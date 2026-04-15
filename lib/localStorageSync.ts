export type LocalChatSession = {
  id: string
  session_title: string
  created_at: string
  last_message_at: string
}

export type LocalChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  created_at: string
  synced?: boolean
}

function sessionsKey(clientId: string) {
  return `seismic_local_sessions_${clientId}`
}

function messagesKey(clientId: string, sessionId: string) {
  return `seismic_local_messages_${clientId}_${sessionId}`
}

export function loadLocalSessions(clientId: string): LocalChatSession[] {
  try {
    const raw = localStorage.getItem(sessionsKey(clientId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveLocalSessions(clientId: string, sessions: LocalChatSession[]) {
  try {
    localStorage.setItem(sessionsKey(clientId), JSON.stringify(sessions.slice(0, 200)))
  } catch {}
}

export function loadLocalMessages(clientId: string, sessionId: string): LocalChatMessage[] {
  try {
    const raw = localStorage.getItem(messagesKey(clientId, sessionId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function appendLocalMessage(clientId: string, sessionId: string, msg: LocalChatMessage) {
  try {
    const existing = loadLocalMessages(clientId, sessionId)
    existing.push(msg)
    localStorage.setItem(messagesKey(clientId, sessionId), JSON.stringify(existing.slice(-600)))
  } catch {}
}

