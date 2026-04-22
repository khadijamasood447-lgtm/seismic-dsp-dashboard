import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const pool = getDbPool()

export async function GET() {
  try {
    // 1. Try to fetch from database first
    try {
      const result = await pool.query(`
        SELECT boundary as geometry 
        FROM public.aoi_boundaries 
        ORDER BY created_at DESC 
        LIMIT 1
      `)
      
      if (result.rows?.[0]) {
        return NextResponse.json({
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: { name: 'AOI (Database)' },
            geometry: result.rows[0].geometry
          }]
        })
      }
    } catch (dbError) {
      console.warn('AOI Database fetch failed, falling back to local file:', dbError)
    }

    // 2. Fallback to local GeoJSON file if database fails
    const localGeoJsonPath = path.join(process.cwd(), 'aoi_constrained.geojson')
    if (fs.existsSync(localGeoJsonPath)) {
      const data = fs.readFileSync(localGeoJsonPath, 'utf-8')
      return NextResponse.json(JSON.parse(data))
    }

    // 3. Last resort: default bounding box for Islamabad
    const defaultBbox = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { name: 'AOI (Default)' },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [72.9, 33.5],
            [73.2, 33.5],
            [73.2, 33.8],
            [72.9, 33.8],
            [72.9, 33.5]
          ]]
        }
      }]
    }
    return NextResponse.json(defaultBbox)

  } catch (error: any) {
    console.error('AOI fetch error:', error)
    return NextResponse.json({ ok: false, error: 'Failed to retrieve AOI boundary' }, { status: 500 })
  }
}
