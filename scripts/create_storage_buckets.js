require('dotenv').config({ path: '.env.local' })

const { createClient } = require('@supabase/supabase-js')

function looksReal(v) {
  if (!v) return false
  const s = String(v).trim()
  return s !== '' && !/YOUR_|your-|YOUR_PROJECT_REF/i.test(s)
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!looksReal(url) || !looksReal(key)) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
    process.exit(1)
  }

  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
  const required = ['ifc_uploads', 'reports', 'models']

  const { data: buckets, error: listErr } = await supabase.storage.listBuckets()
  if (listErr) {
    console.error('Failed to list buckets:', listErr.message)
    process.exit(1)
  }

  const existing = new Set((buckets || []).map((b) => b.name))
  const created = []

  for (const b of required) {
    if (existing.has(b)) continue
    const { error } = await supabase.storage.createBucket(b, { public: false })
    if (error) {
      console.error(`Failed to create bucket ${b}:`, error.message)
    } else {
      created.push(b)
      existing.add(b)
      console.log(`Created bucket: ${b}`)
    }
  }

  console.log(JSON.stringify({ ok: true, buckets: Array.from(existing), created }, null, 2))
}

main().catch((e) => {
  console.error('Unexpected error:', e)
  process.exit(1)
})

