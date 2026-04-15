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

    return new Pool({
      connectionString: databaseUrl,
      ssl: shouldUseSsl ? { rejectUnauthorized: false } : undefined,
    })
  }

  return new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT || 5432),
  })
}

export function getDbPool() {
  if (!global.__geonexusPgPool) {
    global.__geonexusPgPool = buildPool()
  }
  return global.__geonexusPgPool
}
