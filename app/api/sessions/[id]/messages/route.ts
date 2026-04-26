import { NextResponse } from 'next/server'

import { listChatMessages } from '@/lib/supabase/app-data'
import { getUserIdFromHeaders } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function getClientId(req: Request) {
  return req.headers.get('x-client-id')?.trim() || null
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const sessionId = String(params.id ?? '').trim()
  const clientId = getClientId(req)
  const userId = getUserIdFromHeaders(req)

  console.log('SESSION_MESSAGES_REQUEST', {
    method: 'GET',
    url: req.url,
    session_id: sessionId,
    has_user_id: Boolean(userId),
    has_client_id: Boolean(clientId),
  })

  if (!sessionId) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Missing session id',
        details: { hint: 'Request path should be /api/sessions/{id}/messages', session_id: sessionId },
      },
      { status: 400 },
    )
  }

  try {
    const messages = await listChatMessages(sessionId, { user_id: userId, client_id: clientId })
    return NextResponse.json({ ok: true, messages })
  } catch (e: any) {
    const msg = String(e?.message ?? 'Failed to load messages')
    const error_type = /relation .* does not exist|does not exist/i.test(msg) ? 'DATABASE_TABLE_MISSING' : 'DATABASE_QUERY_FAILED'
    console.error('SESSION_MESSAGES_GET_FAILED', { session_id: sessionId, error_type, message: msg })
    return NextResponse.json({ ok: false, error: msg, error_type }, { status: 200 })
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const sessionId = String(params.id ?? '').trim()
  let body: any = null
  try {
    body = await req.clone().json()
  } catch {}
  console.log('SESSION_MESSAGES_UNSUPPORTED_METHOD', { method: 'POST', url: req.url, session_id: sessionId, body_keys: body ? Object.keys(body) : [] })
  return NextResponse.json({ ok: false, error: 'Method not allowed' }, { status: 405 })
}
