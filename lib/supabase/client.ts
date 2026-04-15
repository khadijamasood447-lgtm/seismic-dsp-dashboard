import { createClient } from '@supabase/supabase-js'

import type { Database } from './types'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

function looksReal(value?: string) {
  if (!value) return false
  const v = value.trim()
  return v !== '' && !/YOUR_|your-|YOUR_PROJECT_REF/i.test(v)
}

export const isSupabaseClientConfigured = Boolean(looksReal(supabaseUrl) && looksReal(supabaseAnonKey))

export function createBrowserSupabaseClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')
  }
  return createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  })
}

export const supabase = isSupabaseClientConfigured ? createBrowserSupabaseClient() : null
