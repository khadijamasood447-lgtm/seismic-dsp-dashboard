import { NextResponse } from 'next/server'

import { rateLimitOk } from '@/lib/rate-limit'
import { extractIfcDataFromText, extractIfcDataFromUrl } from '@/lib/compliance/bcp-checks'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type ReqBody = {
  ifc_url?: string
  ifc_text?: string
  file_name?: string
}

function getIp(req: Request) {
  const xf = req.headers.get('x-forwarded-for') ?? ''
  const ip = xf.split(',')[0]?.trim()
  return ip || req.headers.get('x-real-ip') || 'local'
}

export async function POST(req: Request) {
  const ip = getIp(req)
  if (!rateLimitOk(`extract-ifc:${ip}`, 15, 60_000)) {
    return NextResponse.json({ ok: false, error: 'Rate limit exceeded (15 requests/min). Try again shortly.' }, { status: 429 })
  }

  let body: ReqBody
  try {
    body = (await req.json()) as ReqBody
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const ifcUrl = String(body?.ifc_url ?? '').trim()
  const ifcText = typeof body?.ifc_text === 'string' ? body.ifc_text : ''
  const fileName = String(body?.file_name ?? '').trim() || null

  if (!ifcUrl && !ifcText) {
    return NextResponse.json({ ok: false, error: 'Provide ifc_url or ifc_text' }, { status: 400 })
  }

  try {
    const extracted = ifcText ? extractIfcDataFromText(ifcText, fileName) : await extractIfcDataFromUrl(ifcUrl, fileName)
    return NextResponse.json({
      ok: true,
      building_params: extracted,
      disclaimer:
        'PRELIMINARY EXTRACTION: IFC parsing is metadata-based and may miss geometry/properties in some authoring formats.',
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? 'Failed to extract IFC data') }, { status: 500 })
  }
}

