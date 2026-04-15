import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Database } from './types'

function getServerEnv() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    serviceRole: process.env.SUPABASE_SERVICE_ROLE_KEY,
  }
}

function looksReal(value?: string) {
  if (!value) return false
  const v = value.trim()
  return v !== '' && !/YOUR_|your-|YOUR_PROJECT_REF/i.test(v)
}

export function isSupabaseServerConfigured() {
  const { url, serviceRole } = getServerEnv()
  return Boolean(looksReal(url) && looksReal(serviceRole))
}

export function createSupabaseServerClient(): SupabaseClient<Database> | null {
  const { url, serviceRole } = getServerEnv()
  if (!looksReal(url) || !looksReal(serviceRole)) return null
  return createClient<Database>(url, serviceRole, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

export function createSupabaseUserClient(accessToken?: string): SupabaseClient<Database> | null {
  const { url, anon } = getServerEnv()
  if (!looksReal(url) || !looksReal(anon)) return null
  return createClient<Database>(url, anon, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: accessToken
      ? {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      : undefined,
  })
}

export function getBearerToken(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  const m = auth.match(/^Bearer\s+(.+)$/i)
  return m?.[1] ?? null
}

export function getUserIdFromHeaders(req: Request) {
  const x = req.headers.get('x-user-id')
  return x?.trim() || null
}
