import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

export async function GET() {
  // 1. Try to fetch from Supabase table first (if configured)
  const supabase = createSupabaseServerClient()
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('aoi_boundaries')
        .select('boundary')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (error) throw error

      if (data?.boundary) {
        return NextResponse.json({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { name: 'AOI (Supabase)' },
              geometry: data.boundary,
            },
          ],
        })
      }
    } catch {
      // Fall through to local boundary
    }
  }

  // 2. Fallback to shipped GeoJSON boundary (full Islamabad boundary)
  try {
    const localGeoJsonPath = path.join(process.cwd(), 'public', 'islamabad_admin_boundary.geojson')
    if (fs.existsSync(localGeoJsonPath)) {
      const data = fs.readFileSync(localGeoJsonPath, 'utf-8')
      return NextResponse.json(JSON.parse(data))
    }
  } catch {
    // Fall through
  }

  // 3. Last resort: default bounding box (keeps map working even if boundary file missing)
  return NextResponse.json({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: 'AOI (Fallback)' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [72.78, 33.49],
              [73.34, 33.49],
              [73.34, 33.82],
              [72.78, 33.82],
              [72.78, 33.49],
            ],
          ],
        },
      },
    ],
  })
}
