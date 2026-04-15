import { NextResponse } from 'next/server'

import { getAuthUser } from '@/lib/permit-supabase'
import { listNotifications } from '@/lib/permit-notifications'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const auth = await getAuthUser(req)
  if (!auth.ok) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const items = await listNotifications({ user_id: auth.user_id })
  return NextResponse.json({ ok: true, notifications: items })
}

