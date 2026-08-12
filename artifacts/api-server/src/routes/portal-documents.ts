import { Router, type IRouter, type Request, type Response } from "express";
import { db, reportsTable, insightsGeneratedDocumentsTable, projectsTable, quickWinResultSharesTable, presentationDocViewsTable, usersTable, mspsTable, printTokensTable } from "@workspace/db";
import { eq, and, or, desc } from "drizzle-orm";
import { randomBytes } from "crypto";
import { requireAuth } from "../middlewares/requireAuth.ts";
import { stripStagedForReviewBanner } from "../lib/sow-pricing.ts";
import { getMspPortalBaseUrl, buildPrintDocumentUrl } from "../lib/portal-url.ts";
import { buildHtmlDoc, htmlToPdf, renderLiveDocumentToPdf } from "../lib/insight-pdf.ts";
import { logger } from "../lib/logger.ts";
import path from "path";
import fs from "fs";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

// Git #415. The Copilot Readiness journey's seven "live spine" reports
// (`JOURNEY_LIVE_DOCUMENTS` in artifacts/msp-portal/src/components/copilot-journey/journeyTokens.ts
// — kept in sync with that list by hand, the same cross-app-duplication pattern
// this route already uses for `SOW_DOC_TYPE` in portal-assessment.ts) render
// live in the browser from the tenant's own scan data; they have no HTML string
// representation on the server. A tenant can still have a STALE row for one of
// these docTypes from before that migration, or from an admin re-running the old
// generator (`document-engine.ts` has no guard against these keys) — such a row's
// `htmlContent` is old content that can silently diverge from what's on screen
// (e.g. sections since removed). Rather than ever serve that mismatch, these
// docTypes are refused here.
const LIVE_RENDERED_DOC_TYPES = new Set([
  "copilot_readiness",
  "security_posture_report",
  "governance_maturity_report",
  "compliance_alignment_report",
  "license_optimization_report",
  "adoption_report",
  "operational_health_report",
]);

const UPLOADS_BASE = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve("../../data/uploads");

router.get("/portal/reports", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const reports = await db.select().from(reportsTable)
    .where(eq(reportsTable.clientUserId, userId))
    .orderBy(desc(reportsTable.createdAt));
  res.json(reports);
});

// ─── CLIENT: AI-Generated Insights Documents ──────────────────────────────────
router.get("/portal/insights-documents", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const docs = await db
      .select({
        id:            insightsGeneratedDocumentsTable.id,
        title:         insightsGeneratedDocumentsTable.title,
        category:      insightsGeneratedDocumentsTable.category,
        docType:       insightsGeneratedDocumentsTable.docType,
        status:        insightsGeneratedDocumentsTable.status,
        deliveredAt:   insightsGeneratedDocumentsTable.deliveredAt,
        createdAt:     insightsGeneratedDocumentsTable.createdAt,
        sowTotalPrice: insightsGeneratedDocumentsTable.sowTotalPrice,
        projectId:     insightsGeneratedDocumentsTable.projectId,
        projectTitle:  projectsTable.title,
      })
      .from(insightsGeneratedDocumentsTable)
      .leftJoin(projectsTable, eq(insightsGeneratedDocumentsTable.projectId, projectsTable.id))
      .where(
        and(
          eq(insightsGeneratedDocumentsTable.customerId, userId),
          or(
            eq(insightsGeneratedDocumentsTable.status, "delivered"),
            eq(insightsGeneratedDocumentsTable.docType, "scoped_sow"),
          ),
        ),
      )
      .orderBy(desc(insightsGeneratedDocumentsTable.createdAt));
    res.json(docs);
  } catch (err) {
    req.log.error({ err }, "portal/insights-documents list failed");
    res.status(500).json({ error: "Failed to fetch documents" });
  }
});

router.get("/portal/insights-documents/:id/view", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const [doc] = await db
      .select({
        id:          insightsGeneratedDocumentsTable.id,
        title:       insightsGeneratedDocumentsTable.title,
        htmlContent: insightsGeneratedDocumentsTable.htmlContent,
        status:      insightsGeneratedDocumentsTable.status,
        docType:     insightsGeneratedDocumentsTable.docType,
        customerId:  insightsGeneratedDocumentsTable.customerId,
      })
      .from(insightsGeneratedDocumentsTable)
      .where(eq(insightsGeneratedDocumentsTable.id, id));
    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
    if (doc.customerId !== userId) { res.status(403).json({ error: "Forbidden" }); return; }
    if (doc.status !== "delivered" && doc.docType !== "scoped_sow") { res.status(403).json({ error: "Document not yet delivered" }); return; }
    if (LIVE_RENDERED_DOC_TYPES.has(doc.docType)) {
      res.status(409).json({ error: "This report renders live and has no stored HTML to view here" });
      return;
    }
    res.json({ id: doc.id, title: doc.title, htmlContent: stripStagedForReviewBanner(doc.htmlContent) });
  } catch (err) {
    req.log.error({ err }, "portal/insights-documents/:id/view failed");
    res.status(500).json({ error: "Failed to fetch document" });
  }
});

// ── CLIENT: AI Insights Document → branded PDF download ──────────────────────

router.get("/portal/insights-documents/:id/pdf", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const [doc] = await db
      .select({
        id:          insightsGeneratedDocumentsTable.id,
        title:       insightsGeneratedDocumentsTable.title,
        htmlContent: insightsGeneratedDocumentsTable.htmlContent,
        status:      insightsGeneratedDocumentsTable.status,
        docType:     insightsGeneratedDocumentsTable.docType,
        customerId:  insightsGeneratedDocumentsTable.customerId,
      })
      .from(insightsGeneratedDocumentsTable)
      .where(eq(insightsGeneratedDocumentsTable.id, id));

    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
    if (doc.customerId !== userId) { res.status(403).json({ error: "Forbidden" }); return; }
    // Allow download for approved docs shown in the presentation portal, not just formally "delivered" ones
    if (!["approved", "delivered"].includes(doc.status ?? "")) { res.status(403).json({ error: "Document not available for download" }); return; }
    if (LIVE_RENDERED_DOC_TYPES.has(doc.docType)) {
      // Git #415: this docType renders live from the tenant's own scan data —
      // the row's stored htmlContent is stale (or absent) and would silently
      // mismatch what's on screen, so buildHtmlDoc/htmlToPdf below is never
      // used for it. Instead: mint a single-use print token scoped to this
      // one document, navigate the real live Document Viewer route with it,
      // and print the actual rendered page (renderLiveDocumentToPdf).
      const [userRow] = await db.select({ mspId: usersTable.mspId }).from(usersTable)
        .where(eq(usersTable.id, userId)).limit(1);
      const [mspRow] = userRow?.mspId
        ? await db.select({ slug: mspsTable.slug }).from(mspsTable).where(eq(mspsTable.id, userRow.mspId)).limit(1)
        : [];
      if (!mspRow?.slug) {
        log.error({ userId, documentId: doc.id }, "live document pdf: could not resolve MSP slug for user");
        res.status(500).json({ error: "Could not resolve your account for PDF export" });
        return;
      }

      const printToken = randomBytes(32).toString("hex");
      await db.insert(printTokensTable).values({
        token: printToken,
        userId,
        documentId: doc.id,
        // Comfortably longer than a headless print run, far shorter than any
        // real session — this token exists only to get one Chromium tab from
        // "just navigated" to "already printed".
        expiresAt: new Date(Date.now() + 2 * 60 * 1000),
      });

      const printUrl = buildPrintDocumentUrl(mspRow.slug, doc.id, printToken);
      let livePdfBuffer: Buffer;
      try {
        livePdfBuffer = await renderLiveDocumentToPdf(printUrl);
      } catch (err) {
        log.error({ err, userId, documentId: doc.id }, "live document pdf: renderLiveDocumentToPdf failed");
        res.status(502).json({ error: "Could not render this report to PDF right now — please try again" });
        return;
      }

      const safeLiveTitle = (doc.title ?? "document")
        .replace(/[^a-zA-Z0-9 _-]/g, "")
        .replace(/\s+/g, "-")
        .slice(0, 80);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${safeLiveTitle}.pdf"`);
      res.setHeader("Content-Length", String(livePdfBuffer.length));
      res.end(livePdfBuffer);
      return;
    }

    // Strip staged-for-review banner (same as /view), then build full HTML doc
    const cleanHtml = stripStagedForReviewBanner(doc.htmlContent ?? "");
    const htmlDoc   = buildHtmlDoc(cleanHtml);
    const pdfBuffer = await htmlToPdf(htmlDoc);

    const safeTitle = (doc.title ?? "document")
      .replace(/[^a-zA-Z0-9 _-]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 80);
    const filename = `${safeTitle}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", String(pdfBuffer.length));
    res.end(pdfBuffer);
  } catch (err) {
    req.log.error({ err }, "portal/insights-documents/:id/pdf failed");
    res.status(500).json({ error: "Failed to generate PDF" });
  }
});

router.post("/portal/documents/:id/share", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const [doc] = await db
      .select({
        id: insightsGeneratedDocumentsTable.id,
        status: insightsGeneratedDocumentsTable.status,
        docType: insightsGeneratedDocumentsTable.docType,
        customerId: insightsGeneratedDocumentsTable.customerId,
      })
      .from(insightsGeneratedDocumentsTable)
      .where(eq(insightsGeneratedDocumentsTable.id, id));

    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
    if (doc.customerId !== userId) { res.status(403).json({ error: "Forbidden" }); return; }
    if (!["approved", "delivered"].includes(doc.status ?? "") && doc.docType !== "scoped_sow") {
      res.status(403).json({ error: "Document not available to share" });
      return;
    }

    // Revoke any existing share for THIS document (per-document, not per-client —
    // sharing one document must not invalidate a colleague's link to another).
    await db.delete(quickWinResultSharesTable)
      .where(
        and(
          eq(quickWinResultSharesTable.shareKind, "document"),
          eq(quickWinResultSharesTable.documentId, id),
        ),
      );

    const { randomBytes } = await import("crypto");
    const shareToken = randomBytes(32).toString("hex");
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const [share] = await db.insert(quickWinResultSharesTable).values({
      clientUserId: userId,
      shareToken,
      shareKind: "document",
      documentId: id,
      expiresAt,
    }).returning({ id: quickWinResultSharesTable.id, shareToken: quickWinResultSharesTable.shareToken });

    const baseUrl = getMspPortalBaseUrl();
    const shareUrl = `${baseUrl}/shared-documents/${share.shareToken}`;

    res.json({ shareUrl, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "portal/documents/:id/share (post) failed");
    res.status(500).json({ error: "Failed to generate share link" });
  }
});

// ── PUBLIC: Shared document viewer — share token, no auth required ───────────
// Mirrors /public/sows/:shareToken (msp-sow.ts). Records a view event into
// presentation_doc_views (presentationId null — this view happened outside any
// Quick Win presentation) so document shares get the same real dwell/view
// tracking data as presentation docs do.

router.get("/public/documents/:shareToken", async (req: Request, res: Response) => {
  try {
    const shareToken = String(req.params.shareToken ?? "");
    if (!shareToken) { res.status(400).json({ error: "Missing token" }); return; }

    const [share] = await db
      .select({
        id: quickWinResultSharesTable.id,
        documentId: quickWinResultSharesTable.documentId,
        expiresAt: quickWinResultSharesTable.expiresAt,
        viewCount: quickWinResultSharesTable.viewCount,
      })
      .from(quickWinResultSharesTable)
      .where(
        and(
          eq(quickWinResultSharesTable.shareToken, shareToken),
          eq(quickWinResultSharesTable.shareKind, "document"),
        ),
      )
      .limit(1);

    if (!share || !share.documentId) { res.status(404).json({ error: "Share link not found" }); return; }
    if (new Date() > share.expiresAt) { res.status(410).json({ error: "This share link has expired" }); return; }

    const [doc] = await db
      .select({
        id: insightsGeneratedDocumentsTable.id,
        title: insightsGeneratedDocumentsTable.title,
        htmlContent: insightsGeneratedDocumentsTable.htmlContent,
        docType: insightsGeneratedDocumentsTable.docType,
      })
      .from(insightsGeneratedDocumentsTable)
      .where(eq(insightsGeneratedDocumentsTable.id, share.documentId));

    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }

    // Fire-and-forget: bump view count + record a real view event.
    db.update(quickWinResultSharesTable)
      .set({ viewCount: share.viewCount + 1 })
      .where(eq(quickWinResultSharesTable.id, share.id))
      .catch(() => { /* ignore */ });
    db.insert(presentationDocViewsTable).values({
      presentationId: null,
      documentId: doc.id,
      documentTitle: doc.title,
      eventType: "view",
    }).catch(() => { /* ignore */ });

    res.json({
      title: doc.title,
      htmlContent: stripStagedForReviewBanner(doc.htmlContent ?? ""),
      docType: doc.docType,
      expiresAt: share.expiresAt.toISOString(),
    });
  } catch (err) {
    log.error({ err }, "public/documents/:shareToken failed");
    res.status(500).json({ error: "Failed to load document" });
  }
});

// ── PUBLIC: Dwell-time tracking for a shared document ────────────────────────
// Mirrors /portal/presentations/:id/doc-views (below) for the non-presentation
// share path — same event shape, so admin analytics that read
// presentation_doc_views by documentId see consistent data either way.

router.post("/public/documents/:shareToken/doc-views", async (req: Request, res: Response) => {
  try {
    const shareToken = String(req.params.shareToken ?? "");
    const { dwellSeconds } = req.body as { dwellSeconds?: number };
    if (typeof dwellSeconds !== "number" || dwellSeconds < 0) {
      res.status(400).json({ error: "dwellSeconds must be a non-negative number" });
      return;
    }

    const [share] = await db
      .select({ documentId: quickWinResultSharesTable.documentId, expiresAt: quickWinResultSharesTable.expiresAt })
      .from(quickWinResultSharesTable)
      .where(
        and(
          eq(quickWinResultSharesTable.shareToken, shareToken),
          eq(quickWinResultSharesTable.shareKind, "document"),
        ),
      )
      .limit(1);

    if (!share || !share.documentId) { res.status(404).json({ error: "Share link not found" }); return; }
    if (new Date() > share.expiresAt) { res.status(410).json({ error: "This share link has expired" }); return; }

    const [doc] = await db
      .select({ title: insightsGeneratedDocumentsTable.title })
      .from(insightsGeneratedDocumentsTable)
      .where(eq(insightsGeneratedDocumentsTable.id, share.documentId));

    await db.insert(presentationDocViewsTable).values({
      presentationId: null,
      documentId: share.documentId,
      documentTitle: doc?.title ?? null,
      dwellSeconds: Math.round(dwellSeconds),
      eventType: "dwell",
    });

    res.status(204).end();
  } catch (err) {
    log.error({ err }, "public/documents/:shareToken/doc-views failed");
    res.status(500).json({ error: "Failed to record view" });
  }
});

router.get("/portal/reports/:id/download", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const isAdmin = req.user!.role === "admin";
  const [report] = await db.select().from(reportsTable)
    .where(isAdmin ? eq(reportsTable.id, id) : and(eq(reportsTable.id, id), eq(reportsTable.clientUserId, userId)));
  if (!report) { res.status(404).json({ error: "Report not found" }); return; }

  const filePath = path.join(UPLOADS_BASE, "reports", report.filename);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: "File not found" }); return; }
  res.download(filePath, report.filename);
});

export default router;
