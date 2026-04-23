import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

export async function GET() {
  const reqId = `aoi_${Date.now()}_${Math.random().toString(16).slice(2)}`

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

  // 2. Fallback to grid bounds (matches available sampling area)
  try {
    const bundlePath = path.join(process.cwd(), 'public', 'islamabad_grid_bundle.json')
    if (fs.existsSync(bundlePath)) {
      const raw = fs.readFileSync(bundlePath, 'utf-8')
      const parsed = JSON.parse(raw)
      const b = parsed?.bounds
      const left = Number(b?.left)
      const right = Number(b?.right)
      const bottom = Number(b?.bottom)
      const top = Number(b?.top)
      if ([left, right, bottom, top].every((x) => Number.isFinite(x))) {
        console.log('AOI_BOUNDARY', { reqId, source: 'grid_bounds' })
        return NextResponse.json({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { name: 'AOI (Grid Bounds)' },
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
    }
  } catch {
    // Fall through
  }

  // 3. Last resort: default bounding box (keeps map working even if boundary file missing)
  console.log('AOI_BOUNDARY', { reqId, source: 'fallback_bbox' })
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
