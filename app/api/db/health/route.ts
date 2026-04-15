import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'

export const dynamic = 'force-dynamic'

const pool = getDbPool()

export async function GET() {
  const hasDbUrl = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim())
  const hasParts = Boolean(process.env.DB_HOST && process.env.DB_NAME && process.env.DB_USER)
  if (!hasDbUrl && !hasParts) {
    return NextResponse.json({
      ok: true,
      db: { connected: false },
      status: 'not_configured',
      error_type: 'DATABASE_NOT_CONFIGURED',
      suggestion: 'Set DATABASE_URL (and PGSSLMODE=require when needed) if you intend to use a Postgres DB for /api/db/* endpoints.',
    })
  }
  try {
    const r = await pool.query('select 1 as ok')
    return NextResponse.json({ ok: true, db: { connected: r.rows?.[0]?.ok === 1 } })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, db: { connected: false }, error: 'DB connection failed', error_type: 'DATABASE_CONNECTION_FAILED' },
      { status: 500 },
    )
  }
}
