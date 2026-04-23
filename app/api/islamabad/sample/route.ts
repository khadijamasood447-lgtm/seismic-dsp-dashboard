import { NextResponse } from 'next/server'

import { sampleIslamabadGrid } from '@/lib/islamabadGrid'
import { getPgaForSector, inferSectorFromSiteName, sampleSubbasinTables } from '@/lib/islamabadTables'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const reqId = `sample_${Date.now()}_${Math.random().toString(16).slice(2)}`
    const { searchParams } = new URL(req.url)
    const lonStr = searchParams.get('lon')
    const latStr = searchParams.get('lat')
    const site = searchParams.get('site')
    const sector = searchParams.get('sector')

    const lon = lonStr ? Number(lonStr) : NaN
    const lat = latStr ? Number(latStr) : NaN

    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      return NextResponse.json({ ok: false, error: 'Invalid lon/lat' }, { status: 400 })
    }

    console.log('SAMPLE_REQUEST', { reqId, lon, lat, has_site: Boolean(site), has_sector: Boolean(sector) })

    const sample = await sampleIslamabadGrid(lon, lat)

    const inferredSector = sector ?? (site ? inferSectorFromSiteName(site) : null)
    const pga = inferredSector ? getPgaForSector(inferredSector) : null
    const subbasin = sample.inBounds ? sampleSubbasinTables(lon, lat) : null

    const shallowVsBase = typeof sample.layers?.pred_vs_sw === 'number' ? sample.layers.pred_vs_sw : null
    const vs_by_depth_m_s: Record<string, number | null> = {
      '1': shallowVsBase,
      '2': shallowVsBase,
      '3': shallowVsBase,
      '4': shallowVsBase,
      '5': shallowVsBase,
    }

  const warning =
    'Cyclic triaxial v4 model cannot be applied directly to GIS rasters yet because its feature schema is lab-series derived; add Islamabad cyclic triaxial targets to train a GIS→cyclic surrogate.'

    return NextResponse.json({
      ok: true,
      input: { lon, lat },
      sample,
      tables: { sector: inferredSector, pga, subbasin },
      shallow_vs_by_depth_m_s: vs_by_depth_m_s,
      cyclic: null,
      warning,
    })
  } catch (e: any) {
    console.error('sample error', e)
    return NextResponse.json({ ok: false, error: 'Sampling failed' }, { status: 500 })
  }
}
