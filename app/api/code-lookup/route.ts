import { NextResponse } from 'next/server'

import { searchCodeDb } from '@/lib/code-db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const q = searchParams.get('q') ?? ''
    const tagsRaw = searchParams.get('tags') ?? ''
    const limit = Number(searchParams.get('limit') ?? '5')
    const tags = tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)

    const hits = searchCodeDb({ q, tags, limit })
    return NextResponse.json({
      ok: true,
      results: hits.map((h) => ({
        id: h.id,
        title: h.title,
        text: h.text,
        tags: h.tags,
        refs: h.refs,
      })),
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? 'lookup failed') }, { status: 500 })
  }
}

