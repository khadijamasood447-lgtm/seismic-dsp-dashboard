import { NextRequest, NextResponse } from 'next/server'

import { getDbPool } from '@/lib/db'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const pool = getDbPool()

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
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '1000')
    const offset = (page - 1) * limit

    const allColsRes = await pool.query(
      `
        select table_schema, table_name, array_agg(column_name order by ordinal_position) as cols
        from information_schema.columns
        where table_schema not in ('pg_catalog','information_schema')
        group by table_schema, table_name
        order by table_schema, table_name
      `,
    )

    const candidates = allColsRes.rows
      .map((r: any) => {
        const schema = String(r.table_schema)
        const name = String(r.table_name)
        const cols = (r.cols as string[]) ?? []
        const lonCol = pickCoordColumn(cols, 'lon')
        const latCol = pickCoordColumn(cols, 'lat')
        const hasCoords = Boolean(lonCol && latCol)
        const score = (hasCoords ? 10 : 0) + (hasSite ? 3 : 0) + (hasId ? 1 : 0)
        return { schema, name, cols, lonCol, latCol, score }
      })
      .filter((c: any) => c.score >= 10)
      .sort((a: any, b: any) => {
        const pref = (x: any) => (x.name === 'geotechnical_data' ? 2 : x.name === 'sites' ? 1 : 0)
        const d = b.score - a.score
        if (d !== 0) return d
        return pref(b) - pref(a)
      })

    const best = candidates[0]
    if (!best) {
      const fallback = localSitesFallback()
      if (fallback) return NextResponse.json(fallback)
      return NextResponse.json({
        type: 'FeatureCollection',
        features: [],
        warning: 'No supported table found (need lon/lat-like columns in your DB). Import your sites table into the configured production database.',
      })
    }

    const schemaIdent = safeIdent(best.schema)
    const tableIdent = safeIdent(best.name)
    if (!schemaIdent || !tableIdent) {
      return NextResponse.json({ error: 'Unsafe identifiers in DB schema' }, { status: 500 })
    }

    let geoJsonSql = 'null as geometry'
    let lonExpr = 'null'
    let latExpr = 'null'
    const lonIdent = best.lonCol ? safeIdent(best.lonCol) : null
    const latIdent = best.latCol ? safeIdent(best.latCol) : null
    if (!lonIdent || !latIdent) {
      return NextResponse.json({ error: 'Missing lon/lat columns' }, { status: 500 })
    }
    lonExpr = lonIdent
    latExpr = latIdent
    geoJsonSql = `json_build_object('type','Point','coordinates', json_build_array(${lonIdent}, ${latIdent})) as geometry`

    const q = `
      select *, ${geoJsonSql}, ${lonExpr} as longitude, ${latExpr} as latitude
      from ${schemaIdent}.${tableIdent}
      order by 1
      limit $1 offset $2
    `
    const result = await pool.query(q, [limit, offset])
    const features = result.rows
      .map((row: any, idx: number) => {
        const geom = row.geometry ?? null
        const props = { ...row }
        delete props.geometry
        const id = props.id ?? idx
        const siteName = props.site ?? props.name ?? String(id)
        return {
          type: 'Feature' as const,
          geometry: geom,
          properties: { id, site: siteName, ...props },
        }
      })
      .filter((f: any) => f.geometry)

    return NextResponse.json({ type: 'FeatureCollection', features })
  } catch (error) {
    console.error('Database error:', error)
    const fallback = localSitesFallback()
    if (fallback) return NextResponse.json(fallback)
    return NextResponse.json({ type: 'FeatureCollection', features: [], error: 'Database query failed' })
  }
}
