export type IfcLiteResult = {
  ok: boolean
  warnings: string[]
  location: { lat: number; lon: number } | null
  building: { name?: string; height_m?: number | null } | null
  counts: { columns: number; beams: number; footings: number; walls: number } | null
  materials: string[]
}

function dmsToDecimal(parts: number[]) {
  const [d, m, s, frac] = parts
  const sec = s + (typeof frac === 'number' ? frac / 1_000_000 : 0)
  return d + m / 60 + sec / 3600
}

function parseDmsTuple(s: string) {
  const nums = s
    .split(',')
    .map((x) => x.trim())
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x))
  if (nums.length < 3) return null
  return nums.slice(0, 4)
}

export function parseIfcLite(text: string): IfcLiteResult {
  const warnings: string[] = []
  const upper = text.toUpperCase()

  const count = (needle: string) => (upper.match(new RegExp(needle, 'g')) ?? []).length
  const counts = {
    columns: count('IFCCOLUMN\\('),
    beams: count('IFCBEAM\\('),
    footings: count('IFCFOOTING\\('),
    walls: count('IFCWALL'),
  }

  const materialsSet = new Set<string>()
  for (const m of text.matchAll(/IFCMATERIAL\('([^']+)'/gi)) {
    if (m[1]) materialsSet.add(String(m[1]))
  }
  const materials = Array.from(materialsSet).slice(0, 20)

  let location: { lat: number; lon: number } | null = null
  const siteLine = text.match(/IFCSITE\([\s\S]*?\);/i)?.[0] ?? null
  if (siteLine) {
    const tuples = Array.from(siteLine.matchAll(/\((\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*\d+)?\s*)\)/g)).map((m) => m[1])
    if (tuples.length >= 2) {
      const latParts = parseDmsTuple(tuples[0])
      const lonParts = parseDmsTuple(tuples[1])
      if (latParts && lonParts) {
        const lat = dmsToDecimal(latParts)
        const lon = dmsToDecimal(lonParts)
        if (Number.isFinite(lat) && Number.isFinite(lon)) location = { lat, lon }
      }
    }
  }

  if (!location) {
    warnings.push('IFC site georeferencing not found (IfcSite RefLatitude/RefLongitude). Provide lat/lon manually if needed.')
  }

  const buildingName = text.match(/IFCBUILDING\('([^']+)'/i)?.[1] ?? undefined
  let height_m: number | null = null
  const storeyLines = Array.from(text.matchAll(/IFCBUILDINGSTOREY\([\s\S]*?\);/gi)).map((m) => m[0])
  if (storeyLines.length) {
    const elevations: number[] = []
    for (const ln of storeyLines) {
      const nums = Array.from(ln.matchAll(/(-?\d+(?:\.\d+)?)/g)).map((m) => Number(m[1])).filter((n) => Number.isFinite(n))
      const last = nums.length ? nums[nums.length - 1] : null
      if (typeof last === 'number' && Number.isFinite(last)) elevations.push(last)
    }
    if (elevations.length >= 2) {
      const min = Math.min(...elevations)
      const max = Math.max(...elevations)
      const h = max - min
      if (Number.isFinite(h) && h > 0) height_m = h
    }
  }
  if (height_m == null) warnings.push('Building height not found from IfcBuildingStorey elevations; height checks may be incomplete.')

  return {
    ok: true,
    warnings,
    location,
    building: buildingName || height_m != null ? { name: buildingName, height_m } : null,
    counts,
    materials,
  }
}
