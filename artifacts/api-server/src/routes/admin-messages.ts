import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "admin.messages" });

const router: IRouter = Router();

// ─── ADMIN: Admin messages (all clients) ────────────────────────────────────
router.get("/admin/messages/clients", requireAdmin, async (_req: Request, res: Response) => {
  const clients = await db.select({
    id: usersTable.id,
    email: usersTable.email,
    name: usersTable.name,
    company: usersTable.company,
    unread: sql<number>`(SELECT count(*) FROM messages WHERE client_user_id = ${usersTable.id} AND read_by_admin = false)`.mapWith(Number),
    lastMessage: sql<string>`(SELECT created_at FROM messages WHERE client_user_id = ${usersTable.id} ORDER BY created_at DESC LIMIT 1)`,
  }).from(usersTable).where(eq(usersTable.role, "client")).orderBy(desc(usersTable.createdAt));
  res.json(clients);
});

export default router;
