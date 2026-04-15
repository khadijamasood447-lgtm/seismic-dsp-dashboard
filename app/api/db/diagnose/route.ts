import { NextResponse } from 'next/server'

import { createSupabaseServerClient, isSupabaseServerConfigured } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function checkTableExists(table: string) {
  const supabase = createSupabaseServerClient()
  if (!supabase) return { exists: false, error: 'Supabase server client not configured' }
  try {
    const { error } = await supabase.from(table as any).select('*').limit(1)
    if (!error) return { exists: true, error: null }
    const msg = error.message || ''
    const missing = /could not find the table|schema cache|relation .* does not exist|does not exist|not found/i.test(msg)
    return { exists: !missing, error: msg }
  } catch (e: any) {
    return { exists: false, error: String(e?.message ?? 'query failed') }
  }
}

export async function GET() {
  const ts = new Date().toISOString()
  const status: any = {
    timestamp: ts,
    environment: process.env.NODE_ENV || 'development',
    supabase: {
      configured: isSupabaseServerConfigured(),
      url_host: null as string | null,
      service_role_prefix: null as string | null,
      tables: {} as Record<string, any>,
      connection_error: null as string | null,
    },
  }

  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
  if (url) {
    try {
      status.supabase.url_host = new URL(url).host
    } catch {}
  }
  const sr = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  status.supabase.service_role_prefix = sr ? sr.slice(0, 10) + '...' : null

  if (!status.supabase.configured) {
    status.status = 'missing_env_vars'
    status.suggestion = 'Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your deployment environment.'
    return NextResponse.json(status, { status: 500 })
  }

  const requiredTables = [
    'chat_sessions',
    'chat_messages',
    'predictions_cache',
    'reports',
    'ifc_analyses',
    'permit_applications',
    'permit_reviews',
    'notifications',
  ]

  for (const t of requiredTables) {
    status.supabase.tables[t] = await checkTableExists(t)
  }

  const anyMissing = Object.values(status.supabase.tables).some((v: any) => v && v.exists === false)
  status.status = anyMissing ? 'missing_tables' : 'healthy'
  status.suggestion =
    status.status === 'missing_tables'
      ? 'Apply Supabase migrations: supabase/migrations/001_initial_schema.sql and supabase/migrations/003_permit_workflow.sql (Supabase SQL Editor).'
      : null
  logger.info('DB_DIAG', 'db_diagnose', { status: status.status, host: status.supabase.url_host })

  return NextResponse.json(status)
}
