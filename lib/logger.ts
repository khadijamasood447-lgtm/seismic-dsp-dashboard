import fs from 'fs'
import path from 'path'

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export type LogEntry = {
  ts: string
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
  component: string
  message: string
  data?: any
}

declare global {
  // eslint-disable-next-line no-var
  var __GEONEXUS_LOGS__: LogEntry[] | undefined
}

function getLevelFromEnv(): LogLevel {
  const raw = String(process.env.LOG_LEVEL ?? '').trim().toLowerCase()
  if (raw === 'error') return LogLevel.ERROR
  if (raw === 'warn' || raw === 'warning') return LogLevel.WARN
  if (raw === 'info') return LogLevel.INFO
  if (raw === 'debug') return LogLevel.DEBUG
  return LogLevel.DEBUG
}

function ring() {
  if (!global.__GEONEXUS_LOGS__) global.__GEONEXUS_LOGS__ = []
  return global.__GEONEXUS_LOGS__
}

function push(entry: LogEntry) {
  const r = ring()
  r.push(entry)
  while (r.length > 1000) r.shift()
}

function safeData(data: any) {
  if (data == null) return undefined
  try {
    const raw = JSON.stringify(data)
    if (raw.length > 6000) return { truncated: true, bytes: raw.length }
    return data
  } catch {
    return { unserializable: true }
  }
}

function writeToFile(line: string) {
  const enabled = String(process.env.LOG_TO_FILE ?? '').trim().toLowerCase()
  if (!(enabled === '1' || enabled === 'true' || enabled === 'yes')) return
  try {
    const dir = path.join(process.cwd(), 'logs')
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, 'app.log'), line + '\n', 'utf-8')
  } catch {}
}

class Logger {
  private level: LogLevel = getLevelFromEnv()

  setLevel(level: LogLevel) {
    this.level = level
  }

  getRecent(limit = 200) {
    const r = ring()
    const n = Math.max(1, Math.min(1000, limit))
    return r.slice(Math.max(0, r.length - n))
  }

  private emit(level: LogEntry['level'], component: string, message: string, data?: any) {
    const entry: LogEntry = { ts: new Date().toISOString(), level, component, message, data: safeData(data) }
    push(entry)
    const line = `[${entry.ts}] [${entry.level}] [${entry.component}] ${entry.message}`
    if (level === 'ERROR') console.error(line, entry.data ?? '')
    else if (level === 'WARN') console.warn(line, entry.data ?? '')
    else console.log(line, entry.data ?? '')
    writeToFile(line + (entry.data ? ` ${JSON.stringify(entry.data)}` : ''))
  }

  debug(component: string, message: string, data?: any) {
    if (this.level > LogLevel.DEBUG) return
    this.emit('DEBUG', component, message, data)
  }

  info(component: string, message: string, data?: any) {
    if (this.level > LogLevel.INFO) return
    this.emit('INFO', component, message, data)
  }

  warn(component: string, message: string, data?: any) {
    if (this.level > LogLevel.WARN) return
    this.emit('WARN', component, message, data)
  }

  error(component: string, message: string, error?: any) {
    if (this.level > LogLevel.ERROR) return
    const errObj =
      error && typeof error === 'object'
        ? {
            name: (error as any).name,
            message: (error as any).message,
            status: (error as any).status,
            code: (error as any).code,
          }
        : error
    this.emit('ERROR', component, message, errObj)
  }
}

export const logger = new Logger()

