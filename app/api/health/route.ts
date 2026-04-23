import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerClient, isSupabaseServerConfigured } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const results: any = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      database: { status: 'unknown' },
      storage: { status: 'unknown' },
      anthropic: { status: 'unknown' },
    },
  }

  // 1. Check Supabase Database (no DATABASE_URL required)
  try {
    if (!isSupabaseServerConfigured()) {
      results.services.database.status = 'not_configured'
      results.status = 'degraded'
    } else {
      const supabase = createSupabaseServerClient()
      if (!supabase) {
        results.services.database.status = 'not_configured'
        results.status = 'degraded'
      } else {
        const { error } = await supabase.from('chat_sessions').select('id').limit(1)
        if (error) throw error
        results.services.database.status = 'healthy'
      }
    }
  } catch (e: any) {
    results.services.database.status = 'error'
    results.services.database.error = e.message
    results.status = 'degraded'
  }

  // 2. Check Supabase Storage
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    
    if (supabaseUrl && supabaseServiceKey) {
      const supabase = createClient(supabaseUrl, supabaseServiceKey)
      const { data, error } = await supabase.storage.listBuckets()
      if (error) throw error
      results.services.storage.status = 'healthy'
      results.services.storage.buckets = data.map(b => b.name)
    } else {
      results.services.storage.status = 'not_configured'
    }
  } catch (e: any) {
    results.services.storage.status = 'error'
    results.services.storage.error = e.message
    results.status = 'degraded'
  }

  // 3. Check Anthropic API (Lightweight check)
  try {
    const anthropicKey = process.env.ANTHROPIC_API_KEY
    if (anthropicKey) {
      // We don't want to waste tokens, just check if key exists and is valid format
      if (anthropicKey.startsWith('sk-ant-')) {
        results.services.anthropic.status = 'configured'
      } else {
        results.services.anthropic.status = 'invalid_format'
      }
    } else {
      results.services.anthropic.status = 'not_configured'
    }
  } catch (e: any) {
    results.services.anthropic.status = 'error'
    results.services.anthropic.error = e.message
  }

  const statusCode = results.status === 'unhealthy' ? 500 : 200
  return NextResponse.json(results, { status: statusCode })
}
