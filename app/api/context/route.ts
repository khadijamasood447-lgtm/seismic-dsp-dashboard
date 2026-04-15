import { NextResponse } from 'next/server'

import { availableDepths, availableSectors, getMeta, getMetrics } from '@/lib/vs-data'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const depths = availableDepths()
    const sectors = availableSectors(500)
    const meta = getMeta()
    const metrics = getMetrics()

    return NextResponse.json({
      ok: true,
      available_depths: depths,
      available_sectors: sectors,
      data_range: meta?.bbox ?? null,
      model_metrics: metrics?.loocv?.ensemble_mean ?? metrics?.loocv?.ensemble_mean ?? null,
      validation: metrics ?? null,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? 'Context unavailable') }, { status: 500 })
  }
}
