import { Router, type IRouter, type Request, type Response } from "express";
import { db, quickWinPresentationsTable, presentationDocViewsTable } from "@workspace/db";
import { eq, desc, asc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "admin.presentations" });

const router: IRouter = Router();

router.get("/admin/engagements/:id/presentation-analytics", requireAdmin, async (req: Request, res: Response) => {
  try {
    const projectId = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }

    const [pres] = await db.select({
      id: quickWinPresentationsTable.id,
      status: quickWinPresentationsTable.status,
      createdAt: quickWinPresentationsTable.createdAt,
    })
      .from(quickWinPresentationsTable)
      .where(eq(quickWinPresentationsTable.projectId, projectId))
      .orderBy(desc(quickWinPresentationsTable.createdAt))
      .limit(1);

    if (!pres) {
      res.json({ presentationId: null, views: [], rawViews: [], firstCardClick: null });
      return;
    }

    const rawViews = await db.select({
      id: presentationDocViewsTable.id,
      documentId: presentationDocViewsTable.documentId,
      documentTitle: presentationDocViewsTable.documentTitle,
      viewedAt: presentationDocViewsTable.viewedAt,
      dwellSeconds: presentationDocViewsTable.dwellSeconds,
      eventType: presentationDocViewsTable.eventType,
      cardName: presentationDocViewsTable.cardName,
    })
      .from(presentationDocViewsTable)
      .where(eq(presentationDocViewsTable.presentationId, pres.id))
      .orderBy(asc(presentationDocViewsTable.viewedAt));

    // Aggregate dwell time per document (dwell events only)
    const byDoc = new Map<string, { documentId: number | null; documentTitle: string; totalSeconds: number; visits: number }>();
    for (const v of rawViews) {
      if ((v.eventType ?? "dwell") !== "dwell") continue;
      const key = v.documentTitle ?? `doc-${v.documentId ?? "unknown"}`;
      const existing = byDoc.get(key);
      if (existing) {
        existing.totalSeconds += v.dwellSeconds ?? 0;
        existing.visits += 1;
      } else {
        byDoc.set(key, {
          documentId: v.documentId,
          documentTitle: v.documentTitle ?? key,
          totalSeconds: v.dwellSeconds ?? 0,
          visits: 1,
        });
      }
    }

    // First card click: earliest card_click event
    // totalClicks = distinct card names (deduplicates legacy re-click events already in the DB)
    const cardClicks = rawViews.filter(v => v.eventType === "card_click" && v.cardName);
    const distinctCardNames = new Set(cardClicks.map(v => v.cardName!));
    const firstCardClick = cardClicks.length > 0
      ? { cardName: cardClicks[0].cardName!, clickedAt: cardClicks[0].viewedAt, totalClicks: distinctCardNames.size }
      : null;

    res.json({
      presentationId: pres.id,
      presentationStatus: pres.status,
      presentationCreatedAt: pres.createdAt,
      views: Array.from(byDoc.values()).sort((a, b) => b.totalSeconds - a.totalSeconds),
      rawViews,
      firstCardClick,
    });
  } catch (err) {
    log.error({ err }, "portal: failed to fetch presentation analytics");
    res.status(500).json({ error: "Failed to fetch presentation analytics" });
  }
});

export default router;
