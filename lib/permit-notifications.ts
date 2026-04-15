import { createPermitAdminClient } from '@/lib/permit-supabase'

export async function notifyUser(params: { user_id: string; application_id: string; type: string; message: string }) {
  const admin = createPermitAdminClient()
  const { error } = await admin.from('notifications').insert({
    user_id: params.user_id,
    application_id: params.application_id,
    type: params.type,
    message: params.message,
    is_read: false,
  })
  if (error) throw error
}

export async function listNotifications(params: { user_id: string }) {
  const admin = createPermitAdminClient()
  const { data, error } = await admin
    .from('notifications')
    .select('*')
    .eq('user_id', params.user_id)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error
  return data ?? []
}

export async function markNotificationsRead(params: { user_id: string; ids: string[] }) {
  const admin = createPermitAdminClient()
  const { error } = await admin.from('notifications').update({ is_read: true }).eq('user_id', params.user_id).in('id', params.ids)
  if (error) throw error
}

