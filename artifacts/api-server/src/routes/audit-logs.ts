import { Router, type IRouter, type Request, type Response } from "express";
import { db, auditLogsTable, usersTable } from "@workspace/db";
import { eq, and, desc, count, gte, lte, type SQL } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/requireAuth";

const router: IRouter = Router();

const PAGE_SIZE = 25;

router.get("/audit-logs", requireAdmin, async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const offset = (page - 1) * PAGE_SIZE;

  const limit = req.query.limit
    ? Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10)))
    : PAGE_SIZE;

  const conditions: SQL[] = [];

  if (req.query.clientId) {
    const cid = parseInt(String(req.query.clientId), 10);
    if (!isNaN(cid)) conditions.push(eq(auditLogsTable.clientId, cid));
  }

  if (req.query.projectId) {
    const pid = parseInt(String(req.query.projectId), 10);
    if (!isNaN(pid)) conditions.push(eq(auditLogsTable.projectId, pid));
  }

  if (req.query.entityType && req.query.entityType !== "all") {
    conditions.push(eq(auditLogsTable.entityType, String(req.query.entityType)));
  }

  if (req.query.from) {
    const d = new Date(String(req.query.from));
    if (!isNaN(d.getTime())) conditions.push(gte(auditLogsTable.createdAt, d));
  }

  if (req.query.to) {
    const d = new Date(String(req.query.to));
    if (!isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      conditions.push(lte(auditLogsTable.createdAt, d));
    }
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalRow] = await db.select({ count: count() }).from(auditLogsTable).where(where);
  const entries = await db.select().from(auditLogsTable)
    .where(where)
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json({ entries, total: totalRow?.count ?? 0, page, pageSize: limit });
});

router.get("/audit-logs/me", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const offset = (page - 1) * PAGE_SIZE;

  const where = eq(auditLogsTable.clientId, userId);

  const [totalRow] = await db.select({ count: count() }).from(auditLogsTable).where(where);
  const entries = await db.select().from(auditLogsTable)
    .where(where)
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(PAGE_SIZE)
    .offset(offset);

  res.json({ entries, total: totalRow?.count ?? 0, page, pageSize: PAGE_SIZE });
});

router.get("/audit-logs/clients", requireAdmin, async (_req: Request, res: Response) => {
  const clients = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.role, "client"))
    .orderBy(usersTable.name);
  res.json(clients);
});

export default router;
