/**
 * admin-document-generator.ts
 *
 * Document Generator IDE — real, on-demand document generation for any
 * active document_types row, routed to generateDocument()/generateSowDocument()
 * by pipelineCategory, plus the tenant/project pickers and generation history
 * the admin page needs. Dry-run preview stays on the existing
 * GET /api/admin/document-types/:key/preview route (admin-document-types.ts);
 * this file only adds the real (persisting) trigger and read paths.
 *
 * Routes
 * ──────
 * GET  /api/admin/document-generator/tenants                       — tenant picker (msp_customers)
 * GET  /api/admin/document-generator/tenants/:mspCustomerId/projects — project picker for a tenant
 * GET  /api/admin/document-generator/missing-types           — document_generation services with no document_types row
 * POST /api/admin/document-generator/document-types/:key/generate — real generation
 * GET  /api/admin/document-generator/history                — recent generations
 * GET  /api/admin/document-generator/history/:id/html        — view/download stored HTML
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, documentTypesTable, insightsGeneratedDocumentsTable, mspCustomersTable, projectsTable, servicesTable, usersTable } from "@workspace/db";
import { eq, desc, and, isNull, inArray, asc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { generateDocument } from "../lib/document-engine.ts";
import { generateSowDocument } from "../lib/document-engine-sow.ts";
import { resolveCustomerUserIds } from "../lib/tenant-signals";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "workflow.doc-pipeline" });
const missingTypesLog = logger.child({ channel: "engine.document-generator" });
const router: IRouter = Router();

// ── Tenant picker ────────────────────────────────────────────────────────────
// Every `msp_customers` row, including ones with no `tenantId` yet — those are
// surfaced with a null `tenantId` rather than filtered out, so the frontend can
// show the same amber "not yet connected" indicator convention used elsewhere
// in this app instead of silently hiding an onboarding-stage tenant.

router.get("/admin/document-generator/tenants", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        id: mspCustomersTable.id,
        name: mspCustomersTable.name,
        tenantId: mspCustomersTable.tenantId,
        domain: mspCustomersTable.domain,
        status: mspCustomersTable.status,
      })
      .from(mspCustomersTable)
      .orderBy(asc(mspCustomersTable.name));
    res.json(rows);
  } catch (err) {
    log.error({ err }, "admin-document-generator: list tenants failed");
    res.status(500).json({ error: "Failed to fetch tenants" });
  }
});

// ── Project picker (tenant-scoped) ──────────────────────────────────────────
// Resolves every linked login for the tenant (resolveCustomerUserIds), then
// returns projects across the whole set, ordered by updatedAt desc — not just
// one arbitrary login's projects.

router.get("/admin/document-generator/tenants/:mspCustomerId/projects", requireAdmin, async (req: Request, res: Response) => {
  const mspCustomerId = parseInt(String(req.params["mspCustomerId"] ?? ""), 10);
  if (isNaN(mspCustomerId)) { res.status(400).json({ error: "Invalid mspCustomerId" }); return; }

  try {
    const userIds = await resolveCustomerUserIds(mspCustomerId);
    if (userIds.length === 0) { res.json([]); return; }

    const rows = await db
      .select({ id: projectsTable.id, title: projectsTable.title, status: projectsTable.status })
      .from(projectsTable)
      .where(inArray(projectsTable.clientUserId, userIds))
      .orderBy(desc(projectsTable.updatedAt));
    res.json(rows);
  } catch (err) {
    log.error({ err, mspCustomerId }, "admin-document-generator: list tenant projects failed");
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

// ── Missing document types ───────────────────────────────────────────────────
// Services flagged for document-generation delivery with no matching
// document_types row yet — surfaces registry gaps before they're hit at
// generation time. `slug` is included alongside the id/name/description the
// panel displays so the frontend's Quick Add can derive a key without a
// second round trip.

router.get("/admin/document-generator/missing-types", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        id: servicesTable.id,
        name: servicesTable.name,
        description: servicesTable.description,
        slug: servicesTable.slug,
      })
      .from(servicesTable)
      .leftJoin(documentTypesTable, eq(documentTypesTable.serviceId, servicesTable.id))
      .where(and(eq(servicesTable.deliveryType, "document_generation"), isNull(documentTypesTable.id)))
      .orderBy(servicesTable.name);
    res.json(rows);
  } catch (err) {
    missingTypesLog.error({ err }, "admin-document-generator: missing-types failed");
    res.status(500).json({ error: "Failed to fetch missing document types" });
  }
});

// ── Generate (real, persisting) ─────────────────────────────────────────────
//
// Takes `mspCustomerId` directly now that the tenant picker (Phase 9) gives the
// UI a real customer id to supply — the interim `resolveCustomerIdForPortalUser()`
// translation this route used to do at the boundary is gone.

router.post("/admin/document-generator/document-types/:key/generate", requireAdmin, async (req: Request, res: Response) => {
  const key = String(req.params["key"] ?? "");
  const mspCustomerId = parseInt(String(req.body?.mspCustomerId ?? ""), 10);
  const projectId = parseInt(String(req.body?.projectId ?? "0"), 10);
  // Drift gate override. Defaults to false, so a plain "Generate" click reuses
  // an existing document when nothing about the tenant's data has moved instead
  // of paying for an identical AI call. Strict `=== true` so a body carrying the
  // string "false" (or any other truthy-but-not-true value) can't accidentally
  // buy an AI call.
  const forceRegenerate = req.body?.forceRegenerate === true;

  if (isNaN(mspCustomerId)) {
    res.status(400).json({ error: "mspCustomerId is required and must be a number" });
    return;
  }

  try {
    const [docTypeRow] = await db
      .select({ pipelineCategory: documentTypesTable.pipelineCategory, isActive: documentTypesTable.isActive, label: documentTypesTable.label })
      .from(documentTypesTable)
      .where(eq(documentTypesTable.key, key))
      .limit(1);

    if (!docTypeRow) { res.status(404).json({ error: `Unknown document type "${key}"` }); return; }
    if (!docTypeRow.isActive) { res.status(400).json({ error: `Document type "${key}" is not active` }); return; }

    log.info({ key, mspCustomerId, projectId, forceRegenerate, actor: req.user?.email }, "admin-document-generator: generate requested");

    const result = docTypeRow.pipelineCategory === "pipeline_output"
      ? await generateSowDocument({ mspCustomerId, projectId: isNaN(projectId) ? 0 : projectId, docTypeKey: key, forceRegenerate })
      : await generateDocument({ mspCustomerId, projectId: isNaN(projectId) ? 0 : projectId, docTypeKey: key, forceRegenerate });

    log.info({ key, mspCustomerId, documentId: result.documentId }, "admin-document-generator: generate completed");
    res.json({ documentId: result.documentId, htmlContent: result.htmlContent, docTypeKey: key });
  } catch (err) {
    log.error({ err, key, mspCustomerId }, "admin-document-generator: generate failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Generation failed" });
  }
});

// ── History ──────────────────────────────────────────────────────────────────

router.get("/admin/document-generator/history", requireAdmin, async (req: Request, res: Response) => {
  const docType = req.query["docType"] ? String(req.query["docType"]) : undefined;
  const rawLimit = parseInt(String(req.query["limit"] ?? "50"), 10);
  const limit = isNaN(rawLimit) ? 50 : Math.min(Math.max(rawLimit, 1), 200);

  try {
    const conditions = docType ? [eq(insightsGeneratedDocumentsTable.docType, docType)] : [];
    const rows = await db
      .select({
        id: insightsGeneratedDocumentsTable.id,
        docType: insightsGeneratedDocumentsTable.docType,
        category: insightsGeneratedDocumentsTable.category,
        title: insightsGeneratedDocumentsTable.title,
        status: insightsGeneratedDocumentsTable.status,
        errorMessage: insightsGeneratedDocumentsTable.errorMessage,
        createdAt: insightsGeneratedDocumentsTable.createdAt,
        customerId: insightsGeneratedDocumentsTable.customerId,
        customerName: usersTable.name,
        customerCompany: usersTable.company,
        projectId: insightsGeneratedDocumentsTable.projectId,
        projectTitle: projectsTable.title,
        docTypeLabel: documentTypesTable.label,
      })
      .from(insightsGeneratedDocumentsTable)
      .leftJoin(usersTable, eq(insightsGeneratedDocumentsTable.customerId, usersTable.id))
      .leftJoin(projectsTable, eq(insightsGeneratedDocumentsTable.projectId, projectsTable.id))
      .leftJoin(documentTypesTable, eq(insightsGeneratedDocumentsTable.docType, documentTypesTable.key))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(insightsGeneratedDocumentsTable.createdAt))
      .limit(limit);
    res.json(rows);
  } catch (err) {
    log.error({ err }, "admin-document-generator: history failed");
    res.status(500).json({ error: "Failed to fetch generation history" });
  }
});

router.get("/admin/document-generator/history/:id/html", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const [doc] = await db
      .select({ title: insightsGeneratedDocumentsTable.title, htmlContent: insightsGeneratedDocumentsTable.htmlContent })
      .from(insightsGeneratedDocumentsTable)
      .where(eq(insightsGeneratedDocumentsTable.id, id))
      .limit(1);
    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(doc.htmlContent);
  } catch (err) {
    log.error({ err, id }, "admin-document-generator: html view failed");
    res.status(500).json({ error: "Failed to load document" });
  }
});

export default router;
