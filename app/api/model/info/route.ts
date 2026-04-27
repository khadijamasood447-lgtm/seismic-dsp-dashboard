import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const reportPath = path.join(process.cwd(), 'outputs', 'metrics', 'validation_report.json')
  if (!fs.existsSync(reportPath)) {
    return NextResponse.json({ ok: false, error: 'validation_report.json not found' }, { status: 404 })
  }
  try {
    const raw = fs.readFileSync(reportPath, 'utf-8')
    const obj = JSON.parse(raw)
    const bestPractical = obj?.best_practical ?? null
    const practical = obj?.comparisons?.vs30weak_ensemble?.practical ?? null
    const strict = obj?.comparisons?.vs30weak_ensemble?.strict ?? null
    return NextResponse.json({ ok: true, best_practical: bestPractical, vs30weak: { practical, strict } })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

