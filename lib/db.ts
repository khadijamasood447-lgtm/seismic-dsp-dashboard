import { Pool } from 'pg'

declare global {
  // eslint-disable-next-line no-var
  var __geonexusPgPool: Pool | undefined
}

function buildPool() {
  const databaseUrl = process.env.DATABASE_URL
  
  if (!databaseUrl) {
    // Return a dummy object during build or if not configured
    // This prevents the application from crashing at startup
    return {
      query: async () => {
        throw new Error('DATABASE_URL is not configured. Direct SQL queries are unavailable.')
      },
      on: () => {},
      end: async () => {},
    } as any
  }

  const isSupabase = databaseUrl.includes('supabase.co')
  const shouldUseSsl =
    process.env.PGSSLMODE === 'require' ||
    process.env.PGSSLMODE === 'verify-ca' ||
    process.env.PGSSLMODE === 'verify-full' ||
    (process.env.NODE_ENV === 'production' && isSupabase)

  try {
    return new Pool({
      connectionString: databaseUrl,
      ssl: shouldUseSsl ? { rejectUnauthorized: false } : undefined,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    })
  } catch (error: any) {
    console.error('Failed to initialize database pool:', error.message)
    throw new Error(`Database connection initialization failed. Please check DATABASE_URL and SSL settings. Error: ${error.message}`)
  }
}

export function getDbPool() {
  if (!global.__geonexusPgPool) {
    global.__geonexusPgPool = buildPool()
  }
  return global.__geonexusPgPool
}
