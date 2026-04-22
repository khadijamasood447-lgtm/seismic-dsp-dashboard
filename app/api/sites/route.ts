import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

function localSitesFallback() {
  const localPath = path.join(process.cwd(), 'ISLAMABD DATA', 'islamabad local land test.csv')
  if (!fs.existsSync(localPath)) return null

  const raw = fs.readFileSync(localPath, 'utf-8')
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const dataLines = lines.filter((l) => !l.toLowerCase().startsWith('sector') && !l.toLowerCase().includes('coordinates'))

  const features: any[] = []
  for (let i = 0; i < dataLines.length; i++) {
    const parts = dataLines[i].split(',').map((p) => p.trim())
    if (parts.length < 3) continue
    const sector = parts[0] || `Site ${i + 1}`
    const lat = Number(parts[1])
    const lon = Number(parts[2])
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue

    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: { id: `local_${i + 1}`, site: sector, sector, source: 'islamabad local land test.csv' },
    })
  }

  return { type: 'FeatureCollection', features }
}

function safeIdent(name: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) return null
  return `"${name}"`
}

function pickCoordColumn(columns: string[], kind: 'lon' | 'lat') {
  const lower = columns.map((c) => ({ raw: c, lower: c.toLowerCase() }))
  const exact = kind === 'lon'
    ? ['longitude', 'lon', 'lng', 'x']
    : ['latitude', 'lat', 'y']

  for (const k of exact) {
    const hit = lower.find((c) => c.lower === k)
    if (hit) return hit.raw
  }

  const substr = kind === 'lon' ? ['lon', 'lng', 'long'] : ['lat', 'lati']
  const hit2 = lower.find((c) => substr.some((s) => c.lower.includes(s)))
  return hit2?.raw ?? null
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createSupabaseServerClient()
    if (!supabase) {
      const fallback = localSitesFallback()
      return fallback ? NextResponse.json(fallback) : NextResponse.json({ features: [] })
    }

    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '1000')
    const page = parseInt(searchParams.get('page') || '1')
    const offset = (page - 1) * limit

    // Try to fetch from a 'sites' table or 'geotechnical_data' table
    const { data: sites, error } = await supabase
      .from('sites')
      .select('*')
      .range(offset, offset + limit - 1)

    if (error || !sites) {
      const fallback = localSitesFallback()
      return fallback ? NextResponse.json(fallback) : NextResponse.json({ features: [] })
    }

    const features = sites.map((s: any, idx: number) => ({
      type: 'Feature',
      geometry: s.boundary || s.location || { type: 'Point', coordinates: [s.longitude || 0, s.latitude || 0] },
      properties: { ...s, id: s.id || idx }
    }))

    return NextResponse.json({ type: 'FeatureCollection', features })
  } catch (error) {
    const fallback = localSitesFallback()
    return fallback ? NextResponse.json(fallback) : NextResponse.json({ features: [] })
  }
}
