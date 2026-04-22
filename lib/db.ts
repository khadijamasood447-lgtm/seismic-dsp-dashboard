import { Pool } from 'pg'

declare global {
  // eslint-disable-next-line no-var
  var __geonexusPgPool: Pool | undefined
}

function buildPool() {
  const databaseUrl = process.env.DATABASE_URL
  if (databaseUrl) {
    const isSupabase = databaseUrl.includes('supabase.co')
    const isRailway = databaseUrl.includes('rlwy.net')
    const shouldUseSsl =
      process.env.PGSSLMODE === 'require' ||
      process.env.PGSSLMODE === 'verify-ca' ||
      process.env.PGSSLMODE === 'verify-full' ||
      (process.env.NODE_ENV === 'production' && (isSupabase || isRailway))

    try {
      return new Pool({
        connectionString: databaseUrl,
        ssl: shouldUseSsl ? { rejectUnauthorized: false } : undefined,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      })
    } catch (error: any) {
      console.error('Failed to initialize database pool:', error.message)
      throw new Error(`Database connection initialization failed. Check DATABASE_URL and SSL settings. Error: ${error.message}`)
    }
  }

  // Fallback to individual connection parameters
  const host = process.env.DB_HOST
  if (host) {
    return new Pool({
      user: process.env.DB_USER,
      host: host,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: Number(process.env.DB_PORT || 5432),
    })
  }

  // If no config, return a pool that will fail on query with a clear message
  return new Pool({
    connectionString: 'postgresql://invalid:invalid@localhost:5432/invalid',
  })
}

export function getDbPool() {
  if (!global.__geonexusPgPool) {
    global.__geonexusPgPool = buildPool()
  }
  return global.__geonexusPgPool
}
