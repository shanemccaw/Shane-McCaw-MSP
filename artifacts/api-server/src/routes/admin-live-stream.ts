import { Router, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import { registerHubClient } from "../lib/sse-hub.ts";

const router = Router();

// GET /api/admin/live-stream?channel=<eventType>&mspId=42&token=<jwt>
// Query-param JWT (EventSource can't send an Authorization header). Mirrors the
// SSE setup in routes/notifications.ts — same header block and 25s keepalive.
router.get("/admin/live-stream", async (req: Request, res: Response) => {
  const token = String(req.query.token ?? "");
  const channel = String(req.query.channel ?? "");
  const scopeParam = req.query.mspId;
  const scopeKey = scopeParam ? Number(scopeParam) : null;
  const secret = process.env.JWT_SECRET;
  if (!secret || !token || !channel) { res.status(401).json({ error: "Missing token or channel" }); return; }

  let user: { id: number; role: string };
  try { user = jwt.verify(token, secret) as { id: number; role: string }; }
  catch { res.status(401).json({ error: "Invalid or expired token" }); return; }
  if (user.role !== "admin") { res.status(403).json({ error: "Admin access required" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.write(": connected\n\n");

  const keepAlive = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 25_000);
  registerHubClient(channel, scopeKey, res, () => clearInterval(keepAlive));
});

export default router;
