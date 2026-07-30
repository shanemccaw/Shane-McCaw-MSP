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

export default router;
