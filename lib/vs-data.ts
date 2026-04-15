import fs from 'fs'
import path from 'path'

export type VsRow = {
  grid_id?: number
  longitude: number
  latitude: number
  depth_m: number
  sector_norm?: string
  vs_predicted_m_s?: number
  vs_predicted_p10?: number
  vs_predicted_p90?: number
  vs_pred_mean_m_s?: number
  vs_pred_p10_m_s?: number
  vs_pred_p90_m_s?: number
  vs_pred_std_m_s?: number
  vs_ensemble_std?: number
  nehrp_class?: string
  [k: string]: any
}

export type TestPointRow = {
  test_id: string
  sector?: string
  sector_norm?: string
  lat: number
  lon: number
  depth_m: number
  vs_m_s: number
  [k: string]: any
}

type Cache = {
  loadedAt: number
  aoiRows: VsRow[]
  byDepth: Map<number, VsRow[]>
  bySectorDepth: Map<string, VsRow[]>
  testPoints: TestPointRow[]
  testById: Map<string, TestPointRow[]>
  meta: any
  metrics: any
}

declare global {
  // eslint-disable-next-line no-var
  var __VS_CACHE__: Cache | undefined
}

function parseCsvLine(line: string) {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur)
  return out
}

function readCsvRows(filePath: string, maxRows?: number) {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const lines = raw.split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return { headers: [], rows: [] as Record<string, string>[] }
  const headers = parseCsvLine(lines[0]).map((h) => h.trim())
  const rows: Record<string, string>[] = []
  const limit = typeof maxRows === 'number' ? Math.min(maxRows, lines.length - 1) : lines.length - 1
  for (let i = 1; i <= limit; i++) {
    const parts = parseCsvLine(lines[i])
    const rec: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) {
      rec[headers[j]] = (parts[j] ?? '').trim()
    }
    rows.push(rec)
  }
  return { headers, rows }
}

function findFirstExisting(candidates: string[]) {
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}

function toNum(v: any) {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim())
  return Number.isFinite(n) ? n : NaN
}

function normalizeSector(s: any) {
  const t = String(s ?? '').trim()
  if (!t) return ''
  return t.replace(/\s+/g, ' ').toUpperCase()
}

export function getVsDataPaths() {
  const cwd = process.cwd()
  const aoiCandidates = [
    path.join(cwd, '..', 'outputs', 'predictions_vs', 'aoi_vs_predictions.csv'),
    path.join(cwd, '..', 'outputs', 'predictions_vs', 'aoi_predictions_vs.csv'),
    path.join(cwd, 'public', 'aoi_vs_predictions.csv'),
    path.join(cwd, 'public', 'aoi_predictions_vs.csv'),
  ]
  const testCandidates = [
    path.join(cwd, '..', 'outputs', 'predictions_vs', 'islamabad_test_points_clean.csv'),
    path.join(cwd, 'public', 'islamabad_test_points_clean.csv'),
    path.join(cwd, 'ISLAMABD DATA', 'islamabad local land test.csv'),
  ]
  const metaCandidates = [
    path.join(cwd, '..', 'outputs', 'predictions_vs', 'aoi_grid_vs_meta.json'),
    path.join(cwd, '..', 'outputs', 'predictions_vs', 'aoi_constrained.geojson'),
    path.join(cwd, '..', 'aoi_constrained.geojson'),
  ]
  const metricsCandidates = [
    path.join(cwd, '..', 'outputs', 'metrics_vs', 'validation_report.json'),
    path.join(cwd, '..', 'outputs', 'metrics_vs', 'validation_report_vs.json'),
  ]

  return {
    aoiCsv: findFirstExisting(aoiCandidates),
    testCsv: findFirstExisting(testCandidates),
    metaPath: findFirstExisting(metaCandidates),
    metricsPath: findFirstExisting(metricsCandidates),
  }
}

export function loadVsCache(force = false): Cache {
  if (!force && global.__VS_CACHE__) return global.__VS_CACHE__

  const paths = getVsDataPaths()
  if (!paths.aoiCsv) throw new Error('Missing aoi_vs_predictions.csv (run Vs pipeline first)')
  if (!paths.testCsv) throw new Error('Missing islamabad_test_points_clean.csv (run Vs pipeline first)')

  const aoiRaw = readCsvRows(paths.aoiCsv)
  const aoiRows: VsRow[] = aoiRaw.rows
    .map((r) => {
      const lon = toNum(r['longitude'])
      const lat = toNum(r['latitude'])
      const depth = toNum(r['depth_m'])
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(depth)) return null
      return {
        ...r,
        longitude: lon,
        latitude: lat,
        depth_m: depth,
        sector_norm: normalizeSector(r['sector_norm']),
        vs_predicted_m_s: Number.isFinite(toNum(r['vs_predicted_m_s'])) ? toNum(r['vs_predicted_m_s']) : toNum(r['vs_pred_mean_m_s']),
        vs_predicted_p10: Number.isFinite(toNum(r['vs_predicted_p10'])) ? toNum(r['vs_predicted_p10']) : toNum(r['vs_pred_p10_m_s']),
        vs_predicted_p90: Number.isFinite(toNum(r['vs_predicted_p90'])) ? toNum(r['vs_predicted_p90']) : toNum(r['vs_pred_p90_m_s']),
        vs_pred_std_m_s: Number.isFinite(toNum(r['vs_pred_std_m_s'])) ? toNum(r['vs_pred_std_m_s']) : toNum(r['vs_ensemble_std']),
        nehrp_class: String(r['nehrp_class'] ?? '').trim(),
      } as VsRow
    })
    .filter(Boolean) as VsRow[]

  const byDepth = new Map<number, VsRow[]>()
  const bySectorDepth = new Map<string, VsRow[]>()
  for (const row of aoiRows) {
    const d = row.depth_m
    if (!byDepth.has(d)) byDepth.set(d, [])
    byDepth.get(d)!.push(row)

    const key = `${normalizeSector(row.sector_norm)}|${d}`
    if (!bySectorDepth.has(key)) bySectorDepth.set(key, [])
    bySectorDepth.get(key)!.push(row)
  }

  const testRaw = readCsvRows(paths.testCsv)
  const testPoints: TestPointRow[] = testRaw.rows
    .map((r) => {
      const lat = toNum(r['lat'])
      const lon = toNum(r['lon'])
      const depth = toNum(r['depth_m'])
      const vs = toNum(r['vs_m_s'])
      const testId = String(r['test_id'] ?? '').trim()
      if (!testId || !Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(depth) || !Number.isFinite(vs)) return null
      return {
        ...r,
        test_id: testId,
        sector: String(r['sector'] ?? '').trim(),
        sector_norm: normalizeSector(r['sector_norm']),
        lat,
        lon,
        depth_m: depth,
        vs_m_s: vs,
      } as TestPointRow
    })
    .filter(Boolean) as TestPointRow[]

  const testById = new Map<string, TestPointRow[]>()
  for (const row of testPoints) {
    if (!testById.has(row.test_id)) testById.set(row.test_id, [])
    testById.get(row.test_id)!.push(row)
  }

  let meta: any = null
  if (paths.metaPath && fs.existsSync(paths.metaPath)) {
    try {
      meta = JSON.parse(fs.readFileSync(paths.metaPath, 'utf-8'))
    } catch {
      meta = null
    }
  }

  let metrics: any = null
  if (paths.metricsPath && fs.existsSync(paths.metricsPath)) {
    try {
      metrics = JSON.parse(fs.readFileSync(paths.metricsPath, 'utf-8'))
    } catch {
      metrics = null
    }
  }

  const cache: Cache = {
    loadedAt: Date.now(),
    aoiRows,
    byDepth,
    bySectorDepth,
    testPoints,
    testById,
    meta,
    metrics,
  }
  global.__VS_CACHE__ = cache
  return cache
}

export function availableDepths() {
  const c = loadVsCache()
  return Array.from(c.byDepth.keys()).sort((a, b) => a - b)
}

export function availableSectors(limit = 200) {
  const c = loadVsCache()
  const s = new Set<string>()
  for (const r of c.aoiRows) {
    if (r.sector_norm) s.add(normalizeSector(r.sector_norm))
  }
  return Array.from(s).filter(Boolean).sort().slice(0, limit)
}

export function queryNearest(lon: number, lat: number, depth: number) {
  const c = loadVsCache()
  const rows = c.byDepth.get(depth) ?? []
  let best: VsRow | null = null
  let bestD = Number.POSITIVE_INFINITY
  for (const r of rows) {
    const dx = r.longitude - lon
    const dy = r.latitude - lat
    const d = dx * dx + dy * dy
    if (d < bestD) {
      bestD = d
      best = r
    }
  }
  return best
}

export function sectorSummary(sector: string, depth: number) {
  const c = loadVsCache()
  const key = `${normalizeSector(sector)}|${depth}`
  const rows = c.bySectorDepth.get(key) ?? []
  if (!rows.length) return null
  const vs = rows.map((r) => toNum(r.vs_predicted_m_s)).filter((x) => Number.isFinite(x)) as number[]
  const p10 = rows.map((r) => toNum(r.vs_predicted_p10)).filter((x) => Number.isFinite(x)) as number[]
  const p90 = rows.map((r) => toNum(r.vs_predicted_p90)).filter((x) => Number.isFinite(x)) as number[]
  if (!vs.length) return null
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length)
  const lonArr = rows.map((r) => toNum(r.longitude)).filter((x) => Number.isFinite(x)) as number[]
  const latArr = rows.map((r) => toNum(r.latitude)).filter((x) => Number.isFinite(x)) as number[]
  return {
    sector_norm: normalizeSector(sector),
    depth_m: depth,
    vs_mean: mean(vs),
    vs_p10_mean: p10.length ? mean(p10) : NaN,
    vs_p90_mean: p90.length ? mean(p90) : NaN,
    vs_min: Math.min(...vs),
    vs_max: Math.max(...vs),
    centroid_lon: lonArr.length ? mean(lonArr) : NaN,
    centroid_lat: latArr.length ? mean(latArr) : NaN,
    n: rows.length,
  }
}

export function compareSectors(sectorA: string, sectorB: string, depth: number) {
  const a = sectorSummary(sectorA, depth)
  const b = sectorSummary(sectorB, depth)
  return { a, b }
}

export function getMetrics() {
  const c = loadVsCache()
  return c.metrics
}

export function getMeta() {
  const c = loadVsCache()
  return c.meta
}
