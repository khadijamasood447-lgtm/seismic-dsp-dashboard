export type SectorCentroid = { sector: string; lon: number; lat: number; source: 'approx' }

const CENTROIDS: Record<string, SectorCentroid> = {
  'F-6': { sector: 'F-6', lon: 73.0830, lat: 33.7290, source: 'approx' },
  'F-7': { sector: 'F-7', lon: 73.0550, lat: 33.7200, source: 'approx' },
  'G-6': { sector: 'G-6', lon: 73.0900, lat: 33.7160, source: 'approx' },
  'G-7': { sector: 'G-7', lon: 73.0860, lat: 33.7000, source: 'approx' },
  'G-8': { sector: 'G-8', lon: 73.0940, lat: 33.6850, source: 'approx' },
  'G-9': { sector: 'G-9', lon: 73.0800, lat: 33.6830, source: 'approx' },
  'G-10': { sector: 'G-10', lon: 73.0750, lat: 33.6700, source: 'approx' },
  'G-11': { sector: 'G-11', lon: 73.0500, lat: 33.6550, source: 'approx' },
  'H-8': { sector: 'H-8', lon: 73.0600, lat: 33.6750, source: 'approx' },
  'H-9': { sector: 'H-9', lon: 73.0700, lat: 33.6600, source: 'approx' },
  'H-10': { sector: 'H-10', lon: 73.0600, lat: 33.6450, source: 'approx' },
  'H-11': { sector: 'H-11', lon: 73.0500, lat: 33.6350, source: 'approx' },
  'I-8': { sector: 'I-8', lon: 73.0500, lat: 33.6650, source: 'approx' },
  'I-9': { sector: 'I-9', lon: 73.0650, lat: 33.6500, source: 'approx' },
  'I-10': { sector: 'I-10', lon: 73.0800, lat: 33.6350, source: 'approx' },
  'I-11': { sector: 'I-11', lon: 73.0950, lat: 33.6250, source: 'approx' },
}

export function normalizeSector(input: string): string | null {
  const s = String(input || '').toUpperCase()
  const m = s.match(/\b([A-Z])\s*-?\s*(\d{1,2})\b/)
  if (!m) return null
  return `${m[1]}-${m[2]}`
}

export function getSectorCentroid(input: string): SectorCentroid | null {
  const s = normalizeSector(input)
  if (!s) return null
  return CENTROIDS[s] ?? null
}

export function extractSectors(text: string): string[] {
  const s = String(text || '').toUpperCase()
  const matches = Array.from(s.matchAll(/\b([A-Z])\s*-?\s*(\d{1,2})\b/g)).map((m) => `${m[1]}-${m[2]}`)
  if (!matches.length) return []
  const uniq = Array.from(new Set(matches))
  uniq.sort()
  return uniq
}
