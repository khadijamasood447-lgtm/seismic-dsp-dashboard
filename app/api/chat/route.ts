import { NextResponse } from 'next/server'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

import { queryNearest, sectorSummary, compareSectors, availableDepths } from '@/lib/vs-data'
import { sampleIslamabadGrid } from '@/lib/islamabadGrid'
import { searchCodeDb } from '@/lib/code-db'
import { rateLimitOk } from '@/lib/rate-limit'
import { parseIfcLite } from '@/lib/ifc-lite'
import { checkBcpCompliance, extractIfcDataFromUrl, parsePgaScenario, type SiteData } from '@/lib/compliance/bcp-checks'
import { logger } from '@/lib/logger'
import { getUserIdFromHeaders } from '@/lib/supabase/server'
import { insertChatMessage, upsertChatSession } from '@/lib/supabase/app-data'
import { getOrCachePrediction, vs30ToSiteClass } from '@/lib/prediction-cache'
import { formatComparisonAsText, formatLocationDataAsText, formatSoilCompositionAsText } from '@/lib/response-formatter'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type ChatRequest = {
  message: string
  conversation_id?: string
  client_id?: string
  attachments?: Array<{ type: 'ifc'; file_url: string; file_name?: string }>
  ifc_extracted_data?: any
  context?: {
    depth?: number
    location?: string
    include_predictions?: boolean
    lon?: number
    lat?: number
  }
}

type ChatResponse = {
  response: string
  suggested_actions: string[]
  data_quoted?: any
}

declare global {
  // eslint-disable-next-line no-var
  var __CHAT_MEM__: Map<string, Array<{ role: 'user' | 'assistant'; content: string }>> | undefined
}

function getIp(req: Request) {
  const xf = req.headers.get('x-forwarded-for') ?? ''
  const ip = xf.split(',')[0]?.trim()
  return ip || req.headers.get('x-real-ip') || 'local'
}

function getMem(conversationId: string) {
  if (!global.__CHAT_MEM__) global.__CHAT_MEM__ = new Map()
  const hist = global.__CHAT_MEM__.get(conversationId) ?? []
  global.__CHAT_MEM__.set(conversationId, hist)
  return hist
}

function pushMem(conversationId: string, role: 'user' | 'assistant', content: string) {
  const hist = getMem(conversationId)
  hist.push({ role, content })
  while (hist.length > 10) hist.shift()
  global.__CHAT_MEM__!.set(conversationId, hist)
}

function parseDepth(message: string, fallback = 2.0) {
  const m = message.match(/(\d+(?:\.\d+)?)\s*m\b/i)
  if (!m) return fallback
  const d = Number(m[1])
  return Number.isFinite(d) ? d : fallback
}

function parseLonLat(message: string) {
  const m = message.match(/(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)/)
  if (!m) return null
  const a = Number(m[1])
  const b = Number(m[2])
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  const looksLikeLatLon = Math.abs(a) <= 90 && Math.abs(b) <= 180
  const looksLikeLonLat = Math.abs(a) <= 180 && Math.abs(b) <= 90
  if (looksLikeLatLon && !looksLikeLonLat) return { lat: a, lon: b }
  if (looksLikeLonLat && !looksLikeLatLon) return { lon: a, lat: b }
  return { lat: a, lon: b }
}

function parseSector(message: string) {
  const m = message.match(/\b([A-Z])\s*-\s*(\d{1,2})\b/i)
  if (!m) return null
  return `${m[1].toUpperCase()}-${m[2]}`
}

function parseCompare(message: string) {
  const m = message.match(/\b([A-Z]\s*-\s*\d{1,2})\b.*\b([A-Z]\s*-\s*\d{1,2})\b/i)
  if (!m) return null
  const a = m[1].replace(/\s+/g, '').toUpperCase()
  const b = m[2].replace(/\s+/g, '').toUpperCase()
  return { a, b }
}

function clamp(n: number, a: number, b: number) {
  return Math.min(b, Math.max(a, n))
}

function fmt(n: any, digits = 0) {
  const x = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(x)) return 'N/A'
  return x.toFixed(digits)
}

function safeJsonForPrompt(value: any, maxChars: number) {
  if (value == null) return null
  if (typeof value !== 'object') return null
  try {
    const s = JSON.stringify(value)
    if (s.length <= maxChars) return value
    return { truncated: true, chars: s.length }
  } catch {
    return null
  }
}

function defaultAnswerFromData(data: any): ChatResponse {
  if (!data) {
    return {
      response:
        'I could not retrieve prediction data for that request. ' +
        'Try a sector like "G-6" or coordinates like "33.71, 73.08" and specify depth (e.g., "2m").',
      suggested_actions: [],
    }
  }

  if (data.type === 'sector') {
    const vs = fmt(data.vs, 0)
    const p10 = fmt(data.p10, 0)
    const p90 = fmt(data.p90, 0)
    const d = fmt(data.depth_m, 0)
    return {
      response:
        `At ${data.sector} sector, the predicted shear wave velocity (Vs) at ${d}m depth is ${vs} m/s ` +
        `(80% PI: ${p10}-${p90} m/s). ` +
        `This is research-grade and should be verified with site-specific testing for design.`,
      suggested_actions: ['Show on map', 'Export this data', 'Compare with another sector'],
      data_quoted: { location: data.sector, depth_m: data.depth_m, vs_m_s: data.vs, p10: data.p10, p90: data.p90 },
    }
  }

  if (data.type === 'compare') {
    const a = data.a
    const b = data.b
    const textComparison = formatComparisonAsText({ a, b, depth_m: data.depth_m })
    return {
      response: textComparison,
      suggested_actions: ['Show on map', 'Liquefaction assessment', 'Foundation recommendations'],
      data_quoted: { depth_m: data.depth_m, a, b },
    }
  }

  if (data.type === 'location') {
    const vs = fmt(data.vs, 0)
    const p10 = fmt(data.p10, 0)
    const p90 = fmt(data.p90, 0)
    const d = fmt(data.depth_m, 0)
    const textLocation = formatLocationDataAsText({ input: data.input, nearest: data.nearest, vs: data.vs, p10: data.p10, p90: data.p90 })
    return {
      response: textLocation,
      suggested_actions: ['Show on map', 'Soil composition analysis', 'Liquefaction risk'],
      data_quoted: data,
    }
  }

  return { response: 'Request processed.', suggested_actions: [], data_quoted: data }
}

function keyPrefix(v?: string | null) {
  if (!v) return null
  const s = v.trim()
  if (!s) return null
  return s.slice(0, 10) + '...'
}

async function callClaude(params: { model: string; apiKey: string; system: string; messages: any[] }) {
  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': params.apiKey,
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: 800,
      temperature: 0.2,
      system: params.system,
      messages: params.messages,
    }),
  })
  const raw = await upstream.text()
  if (!upstream.ok) {
    throw new Error(`Claude request failed (${upstream.status}): ${raw.slice(0, 300)}`)
  }
  const data = JSON.parse(raw)
  const text =
    data?.content?.map((c: any) => (c?.type === 'text' ? c?.text : '')).filter(Boolean).join('') ?? ''
  return text
}

function safeJsonParse(s: string) {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

function toolDefs() {
  return [
    {
      name: 'visualize_ifc',
      description: 'Prepare an uploaded IFC model for visualization and summarize key elements (storeys and structural element counts).',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          file_url: { type: 'string' },
          file_name: { type: 'string' },
        },
        required: ['file_url'],
      },
    },
    {
      name: 'extract_ifc_data',
      description: 'Extract building parameters from IFC URL for compliance checks: height, stories, materials, foundation and lateral-system hints.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ifc_url: { type: 'string' },
          file_name: { type: 'string' },
        },
        required: ['ifc_url'],
      },
    },
    {
      name: 'analyze_code_compliance',
      description: 'Analyze IFC model against BCP-SP 2021 screening checks using site class/Vs predictions and PGA scenario.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ifc_url: { type: 'string' },
          location: {
            type: 'object',
            additionalProperties: false,
            properties: {
              lat: { type: 'number' },
              lon: { type: 'number' },
            },
          },
          pga_scenario: { anyOf: [{ type: 'string' }, { type: 'number' }] },
        },
        required: ['ifc_url'],
      },
    },
    {
      name: 'generate_compliance_report',
      description: 'Generate a downloadable compliance PDF report from analysis results.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          analysis_results: { type: 'object' },
          format: { type: 'string', enum: ['pdf', 'markdown'] },
        },
        required: ['analysis_results'],
      },
    },
    {
      name: 'get_site_data',
      description:
        'Return site conditions at a location in Islamabad: shallow Vs predictions (1-5 m), uncertainty, Vs30 proxy, site class proxy, and soil properties.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          lat: { type: 'number' },
          lon: { type: 'number' },
          pga_g: { type: 'number' },
        },
        required: ['lat', 'lon'],
      },
    },
    {
      name: 'get_code_requirement',
      description:
        'Return relevant BCP-SP 2021 requirements (or stored code database entries) for the given site class and building type/topic.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          site_class: { type: 'string' },
          building_type: { type: 'string' },
          topic: { type: 'string' },
          pga_g: { type: 'number' },
        },
        required: ['site_class'],
      },
    },
    {
      name: 'get_uncertainty_interpretation',
      description: 'Explain how to interpret prediction intervals (p10-p90) and why uncertainty matters.',
      input_schema: { type: 'object', additionalProperties: false, properties: {} },
    },
    {
      name: 'get_limitations',
      description: 'List model limitations and appropriate use constraints for screening-level analysis.',
      input_schema: { type: 'object', additionalProperties: false, properties: {} },
    },
  ]
}

async function runTool(name: string, input: any) {
  if (name === 'visualize_ifc') {
    const fileUrl = String(input?.file_url ?? '').trim()
    const fileName = String(input?.file_name ?? '').trim() || null
    if (!fileUrl) return { ok: false, error: 'Missing file_url' }
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 30_000)
    try {
      const res = await fetch(fileUrl, { signal: ctrl.signal })
      if (!res.ok) return { ok: false, error: `Failed to fetch IFC (${res.status})` }
      const buf = await res.arrayBuffer()
      
      // Increased limit to 50MB, with warning for files over 15MB
      const sizeMB = buf.byteLength / 1_000_000
      const largeFileWarning = sizeMB > 15 ? `Note: File is ${sizeMB.toFixed(1)}MB (large). Visualization may be slower. ` : ''
      
      if (buf.byteLength > 50_000_000) return { ok: false, error: `IFC file too large (${sizeMB.toFixed(1)}MB). Max 50MB. Please reduce file size or upload a simplified version.` }
      
      const text = new TextDecoder().decode(new Uint8Array(buf))
      const parsed = parseIfcLite(text)
      const storeys = (text.toUpperCase().match(/IFCBUILDINGSTOREY\(/g) ?? []).length
      return {
        ok: true,
        file_name: fileName,
        model_url: fileUrl,
        format: 'ifc',
        building: parsed.building,
        location: parsed.location,
        storeys,
        element_counts: parsed.counts,
        warnings: (parsed.warnings ?? []).concat(largeFileWarning ? [largeFileWarning] : []),
        disclaimers: [
          'Visualization is for review and coordination; not a substitute for engineering design validation.',
          'PRELIMINARY ASSESSMENT - NOT FOR CONSTRUCTION. Verify with site-specific investigation and a licensed engineer.',
        ],
      }
    } catch (e: any) {
      return { ok: false, error: `IFC preview failed: ${String(e?.message ?? 'unknown error')}` }
    } finally {
      clearTimeout(t)
    }
  }

  if (name === 'get_site_data') {
    const lat = Number(input?.lat)
    const lon = Number(input?.lon)
    const pga = Number(input?.pga_g)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return { ok: false, error: 'Invalid lat/lon' }
    }

    const depths = [1, 2, 3, 5]
    const vsByDepth = await Promise.all(
      depths.map(async (d) => {
        const pred = await getOrCachePrediction({ lat, lon, depth_m: d, pga_g: pga })
        return {
          depth_m: d,
          vs_m_s: pred.vs_predicted,
          p10: pred.vs_p10,
          p90: pred.vs_p90,
          std: null,
          cached: pred.cached,
        }
      }),
    )

    const grid = await sampleIslamabadGrid(lon, lat)
    const layers = grid.layers ?? {}
    const vs30 = typeof layers.vs30 === 'number' ? layers.vs30 : null
    const siteClass = vs30ToSiteClass(vs30)

    const soil = {
      sand_pct: typeof layers.sand_pct === 'number' ? layers.sand_pct : null,
      silt_pct: typeof layers.silt_pct === 'number' ? layers.silt_pct : null,
      clay_pct: typeof layers.clay_pct === 'number' ? layers.clay_pct : null,
      bulk_density_g_cm3: typeof layers.bulk_density === 'number' ? layers.bulk_density : null,
      water_content_pct: typeof layers.water_content === 'number' ? layers.water_content : null,
      dem_m: typeof layers.dem === 'number' ? layers.dem : null,
      land_cover: typeof layers.land_cover === 'number' ? layers.land_cover : null,
      bedrock_depth_10km: typeof layers.bedrock_depth_10km === 'number' ? layers.bedrock_depth_10km : null,
    }

    const notePga = Number.isFinite(pga)
      ? 'PGA scenario is treated as a screening context parameter; Vs predictions shown are not re-computed for PGA in this build.'
      : null

    return {
      ok: true,
      input: { lat, lon, pga_g: Number.isFinite(pga) ? pga : null },
      vs_by_depth: vsByDepth,
      vs30_m_s: vs30,
      site_class: siteClass,
      soil_properties: soil,
      disclaimers: [
        'PRELIMINARY / SCREENING-LEVEL: not for final design without site-specific investigation.',
        'Shallow Vs (1-5 m) does not replace Vs30 measurement; use geotechnical testing for design.',
      ],
      notes: notePga ? [notePga] : [],
      citations: [{ doc: 'bcp-sp-2021', table: '6-1', section: 'Soil / Site Classification' }],
    }
  }

  if (name === 'extract_ifc_data') {
    const ifcUrl = String(input?.ifc_url ?? '').trim()
    if (!ifcUrl) return { ok: false, error: 'Missing ifc_url' }
    try {
      const extracted = await extractIfcDataFromUrl(ifcUrl, String(input?.file_name ?? '').trim() || null)
      return { ok: true, building_params: extracted }
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? 'IFC extraction failed') }
    }
  }

  if (name === 'analyze_code_compliance') {
    const ifcUrl = String(input?.ifc_url ?? '').trim()
    if (!ifcUrl) return { ok: false, error: 'Missing ifc_url' }
    try {
      const building = await extractIfcDataFromUrl(ifcUrl, null)
      const pga = parsePgaScenario(input?.pga_scenario)
      const lat = Number(input?.location?.lat)
      const lon = Number(input?.location?.lon)
      const location =
        Number.isFinite(lat) && Number.isFinite(lon)
          ? { lat, lon }
          : building.location && Number.isFinite(building.location.lat) && Number.isFinite(building.location.lon)
            ? building.location
            : null
      if (!location) return { ok: false, error: 'Missing location (provide location.lat/lon or georeferenced IFC).' }

      const grid = await sampleIslamabadGrid(location.lon, location.lat)
      const layers = grid.layers ?? {}
      const vs30 = typeof layers.vs30 === 'number' ? layers.vs30 : null
      const siteClass = (vs30ToSiteClass(vs30) as 'C' | 'D' | 'E' | null) ?? 'N/A'
      const depths = [1, 2, 3, 5]
      const vsByDepth = await Promise.all(
        depths.map(async (d) => {
          const pred = await getOrCachePrediction({ lat: location.lat, lon: location.lon, depth_m: d, pga_g: pga })
          return { depth_m: d, vs_m_s: pred.vs_predicted, p10: pred.vs_p10, p90: pred.vs_p90 }
        }),
      )
      const site: SiteData = {
        location,
        pga_g: pga,
        site_class: siteClass,
        vs30_m_s: vs30,
        vs_by_depth: vsByDepth,
        soil_properties: {
          sand_pct: typeof layers.sand_pct === 'number' ? layers.sand_pct : null,
          silt_pct: typeof layers.silt_pct === 'number' ? layers.silt_pct : null,
          clay_pct: typeof layers.clay_pct === 'number' ? layers.clay_pct : null,
          bulk_density_g_cm3: typeof layers.bulk_density === 'number' ? layers.bulk_density : null,
          water_content_pct: typeof layers.water_content === 'number' ? layers.water_content : null,
        },
      }
      const analysis = checkBcpCompliance(building, site)
      return { ok: true, analysis }
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? 'Compliance analysis failed') }
    }
  }

  if (name === 'generate_compliance_report') {
    const analysis = input?.analysis_results
    if (!analysis || typeof analysis !== 'object') return { ok: false, error: 'Missing analysis_results' }
    const fmt = String(input?.format ?? 'pdf').toLowerCase()
    if (fmt === 'markdown') {
      const lines: string[] = []
      lines.push('## Site Compliance Report')
      lines.push(`- Site Class: ${analysis?.site?.site_class ?? 'N/A'}`)
      lines.push(`- PGA: ${analysis?.site?.pga_g ?? 'N/A'}g`)
      for (const f of Array.isArray(analysis?.findings) ? analysis.findings : []) {
        lines.push(`- ${f.category}: ${String(f.status).toUpperCase()} (${f.severity}) — ${f.message}`)
      }
      return { ok: true, format: 'markdown', markdown: lines.join('\n') }
    }
    return {
      ok: true,
      format: 'pdf',
      note: 'Use /api/generate-compliance-report with analysis_results to create downloadable PDF.',
    }
  }

  if (name === 'get_code_requirement') {
    const siteClass = String(input?.site_class ?? '').trim().toUpperCase()
    if (!siteClass) return { ok: false, error: 'Missing site_class' }
    const buildingType = String(input?.building_type ?? '').trim().toLowerCase()
    const topic = String(input?.topic ?? '').trim().toLowerCase()
    const tags = ['bcp-sp-2021', 'requirements'].filter(Boolean)
    const q = [siteClass ? `site class ${siteClass}` : '', buildingType, topic].filter(Boolean).join(' ').trim()
    const hits = searchCodeDb({ q, tags: [], limit: 6 })
    return {
      ok: true,
      site_class: siteClass,
      building_type: buildingType || null,
      topic: topic || null,
      entries: hits.map((h) => ({ id: h.id, title: h.title, text: h.text, refs: h.refs, tags: h.tags })),
      disclaimer:
        'BCP-SP 2021 requirements must be confirmed against the official code text; this database is a structured summary and may be incomplete.',
    }
  }

  if (name === 'get_uncertainty_interpretation') {
    return {
      ok: true,
      text:
        'The p10-p90 interval is an 80% prediction interval: under the model assumptions, 80% of similar locations are expected to fall within that range. ' +
        'Wide intervals indicate higher uncertainty (sparser data, higher heterogeneity, or model limitations). Use intervals for screening and prioritize verification where uncertainty is high.',
    }
  }

  if (name === 'get_limitations') {
    const hits = searchCodeDb({ q: 'limitations', limit: 3 })
    return {
      ok: true,
      bullets: [
        'Screening-level predictions only; not a substitute for site investigation.',
        'Shallow depths (1-5 m); does not replace standard Vs30 characterization.',
        'Uncertainty reflects data/model limits; local anomalies may not be captured.',
      ],
      references: hits.map((h) => ({ title: h.title, refs: h.refs })),
    }
  }

  return { ok: false, error: `Unknown tool: ${name}` }
}

async function callClaudeWithTools(params: { model: string; apiKey: string; system: string; messages: any[] }) {
  const start = Date.now()
  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': params.apiKey,
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: 900,
      temperature: 0.2,
      system: params.system,
      tools: toolDefs(),
      messages: params.messages,
    }),
  })
  const raw = await upstream.text()
  logger.info('ANTHROPIC', 'messages_api', { status: upstream.status, ms: Date.now() - start, model: params.model, key_prefix: keyPrefix(params.apiKey) })
  if (!upstream.ok) throw new Error(`Claude request failed (${upstream.status}): ${raw.slice(0, 300)}`)
  return JSON.parse(raw)
}

function toClientShape(out: any) {
  const response = typeof out?.response === 'string' ? out.response : String(out?.text ?? '').trim()
  const citations = Array.isArray(out?.citations) ? out.citations : []
  const suggested = Array.isArray(out?.suggested_questions) ? out.suggested_questions : Array.isArray(out?.suggested_actions) ? out.suggested_actions : []
  const suggested_actions = Array.isArray(out?.suggested_actions) ? out.suggested_actions : suggested
  return { response, citations, suggested_questions: suggested, suggested_actions }
}

function streamTextAsSse(meta: any, text: string) {
  const enc = new TextEncoder()
  const chunks = text.match(/.{1,40}(\s+|$)|.{1,40}/g) ?? [text]
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(`event: open\ndata: ${JSON.stringify(meta ?? {})}\n\n`))
      for (const c of chunks) {
        controller.enqueue(enc.encode(`event: token\ndata: ${JSON.stringify({ t: c })}\n\n`))
      }
      controller.enqueue(enc.encode('event: done\ndata: {}\n\n'))
      controller.close()
    },
  })
}

export async function POST(req: Request) {
  const ip = getIp(req)
  if (!rateLimitOk(`chat:${ip}`, 10, 60_000)) {
    return NextResponse.json({ ok: false, error: 'Rate limit exceeded (10 requests/min). Try again shortly.' }, { status: 429 })
  }

  const url = new URL(req.url)
  const stream = url.searchParams.get('stream') === '1'

  const apiKey = process.env.ANTHROPIC_API_KEY ? process.env.ANTHROPIC_API_KEY.trim() : undefined
  const model = process.env.ANTHROPIC_MODEL || 'claude-3-sonnet-20240229'

  // Debug logging
  logger.info('CHAT_START', 'env_check', {
    api_key_exists: Boolean(apiKey),
    api_key_length: apiKey?.length ?? 0,
    model,
    node_env: process.env.NODE_ENV,
  })

  let body: ChatRequest
  try {
    body = (await req.json()) as ChatRequest
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const message = String(body?.message ?? '').trim()
  if (!message) return NextResponse.json({ ok: false, error: 'Missing message' }, { status: 400 })

  const conversationId = String(body?.conversation_id ?? '').trim() || crypto.randomUUID()
  const clientId = String(body?.client_id ?? req.headers.get('x-client-id') ?? '').trim() || null
  const userId = getUserIdFromHeaders(req)
  const ctx = body?.context ?? {}
  const attachments = Array.isArray(body?.attachments) ? body.attachments : []
  const complianceIntent = /\b(analy[sz]e|compliance|check code|is this compliant|bcp|building code)\b/i.test(message)
  logger.info('CHAT', 'request_received', {
    ts: new Date().toISOString(),
    message_chars: message.length,
    attachments: attachments.length,
    stream,
    model,
    has_api_key: Boolean(apiKey && apiKey.trim()),
    api_key_prefix: keyPrefix(apiKey),
  })

  const depth = Number.isFinite(Number(ctx.depth)) ? Number(ctx.depth) : parseDepth(message, 2.0)
  const depths = availableDepths()
  const depthUse = depths.includes(depth) ? depth : depths.includes(2.0) ? 2.0 : depths[0] ?? 2.0

  const ll = parseLonLat(message) ?? (Number.isFinite(Number(ctx?.lat)) && Number.isFinite(Number(ctx?.lon)) ? { lat: Number(ctx.lat), lon: Number(ctx.lon) } : null)
  const sector = ctx.location ? String(ctx.location) : parseSector(message)
  const cmp = parseCompare(message)

  let dataQuoted: any = null
  if (cmp) {
    const res = compareSectors(cmp.a, cmp.b, depthUse)
    if (res.a && res.b) dataQuoted = { type: 'compare', depth_m: depthUse, a: res.a, b: res.b }
  } else if (ll) {
    const row = queryNearest(ll.lon, ll.lat, depthUse)
    if (row)
      dataQuoted = {
        type: 'location',
        input: { lon: ll.lon, lat: ll.lat, depth_m: depthUse },
        nearest: { lon: row.longitude, lat: row.latitude, sector: row.sector_norm ?? null },
        depth_m: depthUse,
        vs: row.vs_predicted_m_s,
        p10: row.vs_predicted_p10,
        p90: row.vs_predicted_p90,
        std: row.vs_pred_std_m_s,
        nehrp_class: row.nehrp_class ?? null,
      }
  } else if (sector) {
    const s = sectorSummary(sector, depthUse)
    if (s) dataQuoted = { type: 'sector', sector: s.sector_norm, depth_m: depthUse, vs: s.vs_mean, p10: s.vs_p10_mean, p90: s.vs_p90_mean, n: s.n }
  }

  const fallback = defaultAnswerFromData(dataQuoted)

  try {
    await upsertChatSession({
      id: conversationId,
      user_id: userId,
      client_id: clientId,
      session_title: message.slice(0, 80),
      last_message_at: new Date().toISOString(),
    })
    await insertChatMessage({
      session_id: conversationId,
      role: 'user',
      content: message,
      tool_calls: null,
      citations: null,
    })
  } catch {}

  if (!apiKey) {
    const payload = {
      ok: true,
      conversation_id: conversationId,
      session_id: conversationId,
      text: fallback.response,
      response: fallback.response,
      status: 'degraded',
      fallback_used: true,
      error_code: 'ANTHROPIC_MISSING_KEY',
      suggestion: 'Anthropic API not available: Ensure ANTHROPIC_API_KEY is set in .env.local, then restart the dev server: npm run dev',
      citations: [],
      suggested_questions: [],
      suggested_actions: fallback.suggested_actions,
      data_quoted: fallback.data_quoted ?? null,
      llm: { provider: 'anthropic', model, ok: false },
      warning: 'ANTHROPIC_API_KEY is missing or empty. Using fallback (non-LLM) response. Check .env.local and restart server.',
      disclaimer: 'PRELIMINARY ASSESSMENT - NOT FOR CONSTRUCTION. Verify with site-specific investigation and a licensed engineer.',
    }
    try {
      await insertChatMessage({
        session_id: conversationId,
        role: 'assistant',
        content: fallback.response,
        tool_calls: null,
        citations: [],
      })
    } catch {}
    if (stream) {
      return new Response(streamTextAsSse(payload, fallback.response), {
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
        },
      })
    }
    return NextResponse.json(payload)
  }

  pushMem(conversationId, 'user', message)
  const hist = getMem(conversationId)

  const system =
    'You are a geotechnical engineering assistant specializing in soil liquefaction assessment and shallow shear wave velocity (Vs) predictions for Islamabad, Pakistan. ' +
    'You have access to a trained machine learning model that predicts soil properties and liquefaction risk based on: ' +
    '- Shallow Vs (shear wave velocity) at depths 1-5m with uncertainty bounds (p10/p90). ' +
    '- Gridded soil composition: sand %, silt %, clay %. ' +
    '- Bulk density, moisture content, and other geotechnical properties. ' +
    '- Liquefaction factor and settlement risk classifications (high/medium/low). ' +
    '- BCP-SP 2021 building code requirements for site classification. ' +
    '\n' +
    'SOIL MODEL CAPABILITIES:\n' +
    '- Predict Vs at any location/depth in Islamabad using the trained ensemble model. ' +
    '- Retrieve soil composition (sand/silt/clay %) and bulk properties (density, moisture). ' +
    '- Assess liquefaction potential based on soil type, saturation, and cyclic loading. ' +
    '- Classify sites (Class C/D/E) using Vs30 proxy for seismic design. ' +
    '\n' +
    'INTERACTION GUIDELINES:\n' +
    '- When user provides coordinates/location, use get_site_data() to retrieve model predictions and soil properties. ' +
    '- Explain liquefaction risk in context of soil type (clayey vs sandy), fines content, and saturation. ' +
    '- When asked about IFC buildings, call analyze_code_compliance() with the site data. ' +
    '- Always quantify uncertainty: reference p10 and p90 bounds for Vs predictions. ' +
    '- Be explicit about model limitations: shallow Vs (1-5m) is screening-level, NOT a substitute for site investigation. ' +
    '- Include mandatory disclaimer: "PRELIMINARY ASSESSMENT - NOT FOR CONSTRUCTION. Verify with site-specific geotechnical investigation and a licensed engineer." ' +
    '\n' +
    'AVAILABLE TOOLS: get_site_data, get_code_requirement, analyze_code_compliance, generate_compliance_report, visualize_ifc, extract_ifc_data. ' +
    'Return STRICT JSON with keys: response (string), citations (array), suggested_questions (array). No extra text.\n' +
    'Context JSON (read-only): ' +
    JSON.stringify({
      depth_m: depthUse,
      parsed: { lonlat: ll ?? null, sector: sector ?? null, compare: cmp ?? null },
      data_quoted: dataQuoted,
      ui_context: ctx,
      attachments,
      ifc_extracted_data: safeJsonForPrompt((body as any)?.ifc_extracted_data, 45_000),
    })

  const requestMessages = hist.map((h) => ({ role: h.role, content: [{ type: 'text', text: h.content }] }))

  let ifcViz: any = null
  let complianceResult: any = null
  let final: any = null
  let lastText = ''
  let toolSteps = 0
  try {
    while (toolSteps < 6) {
      const resp = await callClaudeWithTools({ model, apiKey, system, messages: requestMessages })
      const blocks = Array.isArray(resp?.content) ? resp.content : []
      const textOut = blocks.map((b: any) => (b?.type === 'text' ? String(b?.text ?? '') : '')).join('')
      lastText = textOut
      const toolUses = blocks.filter((b: any) => b?.type === 'tool_use')
      if (!toolUses.length) {
        final = safeJsonParse(textOut) ?? { response: textOut, citations: [], suggested_questions: [] }
        break
      }
      requestMessages.push({ role: 'assistant', content: blocks })
      for (const tu of toolUses) {
        const res = await runTool(String(tu.name), tu.input)
        if (String(tu.name) === 'visualize_ifc') ifcViz = res
        if (String(tu.name) === 'analyze_code_compliance' && res?.ok) complianceResult = res.analysis
        requestMessages.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: tu.id, content: [{ type: 'text', text: JSON.stringify(res) }] }],
        })
      }
      toolSteps += 1
    }
    if (!final) final = safeJsonParse(lastText) ?? { response: lastText || fallback.response, citations: [], suggested_questions: [] }
    if (!complianceResult && complianceIntent) {
      const ifcAttachment = attachments.find((a: any) => String(a?.type ?? '').toLowerCase() === 'ifc' && String(a?.file_url ?? '').trim())
      if (ifcAttachment) {
        const auto = await runTool('analyze_code_compliance', {
          ifc_url: ifcAttachment.file_url,
          location: Number.isFinite(Number(ctx?.lat)) && Number.isFinite(Number(ctx?.lon)) ? { lat: Number(ctx.lat), lon: Number(ctx.lon) } : undefined,
          pga_scenario: 0.3,
        })
        if (auto?.ok) {
          complianceResult = auto.analysis
          const s = complianceResult?.summary
          const extra =
            `\n\nCompliance screening complete: ${s?.pass_count ?? 0} pass, ${s?.warning_count ?? 0} warning, ${s?.fail_count ?? 0} fail. ` +
            `Would you like me to generate a formal PDF report?`
          if (typeof final?.response === 'string') final.response += extra
          else final = { ...(final ?? {}), response: `${String(final?.text ?? '').trim()}${extra}` }
        }
      }
    }
  } catch (e: any) {
    const emsg = String(e?.message ?? 'Claude API failed; fallback used')
    const authHint =
      /invalid x-api-key|authentication_error|401/i.test(emsg)
        ? 'Anthropic API authentication failed: Verify ANTHROPIC_API_KEY is correct (no spaces/quotes). Restart the dev server: npm run dev'
        : /model|not found|404/i.test(emsg)
          ? `Anthropic model error: The configured model (${params.model}) is invalid. Ensure ANTHROPIC_MODEL=claude-3-sonnet-20240229 in .env.local and restart the server.`
          : 'Anthropic API error: Check server logs and verify ANTHROPIC_API_KEY and ANTHROPIC_MODEL in .env.local are set correctly. Restart: npm run dev'
    const errorCode =
      /invalid x-api-key|authentication_error|401/i.test(emsg)
        ? 'ANTHROPIC_AUTH_ERROR'
        : /model|not found|404/i.test(emsg)
          ? 'ANTHROPIC_MODEL_ERROR'
          : 'ANTHROPIC_ERROR'
    final = {
      response: `${fallback.response}\n\n${authHint}`,
      citations: [],
      suggested_questions: fallback.suggested_actions,
    }
    const payload = {
      ok: true,
      conversation_id: conversationId,
      session_id: conversationId,
      ...toClientShape(final),
      status: 'degraded',
      fallback_used: true,
      error_code: errorCode,
      suggestion: authHint,
      data_quoted: dataQuoted ?? null,
      llm: { provider: 'anthropic', model, ok: false },
      warning: emsg,
      disclaimer: 'PRELIMINARY ASSESSMENT - NOT FOR CONSTRUCTION. Verify with site-specific investigation and a licensed engineer.',
    }
    logger.error('ANTHROPIC', 'chat_failed', { message: emsg, error_code: errorCode, model })
    try {
      await insertChatMessage({
        session_id: conversationId,
        role: 'assistant',
        content: String(payload.response ?? fallback.response),
        tool_calls: null,
        citations: payload.citations ?? [],
      })
    } catch {}
    if (stream) {
      return new Response(streamTextAsSse(payload, String(payload.response ?? payload.text ?? fallback.response)), {
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
        },
      })
    }
    return NextResponse.json(payload)
  }

  const shaped = toClientShape(final)
  pushMem(conversationId, 'assistant', shaped.response)
  try {
    await upsertChatSession({
      id: conversationId,
      user_id: userId,
      client_id: clientId,
      session_title: message.slice(0, 80),
      last_message_at: new Date().toISOString(),
    })
    await insertChatMessage({
      session_id: conversationId,
      role: 'assistant',
      content: shaped.response,
      tool_calls: null,
      citations: shaped.citations ?? [],
    })
  } catch {}

  try {
    const logsDir = path.join(process.cwd(), 'conversation_logs')
    fs.mkdirSync(logsDir, { recursive: true })
    const entry = { ts: new Date().toISOString(), ip, conversation_id: conversationId, model, message, data_quoted: dataQuoted }
    fs.appendFileSync(path.join(logsDir, 'chat_logs.jsonl'), JSON.stringify(entry) + '\n', 'utf-8')
  } catch {}

  if (stream) {
    const meta = {
      ok: true,
      conversation_id: conversationId,
      session_id: conversationId,
      llm: { provider: 'anthropic', model, ok: true },
      citations: shaped.citations ?? [],
      suggested_questions: shaped.suggested_questions ?? [],
      suggested_actions: shaped.suggested_actions ?? [],
      ifc_viz: ifcViz,
      compliance_result: complianceResult,
      disclaimer: 'PRELIMINARY ASSESSMENT - NOT FOR CONSTRUCTION. Verify with site-specific investigation and a licensed engineer.',
    }
    return new Response(streamTextAsSse(meta, shaped.response), {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      },
    })
  }

  return NextResponse.json({
    ok: true,
    conversation_id: conversationId,
    session_id: conversationId,
    ...shaped,
    text: shaped.response,
    data_quoted: dataQuoted ?? null,
    ifc_viz: ifcViz,
    compliance_result: complianceResult,
    llm: { provider: 'anthropic', model, ok: true },
    disclaimer: 'PRELIMINARY ASSESSMENT - NOT FOR CONSTRUCTION. Verify with site-specific investigation and a licensed engineer.',
  })
}
