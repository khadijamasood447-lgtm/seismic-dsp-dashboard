type Bucket = { windowStart: number; count: number }

declare global {
  // eslint-disable-next-line no-var
  var __RL__: Map<string, Bucket> | undefined
}

export function rateLimitOk(key: string, limit: number, windowMs: number) {
  if (!global.__RL__) global.__RL__ = new Map()
  const now = Date.now()
  const cur = global.__RL__.get(key)
  if (!cur || now - cur.windowStart > windowMs) {
    global.__RL__.set(key, { windowStart: now, count: 1 })
    return true
  }
  if (cur.count >= limit) return false
  cur.count += 1
  global.__RL__.set(key, cur)
  return true
}

