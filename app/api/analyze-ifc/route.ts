import { NextResponse } from 'next/server'
import crypto from 'crypto'

import { parseIfcLite } from '@/lib/ifc-lite'
import { sampleIslamabadGrid } from '@/lib/islamabadGrid'
import { queryNearest } from '@/lib/vs-data'
import { searchCodeDb } from '@/lib/code-db'
import { rateLimitOk } from '@/lib/rate-limit'
import { createIfcAnalysisRow, uploadBufferToBucket } from '@/lib/supabase/app-data'
import { getUserIdFromHeaders } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function getIp(req: Request) {
  const xf = req.headers.get('x-forwarded-for') ?? ''
  const ip = xf.split(',')[0]?.trim()
  return ip || req.headers.get('x-real-ip') || 'local'
}

function vs30ToSiteClass(vs30: number | null) {
  if (typeof vs30 !== 'number' || !Number.isFinite(vs30)) return null
  if (vs30 > 1500) return 'A'
  if (vs30 > 760) return 'B'
  if (vs30 > 360) return 'C'
  if (vs30 > 180) return 'D'
  return 'E'
}

function heightLimitM(siteClass: string | null) {
  const s = (siteClass ?? '').toUpperCase()
  if (s === 'E') return 15
  if (s === 'D') return 25
  if (s === 'C') return 40
  return 30
}

export async function POST(req: Request) {
  const ip = getIp(req)
  if (!rateLimitOk(`ifc:${ip}`, 5, 60_000)) {
    return NextResponse.json({ ok: false, error: 'Rate limit exceeded (5 requests/min). Try again shortly.' }, { status: 429 })
  }

  let fd: FormData
  try {
    fd = await req.formData()
  } catch {
    return NextResponse.json({ ok: false, error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const file = fd.get('file')
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: 'Missing file' }, { status: 400 })

  const name = String(file.name ?? 'upload.ifc')
  if (!name.toLowerCase().endsWith('.ifc')) {
    return NextResponse.json({ ok: false, error: 'Only .ifc files are supported in this build' }, { status: 400 })
  }

  const text = await file.text()
  const parsed = parseIfcLite(text)

  const analysisId = crypto.randomUUID()
  const warnings: string[] = [...(parsed.warnings ?? [])]
  const userId = getUserIdFromHeaders(req)
  const clientId = req.headers.get('x-client-id')?.trim() || null

  try {
    const objectPath = `${clientId || userId || 'public'}/${analysisId}_${name}`
    await uploadBufferToBucket('ifc_uploads', objectPath, Buffer.from(text, 'utf-8'), 'application/octet-stream')
  } catch {}

  const loc = parsed.location
  if (!loc) {
    return NextResponse.json({
      ok: true,
      analysis_id: analysisId,
      building_info: parsed.building,
      site_conditions: null,
      inconsistencies: [
        {
          description: 'Building location not found in IFC (IfcSite georeferencing missing).',
          code_section: null,
          severity: 'warning',
          recommendation: 'Enter building lat/lon manually or export IFC with IfcSite georeferencing (RefLatitude/RefLongitude).',
        },
      ],
      summary: { pass_count: 0, warning_count: 1, fail_count: 0 },
      warnings,
      disclaimer: 'PRELIMINARY ASSESSMENT - NOT FOR CONSTRUCTION. Verify with a licensed engineer and site-specific investigation.',
    })
  }

  const grid = await sampleIslamabadGrid(loc.lon, loc.lat)
  const layers = grid.layers ?? {}
  const vs30 = typeof layers.vs30 === 'number' ? layers.vs30 : null
  const siteClass = vs30ToSiteClass(vs30)

  const depths = [1, 2, 3, 5]
  const vsByDepth = depths.map((d) => {
    const row = queryNearest(loc.lon, loc.lat, d)
    return row
      ? { depth_m: d, vs_m_s: row.vs_predicted_m_s, p10: row.vs_predicted_p10, p90: row.vs_predicted_p90 }
      : { depth_m: d, vs_m_s: null, p10: null, p90: null }
  })

  const siteConditions = {
    location: loc,
    vs_by_depth: vsByDepth,
    vs30_m_s: vs30,
    site_class: siteClass,
    soil_properties: {
      sand_pct: typeof layers.sand_pct === 'number' ? layers.sand_pct : null,
      silt_pct: typeof layers.silt_pct === 'number' ? layers.silt_pct : null,
      clay_pct: typeof layers.clay_pct === 'number' ? layers.clay_pct : null,
      bulk_density_g_cm3: typeof layers.bulk_density === 'number' ? layers.bulk_density : null,
      water_content_pct: typeof layers.water_content === 'number' ? layers.water_content : null,
    },
  }

  const inconsistencies: Array<{ description: string; code_section: any; severity: 'pass' | 'warning' | 'fail'; recommendation: string }> = []

  const height = parsed.building?.height_m ?? null
  const lim = heightLimitM(siteClass)
  if (height != null && Number.isFinite(height) && height > lim) {
    inconsistencies.push({
      description: `Building height ${height.toFixed(1)} m appears to exceed a screening limit of ${lim} m for Site Class ${siteClass ?? 'N/A'}.`,
      code_section: { doc: 'bcp-sp-2021', section: 'Structural Design / Height Limits', clause: 'N/A' },
      severity: 'fail',
      recommendation: 'Confirm site class and design category using BCP-SP 2021. Consider revising structural system and/or foundations subject to geotechnical report.',
    })
  } else {
    inconsistencies.push({
      description: 'Building height check: no exceedance detected (screening-level).',
      code_section: null,
      severity: 'pass',
      recommendation: 'Confirm height, occupancy, and design category per BCP-SP 2021.',
    })
  }

  const hasLateral = (parsed.counts?.walls ?? 0) > 0
  if (!hasLateral) {
    inconsistencies.push({
      description: 'No walls/shear-wall-like elements were detected in the IFC text scan.',
      code_section: { doc: 'bcp-sp-2021', section: 'Seismic / Lateral System', clause: 'N/A' },
      severity: 'warning',
      recommendation: 'Verify the lateral system in the IFC model. Add/confirm shear walls or moment frames as required by seismic design category.',
    })
  }

  const codeHits = siteClass ? searchCodeDb({ q: `site class ${siteClass}`, limit: 4 }) : []
  if (codeHits.length === 0) warnings.push('Code database entries are placeholders until PDF extraction is completed.')

  const counts = {
    pass_count: inconsistencies.filter((x) => x.severity === 'pass').length,
    warning_count: inconsistencies.filter((x) => x.severity === 'warning').length,
    fail_count: inconsistencies.filter((x) => x.severity === 'fail').length,
  }

  try {
    await createIfcAnalysisRow({
      user_id: userId,
      client_id: clientId,
      original_filename: name,
      building_height: parsed.building?.height_m ?? null,
      site_class: siteClass,
      inconsistencies,
      summary: counts,
    })
  } catch {}

  return NextResponse.json({
    ok: true,
    analysis_id: analysisId,
    building_info: {
      ...parsed.building,
      element_counts: parsed.counts,
      materials: parsed.materials,
    },
    site_conditions: siteConditions,
    inconsistencies,
    code_references: codeHits.map((h) => ({ id: h.id, title: h.title, refs: h.refs })),
    summary: counts,
    warnings,
    disclaimer: 'PRELIMINARY ASSESSMENT - NOT FOR CONSTRUCTION. Verify with a licensed engineer and site-specific investigation.',
  })
}
