import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const reqId = `ifcdbg_${Date.now()}_${Math.random().toString(16).slice(2)}`
  try {
    const body = await req.json().catch(() => null)
    const ifc_extracted_data = body?.ifc_extracted_data
    const ifc_text = body?.ifc_text

    if (ifc_extracted_data != null) {
      const s = JSON.stringify(ifc_extracted_data)
      return NextResponse.json({ ok: true, reqId, mode: 'echo', size_chars: s.length, preview: s.slice(0, 1000) })
    }

    if (typeof ifc_text === 'string' && ifc_text.trim()) {
      const enc = new TextEncoder()
      const bytes = enc.encode(ifc_text)
      if (bytes.byteLength > 10_000_000) {
        return NextResponse.json({ ok: false, reqId, error: 'ifc_text too large for debug endpoint (10MB max)' }, { status: 413 })
      }
      const mod = await import('@/lib/ifc/extractIfcForChat')
      const extracted = await mod.extractIfcForChat({ buffer: bytes.buffer, file_name: body?.file_name, source_url: body?.source_url })
      const s = JSON.stringify(extracted)
      return NextResponse.json({ ok: true, reqId, mode: 'parse', extracted, size_chars: s.length })
    }

    return NextResponse.json(
      { ok: false, reqId, error: 'Provide ifc_extracted_data (object) or ifc_text (string)' },
      { status: 400 },
    )
  } catch (e: any) {
    return NextResponse.json({ ok: false, reqId, error: String(e?.message ?? e) }, { status: 500 })
  }
}

