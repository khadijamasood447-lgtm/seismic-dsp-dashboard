import { NextResponse } from 'next/server'

import { logger } from '@/lib/logger'
import { ensureBucketsExist, listBucketsSafe, probeBucketReadWrite } from '@/lib/supabase/storage-utils'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function isAdmin(req: Request) {
  const token = String(process.env.ADMIN_DIAG_TOKEN ?? '').trim()
  if (!token) return false
  const got = req.headers.get('x-admin-token')?.trim() || ''
  return got && got === token
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const autofix = url.searchParams.get('autofix') === '1'
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
  const supabaseHost = (() => {
    try {
      return supabaseUrl ? new URL(supabaseUrl).host : null
    } catch {
      return null
    }
  })()
  const servicePrefix = (() => {
    const k = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
    return k ? k.slice(0, 10) + '...' : null
  })()

  const requiredBuckets = ['ifc_uploads', 'reports', 'models']
  try {
    const listed = await listBucketsSafe()
    const found = listed.buckets
    const exists = (name: string) => found.includes(name)

    let created: string[] = []
    if (autofix && isAdmin(req)) {
      const ensured = await ensureBucketsExist(requiredBuckets, { public: false })
      created = ensured.created
    }

    const perms: any = {}
    const missingByProbe = new Set<string>()
    for (const b of requiredBuckets) {
      const probe = await probeBucketReadWrite(b)
      const err = String((probe as any)?.error ?? '')
      if (/bucket/i.test(err) && /not found/i.test(err)) missingByProbe.add(b)
      perms[b] = { ...probe, missing: missingByProbe.has(b) }
    }

    const bucketsNow = (await listBucketsSafe()).buckets
    const missing = requiredBuckets.filter((b) => missingByProbe.has(b))
    const res = {
      ok: true,
      configured: listed.configured,
      supabase_url_host: supabaseHost,
      supabase_service_role_prefix: servicePrefix,
      buckets_found: bucketsNow,
      ifc_uploads_exists: bucketsNow.includes('ifc_uploads') || !missingByProbe.has('ifc_uploads'),
      reports_exists: bucketsNow.includes('reports') || !missingByProbe.has('reports'),
      models_exists: bucketsNow.includes('models') || !missingByProbe.has('models'),
      permissions: perms,
      created_buckets: created,
      suggestion: missing.length ? `Create missing buckets in Supabase Storage: ${missing.join(', ')}.` : null,
      note: 'Signed URLs in this diagnostic expire quickly. If you open an old signed_url later, you may see InvalidJWT/exp errors.',
    }
    logger.info('DIAG_STORAGE', 'storage_diagnose', { configured: listed.configured, buckets: bucketsNow, created })
    return NextResponse.json(res)
  } catch (e: any) {
    logger.error('DIAG_STORAGE', 'storage_diagnose failed', e)
    return NextResponse.json({ ok: false, error: String(e?.message ?? 'Storage diagnose failed') }, { status: 500 })
  }
}
