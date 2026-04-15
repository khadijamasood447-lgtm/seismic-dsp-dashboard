import { NextResponse } from 'next/server'

import { getAuthUser } from '@/lib/permit-supabase'
import { markNotificationsRead } from '@/lib/permit-notifications'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const auth = await getAuthUser(req)
  if (!auth.ok) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const ids = Array.isArray(body?.ids) ? body.ids.map((x: any) => String(x)) : []
  if (!ids.length) return NextResponse.json({ ok: false, error: 'Missing ids' }, { status: 400 })
  await markNotificationsRead({ user_id: auth.user_id, ids })
  return NextResponse.json({ ok: true })
}

