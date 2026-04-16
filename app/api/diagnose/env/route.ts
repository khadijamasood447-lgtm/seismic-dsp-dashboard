import { NextResponse } from 'next/server'

import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function prefix(key?: string | null) {
  if (!key) return null
  const k = key.trim()
  if (!k) return null
  return k.slice(0, 10) + '...'
}

export async function GET() {
  const ts = new Date().toISOString()
  const env = process.env.NODE_ENV || 'development'
  const model = process.env.ANTHROPIC_MODEL || 'claude-3-sonnet-20240229'
  const key = process.env.ANTHROPIC_API_KEY ? process.env.ANTHROPIC_API_KEY.trim() : undefined

  const out: any = {
    anthropic_key_exists: Boolean(key && key.trim()),
    anthropic_key_prefix: prefix(key),
    anthropic_model: model,
    anthropic_key_valid: false,
    environment: env,
    timestamp: ts,
  }

  if (!key || !key.trim()) {
    out.error = 'Missing ANTHROPIC_API_KEY'
    return NextResponse.json(out)
  }

  const start = Date.now()
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
    })
    const raw = await resp.text()
    out.http_status = resp.status
    out.response_time_ms = Date.now() - start
    out.anthropic_key_valid = resp.ok
    if (!resp.ok) out.error = raw.slice(0, 300)
    logger.info('DIAG_ENV', `anthropic_test status=${resp.status}`, { model, key_prefix: prefix(key), ms: out.response_time_ms })
  } catch (e: any) {
    out.error = String(e?.message ?? 'Anthropic test call failed')
    out.response_time_ms = Date.now() - start
    logger.error('DIAG_ENV', 'anthropic_test failed', e)
  }

  return NextResponse.json(out)
}
