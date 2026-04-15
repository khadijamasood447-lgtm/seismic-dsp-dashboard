import { NextResponse } from 'next/server'

import { listIfcAnalyses } from '@/lib/supabase/app-data'
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
    const analyses = await listIfcAnalyses({ user_id: userId, client_id: clientId })
    return NextResponse.json({ ok: true, analyses })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? 'Failed to list IFC analyses') }, { status: 500 })
  }
}

