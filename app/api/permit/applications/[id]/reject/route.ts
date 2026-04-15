import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request, ctx: any) {
  const url = new URL(req.url)
  url.pathname = url.pathname.replace(/\/reject$/, '/review')
  const body = await req.json().catch(() => ({}))
  const nextReq = new Request(url.toString(), {
    method: 'POST',
    headers: req.headers,
    body: JSON.stringify({ ...body, decision: 'rejected' }),
  })
  const mod = await import('../review/route')
  return mod.POST(nextReq, ctx) as any
}

