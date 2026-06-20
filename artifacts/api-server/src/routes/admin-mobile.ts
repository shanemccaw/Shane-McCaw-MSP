import { Router, type IRouter, type Request, type Response } from "express";
import { db, messagesTable, usersTable, deviceTokensTable } from "@workspace/db";
import { eq, desc, count, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";

const router: IRouter = Router();

// ─── ADMIN: Conversations list (for mobile app) ───────────────────────────
router.get("/admin/conversations", requireAdmin, async (_req: Request, res: Response) => {
  const rows = await db.execute(sql`
    SELECT
      m.client_user_id AS "clientId",
      u.name            AS "clientName",
      u.email           AS "clientEmail",
      MAX(m.created_at) AS "latestAt",
      (
        SELECT body FROM messages
        WHERE client_user_id = m.client_user_id
        ORDER BY created_at DESC
        LIMIT 1
      )                 AS "latestMessage",
      COUNT(*) FILTER (WHERE m.read_by_admin = false)::int AS "unreadCount"
    FROM messages m
    JOIN users u ON u.id = m.client_user_id
    GROUP BY m.client_user_id, u.name, u.email
    ORDER BY "latestAt" DESC
  `);

  res.json(rows.rows);
});

// ─── ADMIN: Register device token for push notifications ─────────────────
router.post("/admin/device-tokens", requireAdmin, async (req: Request, res: Response) => {
  const { token, platform } = req.body as { token?: string; platform?: string };

  if (!token?.trim()) {
    res.status(400).json({ error: "token is required" });
    return;
  }

  await db
    .insert(deviceTokensTable)
    .values({
      token: token.trim(),
      platform: platform ?? "ios",
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: deviceTokensTable.token,
      set: { updatedAt: new Date(), platform: platform ?? "ios" },
    });

  res.status(200).json({ success: true });
});

// ─── ADMIN: Remove device token on logout ────────────────────────────────
router.delete("/admin/device-tokens/:token", requireAdmin, async (req: Request, res: Response) => {
  const token = decodeURIComponent(String(req.params.token));
  await db.delete(deviceTokensTable).where(eq(deviceTokensTable.token, token));
  res.json({ success: true });
});

export default router;
