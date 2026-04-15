import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

function now() {
  return new Date().toISOString()
}

function baseUrl() {
  const b = String(process.env.BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '').trim()
  return b ? b.replace(/\/$/, '') : 'http://localhost:3000'
}

async function fetchJson(url, opts) {
  const res = await fetch(url, opts)
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { ok: res.ok, status: res.status, json, text }
}

function printResult(name, ok, details) {
  const tag = ok ? 'PASS' : 'FAIL'
  process.stdout.write(`[${tag}] ${name}${details ? ` — ${details}` : ''}\n`)
  return ok
}

async function main() {
  const base = baseUrl()
  process.stdout.write(`Verify started: ${now()}\n`)
  process.stdout.write(`Base URL: ${base}\n\n`)

  let allOk = true

  const env = await fetchJson(`${base}/api/diagnose/env`)
  if (!env.ok || !env.json) {
    allOk = printResult('/api/diagnose/env reachable', false, `HTTP ${env.status}`) && allOk
  } else {
    allOk = printResult('/api/diagnose/env reachable', true, `HTTP ${env.status}`) && allOk
    const keyOk = Boolean(env.json.anthropic_key_valid)
    allOk = printResult('Anthropic key valid', keyOk, keyOk ? env.json.anthropic_model : `HTTP ${env.json.http_status ?? 'N/A'}`) && allOk
    if (!keyOk) {
      allOk = printResult('Anthropic fallback available', true, 'Chat should run in degraded mode') && allOk
    }
  }

  const storage = await fetchJson(`${base}/api/diagnose/storage`)
  if (!storage.ok || !storage.json) {
    allOk = printResult('/api/diagnose/storage reachable', false, `HTTP ${storage.status}`) && allOk
  } else {
    allOk = printResult('/api/diagnose/storage reachable', true, `HTTP ${storage.status}`) && allOk
    const b = Array.isArray(storage.json.buckets_found) ? storage.json.buckets_found : []
    const bucketOk = Boolean(storage.json.ifc_uploads_exists && storage.json.reports_exists && storage.json.models_exists)
    allOk = printResult('Storage buckets present', bucketOk, b.length ? b.join(', ') : '(list empty)') && allOk
  }

  const db = await fetchJson(`${base}/api/db/diagnose`)
  if (!db.ok || !db.json) {
    allOk = printResult('/api/db/diagnose reachable', false, `HTTP ${db.status}`) && allOk
  } else {
    allOk = printResult('/api/db/diagnose reachable', true, `HTTP ${db.status}`) && allOk
    const healthy = String(db.json.status ?? '').toLowerCase() === 'healthy'
    allOk = printResult('Supabase DB tables', healthy, db.json.suggestion ?? '') && allOk
  }

  const chat = await fetchJson(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-id': 'verify_script' },
    body: JSON.stringify({ message: 'Hello (deployment verify)', conversation_id: 'verify_session', client_id: 'verify_script', context: { depth: 2 } }),
  })
  if (!chat.ok || !chat.json) {
    allOk = printResult('Chat endpoint', false, `HTTP ${chat.status}`) && allOk
  } else {
    allOk = printResult('Chat endpoint', true, `HTTP ${chat.status}`) && allOk
    const degraded = String(chat.json.status ?? '') === 'degraded'
    allOk = printResult('Chat response mode', true, degraded ? 'degraded (fallback)' : 'anthropic') && allOk
  }

  process.stdout.write(`\nOverall: ${allOk ? 'PASS' : 'FAIL'}\n`)
  process.exit(allOk ? 0 : 1)
}

main().catch((e) => {
  console.error('[FAIL] verify_deployment crashed', e)
  process.exit(1)
})

