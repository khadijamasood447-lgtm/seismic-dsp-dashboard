import { createSupabaseServerClient } from './server'

type SessionInsert = {
  id?: string
  user_id?: string | null
  client_id?: string | null
  session_title?: string | null
  last_message_at?: string | null
}

type MessageInsert = {
  session_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  tool_calls?: any
  citations?: any
  metadata?: any
}

function sb() {
  return createSupabaseServerClient()
}

export async function upsertChatSession(input: SessionInsert) {
  const supabase = sb()
  if (!supabase) return null

  if (input.id) {
    const { data, error } = await supabase
      .from('chat_sessions')
      .upsert(
        {
          id: input.id,
          user_id: input.user_id ?? null,
          client_id: input.client_id ?? null,
          session_title: input.session_title ?? null,
          last_message_at: input.last_message_at ?? new Date().toISOString(),
        },
        { onConflict: 'id' },
      )
      .select('*')
      .single()
    if (error) throw error
    return data
  }

  const { data, error } = await supabase
    .from('chat_sessions')
    .insert({
      user_id: input.user_id ?? null,
      client_id: input.client_id ?? null,
      session_title: input.session_title ?? null,
      last_message_at: input.last_message_at ?? new Date().toISOString(),
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function listChatSessions(opts: { user_id?: string | null; client_id?: string | null }) {
  const supabase = sb()
  if (!supabase) return []
  let q = supabase.from('chat_sessions').select('*').order('last_message_at', { ascending: false }).limit(100)
  if (opts.user_id) q = q.eq('user_id', opts.user_id)
  else if (opts.client_id) q = q.eq('client_id', opts.client_id)
  else return []
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

export async function deleteChatSession(id: string, opts: { user_id?: string | null; client_id?: string | null }) {
  const supabase = sb()
  if (!supabase) return false
  let q = supabase.from('chat_sessions').delete().eq('id', id)
  if (opts.user_id) q = q.eq('user_id', opts.user_id)
  else if (opts.client_id) q = q.eq('client_id', opts.client_id)
  else return false
  const { error } = await q
  if (error) throw error
  return true
}

export async function insertChatMessage(input: MessageInsert) {
  const supabase = sb()
  if (!supabase) return null
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      session_id: input.session_id,
      role: input.role,
      content: input.content,
      tool_calls: input.tool_calls ?? null,
      citations: input.citations ?? null,
      metadata: input.metadata ?? null,
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function listChatMessages(sessionId: string, opts: { user_id?: string | null; client_id?: string | null }) {
  const supabase = sb()
  if (!supabase) return []
  let q = supabase
    .from('chat_messages')
    .select('*, chat_sessions!inner(id, user_id, client_id)')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
  if (opts.user_id) q = q.eq('chat_sessions.user_id', opts.user_id)
  else if (opts.client_id) q = q.eq('chat_sessions.client_id', opts.client_id)
  else return []
  const { data, error } = await q
  if (error) throw error
  return (data ?? []).map((x: any) => ({
    id: x.id,
    session_id: x.session_id,
    role: x.role,
    content: x.content,
    tool_calls: x.tool_calls,
    citations: x.citations,
    metadata: x.metadata,
    created_at: x.created_at,
  }))
}

export async function upsertPredictionCache(input: {
  latitude: number
  longitude: number
  depth_m: number
  pga_g: number
  vs_predicted?: number | null
  vs_p10?: number | null
  vs_p90?: number | null
  sand_pct?: number | null
  silt_pct?: number | null
  clay_pct?: number | null
  bulk_density?: number | null
  water_content?: number | null
  site_class?: string | null
}) {
  const supabase = sb()
  if (!supabase) return null
  const { data, error } = await supabase
    .from('predictions_cache')
    .upsert(
      {
        ...input,
        expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      },
      { onConflict: 'latitude,longitude,depth_m,pga_g' },
    )
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function getPredictionCache(latitude: number, longitude: number, depth_m: number, pga_g: number) {
  const supabase = sb()
  if (!supabase) return null
  const { data, error } = await supabase.rpc('get_prediction', { p_lat: latitude, p_lon: longitude, p_depth: depth_m, p_pga: pga_g })
  if (error) throw error
  return data?.[0] ?? null
}

export async function createReportRow(input: {
  user_id?: string | null
  client_id?: string | null
  report_title?: string
  location?: any
  pga_scenario?: number | null
  building_type?: string | null
  report_pdf_url?: string | null
  report_summary?: string | null
  file_size_bytes?: number | null
}) {
  const supabase = sb()
  if (!supabase) return null
  const { data, error } = await supabase.from('reports').insert(input).select('*').single()
  if (error) throw error
  return data
}

export async function listReports(opts: { user_id?: string | null; client_id?: string | null }) {
  const supabase = sb()
  if (!supabase) return []
  let q = supabase.from('reports').select('*').order('created_at', { ascending: false }).limit(100)
  if (opts.user_id) q = q.eq('user_id', opts.user_id)
  else if (opts.client_id) q = q.eq('client_id', opts.client_id)
  else return []
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

export async function deleteReport(id: string, opts: { user_id?: string | null; client_id?: string | null }) {
  const supabase = sb()
  if (!supabase) return false
  let q = supabase.from('reports').delete().eq('id', id)
  if (opts.user_id) q = q.eq('user_id', opts.user_id)
  else if (opts.client_id) q = q.eq('client_id', opts.client_id)
  else return false
  const { error } = await q
  if (error) throw error
  return true
}

export async function createIfcAnalysisRow(input: {
  user_id?: string | null
  client_id?: string | null
  original_filename?: string | null
  building_height?: number | null
  site_class?: string | null
  inconsistencies?: any
  summary?: any
}) {
  const supabase = sb()
  if (!supabase) return null
  const { data, error } = await supabase.from('ifc_analyses').insert(input).select('*').single()
  if (error) throw error
  return data
}

export async function listIfcAnalyses(opts: { user_id?: string | null; client_id?: string | null }) {
  const supabase = sb()
  if (!supabase) return []
  let q = supabase.from('ifc_analyses').select('*').order('created_at', { ascending: false }).limit(100)
  if (opts.user_id) q = q.eq('user_id', opts.user_id)
  else if (opts.client_id) q = q.eq('client_id', opts.client_id)
  else return []
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

export async function uploadBufferToBucket(bucket: string, filePath: string, body: Uint8Array, contentType: string) {
  const supabase = sb()
  if (!supabase) return null
  const { data, error } = await supabase.storage.from(bucket).upload(filePath, body, {
    contentType,
    upsert: true,
  })
  if (error) throw error
  return data
}

export async function createSignedDownloadUrl(bucket: string, filePath: string, expiresIn = 60 * 60 * 24 * 7) {
  const supabase = sb()
  if (!supabase) return null
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(filePath, expiresIn)
  if (error) throw error
  return data?.signedUrl ?? null
}
