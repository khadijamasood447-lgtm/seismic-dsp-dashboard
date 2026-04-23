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
  
  // Optimization: Only look at the first 2MB for metadata if the file is huge
  // Most IFC metadata (Site, Building, Storey) is near the beginning
  const sampleText = text.length > 2_000_000 ? text.slice(0, 2_000_000) : text
  const upperSample = sampleText.toUpperCase()

  const count = (needle: string) => {
    let n = 0
    let pos = 0
    while (true) {
      pos = upperSample.indexOf(needle, pos)
      if (pos === -1) break
      n++
      pos += needle.length
    }
    return n
  }

  const counts = {
    columns: count('IFCCOLUMN('),
    beams: count('IFCBEAM('),
    footings: count('IFCFOOTING('),
    walls: count('IFCWALL'),
  }

  const materialsSet = new Set<string>()
  // Use a more restricted search for materials
  let matPos = 0
  while (materialsSet.size < 20) {
    matPos = upperSample.indexOf('IFCMATERIAL(', matPos)
    if (matPos === -1) break
    const end = upperSample.indexOf(')', matPos)
    if (end === -1) break
    const snippet = sampleText.slice(matPos, end)
    const m = snippet.match(/'([^']+)'/)
    if (m?.[1]) materialsSet.add(m[1])
    matPos = end
  }
  const materials = Array.from(materialsSet)

  let location: { lat: number; lon: number } | null = null
  const siteIdx = upperSample.indexOf('IFCSITE(')
  if (siteIdx !== -1) {
    const endIdx = upperSample.indexOf(');', siteIdx)
    if (endIdx !== -1) {
      const siteLine = sampleText.slice(siteIdx, endIdx + 2)
      const tuples = Array.from(siteLine.matchAll(/\((\s*-?\d+\s*,\s*-?\d+\s*,\s*-?\d+(?:\s*,\s*-?\d+)?\s*)\)/g)).map((m) => m[1])
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
  }

  if (!location) {
    warnings.push('IFC site georeferencing not found in sample. Provide lat/lon manually.')
  }

  const buildingIdx = upperSample.indexOf('IFCBUILDING(')
  let buildingName: string | undefined = undefined
  if (buildingIdx !== -1) {
    const endIdx = upperSample.indexOf(');', buildingIdx)
    const snippet = sampleText.slice(buildingIdx, endIdx !== -1 ? endIdx : buildingIdx + 200)
    buildingName = snippet.match(/'([^']+)'/)?.[1]
  }

  let height_m: number | null = null
  const elevations: number[] = []
  let storeyPos = 0
  while (elevations.length < 50) {
    storeyPos = upperSample.indexOf('IFCBUILDINGSTOREY(', storeyPos)
    if (storeyPos === -1) break
    const endIdx = upperSample.indexOf(');', storeyPos)
    if (endIdx === -1) break
    const ln = sampleText.slice(storeyPos, endIdx + 2)
    const nums = Array.from(ln.matchAll(/(-?\d+(?:\.\d+)?)/g)).map((m) => Number(m[1])).filter((n) => Number.isFinite(n))
    const last = nums.length ? nums[nums.length - 1] : null
    if (typeof last === 'number' && Number.isFinite(last)) elevations.push(last)
    storeyPos = endIdx
  }

  if (elevations.length >= 2) {
    const min = Math.min(...elevations)
    const max = Math.max(...elevations)
    const h = max - min
    if (Number.isFinite(h) && h > 0) height_m = h
  }

  if (height_m == null) warnings.push('Building height not found in sample.')

  return {
    ok: true,
    warnings,
    location,
    building: buildingName || height_m != null ? { name: buildingName, height_m } : null,
    counts,
    materials,
  }
}
