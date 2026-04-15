import { NextResponse } from 'next/server'

import { deleteReport, listReports } from '@/lib/supabase/app-data'
import { getUserIdFromHeaders } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function getClientId(req: Request) {
  return req.headers.get('x-client-id')?.trim() || null
}

export async function GET(req: Request) {
  try {
    const userId = getUserIdFromHeaders(req)
    const clientId = getClientId(req)
    const reports = await listReports({ user_id: userId, client_id: clientId })
    return NextResponse.json({ ok: true, reports })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? 'Failed to list reports') }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ ok: false, error: 'Missing report id' }, { status: 400 })
  try {
    const userId = getUserIdFromHeaders(req)
    const clientId = getClientId(req)
    await deleteReport(id, { user_id: userId, client_id: clientId })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? 'Failed to delete report') }, { status: 500 })
  }
}

