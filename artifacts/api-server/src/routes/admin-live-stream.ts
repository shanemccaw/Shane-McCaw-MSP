import { Router, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import { registerHubClient, registerFirehoseClient } from "../lib/sse-hub.ts";
import { requireAdmin } from "../middlewares/requireAuth";

const router = Router();

// Locked channel taxonomy for the frontend's channel picker — the distinct set
// of `channel` tags emitted via logger.child({ channel }) across the app. Static
// for Phase 3a (a live DISTINCT on platform_log_stream is a future nicety); keep
// this in sync when a new channel is introduced.
const CHANNEL_TAXONOMY = [
  "admin.clients",
  "admin.content",
  "admin.exceptions",
  "admin.insights",
  "audit",
  "auth",
  "billing",
  "comms.email",
  "comms.sms-push",
  "comms.webhook",
  "crm",
  "engine.alert",
  "engine.config-pack",
  "engine.kanban",
  "engine.monitor",
  "engine.offer",
  "engine.scope-creep",
  "engine.signals",
  "engine.sla",
  "growth.booking",
  "growth.quiz",
  "inbox",
  "integration.azure",
  "notification",
  "system.core",
  "system.dlq",
  "tenant.msp-admin",
  "tenant.portal",
  "workflow.doc-pipeline",
  "workflow.run",
  "workflow.script",
] as const;

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
  // channel="*" is the firehose: every broadcast on every channel/scope.
  if (channel === "*") {
    registerFirehoseClient(res, () => clearInterval(keepAlive));
  } else {
    registerHubClient(channel, scopeKey, res, () => clearInterval(keepAlive));
  }
});

// GET /api/admin/live-stream/channels — enumerate the channel taxonomy for the
// frontend's channel picker, so it doesn't hardcode the list client-side. This
// is a normal fetch (not EventSource), so it uses the standard admin guard
// rather than the query-param JWT the SSE route needs.
router.get("/admin/live-stream/channels", requireAdmin, (_req: Request, res: Response) => {
  res.json({ channels: CHANNEL_TAXONOMY });
});

export default router;
