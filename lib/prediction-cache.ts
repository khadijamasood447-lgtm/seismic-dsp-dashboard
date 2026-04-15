import { sampleIslamabadGrid } from '@/lib/islamabadGrid'
import { queryNearest } from '@/lib/vs-data'
import { getPredictionCache, upsertPredictionCache } from '@/lib/supabase/app-data'

export function vs30ToSiteClass(vs30: number | null) {
  if (typeof vs30 !== 'number' || !Number.isFinite(vs30)) return null
  if (vs30 > 1500) return 'A'
  if (vs30 > 760) return 'B'
  if (vs30 > 360) return 'C'
  if (vs30 > 180) return 'D'
  return 'E'
}

export async function getOrCachePrediction(params: {
  lat: number
  lon: number
  depth_m: number
  pga_g?: number
}) {
  const pga = Number.isFinite(Number(params.pga_g)) ? Number(params.pga_g) : 0.3
  const cached = await getPredictionCache(params.lat, params.lon, params.depth_m, pga).catch(() => null)
  if (cached?.cached) {
    return {
      cached: true,
      vs_predicted: cached.vs_predicted,
      vs_p10: cached.vs_p10,
      vs_p90: cached.vs_p90,
      site_class: cached.site_class,
      grid: null,
    }
  }

  const row = queryNearest(params.lon, params.lat, params.depth_m)
  const grid = await sampleIslamabadGrid(params.lon, params.lat)
  const layers = grid.layers ?? {}
  const siteClass = vs30ToSiteClass(typeof layers.vs30 === 'number' ? layers.vs30 : null)

  await upsertPredictionCache({
    latitude: params.lat,
    longitude: params.lon,
    depth_m: params.depth_m,
    pga_g: pga,
    vs_predicted: row?.vs_predicted_m_s ?? null,
    vs_p10: row?.vs_predicted_p10 ?? null,
    vs_p90: row?.vs_predicted_p90 ?? null,
    sand_pct: typeof layers.sand_pct === 'number' ? layers.sand_pct : null,
    silt_pct: typeof layers.silt_pct === 'number' ? layers.silt_pct : null,
    clay_pct: typeof layers.clay_pct === 'number' ? layers.clay_pct : null,
    bulk_density: typeof layers.bulk_density === 'number' ? layers.bulk_density : null,
    water_content: typeof layers.water_content === 'number' ? layers.water_content : null,
    site_class: siteClass,
  }).catch(() => null)

  return {
    cached: false,
    vs_predicted: row?.vs_predicted_m_s ?? null,
    vs_p10: row?.vs_predicted_p10 ?? null,
    vs_p90: row?.vs_predicted_p90 ?? null,
    site_class: siteClass,
    grid,
  }
}
