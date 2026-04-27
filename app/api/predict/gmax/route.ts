import { NextResponse } from 'next/server'

import { sampleAoiPredictions } from '@/lib/aoiPredictions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const lon = Number(searchParams.get('lon'))
  const lat = Number(searchParams.get('lat'))
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return NextResponse.json({ ok: false, error: 'Invalid lon/lat' }, { status: 400 })
  }

  const res = await sampleAoiPredictions(lon, lat)
  return NextResponse.json(res)
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { lon?: number; lat?: number } | null
  const lon = body?.lon
  const lat = body?.lat
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return NextResponse.json({ ok: false, error: 'Invalid lon/lat' }, { status: 400 })
  }

  const res = await sampleAoiPredictions(lon, lat)
  return NextResponse.json(res)
}

