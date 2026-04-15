export default function handler(req, res) {
  res.status(200).json({
    status: "success",
    environment: process.env.NODE_ENV || "development",
    node_version: process.version,
    timestamp: new Date().toISOString(),
    env_vars_configured: {
      DATABASE_URL: !!process.env.DATABASE_URL,
      SUPABASE_URL: !!process.env.SUPABASE_URL,
      SUPABASE_ANON_KEY: !!process.env.SUPABASE_ANON_KEY
    }
  });
}
