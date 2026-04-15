import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'

import { queryNearest } from '@/lib/vs-data'
import { sampleIslamabadGrid } from '@/lib/islamabadGrid'
import { searchCodeDb } from '@/lib/code-db'
import { rateLimitOk } from '@/lib/rate-limit'
import { createReportRow, createSignedDownloadUrl, uploadBufferToBucket } from '@/lib/supabase/app-data'
import { getUserIdFromHeaders } from '@/lib/supabase/server'
import { getOrCachePrediction, vs30ToSiteClass } from '@/lib/prediction-cache'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type ReqBody = {
  location?: { lat: number; lon: number }
  pga_scenario?: number
  building_type?: string
  ifc_analysis?: any
}

function getIp(req: Request) {
  const xf = req.headers.get('x-forwarded-for') ?? ''
  const ip = xf.split(',')[0]?.trim()
  return ip || req.headers.get('x-real-ip') || 'local'
}

function riskColor(level: 'low' | 'medium' | 'high') {
  if (level === 'low') return rgb(0.086, 0.639, 0.29)
  if (level === 'medium') return rgb(0.961, 0.62, 0.043)
  return rgb(0.863, 0.161, 0.161)
}

export async function POST(req: Request) {
  const ip = getIp(req)
  if (!rateLimitOk(`report:${ip}`, 5, 60_000)) {
    return NextResponse.json({ ok: false, error: 'Rate limit exceeded (5 requests/min). Try again shortly.' }, { status: 429 })
  }

  let body: ReqBody
  try {
    body = (await req.json()) as ReqBody
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const lat = Number(body?.location?.lat)
  const lon = Number(body?.location?.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ ok: false, error: 'Missing or invalid location.lat/location.lon' }, { status: 400 })
  }

  const pga = Number(body?.pga_scenario)
  const pgaText = Number.isFinite(pga) ? `${pga.toFixed(2)} g` : 'N/A'
  const buildingType = String(body?.building_type ?? 'N/A')
  const userId = getUserIdFromHeaders(req)
  const clientId = req.headers.get('x-client-id')?.trim() || null

  const depths = [1, 2, 3, 5]
  const vsByDepth = await Promise.all(
    depths.map(async (d) => {
      const pred = await getOrCachePrediction({ lat, lon, depth_m: d, pga_g: pga })
      return { depth_m: d, vs: pred.vs_predicted, p10: pred.vs_p10, p90: pred.vs_p90, cached: pred.cached }
    }),
  )

  const grid = await sampleIslamabadGrid(lon, lat)
  const layers = grid.layers ?? {}
  const vs30 = typeof layers.vs30 === 'number' ? layers.vs30 : null
  const siteClass = vs30ToSiteClass(vs30) ?? 'N/A'

  const soil = {
    sand: typeof layers.sand_pct === 'number' ? `${layers.sand_pct.toFixed(1)}%` : 'N/A',
    silt: typeof layers.silt_pct === 'number' ? `${layers.silt_pct.toFixed(1)}%` : 'N/A',
    clay: typeof layers.clay_pct === 'number' ? `${layers.clay_pct.toFixed(1)}%` : 'N/A',
    bulk: typeof layers.bulk_density === 'number' ? `${layers.bulk_density.toFixed(2)} g/cm³` : 'N/A',
    water: typeof layers.water_content === 'number' ? `${layers.water_content.toFixed(1)}%` : 'N/A',
  }

  const codeHits = searchCodeDb({ q: `site class ${siteClass}`, limit: 4 })

  const reportId = crypto.randomUUID()
  const now = new Date()

  const pdf = await PDFDocument.create()
  const page = pdf.addPage([595.28, 841.89])
  const helv = await pdf.embedFont(StandardFonts.Helvetica)
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const margin = 48
  const w = page.getWidth()
  const h = page.getHeight()
  let y = h - margin

  page.drawText('PRELIMINARY ASSESSMENT - NOT FOR CONSTRUCTION', {
    x: 40,
    y: 380,
    size: 34,
    font: helvBold,
    color: rgb(0.937, 0.267, 0.267),
    opacity: 0.12,
    rotate: degrees(-30),
  })

  const title = 'Preliminary Site & Code Screening Report'
  page.drawText(title, { x: margin, y, size: 18, font: helvBold, color: rgb(0.059, 0.09, 0.157) })
  y -= 26

  const metaLines = [
    `Report ID: ${reportId}`,
    `Date: ${now.toISOString().slice(0, 10)}`,
    `Location: lat ${lat.toFixed(5)}, lon ${lon.toFixed(5)}`,
    `PGA Scenario: ${pgaText}`,
    `Building Type: ${buildingType}`,
  ]
  for (const ln of metaLines) {
    page.drawText(ln, { x: margin, y, size: 10, font: helv, color: rgb(0.2, 0.255, 0.341) })
    y -= 14
  }
  y -= 12

  page.drawText('Site Conditions Summary', { x: margin, y, size: 14, font: helvBold, color: rgb(0.059, 0.09, 0.157) })
  y -= 18

  const leftX = margin
  const rightX = margin + (w - margin * 2) / 2 + 10
  const colW = (w - margin * 2) / 2 - 10

  const leftRows: Array<[string, string]> = [
    ['Site Class (proxy)', String(siteClass)],
    ['Vs30 (m/s)', vs30 != null ? vs30.toFixed(0) : 'N/A'],
    ['Sand', soil.sand],
    ['Silt', soil.silt],
    ['Clay', soil.clay],
  ]
  const rightRows: Array<[string, string]> = [
    ['Bulk density', soil.bulk],
    ['Water content', soil.water],
    ['Model scope', 'Shallow depths (1-5 m)'],
    ['Uncertainty', '80% PI (p10-p90)'],
  ]

  const drawKv = (rows: Array<[string, string]>, x: number, y0: number) => {
    let yy = y0
    for (const [k, v] of rows) {
      page.drawText(k, { x, y: yy, size: 10, font: helv, color: rgb(0.2, 0.255, 0.341) })
      page.drawText(v, { x: x + colW * 0.55, y: yy, size: 10, font: helv, color: rgb(0.059, 0.09, 0.157) })
      yy -= 14
    }
    return yy
  }

  const yStart = y
  const yLeftEnd = drawKv(leftRows, leftX, yStart)
  const yRightEnd = drawKv(rightRows, rightX, yStart)
  y = Math.min(yLeftEnd, yRightEnd) - 10

  page.drawText('Vs Predictions by Depth (m/s)', { x: margin, y, size: 12, font: helvBold, color: rgb(0.059, 0.09, 0.157) })
  y -= 16
  for (const row of vsByDepth) {
    const vs = row.vs != null ? row.vs.toFixed(0) : 'N/A'
    const p10 = row.p10 != null ? row.p10.toFixed(0) : 'N/A'
    const p90 = row.p90 != null ? row.p90.toFixed(0) : 'N/A'
    page.drawText(`Depth ${row.depth_m} m: Vs ${vs} (80% PI: ${p10}-${p90})`, {
      x: margin,
      y,
      size: 10,
      font: helv,
      color: rgb(0.2, 0.255, 0.341),
    })
    y -= 14
  }
  y -= 10

  page.drawText('Code Compliance Assessment (Screening)', { x: margin, y, size: 14, font: helvBold, color: rgb(0.059, 0.09, 0.157) })
  y -= 18
  if (codeHits.length) {
    for (const hhit of codeHits) {
      page.drawText(hhit.title, { x: margin, y, size: 11, font: helvBold, color: rgb(0.059, 0.09, 0.157) })
      y -= 14
      const txt = (hhit.text ?? '').slice(0, 350)
      page.drawText(txt, { x: margin, y, size: 10, font: helv, color: rgb(0.2, 0.255, 0.341), maxWidth: w - margin * 2 })
      y -= 28
      for (const r of hhit.refs ?? []) {
        const ref = [r.doc, r.section, r.clause ? `clause ${r.clause}` : null, r.table ? `table ${r.table}` : null].filter(Boolean).join(' · ')
        page.drawText(ref, { x: margin, y, size: 9, font: helv, color: rgb(0.392, 0.455, 0.545) })
        y -= 12
      }
      y -= 6
      if (y < 120) break
    }
  } else {
    page.drawText('No code entries found in local code database. Populate code_database.json from BCP PDFs.', {
      x: margin,
      y,
      size: 10,
      font: helv,
      color: rgb(0.2, 0.255, 0.341),
      maxWidth: w - margin * 2,
    })
    y -= 18
  }

  const riskLevel: 'low' | 'medium' | 'high' = siteClass === 'E' ? 'high' : siteClass === 'D' ? 'medium' : 'low'
  page.drawText(`Screening risk level: ${riskLevel.toUpperCase()}`, { x: margin, y: 110, size: 11, font: helvBold, color: riskColor(riskLevel) })
  page.drawText(
    'This report is generated for screening and does not replace site investigation. Verify with a licensed engineer.',
    { x: margin, y: 92, size: 9, font: helv, color: rgb(0.2, 0.255, 0.341), maxWidth: w - margin * 2 },
  )

  const bytes = await pdf.save()
  const buf = Buffer.from(bytes)
  let savedUrl: string | null = null
  try {
    const objectPath = `${clientId || userId || 'public'}/${reportId}.pdf`
    await uploadBufferToBucket('reports', objectPath, buf, 'application/pdf')
    savedUrl = await createSignedDownloadUrl('reports', objectPath)
    await createReportRow({
      user_id: userId,
      client_id: clientId,
      report_title: title,
      location: { lat, lon },
      pga_scenario: Number.isFinite(pga) ? pga : null,
      building_type: buildingType,
      report_pdf_url: savedUrl,
      report_summary: `Site Class ${siteClass}; risk ${riskLevel}; location lat ${lat.toFixed(5)}, lon ${lon.toFixed(5)}`,
      file_size_bytes: buf.byteLength,
    })
  } catch {}
  return new NextResponse(buf, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename=\"report_${reportId}.pdf\"`,
      'cache-control': 'no-store',
      'x-report-id': reportId,
      ...(savedUrl ? { 'x-report-url': savedUrl } : {}),
    },
  })
}
