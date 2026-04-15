import { NextResponse } from 'next/server'

import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function isAdmin(req: Request) {
  const token = String(process.env.ADMIN_DIAG_TOKEN ?? '').trim()
  if (!token) return false
  const got = req.headers.get('x-admin-token')?.trim() || ''
  return got && got === token
}

export async function GET(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get('limit') ?? 200) || 200))
  const entries = logger.getRecent(limit)
  return NextResponse.json({ ok: true, entries })
}

