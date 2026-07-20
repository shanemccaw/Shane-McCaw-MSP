/**
 * dashboard-export.ts
 *
 * Customer dashboard → "Export as PDF" + "Share link".
 *
 * Both features render the SAME frozen HTML snapshot (dashboard-snapshot.ts),
 * matching the precedent set by the existing document-sharing feature (its
 * public view also serves htmlContent captured at generation time, not a live
 * re-render):
 *   - PDF: rendered on-demand through the existing insight-pdf.ts Chromium
 *     pipeline (buildHtmlDoc + htmlToPdf), same as /portal/insights-documents/:id/pdf.
 *   - Share link: the snapshot HTML is persisted as an insights_generated_documents
 *     row (docType "dashboard_snapshot", status "approved") and shared via the
 *     EXISTING quick_win_result_shares token/expiration/view-tracking pattern —
 *     no new token or expiration logic. The public view/tracking routes already
 *     live in portal.ts (/public/documents/:shareToken) and need no changes.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, insightsGeneratedDocumentsTable, quickWinResultSharesTable } from "@workspace/db";
import { eq, and, gte, desc } from "drizzle-orm";
import { requireRole } from "../middlewares/requireAuth.ts";
import { buildHtmlDoc, htmlToPdf } from "../lib/insight-pdf.ts";
import { renderDashboardSnapshotHtml, DashboardSnapshotError } from "../lib/dashboard-snapshot.ts";
import { getMspPortalBaseUrl } from "../lib/portal-url.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "engine.dashboard" });

const router: IRouter = Router();

// ── CLIENT: Dashboard → branded PDF download ─────────────────────────────────

router.get("/portal/dashboard/pdf", requireRole("CustomerUser"), async (req: Request, res: Response) => {
  try {
    const { title, html } = await renderDashboardSnapshotHtml(req);
    const pdfBuffer = await htmlToPdf(buildHtmlDoc(html));

    const safeTitle = title.replace(/[^a-zA-Z0-9 _-]/g, "").replace(/\s+/g, "-").slice(0, 80);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.pdf"`);
    res.setHeader("Content-Length", String(pdfBuffer.length));
    res.end(pdfBuffer);
  } catch (err) {
    if (err instanceof DashboardSnapshotError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    log.error({ err }, "portal/dashboard/pdf failed");
    res.status(500).json({ error: "Failed to generate PDF" });
  }
});

// ── CLIENT: Dashboard share link — GET current, POST create ────────────────

router.get("/portal/dashboard/share", requireRole("CustomerUser"), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const now = new Date();

    const [existing] = await db
      .select({
        shareToken: quickWinResultSharesTable.shareToken,
        expiresAt: quickWinResultSharesTable.expiresAt,
        createdAt: quickWinResultSharesTable.createdAt,
      })
      .from(quickWinResultSharesTable)
      .innerJoin(insightsGeneratedDocumentsTable, eq(quickWinResultSharesTable.documentId, insightsGeneratedDocumentsTable.id))
      .where(
        and(
          eq(quickWinResultSharesTable.shareKind, "document"),
          eq(quickWinResultSharesTable.clientUserId, userId),
          eq(insightsGeneratedDocumentsTable.docType, "dashboard_snapshot"),
          eq(insightsGeneratedDocumentsTable.customerId, userId),
          gte(quickWinResultSharesTable.expiresAt, now),
        ),
      )
      .orderBy(desc(quickWinResultSharesTable.createdAt))
      .limit(1);

    if (!existing) { res.json({ share: null }); return; }

    const baseUrl = getMspPortalBaseUrl();
    res.json({
      share: {
        shareUrl: `${baseUrl}/shared-documents/${existing.shareToken}`,
        expiresAt: existing.expiresAt.toISOString(),
        createdAt: existing.createdAt.toISOString(),
      },
    });
  } catch (err) {
    log.error({ err }, "portal/dashboard/share (get) failed");
    res.status(500).json({ error: "Failed to load share link" });
  }
});

router.post("/portal/dashboard/share", requireRole("CustomerUser"), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { title, html } = await renderDashboardSnapshotHtml(req);

    // Persist this render as a real generated document — the same row shape
    // /portal/documents/:id/share already knows how to share (title/htmlContent/
    // status), so the public view/tracking path needs zero new code.
    const [doc] = await db
      .insert(insightsGeneratedDocumentsTable)
      .values({
        customerId: userId,
        category: "report",
        docType: "dashboard_snapshot",
        title,
        htmlContent: html,
        status: "approved",
        approvedAt: new Date(),
      })
      .returning({ id: insightsGeneratedDocumentsTable.id });

    // Mirrors portal.ts's /portal/documents/:id/share token/expiry pattern exactly.
    const { randomBytes } = await import("crypto");
    const shareToken = randomBytes(32).toString("hex");
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const [share] = await db
      .insert(quickWinResultSharesTable)
      .values({
        clientUserId: userId,
        shareToken,
        shareKind: "document",
        documentId: doc.id,
        expiresAt,
      })
      .returning({ shareToken: quickWinResultSharesTable.shareToken });

    const baseUrl = getMspPortalBaseUrl();
    res.json({ shareUrl: `${baseUrl}/shared-documents/${share.shareToken}`, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    if (err instanceof DashboardSnapshotError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    log.error({ err }, "portal/dashboard/share (post) failed");
    res.status(500).json({ error: "Failed to generate share link" });
  }
});

export default router;
