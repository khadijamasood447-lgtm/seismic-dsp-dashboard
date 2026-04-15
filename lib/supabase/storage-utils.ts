import crypto from 'crypto'

import { createSupabaseServerClient } from '@/lib/supabase/server'

declare global {
  // eslint-disable-next-line no-var
  var __GEONEXUS_BUCKETS_READY__: Record<string, boolean> | undefined
}

function readyMap() {
  if (!global.__GEONEXUS_BUCKETS_READY__) global.__GEONEXUS_BUCKETS_READY__ = {}
  return global.__GEONEXUS_BUCKETS_READY__
}

export async function listBucketsSafe() {
  const supabase = createSupabaseServerClient()
  if (!supabase) return { configured: false, buckets: [] as string[] }
  const { data, error } = await supabase.storage.listBuckets()
  if (error) throw error
  return { configured: true, buckets: (data ?? []).map((b) => b.name) }
}

export async function ensureBucketsExist(requiredBuckets: string[], opts?: { public?: boolean }) {
  const supabase = createSupabaseServerClient()
  if (!supabase) return { ok: false, configured: false, buckets: [] as string[], created: [] as string[], missing: requiredBuckets }

  const { data, error } = await supabase.storage.listBuckets()
  if (error) throw error
  const existing = new Set((data ?? []).map((b) => b.name))

  const created: string[] = []
  const missing = requiredBuckets.filter((b) => !existing.has(b))
  for (const bucket of missing) {
    const key = `bucket:${bucket}`
    if (readyMap()[key]) continue
    const { error: cErr } = await supabase.storage.createBucket(bucket, { public: Boolean(opts?.public) })
    if (!cErr) {
      created.push(bucket)
      readyMap()[key] = true
      existing.add(bucket)
    }
  }

  return { ok: true, configured: true, buckets: Array.from(existing), created, missing: requiredBuckets.filter((b) => !existing.has(b)) }
}

export async function probeBucketReadWrite(bucket: string) {
  const supabase = createSupabaseServerClient()
  if (!supabase) return { configured: false, can_write: false, can_read: false, error: 'Supabase server client not configured' }

  const key = `diag/${crypto.randomUUID()}.txt`
  const payload = new Uint8Array([79, 75])
  try {
    const { error: upErr } = await supabase.storage.from(bucket).upload(key, payload, { upsert: true, contentType: 'text/plain' })
    if (upErr) return { configured: true, can_write: false, can_read: false, error: upErr.message }
  } catch (e: any) {
    return { configured: true, can_write: false, can_read: false, error: String(e?.message ?? 'upload failed') }
  }

  try {
    const expiresIn = 600
    const { data, error: sErr } = await supabase.storage.from(bucket).createSignedUrl(key, expiresIn)
    if (sErr) return { configured: true, can_write: true, can_read: false, error: sErr.message }
    return {
      configured: true,
      can_write: true,
      can_read: Boolean(data?.signedUrl),
      signed_url: data?.signedUrl ?? null,
      signed_url_expires_in_s: expiresIn,
    }
  } catch (e: any) {
    return { configured: true, can_write: true, can_read: false, error: String(e?.message ?? 'signed url failed') }
  } finally {
    try {
      await supabase.storage.from(bucket).remove([key])
    } catch {}
  }
}
