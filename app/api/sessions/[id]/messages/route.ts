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
  if (!sessionId) return NextResponse.json({ ok: false, error: 'Missing session id' }, { status: 400 })

  try {
    const userId = getUserIdFromHeaders(req)
    const clientId = getClientId(req)
    const messages = await listChatMessages(sessionId, { user_id: userId, client_id: clientId })
    return NextResponse.json({ ok: true, messages })
  } catch (e: any) {
    const msg = String(e?.message ?? 'Failed to load messages')
    const error_type = /relation .* does not exist|does not exist/i.test(msg) ? 'DATABASE_TABLE_MISSING' : 'DATABASE_QUERY_FAILED'
    return NextResponse.json({ ok: false, error: msg, error_type }, { status: 500 })
  }
}
