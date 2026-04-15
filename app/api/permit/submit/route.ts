import { NextResponse } from 'next/server'

import { rateLimitOk } from '@/lib/rate-limit'
import { getAuthUser, getProfileRole } from '@/lib/permit-supabase'
import { notifyUser } from '@/lib/permit-notifications'
import { submitPermitApplication } from '@/lib/permit-service'
import { createPermitAdminClient } from '@/lib/permit-supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function ip(req: Request) {
  const xf = req.headers.get('x-forwarded-for') ?? ''
  return xf.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local'
}

export async function POST(req: Request) {
  if (!rateLimitOk(`permit_submit:${ip(req)}`, 10, 60_000)) {
    return NextResponse.json({ ok: false, error: 'Rate limit exceeded.' }, { status: 429 })
  }

  const auth = await getAuthUser(req)
  if (!auth.ok) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const role = await getProfileRole(auth.user_id).catch(() => null)
  if (role && !role.toLowerCase().includes('engineer')) {
    return NextResponse.json({ ok: false, error: 'Engineer role required' }, { status: 403 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ ok: false, error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const projectName = String(form.get('project_name') ?? '').trim()
  const notes = String(form.get('engineer_notes') ?? '').trim() || null
  const lat = Number(form.get('lat'))
  const lon = Number(form.get('lon'))
  const hasLoc = Number.isFinite(lat) && Number.isFinite(lon)

  const file = form.get('ifc_file')
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: 'Missing ifc_file' }, { status: 400 })
  const bytes = new Uint8Array(await file.arrayBuffer())

  const result = await submitPermitApplication({
    engineer_id: auth.user_id,
    file_name: file.name || 'upload.ifc',
    file_bytes: bytes,
    location: hasLoc ? { lat, lon } : null,
    engineer_notes: notes,
  })

  try {
    const admin = createPermitAdminClient()
    const { data: authorities } = await admin
      .from('profiles')
      .select('id, role')
      .in('role', ['authority', 'authority_admin', 'reviewer', 'admin'])
      .limit(200)
    for (const a of (authorities as any[]) ?? []) {
      if (!a?.id) continue
      await notifyUser({
        user_id: a.id,
        application_id: result.application.id,
        type: 'submission',
        message: `New permit application submitted: ${projectName || result.application.application_number}`,
      })
    }
  } catch {}

  return NextResponse.json({
    ok: true,
    application: result.application,
    disclaimer: 'PRELIMINARY ASSESSMENT - NOT FOR CONSTRUCTION. Verify with a licensed engineer and site-specific investigation.',
  })
}

