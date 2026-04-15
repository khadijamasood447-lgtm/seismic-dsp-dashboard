import { NextResponse } from 'next/server'

import { rateLimitOk } from '@/lib/rate-limit'
import { getAuthUser, getProfileRole } from '@/lib/permit-supabase'
import { notifyUser } from '@/lib/permit-notifications'
import { submitPermitReview } from '@/lib/permit-service'
import { createPermitAdminClient } from '@/lib/permit-supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function ip(req: Request) {
  const xf = req.headers.get('x-forwarded-for') ?? ''
  return xf.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local'
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!rateLimitOk(`permit_review:${ip(req)}`, 20, 60_000)) {
    return NextResponse.json({ ok: false, error: 'Rate limit exceeded.' }, { status: 429 })
  }

  const auth = await getAuthUser(req)
  if (!auth.ok) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const role = await getProfileRole(auth.user_id).catch(() => null)
  const okAuthority = role && ['authority', 'authority_admin', 'reviewer', 'admin'].includes(role.toLowerCase())
  if (!okAuthority) return NextResponse.json({ ok: false, error: 'Authority role required' }, { status: 403 })

  const id = String(params.id ?? '').trim()
  if (!id) return NextResponse.json({ ok: false, error: 'Missing id' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const decision = String(body?.decision ?? '').trim()
  if (!['approved', 'rejected', 'needs_revision'].includes(decision)) {
    return NextResponse.json({ ok: false, error: 'Invalid decision' }, { status: 400 })
  }

  const comments = String(body?.comments ?? '').trim() || null
  const code_sections_cited = body?.code_sections_cited ?? null
  const approved_conditions = body?.approved_conditions ?? null

  const res = await submitPermitReview({
    application_id: id,
    reviewer_id: auth.user_id,
    decision: decision as any,
    comments,
    code_sections_cited,
    approved_conditions,
  })

  try {
    const admin = createPermitAdminClient()
    const { data: app } = await admin.from('permit_applications').select('engineer_id, application_number').eq('id', id).maybeSingle()
    const engineerId = (app as any)?.engineer_id
    if (engineerId) {
      await notifyUser({
        user_id: engineerId,
        application_id: id,
        type: 'review_completed',
        message: `Permit application ${(app as any)?.application_number ?? id} status: ${decision}`,
      })
    }
  } catch {}

  return NextResponse.json({ ok: true, application: res.application })
}

