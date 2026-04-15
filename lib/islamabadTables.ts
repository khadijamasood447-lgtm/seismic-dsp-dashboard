import fs from 'fs'
import path from 'path'

type PgaRow = {
  sector: string
  returnPeriod: number
  pga500: number | null
  pga2500: number | null
  ss2500: number | null
  s12500: number | null
}

type SubbasinRow = {
  subBasin: string
  lon: number
  lat: number
  areaKm2: number | null
  minElevM: number | null
  maxElevM: number | null
  runoffClass: number | null
  runoffDepthMmMean: number | null
}

type TablesCache = {
  pgaBySector: Map<string, PgaRow>
  subbasins: SubbasinRow[]
}

let cached: TablesCache | null = null

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"'
        i++
        continue
      }
      inQuotes = !inQuotes
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
  return out.map((s) => s.trim())
}

function readCsv(filePath: string): Array<Record<string, string>> {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) return []
  const header = parseCsvLine(lines[0])
  const rows: Array<Record<string, string>> = []
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line)
    const row: Record<string, string> = {}
    for (let i = 0; i < header.length; i++) {
      row[header[i]] = cols[i] ?? ''
    }
    rows.push(row)
  }
  return rows
}

function toNum(v: string): number | null {
  const n = Number(String(v).trim())
  return Number.isFinite(n) ? n : null
}

function toDepthMean(v: string): number | null {
  const s = String(v).trim()
  if (!s) return null
  const m = s.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/)
  if (!m) return toNum(s)
  const a = Number(m[1])
  const b = Number(m[2])
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return (a + b) / 2
}

function loadTables(): TablesCache {
  if (cached) return cached
  const base = path.join(process.cwd(), 'data', 'gis', 'islamabad_zone1', 'standardized')
  const pgaPath = path.join(base, 'pga_islamabad.csv')
  const subbasinPath = path.join(base, 'subbasins_runoff.csv')

  const pgaBySector = new Map<string, PgaRow>()
  if (fs.existsSync(pgaPath)) {
    const rows = readCsv(pgaPath)
    for (const r of rows) {
      const sector = String(r['Sector'] ?? '').trim()
      const returnPeriod = Number(r['Return_Period'] ?? NaN)
      if (!sector || !Number.isFinite(returnPeriod)) continue
      const row: PgaRow = {
        sector,
        returnPeriod,
        pga500: toNum(r['PGA_500'] ?? ''),
        pga2500: toNum(r['PGA_2500'] ?? ''),
        ss2500: toNum(r['Ss_2500'] ?? ''),
        s12500: toNum(r['S1_2500'] ?? ''),
      }
      if (!pgaBySector.has(sector)) pgaBySector.set(sector, row)
    }
  }

  const subbasins: SubbasinRow[] = []
  if (fs.existsSync(subbasinPath)) {
    const rows = readCsv(subbasinPath)
    for (const r of rows) {
      const lat = toNum(r['Latitude'] ?? '')
      const lon = toNum(r['Longitude'] ?? '')
      if (lat == null || lon == null) continue
      subbasins.push({
        subBasin: String(r['Sub_basin'] ?? '').trim(),
        lon,
        lat,
        areaKm2: toNum(r['Area_km2'] ?? ''),
        minElevM: toNum(r['Min_Elev_m'] ?? ''),
        maxElevM: toNum(r['Max_Elev_m'] ?? ''),
        runoffClass: toNum(r['Runoff_Class'] ?? ''),
        runoffDepthMmMean: toDepthMean(r['Runoff_Depth_mm'] ?? ''),
      })
    }
  }

  cached = { pgaBySector, subbasins }
  return cached
}

function idw(lon: number, lat: number, points: SubbasinRow[], k = 5, power = 2) {
  const scored = points
    .map((p) => {
      const dx = lon - p.lon
      const dy = lat - p.lat
      const d2 = dx * dx + dy * dy
      return { p, d2 }
    })
    .sort((a, b) => a.d2 - b.d2)
    .slice(0, Math.min(k, points.length))

  if (scored.length === 0) return null
  if (scored[0].d2 === 0) return { points: scored.map((s) => s.p), weights: [1] }

  const weights = scored.map((s) => 1 / (Math.pow(s.d2, power / 2) + 1e-12))
  const wsum = weights.reduce((a, b) => a + b, 0)
  const norm = weights.map((w) => w / wsum)
  return { points: scored.map((s) => s.p), weights: norm }
}

export function inferSectorFromSiteName(site: string): string | null {
  const m = String(site).toUpperCase().match(/\b([A-Z]-\d{1,2})\b/)
  return m ? m[1] : null
}

export function getPgaForSector(sector: string): PgaRow | null {
  const { pgaBySector } = loadTables()
  return pgaBySector.get(sector) ?? null
}

export function sampleSubbasinTables(lon: number, lat: number) {
  const { subbasins } = loadTables()
  const fit = idw(lon, lat, subbasins, 5, 2)
  if (!fit) return null

  const rows = fit.points
  const w = fit.weights

  const wAvg = (get: (r: SubbasinRow) => number | null) => {
    let acc = 0
    let wsum = 0
    for (let i = 0; i < rows.length; i++) {
      const v = get(rows[i])
      if (typeof v !== 'number') continue
      acc += v * w[i]
      wsum += w[i]
    }
    return wsum > 0 ? acc / wsum : null
  }

  const runoffClass = wAvg((r) => r.runoffClass)
  return {
    runoffClass: typeof runoffClass === 'number' ? Math.round(runoffClass) : null,
    runoffDepthMmMean: wAvg((r) => r.runoffDepthMmMean),
    minElevM: wAvg((r) => r.minElevM),
    maxElevM: wAvg((r) => r.maxElevM),
    areaKm2: wAvg((r) => r.areaKm2),
  }
}

