import fs from 'fs'
import path from 'path'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ALLOWED: Record<string, string> = {
  mean: 'gmax_2m_predicted.tif',
  std: 'gmax_2m_uncertainty.tif',
  p10: 'gmax_2m_p10.tif',
  p90: 'gmax_2m_p90.tif',
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const layer = String(searchParams.get('layer') || 'mean')
  const fname = ALLOWED[layer]
  if (!fname) {
    return NextResponse.json({ ok: false, error: 'Invalid layer. Use mean|std|p10|p90' }, { status: 400 })
  }

  const filePath = path.join(process.cwd(), 'outputs', 'predictions', fname)
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ ok: false, error: 'Raster not found. Run Phase 4 first.' }, { status: 404 })
  }

  const buf = fs.readFileSync(filePath)
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'image/tiff',
      'Cache-Control': 'no-store',
    },
  })
}

