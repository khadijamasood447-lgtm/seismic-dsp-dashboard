import { NextResponse } from 'next/server'

import { sampleIslamabadGrid } from '@/lib/islamabadGrid'
import { getPgaForSector, inferSectorFromSiteName, sampleSubbasinTables } from '@/lib/islamabadTables'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
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

    const sample = await sampleIslamabadGrid(lon, lat)

    const inferredSector = sector ?? (site ? inferSectorFromSiteName(site) : null)
    const pga = inferredSector ? getPgaForSector(inferredSector) : null
    const subbasin = sample.inBounds ? sampleSubbasinTables(lon, lat) : null

  const warning =
    'Cyclic triaxial v4 model cannot be applied directly to GIS rasters yet because its feature schema is lab-series derived; add Islamabad cyclic triaxial targets to train a GIS→cyclic surrogate.'

    return NextResponse.json({
      ok: true,
      input: { lon, lat },
      sample,
      tables: { sector: inferredSector, pga, subbasin },
      cyclic: null,
      warning,
    })
  } catch (e: any) {
    console.error('sample error', e)
    return NextResponse.json({ ok: false, error: 'Sampling failed' }, { status: 500 })
  }
}
