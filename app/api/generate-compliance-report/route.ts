import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

import { rateLimitOk } from '@/lib/rate-limit'
import { createSignedDownloadUrl, uploadBufferToBucket } from '@/lib/supabase/app-data'
import type { ComplianceResult } from '@/lib/compliance/bcp-checks'
import { logger } from '@/lib/logger'
import { ensureBucketsExist } from '@/lib/supabase/storage-utils'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type ReqBody = {
  analysis_results?: ComplianceResult
  dashboard_url?: string
}

function getIp(req: Request) {
  const xf = req.headers.get('x-forwarded-for') ?? ''
  const ip = xf.split(',')[0]?.trim()
  return ip || req.headers.get('x-real-ip') || 'local'
}

function statusGlyph(s: string) {
  if (s === 'pass') return 'PASS'
  if (s === 'warning') return 'WARNING'
  return 'FAIL'
}

function statusColor(s: string) {
  if (s === 'pass') return rgb(0.086, 0.639, 0.29)
  if (s === 'warning') return rgb(0.92, 0.62, 0.09)
  return rgb(0.84, 0.19, 0.2)
}

export async function POST(req: Request) {
  const ip = getIp(req)
  if (!rateLimitOk(`compliance-report:${ip}`, 8, 60_000)) {
    return NextResponse.json({ ok: false, error: 'Rate limit exceeded (8 requests/min). Try again shortly.' }, { status: 429 })
  }

  logger.info('REPORT', 'generate_compliance_report request', { ip })

  let body: ReqBody
  try {
    body = (await req.json()) as ReqBody
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const analysis = body?.analysis_results
  if (!analysis?.building || !analysis?.site || !Array.isArray(analysis?.findings)) {
    return NextResponse.json({ ok: false, error: 'Missing analysis_results payload' }, { status: 400 })
  }

  try {
    const ensured = await ensureBucketsExist(['reports'], { public: false })
    logger.info('REPORT', 'ensure_buckets', { configured: ensured.configured, created: ensured.created, missing: ensured.missing })
  } catch (e: any) {
    logger.error('REPORT', 'ensure_buckets failed', e)
  }

  const reportId = `IZ1-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([595.28, 841.89])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const width = page.getWidth()
  const margin = 36
  let y = page.getHeight() - margin

  const write = (txt: string, opts?: { size?: number; bold?: boolean; color?: [number, number, number] }) => {
    page.drawText(txt, {
      x: margin,
      y,
      size: opts?.size ?? 10,
      font: opts?.bold ? fontBold : font,
      color: opts?.color ? rgb(opts.color[0], opts.color[1], opts.color[2]) : rgb(0.13, 0.16, 0.23),
      maxWidth: width - margin * 2,
      lineHeight: 12,
    })
    y -= (opts?.size ?? 10) + 5
  }

  write('GEOTECHNICAL & STRUCTURAL ASSESSMENT', { size: 16, bold: true })
  write('Islamabad Zone 1 - Preliminary Compliance Report', { size: 11 })
  write(`Report ID: ${reportId}`)
  write(`Date: ${new Date().toISOString().slice(0, 10)}`)
  write(`Project: ${analysis.building.building_name ?? analysis.building.file_name ?? 'N/A'}`)
  write(`Location: ${analysis.site.location.lat.toFixed(5)}, ${analysis.site.location.lon.toFixed(5)}`)
  y -= 5

  write('SITE CONDITIONS', { size: 12, bold: true })
  const vs1 = analysis.site.vs_by_depth.find((v) => v.depth_m === 1)?.vs_m_s
  const vs5 = analysis.site.vs_by_depth.find((v) => v.depth_m === 5)?.vs_m_s
  write(`Vs at 1m: ${vs1 != null ? vs1.toFixed(0) : 'N/A'} m/s`)
  write(`Vs at 5m: ${vs5 != null ? vs5.toFixed(0) : 'N/A'} m/s`)
  write(`Site Class: ${analysis.site.site_class}`)
  write(`PGA: ${analysis.site.pga_g.toFixed(2)}g`)
  write(
    `Soil: Sand ${analysis.site.soil_properties?.sand_pct?.toFixed?.(1) ?? 'N/A'}%, Silt ${analysis.site.soil_properties?.silt_pct?.toFixed?.(1) ?? 'N/A'}%, Clay ${analysis.site.soil_properties?.clay_pct?.toFixed?.(1) ?? 'N/A'}%`,
  )
  y -= 3

  write('COMPLIANCE SUMMARY', { size: 12, bold: true })
  for (const f of analysis.findings) {
    page.drawText(`${f.category}: ${statusGlyph(f.status)} (${f.severity})`, {
      x: margin,
      y,
      size: 10,
      font: fontBold,
      color: statusColor(f.status),
    })
    y -= 14
  }
  y -= 2

  write('DETAILED FINDINGS', { size: 12, bold: true })
  for (const f of analysis.findings) {
    if (y < 150) break
    write(`${statusGlyph(f.status)} - ${f.category}`, { bold: true, color: [0.1, 0.1, 0.1] })
    write(`Code: ${f.code_section}`)
    write(`${f.message}`)
    write(`Recommendation: ${f.recommendation}`)
    y -= 3
  }

  if (y < 120) {
    const p2 = pdf.addPage([595.28, 841.89])
    y = p2.getHeight() - margin
    p2.drawText('RECOMMENDATIONS', { x: margin, y, size: 12, font: fontBold, color: rgb(0.13, 0.16, 0.23) })
    y -= 18
    for (const pri of ['high', 'medium', 'low'] as const) {
      p2.drawText(`${pri.toUpperCase()} Priority`, { x: margin, y, size: 11, font: fontBold, color: rgb(0.13, 0.16, 0.23) })
      y -= 14
      const rows = analysis.by_priority?.[pri] ?? []
      if (!rows.length) {
        p2.drawText('- No actions', { x: margin + 8, y, size: 10, font, color: rgb(0.2, 0.25, 0.33) })
        y -= 13
      } else {
        for (const row of rows.slice(0, 10)) {
          p2.drawText(`- ${row}`, { x: margin + 8, y, size: 10, font, color: rgb(0.2, 0.25, 0.33), maxWidth: width - margin * 2 - 12 })
          y -= 13
          if (y < 80) break
        }
      }
      y -= 6
    }
    p2.drawText('LIMITATIONS', { x: margin, y: 92, size: 11, font: fontBold, color: rgb(0.13, 0.16, 0.23) })
    p2.drawText(analysis.disclaimer, {
      x: margin,
      y: 76,
      size: 9,
      font,
      color: rgb(0.28, 0.33, 0.41),
      maxWidth: width - margin * 2,
      lineHeight: 11,
    })
    p2.drawText(`Live dashboard: ${body?.dashboard_url ?? process.env.NEXT_PUBLIC_APP_URL ?? 'N/A'}`, {
      x: margin,
      y: 50,
      size: 9,
      font,
      color: rgb(0.28, 0.33, 0.41),
    })
  } else {
    write('LIMITATIONS', { size: 12, bold: true })
    write(analysis.disclaimer)
  }

  const bytes = await pdf.save()
  const buffer = Buffer.from(bytes)
  const objectPath = `public/compliance/${reportId}.pdf`
  let downloadUrl: string | null = null
  try {
    const uploaded = await uploadBufferToBucket('reports', objectPath, buffer, 'application/pdf')
    if (!uploaded) {
      return NextResponse.json(
        {
          ok: false,
          error_code: 'STORAGE_NOT_CONFIGURED',
          error:
            'Report storage is not configured on the server. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, and create a Storage bucket named reports.',
        },
        { status: 500 },
      )
    }
    downloadUrl = await createSignedDownloadUrl('reports', objectPath, 60 * 60 * 24 * 14)
  } catch (e: any) {
    const msg = String(e?.message ?? 'unknown error')
    if (/bucket not found/i.test(msg)) {
      return NextResponse.json(
        {
          ok: false,
          error_code: 'STORAGE_BUCKET_MISSING',
          error: 'Report generation failed: Storage bucket "reports" was not found. Create it in Supabase Storage (bucket name: reports) and retry.',
        },
        { status: 500 },
      )
    }
    return NextResponse.json({ ok: false, error_code: 'REPORT_FAILED', error: `Report generation failed: ${msg}` }, { status: 500 })
  }

  if (!downloadUrl) {
    return NextResponse.json(
      {
        ok: false,
        error_code: 'SIGNED_URL_FAILED',
        error:
          'Report was generated but a signed download URL could not be created. Ensure Supabase Storage is enabled and the reports bucket exists.',
      },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok: true,
    report_id: reportId,
    filename: `${reportId}.pdf`,
    download_url: downloadUrl,
    bytes: buffer.byteLength,
    disclaimer: analysis.disclaimer,
  })
}
