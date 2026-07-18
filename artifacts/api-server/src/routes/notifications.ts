import { Router, type Request, type Response } from "express";
import { db, notificationsTable, usersTable } from "@workspace/db";
import { eq, and, desc, lt, sql } from "drizzle-orm";
import { requireAdmin, requireAuth } from "../middlewares/requireAuth";
import jwt from "jsonwebtoken";
import { registerNotificationSSEClient } from "../lib/sse-channels";
import { logger } from "../lib/logger";

const router = Router();

// ── Category → icon/color mapping (used by clients to render the bell UI) ────
export const CATEGORY_STYLES: Record<string, { icon: string; color: string }> = {
  fulfillment:    { icon: "package",       color: "blue"   },
  payment:        { icon: "credit-card",   color: "green"  },
  security:       { icon: "shield",        color: "red"    },
  ai:             { icon: "cpu",           color: "purple" },
  sow:            { icon: "file-text",     color: "indigo" },
  signal:         { icon: "activity",      color: "amber"  },
  message:        { icon: "message-circle",color: "teal"   },
  system:         { icon: "settings",      color: "gray"   },
  lead:           { icon: "user-plus",     color: "cyan"   },
  dunning:        { icon: "alert-triangle",color: "orange" },
  consent:        { icon: "lock",          color: "red"    },
  automation:     { icon: "zap",           color: "yellow" },
  project:        { icon: "layers",        color: "blue"   },
  onboarding:     { icon: "rocket",        color: "green"  },
};

// ── Admin: SSE stream for real-time notification updates ──────────────────────
router.get("/notifications/stream", async (req: Request, res: Response) => {
  const token = String(req.query.token ?? "");
  const secret = process.env.JWT_SECRET;
  if (!secret || !token) { res.status(401).json({ error: "Missing token" }); return; }

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
  registerNotificationSSEClient(user.id, res, () => clearInterval(keepAlive));
});

// ── Portal: SSE stream for client notification updates ────────────────────────
router.get("/portal/notifications/stream", async (req: Request, res: Response) => {
  const token = String(req.query.token ?? "");
  const secret = process.env.JWT_SECRET;
  if (!secret || !token) { res.status(401).json({ error: "Missing token" }); return; }

  let user: { id: number; role: string };
  try { user = jwt.verify(token, secret) as { id: number; role: string }; }
  catch { res.status(401).json({ error: "Invalid or expired token" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.write(": connected\n\n");

  const keepAlive = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 25_000);
  registerNotificationSSEClient(user.id, res, () => clearInterval(keepAlive));
});

// ── MSP Portal: SSE stream for MSP user notification updates ─────────────────
router.get("/msp/notifications/stream", async (req: Request, res: Response) => {
  const token = String(req.query.token ?? "");
  const secret = process.env.JWT_SECRET;
  if (!secret || !token) { res.status(401).json({ error: "Missing token" }); return; }

  let user: { id: number; mspUserId?: number; mspId?: number };
  try { user = jwt.verify(token, secret) as typeof user; }
  catch { res.status(401).json({ error: "Invalid or expired token" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.write(": connected\n\n");

  // Use negative mspUserId key convention to avoid collisions
  const sseKey = user.mspUserId ? -(user.mspUserId) : user.id;
  const keepAlive = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 25_000);
  registerNotificationSSEClient(sseKey, res, () => clearInterval(keepAlive));
});

// ── Admin: list notifications ─────────────────────────────────────────────────
router.get("/notifications", requireAdmin, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const feedType = String(req.query.feedType ?? "personal");
    const limit = Math.min(parseInt(String(req.query.limit ?? "60"), 10) || 60, 200);

    const rows = await db
      .select()
      .from(notificationsTable)
      .where(
        and(
          feedType === "all_activity"
            ? eq(notificationsTable.feedType, "all_activity")
            : and(eq(notificationsTable.userId, userId), eq(notificationsTable.feedType, "personal")),
        ),
      )
      .orderBy(desc(notificationsTable.createdAt))
      .limit(limit);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Admin: unread count ───────────────────────────────────────────────────────
router.get("/notifications/unread-count", requireAdmin, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.userId, userId),
          eq(notificationsTable.feedType, "personal"),
          eq(notificationsTable.read, false),
        ),
      );
    res.json({ unreadCount: row?.n ?? 0 });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Admin: mark all read ──────────────────────────────────────────────────────
router.patch("/notifications/read-all", requireAdmin, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    await db
      .update(notificationsTable)
      .set({ read: true })
      .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.read, false)));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Admin: mark one read ──────────────────────────────────────────────────────
router.patch("/notifications/:id/read", requireAdmin, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    await db
      .update(notificationsTable)
      .set({ read: true })
      .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, userId)));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Admin: activity feed (all_activity, admin-side) ──────────────────────────
router.get("/notifications/activity-feed", requireAdmin, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10) || 100, 500);
    const before = req.query.before ? new Date(String(req.query.before)) : undefined;

    const rows = await db
      .select()
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.feedType, "all_activity"),
          before ? lt(notificationsTable.createdAt, before) : undefined,
        ),
      )
      .orderBy(desc(notificationsTable.createdAt))
      .limit(limit);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── MSP Portal: list personal notifications for an MSP user ──────────────────
// MSP users are authenticated via requireAuth; their userId is the platform userId
// (which may be scoped as an admin with mspRole, or a regular user in MSP context).
router.get("/msp/notifications", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);

    // MSP notifications keyed by userId (platform_admin recipient type)
    const rows = await db
      .select()
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.userId, userId),
          eq(notificationsTable.feedType, "personal"),
        ),
      )
      .orderBy(desc(notificationsTable.createdAt))
      .limit(limit);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── MSP Portal: unread count ──────────────────────────────────────────────────
router.get("/msp/notifications/unread-count", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.userId, userId),
          eq(notificationsTable.feedType, "personal"),
          eq(notificationsTable.read, false),
        ),
      );
    res.json({ unreadCount: row?.n ?? 0 });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── MSP Portal: mark notification read ───────────────────────────────────────
router.patch("/msp/notifications/:id/read", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    await db
      .update(notificationsTable)
      .set({ read: true })
      .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, userId)));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── MSP Portal: mark all read ─────────────────────────────────────────────────
router.patch("/msp/notifications/read-all", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    await db
      .update(notificationsTable)
      .set({ read: true })
      .where(
        and(
          eq(notificationsTable.userId, userId),
          eq(notificationsTable.feedType, "personal"),
          eq(notificationsTable.read, false),
        ),
      );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── MSP Portal: activity feed (admin-level all_activity) ─────────────────────
// Only admins (who have mspRole) can see the cross-customer all_activity feed.
router.get("/msp/notifications/activity-feed", requireAdmin, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10) || 100, 500);
    const before = req.query.before ? new Date(String(req.query.before)) : undefined;

    const rows = await db
      .select()
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.feedType, "all_activity"),
          before ? lt(notificationsTable.createdAt, before) : undefined,
        ),
      )
      .orderBy(desc(notificationsTable.createdAt))
      .limit(limit);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Portal (customer): list personal notifications ────────────────────────────
router.get("/portal/notifications", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);

    const rows = await db
      .select()
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.userId, userId),
          eq(notificationsTable.feedType, "personal"),
        ),
      )
      .orderBy(desc(notificationsTable.createdAt))
      .limit(limit);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Portal (customer): unread count ──────────────────────────────────────────
router.get("/portal/notifications/unread-count", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.userId, userId),
          eq(notificationsTable.feedType, "personal"),
          eq(notificationsTable.read, false),
        ),
      );
    res.json({ unreadCount: row?.n ?? 0 });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Portal (customer): mark one read ─────────────────────────────────────────
router.patch("/portal/notifications/:id/read", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    await db
      .update(notificationsTable)
      .set({ read: true })
      .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, userId)));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Portal (customer): mark all read ─────────────────────────────────────────
router.post("/portal/notifications/read-all", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    await db
      .update(notificationsTable)
      .set({ read: true })
      .where(
        and(
          eq(notificationsTable.userId, userId),
          eq(notificationsTable.read, false),
        ),
      );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Portal (customer): activity feed (own tenant only) ────────────────────────
router.get("/portal/notifications/activity-feed", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10) || 100, 500);
    const before = req.query.before ? new Date(String(req.query.before)) : undefined;

    const rows = await db
      .select()
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.feedType, "all_activity"),
          eq(notificationsTable.userId, userId),
          before ? lt(notificationsTable.createdAt, before) : undefined,
        ),
      )
      .orderBy(desc(notificationsTable.createdAt))
      .limit(limit);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Category styles map endpoint (public) ─────────────────────────────────────
router.get("/notifications/category-styles", (_req: Request, res: Response) => {
  res.json(CATEGORY_STYLES);
});

export default router;
