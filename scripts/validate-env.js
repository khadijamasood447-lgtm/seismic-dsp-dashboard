const { createClient } = require('@supabase/supabase-js')

function looksReal(v) {
  if (!v) return false
  const s = String(v).trim()
  return s !== '' && !/YOUR_|your-|YOUR_PROJECT_REF/i.test(s)
}

async function testAnthropic(model, key) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 12000)
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': key,
      },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        temperature: 0,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
      }),
      signal: ctrl.signal,
    })
    return { ok: resp.ok, status: resp.status }
  } catch (e) {
    return { ok: false, status: null, error: String(e && e.message ? e.message : e) }
  } finally {
    clearTimeout(t)
  }
}

async function testSupabase(url, serviceRole) {
  const sb = createClient(url, serviceRole, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data, error } = await sb.storage.listBuckets()
  if (error) return { ok: false, error: error.message }
  return { ok: true, bucketCount: (data || []).length }
}

async function main() {
  const enforce =
    String(process.env.SKIP_ENV_VALIDATE || '').trim() !== '1' &&
    (process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT || !!process.env.VERCEL)

  const result = { ok: true, errors: [], warnings: [] }

  const model = process.env.ANTHROPIC_MODEL || 'claude-3-haiku-20240307'
  const key = process.env.ANTHROPIC_API_KEY || ''
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  const supabaseService = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

  if (!looksReal(model)) result.errors.push('ANTHROPIC_MODEL is missing/placeholder')
  if (!looksReal(key)) result.errors.push('ANTHROPIC_API_KEY is missing/placeholder')
  if (!looksReal(supabaseUrl)) result.errors.push('NEXT_PUBLIC_SUPABASE_URL is missing/placeholder')
  if (!looksReal(supabaseAnon)) result.errors.push('NEXT_PUBLIC_SUPABASE_ANON_KEY is missing/placeholder')
  if (!looksReal(supabaseService)) result.errors.push('SUPABASE_SERVICE_ROLE_KEY is missing/placeholder')

  if (looksReal(model) && looksReal(key)) {
    const a = await testAnthropic(model, key)
    if (!a.ok) result.errors.push(`Anthropic check failed (status ${a.status || 'N/A'})`)
  }

  if (looksReal(supabaseUrl) && looksReal(supabaseService)) {
    const s = await testSupabase(supabaseUrl, supabaseService)
    if (!s.ok) result.errors.push(`Supabase storage check failed (${s.error || 'unknown'})`)
  }

  result.ok = result.errors.length === 0
  process.stdout.write(JSON.stringify({ ...result, enforce, timestamp: new Date().toISOString() }, null, 2) + '\n')
  if (enforce && !result.ok) process.exit(1)
  process.exit(0)
}

main()

