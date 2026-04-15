import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function parseLocalTestBbox() {
  const localPath = path.join(process.cwd(), 'ISLAMABD DATA', 'islamabad local land test.csv')
  if (!fs.existsSync(localPath)) return null
  const raw = fs.readFileSync(localPath, 'utf-8')
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const dataLines = lines.filter((l) => !l.toLowerCase().startsWith('sector') && !l.toLowerCase().includes('coordinates'))
  const points: Array<{ lat: number; lon: number }> = []
  for (const line of dataLines) {
    const parts = line.split(',').map((p) => p.trim())
    if (parts.length < 3) continue
    const latStr = parts[1]
    const lonStr = parts[2]
    if (!latStr || !lonStr) continue
    const lat = Number.parseFloat(latStr)
    const lon = Number.parseFloat(lonStr)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    if (Math.abs(lat) < 1e-12 && Math.abs(lon) < 1e-12) continue
    points.push({ lat, lon })
  }
  if (points.length === 0) return null
  const minLon = Math.min(...points.map((p) => p.lon)) - 0.002
  const maxLon = Math.max(...points.map((p) => p.lon)) + 0.002
  const minLat = Math.min(...points.map((p) => p.lat)) - 0.002
  const maxLat = Math.max(...points.map((p) => p.lat)) + 0.002
  return { minLon, maxLon, minLat, maxLat }
}

function bboxGeoJson(b: { minLon: number; maxLon: number; minLat: number; maxLat: number }) {
  const coords = [
    [
      [b.minLon, b.minLat],
      [b.maxLon, b.minLat],
      [b.maxLon, b.maxLat],
      [b.minLon, b.maxLat],
      [b.minLon, b.minLat],
    ],
  ]
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: 'AOI (bbox)' },
        geometry: { type: 'Polygon', coordinates: coords },
      },
    ],
  }
}

export async function GET() {
  try {
    const bbox = parseLocalTestBbox()
    if (bbox) return NextResponse.json(bboxGeoJson(bbox))
    return NextResponse.json({ ok: false, error: 'Local test points not found for AOI bbox' }, { status: 500 })
  } catch {
    return NextResponse.json({ ok: false, error: 'Boundary file not found' }, { status: 500 })
  }
}
