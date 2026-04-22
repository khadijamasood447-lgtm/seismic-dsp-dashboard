import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // 1. Try to fetch from database first using Supabase Client
    const supabase = createSupabaseServerClient()
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('aoi_boundaries')
          .select('boundary')
          .order('created_at', { ascending: false })
          .limit(1)
          .single()

        if (data?.boundary) {
          return NextResponse.json({
            type: 'FeatureCollection',
            features: [{
              type: 'Feature',
              properties: { name: 'AOI (Supabase)' },
              geometry: data.boundary
            }]
          })
        }
      } catch (supabaseError) {
        console.warn('AOI Supabase fetch failed, falling back to local file:', supabaseError)
      }
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
