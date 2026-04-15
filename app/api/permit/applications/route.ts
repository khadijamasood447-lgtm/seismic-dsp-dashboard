import { NextResponse } from 'next/server'

import { getAuthUser, getProfileRole } from '@/lib/permit-supabase'
import { listPermitApplications } from '@/lib/permit-service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const auth = await getAuthUser(req)
  if (!auth.ok) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const role = await getProfileRole(auth.user_id).catch(() => null)
  const apps = await listPermitApplications({ user_id: auth.user_id, role })
  return NextResponse.json({ ok: true, applications: apps })
}

