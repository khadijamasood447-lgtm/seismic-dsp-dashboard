import { NextResponse } from 'next/server'

import { queryNearest, sectorSummary } from '@/lib/vs-data'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type QueryRequest =
  | { type: 'location'; value: string; depth?: number }
  | { type: 'sector'; value: string; depth?: number }

function parseDepth(v: any) {
  const d = Number(v)
  return Number.isFinite(d) ? d : 2.0
}

function parseLonLat(value: string) {
  const s = String(value ?? '').trim()
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)/)
  if (!m) return null
  const a = Number(m[1])
  const b = Number(m[2])
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  const looksLikeLatLon = Math.abs(a) <= 90 && Math.abs(b) <= 180
  const looksLikeLonLat = Math.abs(a) <= 180 && Math.abs(b) <= 90
  if (looksLikeLatLon && !looksLikeLonLat) return { lat: a, lon: b }
  if (looksLikeLonLat && !looksLikeLatLon) return { lon: a, lat: b }
  return { lat: a, lon: b }
}

export async function POST(req: Request) {
  let body: QueryRequest
  try {
    body = (await req.json()) as QueryRequest
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const type = String((body as any)?.type ?? '').toLowerCase()
  const value = String((body as any)?.value ?? '').trim()
  const depth = parseDepth((body as any)?.depth)

  if (!value) return NextResponse.json({ ok: false, error: 'Missing value' }, { status: 400 })

  if (type === 'sector') {
    const s = sectorSummary(value, depth)
    if (!s) return NextResponse.json({ ok: false, error: 'Sector not found at this depth' }, { status: 404 })
    return NextResponse.json({
      ok: true,
      type: 'sector',
      sector: s.sector_norm,
      depth_m: s.depth_m,
      centroid: { lon: s.centroid_lon, lat: s.centroid_lat },
      vs: s.vs_mean,
      p10: s.vs_p10_mean,
      p90: s.vs_p90_mean,
      n: s.n,
    })
  }

  if (type === 'location') {
    const ll = parseLonLat(value)
    if (!ll) return NextResponse.json({ ok: false, error: 'Invalid coordinates. Use "lat, lon".' }, { status: 400 })
    const row = queryNearest(ll.lon, ll.lat, depth)
    if (!row) return NextResponse.json({ ok: false, error: 'No prediction found for this depth' }, { status: 404 })

    const soilProps: Record<string, any> = {}
    const keep = [
      'sand_pct',
      'silt_pct',
      'clay_pct',
      'bulk_density_g_cm3',
      'water_content_pct',
      'elevation_m',
      'bedrock_depth_m',
      'land_cover_class',
      'coarse_fragments_pct',
      'slope_deg',
      'aspect_deg',
      'twi',
      'dist_to_water_m',
      'dist_to_stream_m',
      'dist_to_fault_km',
      'runoff_class',
      'groundwater_depth_m',
      'vegetation_density_pct',
      'urban_density_pct',
      'pga_by_sector_g',
      'sector_norm',
    ]
    for (const k of keep) soilProps[k] = (row as any)[k]

    return NextResponse.json({
      ok: true,
      type: 'location',
      input: { lon: ll.lon, lat: ll.lat, depth_m: depth },
      nearest: { lon: row.longitude, lat: row.latitude, sector: row.sector_norm ?? null },
      depth_m: depth,
      vs: row.vs_predicted_m_s,
      p10: row.vs_predicted_p10,
      p90: row.vs_predicted_p90,
      std: row.vs_pred_std_m_s,
      nehrp_class: row.nehrp_class ?? null,
      soil_properties: soilProps,
    })
  }

  return NextResponse.json({ ok: false, error: 'Unsupported query type' }, { status: 400 })
}
