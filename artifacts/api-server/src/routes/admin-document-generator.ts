/**
 * admin-document-generator.ts
 *
 * Document Generator IDE — real, on-demand document generation for any
 * active document_types row, routed to generateDocument()/generateSowDocument()
 * by pipelineCategory, plus the client/project pickers and generation history
 * the admin page needs. Dry-run preview stays on the existing
 * GET /api/admin/document-types/:key/preview route (admin-document-types.ts);
 * this file only adds the real (persisting) trigger and read paths.
 *
 * Routes
 * ──────
 * GET  /api/admin/document-generator/clients/:id/projects — project picker for a client
 * GET  /api/admin/document-generator/missing-types           — document_generation services with no document_types row
 * POST /api/admin/document-generator/document-types/:key/generate — real generation
 * GET  /api/admin/document-generator/history                — recent generations
 * GET  /api/admin/document-generator/history/:id/html        — view/download stored HTML
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, documentTypesTable, insightsGeneratedDocumentsTable, projectsTable, servicesTable, usersTable } from "@workspace/db";
import { eq, desc, and, isNull } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { generateDocument } from "../lib/document-engine.ts";
import { generateSowDocument } from "../lib/document-engine-sow.ts";
import { resolveCustomerIdForPortalUser } from "../lib/tenant-signals";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "workflow.doc-pipeline" });
const missingTypesLog = logger.child({ channel: "engine.document-generator" });
const router: IRouter = Router();

// ── Project picker ──────────────────────────────────────────────────────────

router.get("/admin/document-generator/clients/:id/projects", requireAdmin, async (req: Request, res: Response) => {
  const clientUserId = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(clientUserId)) { res.status(400).json({ error: "Invalid client id" }); return; }

  try {
    const rows = await db
      .select({ id: projectsTable.id, title: projectsTable.title, status: projectsTable.status })
      .from(projectsTable)
      .where(eq(projectsTable.clientUserId, clientUserId))
      .orderBy(desc(projectsTable.updatedAt));
    res.json(rows);
  } catch (err) {
    log.error({ err, clientUserId }, "admin-document-generator: list projects failed");
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
// Still takes `clientUserId` — deliberately, as an INTERIM step.
//
// The document engines are now tenant-first (they take an `mspCustomerId`), and
// the right end state for this route is to take one directly. It can't yet: the
// only picker the Document Generator IDE has is `GET /admin/clients`, which is
// user-shaped, so there is nothing in the UI that could supply a customer id.
// Changing the contract now would break the page for the sake of a field no
// caller can populate. So the users.id → msp_customers.id translation happens
// here, at the route boundary, instead of hidden inside the engine — which is
// the actual point of the change: the engine no longer does it, exactly one
// caller-side line does, and it becomes a one-line deletion the moment the
// tenant picker lands (Phase 10).

router.post("/admin/document-generator/document-types/:key/generate", requireAdmin, async (req: Request, res: Response) => {
  const key = String(req.params["key"] ?? "");
  const clientUserId = parseInt(String(req.body?.clientUserId ?? ""), 10);
  const projectId = parseInt(String(req.body?.projectId ?? "0"), 10);

  if (isNaN(clientUserId)) {
    res.status(400).json({ error: "clientUserId is required and must be a number" });
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

    const mspCustomerId = await resolveCustomerIdForPortalUser(clientUserId);
    if (mspCustomerId == null) {
      res.status(404).json({ error: `Client ${clientUserId} is not linked to an MSP customer — there is no tenant to generate a document against` });
      return;
    }

    log.info({ key, clientUserId, mspCustomerId, projectId, actor: req.user?.email }, "admin-document-generator: generate requested");

    const result = docTypeRow.pipelineCategory === "pipeline_output"
      ? await generateSowDocument({ mspCustomerId, documentOwnerUserId: clientUserId, projectId: isNaN(projectId) ? 0 : projectId, docTypeKey: key })
      : await generateDocument({ mspCustomerId, documentOwnerUserId: clientUserId, projectId: isNaN(projectId) ? 0 : projectId, docTypeKey: key });

    log.info({ key, clientUserId, mspCustomerId, documentId: result.documentId }, "admin-document-generator: generate completed");
    res.json({ documentId: result.documentId, htmlContent: result.htmlContent, docTypeKey: key });
  } catch (err) {
    log.error({ err, key, clientUserId }, "admin-document-generator: generate failed");
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
