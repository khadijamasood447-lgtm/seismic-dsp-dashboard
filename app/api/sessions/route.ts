import { NextResponse } from 'next/server'
import crypto from 'crypto'

import { rateLimitOk } from '@/lib/rate-limit'
import { deleteChatSession, listChatSessions, upsertChatSession } from '@/lib/supabase/app-data'
import { getUserIdFromHeaders } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function getIp(req: Request) {
  const xf = req.headers.get('x-forwarded-for') ?? ''
  const ip = xf.split(',')[0]?.trim()
  return ip || req.headers.get('x-real-ip') || 'local'
}

function getClientId(req: Request) {
  return req.headers.get('x-client-id')?.trim() || null
}

export async function GET(req: Request) {
  const userId = getUserIdFromHeaders(req)
  const clientId = getClientId(req)
  try {
    const sessions = await listChatSessions({ user_id: userId, client_id: clientId })
    return NextResponse.json({ ok: true, sessions })
  } catch (e: any) {
    const msg = String(e?.message ?? 'Failed to list sessions')
    const error_type = /relation .* does not exist|does not exist/i.test(msg) ? 'DATABASE_TABLE_MISSING' : 'DATABASE_QUERY_FAILED'
    return NextResponse.json({ ok: false, error: msg, error_type }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const ip = getIp(req)
  if (!rateLimitOk(`sessions:${ip}`, 20, 60_000)) {
    return NextResponse.json({ ok: false, error: 'Rate limit exceeded.' }, { status: 429 })
  }
  const userId = getUserIdFromHeaders(req)
  const clientId = getClientId(req)
  try {
    const body = await req.json().catch(() => ({}))
    const id = String(body?.id ?? '').trim() || crypto.randomUUID()
    const session = await upsertChatSession({
      id,
      user_id: userId,
      client_id: clientId,
      session_title: String(body?.session_title ?? 'New Chat').trim() || 'New Chat',
      last_message_at: new Date().toISOString(),
    })
    return NextResponse.json({
      ok: true,
      session:
        session ?? {
          id,
          user_id: userId,
          client_id: clientId,
          session_title: String(body?.session_title ?? 'New Chat').trim() || 'New Chat',
          created_at: new Date().toISOString(),
          last_message_at: new Date().toISOString(),
        },
    })
  } catch (e: any) {
    const msg = String(e?.message ?? 'Failed to create session')
    const error_type = /relation .* does not exist|does not exist/i.test(msg) ? 'DATABASE_TABLE_MISSING' : 'DATABASE_QUERY_FAILED'
    return NextResponse.json({ ok: false, error: msg, error_type }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  const userId = getUserIdFromHeaders(req)
  const clientId = getClientId(req)
  try {
    const body = await req.json()
    const id = String(body?.id ?? '').trim()
    if (!id) return NextResponse.json({ ok: false, error: 'Missing session id' }, { status: 400 })
    const session = await upsertChatSession({
      id,
      user_id: userId,
      client_id: clientId,
      session_title: String(body?.session_title ?? '').trim() || 'Untitled Session',
      last_message_at: new Date().toISOString(),
    })
    return NextResponse.json({
      ok: true,
      session:
        session ?? {
          id,
          user_id: userId,
          client_id: clientId,
          session_title: String(body?.session_title ?? '').trim() || 'Untitled Session',
          created_at: new Date().toISOString(),
          last_message_at: new Date().toISOString(),
        },
    })
  } catch (e: any) {
    const msg = String(e?.message ?? 'Failed to rename session')
    const error_type = /relation .* does not exist|does not exist/i.test(msg) ? 'DATABASE_TABLE_MISSING' : 'DATABASE_QUERY_FAILED'
    return NextResponse.json({ ok: false, error: msg, error_type }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const userId = getUserIdFromHeaders(req)
  const clientId = getClientId(req)
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ ok: false, error: 'Missing session id' }, { status: 400 })
  try {
    await deleteChatSession(id, { user_id: userId, client_id: clientId })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    const msg = String(e?.message ?? 'Failed to delete session')
    const error_type = /relation .* does not exist|does not exist/i.test(msg) ? 'DATABASE_TABLE_MISSING' : 'DATABASE_QUERY_FAILED'
    return NextResponse.json({ ok: false, error: msg, error_type }, { status: 500 })
  }
}
