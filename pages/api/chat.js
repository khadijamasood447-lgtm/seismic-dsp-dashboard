export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  
  const { message, conversation_id, client_id } = req.body;
  
  res.status(200).json({
    response: `Received: ${message || "empty message"}`,
    conversation_id: conversation_id || "unknown",
    client_id: client_id || "unknown",
    timestamp: new Date().toISOString()
  });
}
