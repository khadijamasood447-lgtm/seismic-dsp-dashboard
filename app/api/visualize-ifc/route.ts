import { NextResponse } from 'next/server'
import crypto from 'crypto'

import { rateLimitOk } from '@/lib/rate-limit'
import { createSignedDownloadUrl, uploadBufferToBucket } from '@/lib/supabase/app-data'
import { getUserIdFromHeaders } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { ensureBucketsExist, listBucketsSafe } from '@/lib/supabase/storage-utils'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function getIp(req: Request) {
  const xf = req.headers.get('x-forwarded-for') ?? ''
  const ip = xf.split(',')[0]?.trim()
  return ip || req.headers.get('x-real-ip') || 'local'
}

function cleanFileName(name: string) {
  return name.replace(/[\\/:"*?<>|]+/g, '_').slice(0, 180)
}

export async function POST(req: Request) {
  const reqId = `ifc_${Date.now()}_${Math.random().toString(16).slice(2)}`
  const startedAt = Date.now()
  const ip = getIp(req)
  if (!rateLimitOk(`viz-ifc:${ip}`, 10, 60_000)) {
    return NextResponse.json({ ok: false, error: 'Rate limit exceeded (10 requests/min). Try again shortly.' }, { status: 429 })
  }

  logger.info('IFC', 'upload_request received', { req_id: reqId, ip })

  let fd: FormData
  try {
    fd = await req.formData()
  } catch {
    return NextResponse.json({ ok: false, error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const file = fd.get('file')
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: 'Missing file' }, { status: 400 })

  const name = cleanFileName(String(file.name ?? 'upload.ifc'))
  if (!name.toLowerCase().endsWith('.ifc')) {
    return NextResponse.json({ ok: false, error: 'Only .ifc files are supported' }, { status: 400 })
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const sizeMb = bytes.byteLength / 1_000_000
  const uploadId = crypto.randomUUID()
  const userId = getUserIdFromHeaders(req)
  const clientId = req.headers.get('x-client-id')?.trim() || null
  const objectPath = `${clientId || userId || 'public'}/${uploadId}_${name}`
  logger.info('IFC', 'file_received', {
    req_id: reqId,
    file_name: name,
    bytes: bytes.byteLength,
    size_mb: Number(sizeMb.toFixed(2)),
    client_id: Boolean(clientId),
    user_id: Boolean(userId),
  })

  try {
    const before = await listBucketsSafe()
    logger.debug('IFC', 'bucket_list', { req_id: reqId, configured: before.configured, buckets: before.buckets })
    const ensured = await ensureBucketsExist(['ifc_uploads', 'reports', 'models'], { public: false })
    logger.info('IFC', 'ensure_buckets', { req_id: reqId, configured: ensured.configured, created: ensured.created, missing: ensured.missing })
  } catch (e: any) {
    logger.error('IFC', 'ensure_buckets failed', { req_id: reqId, error: String(e?.message ?? e) })
  }

  try {
    const t0 = Date.now()
    const uploaded = await uploadBufferToBucket('ifc_uploads', objectPath, bytes, 'application/octet-stream')
    logger.info('IFC', 'upload_complete', { req_id: reqId, ms: Date.now() - t0 })
    if (!uploaded) {
      return NextResponse.json(
        {
          ok: false,
          error_code: 'STORAGE_NOT_CONFIGURED',
          error:
            'IFC upload is not configured on the server. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, and create a Storage bucket named ifc_uploads.',
        },
        { status: 500 },
      )
    }
  } catch (e: any) {
    const msg = String(e?.message ?? 'unknown error')
    if (/bucket not found/i.test(msg)) {
      return NextResponse.json(
        {
          ok: false,
          error_code: 'STORAGE_BUCKET_MISSING',
          error:
            'IFC upload failed: Storage bucket "ifc_uploads" was not found. Create it in Supabase Storage (bucket name: ifc_uploads) and retry.',
        },
        { status: 500 },
      )
    }
    return NextResponse.json(
      { ok: false, error_code: 'IFC_UPLOAD_FAILED', error: `IFC upload failed: ${msg}` },
      { status: 500 },
    )
  }

  const t1 = Date.now()
  const signed = await createSignedDownloadUrl('ifc_uploads', objectPath, 60 * 60 * 24 * 7)
  logger.info('IFC', 'signed_url_complete', { req_id: reqId, ms: Date.now() - t1 })
  if (!signed) {
    return NextResponse.json(
      {
        ok: false,
        error_code: 'SIGNED_URL_FAILED',
        error:
          'IFC uploaded but a signed URL could not be created. Ensure Supabase Storage is enabled and the ifc_uploads bucket exists.',
      },
      { status: 500 },
    )
  }

  logger.info('IFC', 'upload_success', { req_id: reqId, object_path: objectPath, total_ms: Date.now() - startedAt })
  return NextResponse.json({
    ok: true,
    file_name: name,
    object_path: objectPath,
    file_url: signed,
    expires_in_s: 60 * 60 * 24 * 7,
  })
}
