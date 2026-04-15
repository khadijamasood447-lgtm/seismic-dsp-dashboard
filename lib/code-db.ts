import fs from 'fs'
import path from 'path'

export type CodeRef = {
  doc: string
  section?: string
  clause?: string
  table?: string
  page?: number
}

export type CodeEntry = {
  id: string
  title: string
  tags: string[]
  text: string
  refs: CodeRef[]
}

export type CodeDatabase = {
  version: string
  updated_at: string
  docs: Array<{ id: string; title: string; file?: string }>
  entries: CodeEntry[]
}

let cached: CodeDatabase | null = null

export function loadCodeDb(): CodeDatabase {
  if (cached) return cached
  const candidates = [
    path.join(process.cwd(), 'code_database.json'),
    path.join(process.cwd(), 'ISLAMABD DATA', 'code_database.json'),
  ]
  const p = candidates.find((x) => fs.existsSync(x))
  if (!p) {
    cached = { version: '0.0.0', updated_at: new Date().toISOString(), docs: [], entries: [] }
    return cached
  }
  const raw = fs.readFileSync(p, 'utf-8')
  cached = JSON.parse(raw) as CodeDatabase
  return cached
}

export function searchCodeDb(params: {
  q?: string
  tags?: string[]
  limit?: number
}): Array<CodeEntry> {
  const db = loadCodeDb()
  const q = (params.q ?? '').trim().toLowerCase()
  const tags = (params.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean)
  const limit = Math.max(1, Math.min(20, params.limit ?? 5))

  const scored = db.entries
    .map((e) => {
      const hay = `${e.title}\n${e.text}\n${(e.tags ?? []).join(' ')}`.toLowerCase()
      const matchesQ = q ? hay.includes(q) : true
      const matchesTags = tags.length ? tags.every((t) => (e.tags ?? []).map((x) => x.toLowerCase()).includes(t)) : true
      if (!matchesQ || !matchesTags) return null
      const score = (q ? (e.title.toLowerCase().includes(q) ? 3 : 1) : 1) + (tags.length ? 2 : 0)
      return { e, score }
    })
    .filter(Boolean) as Array<{ e: CodeEntry; score: number }>

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((x) => x.e)
}

export function getCodeById(id: string) {
  const db = loadCodeDb()
  return db.entries.find((e) => e.id === id) ?? null
}

