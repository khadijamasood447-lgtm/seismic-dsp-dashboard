import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

type GridBundle = {
  crs: string
  transform: [number, number, number, number, number, number]
  width: number
  height: number
  bounds: { left: number; bottom: number; right: number; top: number }
  layers: Record<string, { values: Array<number | null> }>
}

let cached: GridBundle | null = null
let loading: Promise<GridBundle> | null = null

async function loadBundle(): Promise<GridBundle> {
  if (cached) return cached
  if (loading) return loading

  loading = (async () => {
    const filePath = path.join(process.cwd(), 'public', 'islamabad_grid_bundle.json')
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8')
      cached = JSON.parse(raw) as GridBundle
      return cached
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    const bucket = process.env.SUPABASE_RUNTIME_BUCKET || 'predictions_cache'
    const objectPath = process.env.SUPABASE_GRID_BUNDLE_PATH || 'runtime/islamabad_grid_bundle.json'

    if (!url || !key) {
      throw new Error('Missing local islamabad_grid_bundle.json and Supabase runtime storage env is not configured')
    }

    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await supabase.storage.from(bucket).download(objectPath)
    if (error || !data) {
      throw new Error(`Failed to download runtime grid bundle from Supabase Storage (${bucket}/${objectPath}): ${error?.message ?? 'unknown error'}`)
    }
    const raw = await data.text()
    cached = JSON.parse(raw) as GridBundle
    return cached
  })()

  try {
    return await loading
  } finally {
    loading = null
  }
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}

function bilinearAt(values: Array<number | null>, width: number, height: number, colF: number, rowF: number) {
  const col0 = clamp(Math.floor(colF), 0, width - 1)
  const row0 = clamp(Math.floor(rowF), 0, height - 1)
  const col1 = clamp(col0 + 1, 0, width - 1)
  const row1 = clamp(row0 + 1, 0, height - 1)

  const tx = colF - col0
  const ty = rowF - row0

  const idx00 = row0 * width + col0
  const idx10 = row0 * width + col1
  const idx01 = row1 * width + col0
  const idx11 = row1 * width + col1

  const v00 = values[idx00]
  const v10 = values[idx10]
  const v01 = values[idx01]
  const v11 = values[idx11]

  const valid = [v00, v10, v01, v11].filter((v) => typeof v === 'number') as number[]
  if (valid.length === 0) return null

  const a00 = v00 ?? valid[0]
  const a10 = v10 ?? valid[0]
  const a01 = v01 ?? valid[0]
  const a11 = v11 ?? valid[0]

  const v0 = a00 * (1 - tx) + a10 * tx
  const v1 = a01 * (1 - tx) + a11 * tx
  return v0 * (1 - ty) + v1 * ty
}

function nearestAt(values: Array<number | null>, width: number, height: number, colF: number, rowF: number) {
  const col = clamp(Math.round(colF), 0, width - 1)
  const row = clamp(Math.round(rowF), 0, height - 1)
  const v = values[row * width + col]
  return typeof v === 'number' ? v : null
}

export type IslamabadSample = {
  inBounds: boolean
  row: number | null
  col: number | null
  layers: Record<string, number | null>
}

export async function sampleIslamabadGrid(lon: number, lat: number): Promise<IslamabadSample> {
  const bundle = await loadBundle()
  const { transform, width, height, bounds } = bundle

  if (!(lon >= bounds.left && lon <= bounds.right && lat >= bounds.bottom && lat <= bounds.top)) {
    return { inBounds: false, row: null, col: null, layers: {} }
  }

  const pixelW = transform[0]
  const originX = transform[2]
  const pixelH = transform[4]
  const originY = transform[5]

  const colF = (lon - originX) / pixelW
  const rowF = (lat - originY) / pixelH

  const row = clamp(Math.floor(rowF), 0, height - 1)
  const col = clamp(Math.floor(colF), 0, width - 1)

  const out: Record<string, number | null> = {}
  for (const [name, layer] of Object.entries(bundle.layers)) {
    const sampler = name === 'land_cover' ? nearestAt : bilinearAt
    out[name] = sampler(layer.values, width, height, colF, rowF)
  }

  return { inBounds: true, row, col, layers: out }
}
