import { NextResponse } from 'next/server'

import { getAuthUser, getProfileRole } from '@/lib/permit-supabase'
import { getPermitApplication } from '@/lib/permit-service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await getAuthUser(req)
  if (!auth.ok) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  await getProfileRole(auth.user_id).catch(() => null)
  const id = String(params.id ?? '').trim()
  if (!id) return NextResponse.json({ ok: false, error: 'Missing id' }, { status: 400 })
  const out = await getPermitApplication(id)
  return NextResponse.json({ ok: true, ...out })
}

