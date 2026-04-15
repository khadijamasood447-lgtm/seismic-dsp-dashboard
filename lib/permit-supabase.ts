import { createClient } from '@supabase/supabase-js'

function mustGet(name: string) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env ${name}`)
  return v
}

export function createPermitAdminClient() {
  const url = mustGet('NEXT_PUBLIC_SUPABASE_URL')
  const key = mustGet('SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export function createPermitUserClient(accessToken: string) {
  const url = mustGet('NEXT_PUBLIC_SUPABASE_URL')
  const key = mustGet('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
}

export async function getAuthUser(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  const m = auth.match(/^Bearer\s+(.+)$/i)
  const token = m?.[1] ?? null
  if (token) {
    const userClient = createPermitUserClient(token)
    const { data, error } = await userClient.auth.getUser()
    if (error) return { ok: false as const, error: error.message }
    const id = data.user?.id ?? null
    return id ? { ok: true as const, user_id: id, token } : { ok: false as const, error: 'Unauthenticated' }
  }
  const headerUser = req.headers.get('x-user-id')?.trim() || null
  return headerUser ? { ok: true as const, user_id: headerUser, token: null } : { ok: false as const, error: 'Unauthenticated' }
}

export async function getProfileRole(userId: string) {
  const admin = createPermitAdminClient()
  const { data, error } = await admin.from('profiles').select('role').eq('id', userId).maybeSingle()
  if (error) throw error
  return String((data as any)?.role ?? '').trim() || null
}

