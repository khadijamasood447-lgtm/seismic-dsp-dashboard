import fs from 'fs/promises'
import path from 'path'

export type AoiPredictionRow = {
  lon: number
  lat: number
  gmax_mpa_predicted: number
  gmax_mpa_p10: number
  gmax_mpa_p90: number
  gmax_mpa_std: number
  ll_predicted?: number
  pl_predicted?: number
  [k: string]: number | string | null | undefined
}

const MAX_GMAX_MPA = 200

function clampGmaxRow(row: AoiPredictionRow): AoiPredictionRow {
  const clamp = (v: any) => {
    const n = Number(v)
    if (!Number.isFinite(n)) return v
    return n > MAX_GMAX_MPA ? MAX_GMAX_MPA : n
  }
  const gmax_mpa_predicted = clamp((row as any).gmax_mpa_predicted)
  const gmax_mpa_p10 = clamp((row as any).gmax_mpa_p10)
  const gmax_mpa_p90 = clamp((row as any).gmax_mpa_p90)
  const gmax_mpa_std = clamp((row as any).gmax_mpa_std)
  return { ...row, gmax_mpa_predicted, gmax_mpa_p10, gmax_mpa_p90, gmax_mpa_std }
}

type Index = {
  minLon: number
  minLat: number
  dx: number
  dy: number
  map: Map<string, AoiPredictionRow>
  bounds: { left: number; right: number; bottom: number; top: number }
}

let cachedIndex: Index | null = null
let loading: Promise<Index> | null = null

function parseCsvLine(line: string): string[] {
  return line.split(',')
}

function toNumberOrNull(v: string): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function keyFor(i: number, j: number) {
  return `${i}_${j}`
}

function approxDistanceM(lon1: number, lat1: number, lon2: number, lat2: number) {
  const rad = Math.PI / 180
  const x = (lon2 - lon1) * rad * Math.cos(((lat1 + lat2) * rad) / 2)
  const y = (lat2 - lat1) * rad
  return Math.sqrt(x * x + y * y) * 6371000
}

async function loadIndex(): Promise<Index> {
  if (cachedIndex) return cachedIndex
  if (loading) return loading

  loading = (async () => {
    const filePath = path.join(process.cwd(), 'outputs', 'predictions', 'aoi_predictions_final.csv')
    const raw = await fs.readFile(filePath, 'utf-8')
    const lines = raw.split(/\r?\n/).filter(Boolean)
    if (lines.length < 2) throw new Error('aoi_predictions_final.csv is empty')

    const header = parseCsvLine(lines[0]).map((h) => h.trim())
    const lonIdx = header.indexOf('lon')
    const latIdx = header.indexOf('lat')
    if (lonIdx === -1 || latIdx === -1) throw new Error('aoi_predictions_final.csv missing lon/lat')

    const lons: number[] = []
    const lats: number[] = []
    const rows: AoiPredictionRow[] = []

    for (let i = 1; i < lines.length; i++) {
      const parts = parseCsvLine(lines[i])
      if (parts.length !== header.length) continue
      const lon = toNumberOrNull(parts[lonIdx])
      const lat = toNumberOrNull(parts[latIdx])
      if (lon == null || lat == null) continue
      const row: AoiPredictionRow = { lon, lat, gmax_mpa_predicted: NaN, gmax_mpa_p10: NaN, gmax_mpa_p90: NaN, gmax_mpa_std: NaN }
      for (let c = 0; c < header.length; c++) {
        const k = header[c]
        if (k === 'lon' || k === 'lat') continue
        const n = toNumberOrNull(parts[c])
        ;(row as any)[k] = n ?? parts[c]
      }
      rows.push(row)
      lons.push(lon)
      lats.push(lat)
    }

    const minLon = Math.min(...lons)
    const maxLon = Math.max(...lons)
    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)

    const uniqLons = Array.from(new Set(lons)).sort((a, b) => a - b)
    const uniqLats = Array.from(new Set(lats)).sort((a, b) => a - b)

    const diffsLon: number[] = []
    for (let i = 1; i < uniqLons.length; i++) diffsLon.push(uniqLons[i] - uniqLons[i - 1])
    const diffsLat: number[] = []
    for (let i = 1; i < uniqLats.length; i++) diffsLat.push(uniqLats[i] - uniqLats[i - 1])

    diffsLon.sort((a, b) => a - b)
    diffsLat.sort((a, b) => a - b)
    const dx = diffsLon.length ? diffsLon[Math.floor(diffsLon.length / 2)] : 0.0
    const dy = diffsLat.length ? diffsLat[Math.floor(diffsLat.length / 2)] : 0.0
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || dx <= 0 || dy <= 0) throw new Error('Failed to infer grid spacing from predictions')

    const map = new Map<string, AoiPredictionRow>()
    for (const r of rows) {
      const ii = Math.round((r.lon - minLon) / dx)
      const jj = Math.round((r.lat - minLat) / dy)
      map.set(keyFor(ii, jj), r)
    }

    cachedIndex = {
      minLon,
      minLat,
      dx,
      dy,
      map,
      bounds: { left: minLon, right: maxLon, bottom: minLat, top: maxLat },
    }
    return cachedIndex
  })()

  try {
    return await loading
  } finally {
    loading = null
  }
}

export type AoiSampleResult =
  | { ok: true; inBounds: true; nearest: AoiPredictionRow; approx_distance_m: number }
  | { ok: true; inBounds: false; bounds: Index['bounds'] }
  | { ok: false; error: string }

export async function sampleAoiPredictions(lon: number, lat: number): Promise<AoiSampleResult> {
  try {
    const idx = await loadIndex()
    const inBounds = lon >= idx.bounds.left && lon <= idx.bounds.right && lat >= idx.bounds.bottom && lat <= idx.bounds.top
    if (!inBounds) return { ok: true, inBounds: false, bounds: idx.bounds }

    const ii0 = Math.round((lon - idx.minLon) / idx.dx)
    const jj0 = Math.round((lat - idx.minLat) / idx.dy)

    let best: AoiPredictionRow | null = null
    let bestD = Number.POSITIVE_INFINITY
    for (let r = 0; r <= 3; r++) {
      for (let di = -r; di <= r; di++) {
        for (let dj = -r; dj <= r; dj++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue
          const row = idx.map.get(keyFor(ii0 + di, jj0 + dj))
          if (!row) continue
          const d = approxDistanceM(lon, lat, row.lon, row.lat)
          if (d < bestD) {
            bestD = d
            best = row
          }
        }
      }
      if (best) break
    }

    if (!best) return { ok: false, error: 'No nearby prediction found' }
    return { ok: true, inBounds: true, nearest: clampGmaxRow(best), approx_distance_m: bestD }
  } catch (e: any) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
