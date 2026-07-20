/**
 * msp-documents-hub.ts
 *
 * MSP-Wide Customer Documents Hub — an aggregated, filterable view of every
 * customer-generated document (assessment reports, SOWs, generated
 * deliverables) across the caller's entire book, so MSP staff don't have to
 * open each customer individually to find one. Read-only aggregation over
 * the existing insights_generated_documents table — does not modify that
 * table or its generation logic, and does not duplicate the existing
 * document sharing/view-tracking system (quick_win_result_shares +
 * /public/documents/:shareToken, portal.ts) — this file only adds an
 * MSP-staff-scoped entry point that creates a share record via the exact
 * same mechanism, since the existing POST /portal/documents/:id/share is
 * gated to the document's own customer (doc.customerId === caller's own
 * users.id) and has no path for MSP staff acting on a customer's behalf.
 *
 * Data-model note: insights_generated_documents.customerId is a users.id
 * (NOT msp_customers.id) — bridged to the caller's mspId via msp_users
 * (userId -> mspId/customerId), the same join omg-card-extractor.ts already
 * uses for billing telemetry attribution.
 *
 * Distinct from msp-documents.ts, which backs a different table
 * (mspDocumentsTable/mspDocumentVersionsTable — the MSP's own SharePoint
 * document pipeline, not customer-generated deliverables).
 *
 * Routes (MSPOperator+, mspId from JWT claim via resolveMspIdStrict):
 *   GET  /api/msp/documents-hub                — aggregated list, filterable, paginated
 *   GET  /api/msp/documents-hub/:id/view        — html content for the sandboxed viewer
 *   GET  /api/msp/documents-hub/:id/pdf         — branded PDF download
 *   POST /api/msp/documents-hub/:id/share       — create a customer share link (reuses
 *                                                  the existing quick_win_result_shares
 *                                                  token/expiry mechanism)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  insightsGeneratedDocumentsTable,
  mspUsersTable,
  mspCustomersTable,
  projectsTable,
  quickWinResultSharesTable,
} from "@workspace/db";
import { eq, and, inArray, gte, lte, desc } from "drizzle-orm";
import { requireRole, resolveStaffScopedCustomerIds } from "../middlewares/requireAuth";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { stripStagedForReviewBanner } from "../lib/sow-pricing.ts";
import { getMspPortalBaseUrl } from "../lib/portal-url.ts";
import { buildHtmlDoc, htmlToPdf } from "../lib/insight-pdf.ts";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

/** userId(users.id) -> { mspCustomerId, mspCustomerName } for every customer in mspId's book. */
async function loadCustomerBridge(mspId: number) {
  const rows = await db
    .select({
      userId: mspUsersTable.userId,
      customerId: mspUsersTable.customerId,
      customerName: mspCustomersTable.name,
    })
    .from(mspUsersTable)
    .leftJoin(mspCustomersTable, eq(mspUsersTable.customerId, mspCustomersTable.id))
    .where(eq(mspUsersTable.mspId, mspId));

  const byUserId = new Map<number, { customerId: number | null; customerName: string | null }>();
  for (const row of rows) {
    byUserId.set(row.userId, { customerId: row.customerId, customerName: row.customerName ?? null });
  }
  return byUserId;
}

// ── GET /api/msp/documents-hub ──────────────────────────────────────────────

router.get("/msp/documents-hub", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  try {
    const mspId = resolveMspIdStrict(req);
    if (mspId === null) {
      res.status(403).json({ error: "MSP context required" });
      return;
    }

    const bridge = await loadCustomerBridge(mspId);
    if (bridge.size === 0) {
      res.json({ documents: [], total: 0, limit: 50, offset: 0 });
      return;
    }

    // Per-staff customer scoping: restrict the eligible customers to the caller's
    // assigned set. null = unrestricted (historical default).
    const scopedCustomerIds = await resolveStaffScopedCustomerIds(req.user!);

    const customerIdParam = req.query["customerId"] ? Number(req.query["customerId"]) : undefined;
    const docTypeFilter = req.query["docType"] ? String(req.query["docType"]) : undefined;
    const categoryFilter = req.query["category"] ? String(req.query["category"]) : undefined;
    const dateFrom = req.query["dateFrom"] ? new Date(String(req.query["dateFrom"])) : undefined;
    const dateTo = req.query["dateTo"] ? new Date(String(req.query["dateTo"])) : undefined;
    const limit = Math.min(Number(req.query["limit"] ?? 50), 200);
    const offset = Math.max(Number(req.query["offset"] ?? 0), 0);

    // Filtering by customerId (msp_customers.id) means restricting the
    // eligible users.id set to whichever bridge row maps to that customer.
    let eligibleUserIds = [...bridge.keys()];
    if (scopedCustomerIds !== null) {
      eligibleUserIds = eligibleUserIds.filter((uid) => {
        const cid = bridge.get(uid)?.customerId;
        return cid != null && scopedCustomerIds.includes(cid);
      });
    }
    if (customerIdParam !== undefined && !isNaN(customerIdParam)) {
      eligibleUserIds = eligibleUserIds.filter((uid) => bridge.get(uid)?.customerId === customerIdParam);
    }
    if (eligibleUserIds.length === 0) {
      res.json({ documents: [], total: 0, limit, offset });
      return;
    }

    const conditions = [inArray(insightsGeneratedDocumentsTable.customerId, eligibleUserIds)];
    if (docTypeFilter) conditions.push(eq(insightsGeneratedDocumentsTable.docType, docTypeFilter));
    if (categoryFilter) {
      conditions.push(eq(insightsGeneratedDocumentsTable.category, categoryFilter as "report" | "consulting"));
    }
    if (dateFrom && !isNaN(dateFrom.getTime())) conditions.push(gte(insightsGeneratedDocumentsTable.createdAt, dateFrom));
    if (dateTo && !isNaN(dateTo.getTime())) conditions.push(lte(insightsGeneratedDocumentsTable.createdAt, dateTo));

    const rows = await db
      .select({
        id: insightsGeneratedDocumentsTable.id,
        title: insightsGeneratedDocumentsTable.title,
        category: insightsGeneratedDocumentsTable.category,
        docType: insightsGeneratedDocumentsTable.docType,
        status: insightsGeneratedDocumentsTable.status,
        customerId: insightsGeneratedDocumentsTable.customerId,
        deliveredAt: insightsGeneratedDocumentsTable.deliveredAt,
        createdAt: insightsGeneratedDocumentsTable.createdAt,
        sowTotalPrice: insightsGeneratedDocumentsTable.sowTotalPrice,
        projectId: insightsGeneratedDocumentsTable.projectId,
        projectTitle: projectsTable.title,
      })
      .from(insightsGeneratedDocumentsTable)
      .leftJoin(projectsTable, eq(insightsGeneratedDocumentsTable.projectId, projectsTable.id))
      .where(and(...conditions))
      .orderBy(desc(insightsGeneratedDocumentsTable.createdAt));

    const total = rows.length;
    const page = rows.slice(offset, offset + limit).map((row) => {
      const cust = bridge.get(row.customerId ?? -1);
      return {
        id: row.id,
        title: row.title,
        category: row.category,
        docType: row.docType,
        status: row.status,
        deliveredAt: row.deliveredAt,
        createdAt: row.createdAt,
        sowTotalPrice: row.sowTotalPrice,
        projectId: row.projectId,
        projectTitle: row.projectTitle,
        customerId: cust?.customerId ?? null,
        customerName: cust?.customerName ?? null,
        deepLink: cust?.customerId ? `/customers/${cust.customerId}` : null,
      };
    });

    res.json({ documents: page, total, limit, offset });
  } catch (err) {
    log.error({ err }, "msp-documents-hub: GET /msp/documents-hub failed");
    res.status(500).json({ error: "Failed to fetch documents" });
  }
});

/**
 * Loads a document and confirms it belongs to a customer within mspId's book.
 * Null if not found / not in the MSP. When `scopedCustomerIds` is non-null
 * (a scoped staff member), the document's owning msp_customers.id must also be
 * in that set — otherwise null (out of the caller's assigned scope).
 */
async function loadScopedDocument(mspId: number, documentId: number, scopedCustomerIds: number[] | null) {
  const [doc] = await db
    .select({
      id: insightsGeneratedDocumentsTable.id,
      title: insightsGeneratedDocumentsTable.title,
      htmlContent: insightsGeneratedDocumentsTable.htmlContent,
      status: insightsGeneratedDocumentsTable.status,
      docType: insightsGeneratedDocumentsTable.docType,
      customerId: insightsGeneratedDocumentsTable.customerId,
    })
    .from(insightsGeneratedDocumentsTable)
    .where(eq(insightsGeneratedDocumentsTable.id, documentId));

  if (!doc || doc.customerId === null) return null;

  const [owner] = await db
    .select({ mspId: mspUsersTable.mspId, mspCustomerId: mspUsersTable.customerId })
    .from(mspUsersTable)
    .where(eq(mspUsersTable.userId, doc.customerId));

  if (!owner || owner.mspId !== mspId) return null;
  // Per-staff customer scoping: fence a scoped operator out of documents owned
  // by customers outside their assigned set (reads as 404 at the call sites).
  if (scopedCustomerIds !== null && (owner.mspCustomerId == null || !scopedCustomerIds.includes(owner.mspCustomerId))) {
    return null;
  }
  return doc;
}

// ── GET /api/msp/documents-hub/:id/view ─────────────────────────────────────

router.get("/msp/documents-hub/:id/view", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  try {
    const mspId = resolveMspIdStrict(req);
    if (mspId === null) { res.status(403).json({ error: "MSP context required" }); return; }
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const doc = await loadScopedDocument(mspId, id, await resolveStaffScopedCustomerIds(req.user!));
    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }

    res.json({ id: doc.id, title: doc.title, htmlContent: stripStagedForReviewBanner(doc.htmlContent ?? "") });
  } catch (err) {
    log.error({ err }, "msp-documents-hub: GET /msp/documents-hub/:id/view failed");
    res.status(500).json({ error: "Failed to fetch document" });
  }
});

// ── GET /api/msp/documents-hub/:id/pdf ──────────────────────────────────────

router.get("/msp/documents-hub/:id/pdf", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  try {
    const mspId = resolveMspIdStrict(req);
    if (mspId === null) { res.status(403).json({ error: "MSP context required" }); return; }
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const doc = await loadScopedDocument(mspId, id, await resolveStaffScopedCustomerIds(req.user!));
    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
    if (!["approved", "delivered"].includes(doc.status ?? "")) {
      res.status(403).json({ error: "Document not available for download" });
      return;
    }

    const cleanHtml = stripStagedForReviewBanner(doc.htmlContent ?? "");
    const htmlDoc = buildHtmlDoc(cleanHtml);
    const pdfBuffer = await htmlToPdf(htmlDoc);

    const safeTitle = (doc.title ?? "document")
      .replace(/[^a-zA-Z0-9 _-]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 80);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.pdf"`);
    res.setHeader("Content-Length", String(pdfBuffer.length));
    res.end(pdfBuffer);
  } catch (err) {
    log.error({ err }, "msp-documents-hub: GET /msp/documents-hub/:id/pdf failed");
    res.status(500).json({ error: "Failed to generate PDF" });
  }
});

// ── POST /api/msp/documents-hub/:id/share ───────────────────────────────────
// Reuses the exact quick_win_result_shares token/expiry mechanism the
// customer-self-service /portal/documents/:id/share route already writes to
// (see portal.ts) — same table, same 30-day expiry, same downstream public
// viewing/view-tracking routes, unmodified. Only the authorization check
// differs: MSP-book ownership instead of doc.customerId === caller.

router.post("/msp/documents-hub/:id/share", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  try {
    const mspId = resolveMspIdStrict(req);
    if (mspId === null) { res.status(403).json({ error: "MSP context required" }); return; }
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const doc = await loadScopedDocument(mspId, id, await resolveStaffScopedCustomerIds(req.user!));
    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
    if (!["approved", "delivered"].includes(doc.status ?? "") && doc.docType !== "scoped_sow") {
      res.status(403).json({ error: "Document not available to share" });
      return;
    }

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
      clientUserId: doc.customerId!,
      shareToken,
      shareKind: "document",
      documentId: id,
      expiresAt,
    }).returning({ shareToken: quickWinResultSharesTable.shareToken });

    const baseUrl = getMspPortalBaseUrl();
    const shareUrl = `${baseUrl}/shared-documents/${share.shareToken}`;

    res.json({ shareUrl, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    log.error({ err }, "msp-documents-hub: POST /msp/documents-hub/:id/share failed");
    res.status(500).json({ error: "Failed to generate share link" });
  }
});

export default router;
