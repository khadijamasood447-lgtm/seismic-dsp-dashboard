import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

export async function GET() {
  const reqId = `aoi_${Date.now()}_${Math.random().toString(16).slice(2)}`

  try {
    const localPath = path.join(process.cwd(), 'outputs', 'predictions', 'aoi_polygon.geojson')
    if (fs.existsSync(localPath)) {
      const raw = fs.readFileSync(localPath, 'utf-8')
      const obj = JSON.parse(raw)
      console.log('AOI_BOUNDARY', { reqId, source: 'outputs/predictions/aoi_polygon.geojson' })
      return NextResponse.json(obj)
    }
  } catch {
    // Fall through
  }

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
        console.log('AOI_BOUNDARY', { reqId, source: 'supabase' })
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

  const left = 73.001192
  const right = 73.091278
  const bottom = 33.626396
  const top = 33.723428

  console.log('AOI_BOUNDARY', { reqId, source: 'rectangle_bbox' })
  return NextResponse.json({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: 'AOI (Rectangle)' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [left, bottom],
              [right, bottom],
              [right, top],
              [left, top],
              [left, bottom],
            ],
          ],
        },
      },
    ],
  })
}
