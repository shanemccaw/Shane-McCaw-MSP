import { Router, type IRouter, type Request, type Response } from "express";
import { db, quickWinResultSharesTable, insightsGeneratedDocumentsTable, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
const log = logger.child({ channel: "admin.quick-win" });

const router: IRouter = Router();

router.get("/admin/quick-win/result-shares", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        id: quickWinResultSharesTable.id,
        shareToken: quickWinResultSharesTable.shareToken,
        shareKind: quickWinResultSharesTable.shareKind,
        scoresSnapshot: quickWinResultSharesTable.scoresSnapshot,
        documentId: quickWinResultSharesTable.documentId,
        documentTitle: insightsGeneratedDocumentsTable.title,
        latestDate: quickWinResultSharesTable.latestDate,
        expiresAt: quickWinResultSharesTable.expiresAt,
        viewCount: quickWinResultSharesTable.viewCount,
        createdAt: quickWinResultSharesTable.createdAt,
        clientId: usersTable.id,
        clientName: usersTable.name,
        clientEmail: usersTable.email,
        clientCompany: usersTable.company,
      })
      .from(quickWinResultSharesTable)
      .innerJoin(usersTable, eq(quickWinResultSharesTable.clientUserId, usersTable.id))
      .leftJoin(insightsGeneratedDocumentsTable, eq(quickWinResultSharesTable.documentId, insightsGeneratedDocumentsTable.id))
      .orderBy(desc(quickWinResultSharesTable.viewCount), desc(quickWinResultSharesTable.createdAt));

    res.json({
      shares: rows.map(r => ({
        id: r.id,
        shareToken: r.shareToken,
        shareKind: r.shareKind,
        scoresSnapshot: r.scoresSnapshot,
        documentId: r.documentId,
        documentTitle: r.documentTitle,
        latestDate: r.latestDate?.toISOString() ?? null,
        expiresAt: r.expiresAt.toISOString(),
        viewCount: r.viewCount,
        createdAt: r.createdAt.toISOString(),
        client: {
          id: r.clientId,
          name: r.clientName,
          email: r.clientEmail,
          company: r.clientCompany,
        },
      })),
    });
  } catch (err) {
    log.error({ err }, "admin: failed to list quick win result shares");
    res.status(500).json({ error: "Failed to load result shares" });
  }
});

/**
 * Revokes a share by expiring it immediately. There is no separate
 * `revoked` column — every consumer of this table (`portal-documents.ts`'s
 * `/public/documents/:shareToken`, its `/doc-views` sibling) already gates
 * purely on `expiresAt < now()`, so setting it to now is the real revoke
 * rather than a client-side-only state. Reversible via the extend route
 * below, which is what the adminv2 Shared Links screen offers instead of a
 * separate "restore" action that would have to invent a flag this table
 * doesn't have.
 */
router.post("/admin/quick-win/result-shares/:id/revoke", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [row] = await db
      .update(quickWinResultSharesTable)
      .set({ expiresAt: new Date() })
      .where(eq(quickWinResultSharesTable.id, id))
      .returning({ id: quickWinResultSharesTable.id, expiresAt: quickWinResultSharesTable.expiresAt });
    if (!row) {
      res.status(404).json({ error: "Share not found" });
      return;
    }
    res.json({ id: row.id, expiresAt: row.expiresAt.toISOString() });
  } catch (err) {
    log.error({ err }, "admin: failed to revoke result share");
    res.status(500).json({ error: "Failed to revoke share" });
  }
});

/**
 * Pushes `expiresAt` out by `days` (default 14, matching the design's
 * "Extend by 14 days" action) from whichever is later: now, or the current
 * expiry. That base — not always "now" — means extending a link that still
 * has time left adds to what's left rather than shortening it, while
 * extending an expired or just-revoked one gives it a fresh window starting
 * today. This doubles as the only "un-revoke" this table can honestly offer.
 */
router.post("/admin/quick-win/result-shares/:id/extend", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const rawDays = Number((req.body as { days?: unknown } | undefined)?.days);
    const days = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 14;

    const [existing] = await db
      .select({ expiresAt: quickWinResultSharesTable.expiresAt })
      .from(quickWinResultSharesTable)
      .where(eq(quickWinResultSharesTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Share not found" });
      return;
    }

    const now = new Date();
    const base = existing.expiresAt > now ? existing.expiresAt : now;
    const next = new Date(base);
    next.setDate(next.getDate() + days);

    const [row] = await db
      .update(quickWinResultSharesTable)
      .set({ expiresAt: next })
      .where(eq(quickWinResultSharesTable.id, id))
      .returning({ id: quickWinResultSharesTable.id, expiresAt: quickWinResultSharesTable.expiresAt });
    res.json({ id: row.id, expiresAt: row.expiresAt.toISOString() });
  } catch (err) {
    log.error({ err }, "admin: failed to extend result share");
    res.status(500).json({ error: "Failed to extend share" });
  }
});

export default router;
