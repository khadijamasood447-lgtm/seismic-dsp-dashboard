import { NextResponse } from 'next/server'

import { sampleAoiPredictions } from '@/lib/aoiPredictions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { points?: Array<{ lon: number; lat: number }> } | null
  if (!body?.points || !Array.isArray(body.points) || body.points.length === 0) {
    return NextResponse.json({ ok: false, error: 'Missing points[]' }, { status: 400 })
  }

  const results = await Promise.all(
    body.points.map(async (p) => {
      const lon = Number(p?.lon)
      const lat = Number(p?.lat)
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        return { ok: false, error: 'Invalid lon/lat' }
      }
      return sampleAoiPredictions(lon, lat)
    }),
  )

  return NextResponse.json({ ok: true, results })
}

