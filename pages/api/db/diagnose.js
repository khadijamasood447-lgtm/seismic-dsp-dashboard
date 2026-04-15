export default function handler(req, res) {
  res.status(200).json({
    status: "success",
    message: "Database diagnostic endpoint",
    timestamp: new Date().toISOString(),
    database_configured: !!process.env.DATABASE_URL
  });
}
