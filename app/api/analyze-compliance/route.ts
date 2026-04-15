import { NextResponse } from 'next/server'

import { rateLimitOk } from '@/lib/rate-limit'
import { getOrCachePrediction, vs30ToSiteClass } from '@/lib/prediction-cache'
import { sampleIslamabadGrid } from '@/lib/islamabadGrid'
import { checkBcpCompliance, extractIfcDataFromUrl, parsePgaScenario, type SiteData } from '@/lib/compliance/bcp-checks'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type ReqBody = {
  ifc_url?: string
  location?: { lat?: number; lon?: number }
  pga_scenario?: string | number
  file_name?: string
}

function getIp(req: Request) {
  const xf = req.headers.get('x-forwarded-for') ?? ''
  const ip = xf.split(',')[0]?.trim()
  return ip || req.headers.get('x-real-ip') || 'local'
}

export async function POST(req: Request) {
  const ip = getIp(req)
  if (!rateLimitOk(`analyze-compliance:${ip}`, 10, 60_000)) {
    return NextResponse.json({ ok: false, error: 'Rate limit exceeded (10 requests/min). Try again shortly.' }, { status: 429 })
  }

  let body: ReqBody
  try {
    body = (await req.json()) as ReqBody
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const ifcUrl = String(body?.ifc_url ?? '').trim()
  if (!ifcUrl) return NextResponse.json({ ok: false, error: 'Missing ifc_url' }, { status: 400 })

  const pga = parsePgaScenario(body?.pga_scenario)

  try {
    const extracted = await extractIfcDataFromUrl(ifcUrl, body?.file_name ?? null)
    const latIn = Number(body?.location?.lat)
    const lonIn = Number(body?.location?.lon)
    const location =
      Number.isFinite(latIn) && Number.isFinite(lonIn)
        ? { lat: latIn, lon: lonIn }
        : extracted.location && Number.isFinite(extracted.location.lat) && Number.isFinite(extracted.location.lon)
          ? extracted.location
          : null

    if (!location) {
      return NextResponse.json({
        ok: false,
        error: 'Location is missing. Provide location.lat/lon or include georeferenced IfcSite in IFC.',
      }, { status: 400 })
    }

    const grid = await sampleIslamabadGrid(location.lon, location.lat)
    const layers = grid.layers ?? {}
    const vs30 = typeof layers.vs30 === 'number' ? layers.vs30 : null
    const siteClass = (vs30ToSiteClass(vs30) as 'C' | 'D' | 'E' | null) ?? 'N/A'
    const depths = [1, 2, 3, 5]
    const vsByDepth = await Promise.all(
      depths.map(async (d) => {
        const pred = await getOrCachePrediction({ lat: location.lat, lon: location.lon, depth_m: d, pga_g: pga })
        return { depth_m: d, vs_m_s: pred.vs_predicted, p10: pred.vs_p10, p90: pred.vs_p90 }
      }),
    )

    const site: SiteData = {
      location,
      pga_g: pga,
      site_class: siteClass,
      vs30_m_s: vs30,
      vs_by_depth: vsByDepth,
      soil_properties: {
        sand_pct: typeof layers.sand_pct === 'number' ? layers.sand_pct : null,
        silt_pct: typeof layers.silt_pct === 'number' ? layers.silt_pct : null,
        clay_pct: typeof layers.clay_pct === 'number' ? layers.clay_pct : null,
        bulk_density_g_cm3: typeof layers.bulk_density === 'number' ? layers.bulk_density : null,
        water_content_pct: typeof layers.water_content === 'number' ? layers.water_content : null,
      },
    }

    const result = checkBcpCompliance(extracted, site)
    return NextResponse.json({
      ok: true,
      analysis: result,
      summary: result.summary,
      disclaimer: result.disclaimer,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? 'Compliance analysis failed') }, { status: 500 })
  }
}

