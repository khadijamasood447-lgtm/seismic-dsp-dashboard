import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const reqId = `anth_models_${Date.now()}_${Math.random().toString(16).slice(2)}`
  try {
    const key = process.env.ANTHROPIC_API_KEY
    if (!key) return NextResponse.json({ ok: false, reqId, error: 'Anthropic API key not configured' }, { status: 503 })

    const r = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'anthropic-version': '2023-06-01',
        'x-api-key': key,
      },
    })

    const text = await r.text().catch(() => '')
    let json: any = null
    try {
      json = JSON.parse(text)
    } catch {
      json = null
    }

    if (!r.ok) {
      return NextResponse.json(
        {
          ok: false,
          reqId,
          status: r.status,
          error: 'Failed to list models',
          body_preview: String(text).slice(0, 1200),
        },
        { status: 500 },
      )
    }

    return NextResponse.json({ ok: true, reqId, models: json ?? text })
  } catch (e: any) {
    return NextResponse.json({ ok: false, reqId, error: String(e?.message ?? e) }, { status: 500 })
  }
}

