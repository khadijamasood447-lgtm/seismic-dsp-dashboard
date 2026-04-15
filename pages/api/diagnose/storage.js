export default function handler(req, res) {
  res.status(200).json({
    status: "success",
    message: "Storage diagnostic endpoint",
    timestamp: new Date().toISOString()
  });
}
