/**
 * msp-documents.ts
 *
 * Document ingest & lifecycle API for the MSP Portal.
 *
 * Routes:
 *   POST   /api/msp/documents                             — submit HTML, trigger pipeline
 *   GET    /api/msp/documents                             — list documents for msp/customer
 *   GET    /api/msp/documents/:documentId                 — get document + current version
 *   POST   /api/msp/documents/:documentId/versions        — create a new version (HTML ingest)
 *   POST   /api/msp/documents/:documentId/publish         — publish current version
 *   GET    /api/msp/documents/:documentId/versions        — list all versions
 *   GET    /api/msp/documents/:documentId/versions/:vId   — get specific version
 *
 *   GET    /api/msp/sharepoint-connectors                 — list MSP-owned connectors
 *   POST   /api/msp/sharepoint-connectors                 — create connector
 *   PATCH  /api/msp/sharepoint-connectors/:connectorId   — update connector
 *   DELETE /api/msp/sharepoint-connectors/:connectorId   — soft-delete (isActive = false)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  mspDocumentsTable,
  mspDocumentVersionsTable,
  mspSharepointConnectorsTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireRole } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { createRun, executeRun } from "../lib/portal-workflow-engine";
import { DEFAULT_DOC_PIPELINE_GRAPH } from "../lib/doc-pipeline-nodes";
import { resolveConnectorSiteId } from "../lib/sharepoint-connector";

const router: IRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveMspId(req: Request): number {
  const user = req.user!;
  if (user.role === "admin") {
    const q = parseInt(String((req.query as Record<string, unknown>).mspId ?? ""), 10);
    return isNaN(q) ? 0 : q;
  }
  if (!user.mspId) throw new Error("No mspId on token");
  return user.mspId;
}

/** Ensure the default doc pipeline workflow exists, creating it if not. */
async function ensureDocPipelineWorkflow(): Promise<void> {
  const { portalWfWorkflowsTable } = await import("@workspace/db");
  const [existing] = await db
    .select({ workflowKey: portalWfWorkflowsTable.workflowKey })
    .from(portalWfWorkflowsTable)
    .where(eq(portalWfWorkflowsTable.workflowKey, "doc.pipeline.default"))
    .limit(1);

  if (!existing) {
    await db.insert(portalWfWorkflowsTable).values({
      workflowKey: "doc.pipeline.default",
      label: "Document Pipeline (Default)",
      description: "HTML → PDF → SharePoint → publish",
      graph: DEFAULT_DOC_PIPELINE_GRAPH as unknown as Record<string, unknown>,
      isActive: true,
    });
    logger.info({}, "msp-documents: seeded default doc pipeline workflow");
  }
}

// ── POST /api/msp/documents ────────────────────────────────────────────────────

router.post(
  "/msp/documents",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspId(req);
      const {
        title,
        documentType = "general",
        customerId,
        htmlContent,
        changeNote,
        connectorMode = "platform",
        connectorId,
        autoPublish = false,
      } = req.body as {
        title?: string;
        documentType?: string;
        customerId?: number;
        htmlContent?: string;
        changeNote?: string;
        connectorMode?: "platform" | "msp_owned";
        connectorId?: string;
        autoPublish?: boolean;
      };

      if (!title) { res.status(400).json({ error: "title is required" }); return; }
      if (!htmlContent) { res.status(400).json({ error: "htmlContent is required" }); return; }
      if (connectorMode === "msp_owned" && !connectorId) {
        res.status(400).json({ error: "connectorId is required when connectorMode is msp_owned" }); return;
      }

      const authorUserId = req.user!.id ?? 0;

      const [document] = await db
        .insert(mspDocumentsTable)
        .values({
          mspId,
          customerId: customerId ?? null,
          title,
          documentType,
          ownerType: customerId ? "customer" : "msp",
          status: "draft",
          pipelineStatus: "pending",
          connectorMode,
          connectorId: connectorId ?? null,
          createdByUserId: authorUserId,
        })
        .returning();

      if (!document) { res.status(500).json({ error: "Failed to create document" }); return; }

      // Ensure the workflow definition exists
      await ensureDocPipelineWorkflow().catch((err) =>
        logger.warn({ err }, "msp-documents: failed to ensure pipeline workflow (non-fatal)"),
      );

      // Create and enqueue a portal workflow run for the pipeline
      const runId = await createRun({
        workflowKey: "doc.pipeline.default",
        tenantContext: { mspId, customerId: customerId ?? null },
        triggerEventType: "msp.document.submit",
        inputPayload: {
          documentId: document.documentId,
          htmlContent,
          authorUserId,
          changeNote: changeNote ?? "",
          autoPublish,
          publishedByUserId: authorUserId,
        },
      });

      // Persist the pipeline run ID on the document
      await db
        .update(mspDocumentsTable)
        .set({ pipelineRunId: runId })
        .where(eq(mspDocumentsTable.documentId, document.documentId));

      void executeRun(runId);

      res.status(202).json({
        documentId: document.documentId,
        runId,
        message: "Document accepted — pipeline started",
      });
    } catch (err) {
      req.log.error({ err }, "POST /api/msp/documents failed");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── GET /api/msp/documents ─────────────────────────────────────────────────────

router.get(
  "/msp/documents",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspId(req);
      const customerIdFilter = req.query.customerId
        ? parseInt(String(req.query.customerId), 10)
        : undefined;
      const statusFilter = req.query.status as string | undefined;

      const conditions = [eq(mspDocumentsTable.mspId, mspId)];
      if (customerIdFilter && !isNaN(customerIdFilter)) {
        conditions.push(eq(mspDocumentsTable.customerId, customerIdFilter));
      }
      if (statusFilter && ["draft", "active", "archived"].includes(statusFilter)) {
        conditions.push(eq(mspDocumentsTable.status, statusFilter as "draft" | "active" | "archived"));
      }

      const documents = await db
        .select()
        .from(mspDocumentsTable)
        .where(and(...conditions))
        .orderBy(desc(mspDocumentsTable.createdAt))
        .limit(100);

      res.json({ documents });
    } catch (err) {
      req.log.error({ err }, "GET /api/msp/documents failed");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── GET /api/msp/documents/:documentId ────────────────────────────────────────

router.get(
  "/msp/documents/:documentId",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const { documentId } = req.params as { documentId: string };
      const mspId = resolveMspId(req);

      const [document] = await db
        .select()
        .from(mspDocumentsTable)
        .where(
          and(
            eq(mspDocumentsTable.documentId, documentId),
            eq(mspDocumentsTable.mspId, mspId),
          ),
        )
        .limit(1);

      if (!document) { res.status(404).json({ error: "Document not found" }); return; }

      let currentVersion = null;
      if (document.currentVersionId) {
        const [v] = await db
          .select()
          .from(mspDocumentVersionsTable)
          .where(eq(mspDocumentVersionsTable.versionId, document.currentVersionId))
          .limit(1);
        currentVersion = v ?? null;
      }

      // Strip HTML content from the version summary (can be large)
      const versionSummary = currentVersion
        ? { ...currentVersion, content: currentVersion.content ? "[html]" : null }
        : null;

      res.json({ document, currentVersion: versionSummary });
    } catch (err) {
      req.log.error({ err }, "GET /api/msp/documents/:documentId failed");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── POST /api/msp/documents/:documentId/versions ──────────────────────────────
// Creates a new version of an existing document and re-triggers the pipeline.

router.post(
  "/msp/documents/:documentId/versions",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const { documentId } = req.params as { documentId: string };
      const mspId = resolveMspId(req);

      const [document] = await db
        .select()
        .from(mspDocumentsTable)
        .where(
          and(
            eq(mspDocumentsTable.documentId, documentId),
            eq(mspDocumentsTable.mspId, mspId),
          ),
        )
        .limit(1);

      if (!document) { res.status(404).json({ error: "Document not found" }); return; }
      if (document.status === "archived") {
        res.status(409).json({ error: "Cannot add versions to an archived document" });
        return;
      }

      const { htmlContent, changeNote } = req.body as { htmlContent?: string; changeNote?: string };
      if (!htmlContent) { res.status(400).json({ error: "htmlContent is required" }); return; }

      const authorUserId = req.user!.id ?? 0;

      await ensureDocPipelineWorkflow().catch(() => {});

      const runId = await createRun({
        workflowKey: "doc.pipeline.default",
        tenantContext: { mspId, customerId: document.customerId ?? null },
        triggerEventType: "msp.document.version",
        inputPayload: {
          documentId,
          htmlContent,
          authorUserId,
          changeNote: changeNote ?? "",
          autoPublish: false,
        },
      });

      await db
        .update(mspDocumentsTable)
        .set({ pipelineRunId: runId, pipelineStatus: "pending", updatedAt: new Date() })
        .where(eq(mspDocumentsTable.documentId, documentId));

      void executeRun(runId);

      res.status(202).json({ documentId, runId, message: "New version pipeline started" });
    } catch (err) {
      req.log.error({ err }, "POST /api/msp/documents/:documentId/versions failed");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── GET /api/msp/documents/:documentId/versions ───────────────────────────────

router.get(
  "/msp/documents/:documentId/versions",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const { documentId } = req.params as { documentId: string };
      const mspId = resolveMspId(req);

      const [document] = await db
        .select({ documentId: mspDocumentsTable.documentId })
        .from(mspDocumentsTable)
        .where(
          and(
            eq(mspDocumentsTable.documentId, documentId),
            eq(mspDocumentsTable.mspId, mspId),
          ),
        )
        .limit(1);

      if (!document) { res.status(404).json({ error: "Document not found" }); return; }

      const versions = await db
        .select({
          versionId: mspDocumentVersionsTable.versionId,
          documentId: mspDocumentVersionsTable.documentId,
          versionNumber: mspDocumentVersionsTable.versionNumber,
          contentHash: mspDocumentVersionsTable.contentHash,
          mimeType: mspDocumentVersionsTable.mimeType,
          sizeBytes: mspDocumentVersionsTable.sizeBytes,
          pdfSizeBytes: mspDocumentVersionsTable.pdfSizeBytes,
          sharepointFileId: mspDocumentVersionsTable.sharepointFileId,
          sharepointFileUrl: mspDocumentVersionsTable.sharepointFileUrl,
          pipelineStatus: mspDocumentVersionsTable.pipelineStatus,
          authorUserId: mspDocumentVersionsTable.authorUserId,
          changeNote: mspDocumentVersionsTable.changeNote,
          createdAt: mspDocumentVersionsTable.createdAt,
        })
        .from(mspDocumentVersionsTable)
        .where(eq(mspDocumentVersionsTable.documentId, documentId))
        .orderBy(desc(mspDocumentVersionsTable.versionNumber));

      res.json({ versions });
    } catch (err) {
      req.log.error({ err }, "GET /api/msp/documents/:documentId/versions failed");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── GET /api/msp/documents/:documentId/versions/:versionId ────────────────────

router.get(
  "/msp/documents/:documentId/versions/:versionId",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const { documentId, versionId } = req.params as { documentId: string; versionId: string };
      const mspId = resolveMspId(req);

      const [document] = await db
        .select({ documentId: mspDocumentsTable.documentId })
        .from(mspDocumentsTable)
        .where(
          and(
            eq(mspDocumentsTable.documentId, documentId),
            eq(mspDocumentsTable.mspId, mspId),
          ),
        )
        .limit(1);

      if (!document) { res.status(404).json({ error: "Document not found" }); return; }

      const [version] = await db
        .select()
        .from(mspDocumentVersionsTable)
        .where(
          and(
            eq(mspDocumentVersionsTable.versionId, versionId),
            eq(mspDocumentVersionsTable.documentId, documentId),
          ),
        )
        .limit(1);

      if (!version) { res.status(404).json({ error: "Version not found" }); return; }

      // Return full content for direct access
      res.json({ version });
    } catch (err) {
      req.log.error({ err }, "GET /api/msp/documents/:documentId/versions/:versionId failed");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── POST /api/msp/documents/:documentId/publish ───────────────────────────────

router.post(
  "/msp/documents/:documentId/publish",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const { documentId } = req.params as { documentId: string };
      const mspId = resolveMspId(req);
      const publishedByUserId = req.user!.id ?? 0;

      const [document] = await db
        .select()
        .from(mspDocumentsTable)
        .where(
          and(
            eq(mspDocumentsTable.documentId, documentId),
            eq(mspDocumentsTable.mspId, mspId),
          ),
        )
        .limit(1);

      if (!document) { res.status(404).json({ error: "Document not found" }); return; }
      if (!document.currentVersionId) {
        res.status(409).json({ error: "Document has no version to publish — run the pipeline first" });
        return;
      }
      if (document.status === "archived") {
        res.status(409).json({ error: "Cannot publish an archived document" });
        return;
      }

      const publishedAt = new Date();

      await db
        .update(mspDocumentsTable)
        .set({
          status: "active",
          pipelineStatus: "published",
          publishedAt,
          publishedByUserId,
          updatedAt: new Date(),
        })
        .where(eq(mspDocumentsTable.documentId, documentId));

      await db
        .update(mspDocumentVersionsTable)
        .set({ pipelineStatus: "published" })
        .where(eq(mspDocumentVersionsTable.versionId, document.currentVersionId));

      res.json({ documentId, publishedAt: publishedAt.toISOString() });
    } catch (err) {
      req.log.error({ err }, "POST /api/msp/documents/:documentId/publish failed");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── SharePoint Connector CRUD ──────────────────────────────────────────────────

router.get(
  "/msp/sharepoint-connectors",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspId(req);

      const connectors = await db
        .select({
          connectorId: mspSharepointConnectorsTable.connectorId,
          label: mspSharepointConnectorsTable.label,
          tenantId: mspSharepointConnectorsTable.tenantId,
          clientId: mspSharepointConnectorsTable.clientId,
          clientSecretRef: mspSharepointConnectorsTable.clientSecretRef,
          sharepointSiteUrl: mspSharepointConnectorsTable.sharepointSiteUrl,
          sharepointSiteId: mspSharepointConnectorsTable.sharepointSiteId,
          defaultFolderPath: mspSharepointConnectorsTable.defaultFolderPath,
          isActive: mspSharepointConnectorsTable.isActive,
          createdAt: mspSharepointConnectorsTable.createdAt,
        })
        .from(mspSharepointConnectorsTable)
        .where(eq(mspSharepointConnectorsTable.mspId, mspId))
        .orderBy(desc(mspSharepointConnectorsTable.createdAt));

      res.json({ connectors });
    } catch (err) {
      req.log.error({ err }, "GET /api/msp/sharepoint-connectors failed");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

router.post(
  "/msp/sharepoint-connectors",
  requireRole("MSPAdmin"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspId(req);
      const {
        label,
        tenantId,
        clientId,
        clientSecretRef,
        clientSecretPlain,
        sharepointSiteUrl,
        defaultFolderPath,
      } = req.body as {
        label?: string;
        tenantId?: string;
        clientId?: string;
        clientSecretRef?: string;
        clientSecretPlain?: string;
        sharepointSiteUrl?: string;
        defaultFolderPath?: string;
      };

      if (!label) { res.status(400).json({ error: "label is required" }); return; }
      if (!tenantId) { res.status(400).json({ error: "tenantId is required" }); return; }
      if (!clientId) { res.status(400).json({ error: "clientId is required" }); return; }
      if (!clientSecretRef && !clientSecretPlain) {
        res.status(400).json({ error: "clientSecretRef or clientSecretPlain is required" }); return;
      }
      if (clientSecretPlain && process.env.NODE_ENV === "production") {
        res.status(400).json({ error: "clientSecretPlain is not allowed in production — use clientSecretRef (Key Vault)" });
        return;
      }

      // Attempt to resolve the SharePoint site ID
      let sharepointSiteId: string | null = null;
      if (sharepointSiteUrl) {
        sharepointSiteId = await resolveConnectorSiteId({
          mode: "msp_owned",
          siteUrl: sharepointSiteUrl,
        }).catch(() => null);
      }

      const [connector] = await db
        .insert(mspSharepointConnectorsTable)
        .values({
          mspId,
          label,
          tenantId,
          clientId,
          clientSecretRef: clientSecretRef ?? null,
          clientSecretPlain: clientSecretPlain ?? null,
          sharepointSiteUrl: sharepointSiteUrl ?? null,
          sharepointSiteId,
          defaultFolderPath: defaultFolderPath ?? "Documents",
          createdByUserId: req.user!.id ?? 0,
        })
        .returning({
          connectorId: mspSharepointConnectorsTable.connectorId,
          label: mspSharepointConnectorsTable.label,
          sharepointSiteId: mspSharepointConnectorsTable.sharepointSiteId,
        });

      res.status(201).json({ connector });
    } catch (err) {
      req.log.error({ err }, "POST /api/msp/sharepoint-connectors failed");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

router.patch(
  "/msp/sharepoint-connectors/:connectorId",
  requireRole("MSPAdmin"),
  async (req: Request, res: Response) => {
    try {
      const { connectorId } = req.params as { connectorId: string };
      const mspId = resolveMspId(req);

      const [existing] = await db
        .select({ connectorId: mspSharepointConnectorsTable.connectorId })
        .from(mspSharepointConnectorsTable)
        .where(
          and(
            eq(mspSharepointConnectorsTable.connectorId, connectorId),
            eq(mspSharepointConnectorsTable.mspId, mspId),
          ),
        )
        .limit(1);

      if (!existing) { res.status(404).json({ error: "Connector not found" }); return; }

      const {
        label,
        clientSecretRef,
        clientSecretPlain,
        sharepointSiteUrl,
        defaultFolderPath,
        isActive,
      } = req.body as Record<string, unknown>;

      let sharepointSiteId: string | null | undefined;
      if (typeof sharepointSiteUrl === "string") {
        sharepointSiteId = await resolveConnectorSiteId({
          mode: "msp_owned",
          connectorId,
          siteUrl: sharepointSiteUrl,
        }).catch(() => null);
      }

      await db
        .update(mspSharepointConnectorsTable)
        .set({
          updatedAt: new Date(),
          ...(label != null ? { label: String(label) } : {}),
          ...(clientSecretRef != null ? { clientSecretRef: String(clientSecretRef) } : {}),
          ...(clientSecretPlain != null && process.env.NODE_ENV !== "production"
            ? { clientSecretPlain: String(clientSecretPlain) }
            : {}),
          ...(sharepointSiteUrl != null ? { sharepointSiteUrl: String(sharepointSiteUrl) } : {}),
          ...(sharepointSiteId !== undefined ? { sharepointSiteId } : {}),
          ...(defaultFolderPath != null ? { defaultFolderPath: String(defaultFolderPath) } : {}),
          ...(isActive != null ? { isActive: Boolean(isActive) } : {}),
        })
        .where(eq(mspSharepointConnectorsTable.connectorId, connectorId));

      res.json({ ok: true, connectorId });
    } catch (err) {
      req.log.error({ err }, "PATCH /api/msp/sharepoint-connectors/:connectorId failed");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

router.delete(
  "/msp/sharepoint-connectors/:connectorId",
  requireRole("MSPAdmin"),
  async (req: Request, res: Response) => {
    try {
      const { connectorId } = req.params as { connectorId: string };
      const mspId = resolveMspId(req);

      const [updated] = await db
        .update(mspSharepointConnectorsTable)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          and(
            eq(mspSharepointConnectorsTable.connectorId, connectorId),
            eq(mspSharepointConnectorsTable.mspId, mspId),
          ),
        )
        .returning({ connectorId: mspSharepointConnectorsTable.connectorId });

      if (!updated) { res.status(404).json({ error: "Connector not found" }); return; }

      res.json({ ok: true, connectorId });
    } catch (err) {
      req.log.error({ err }, "DELETE /api/msp/sharepoint-connectors/:connectorId failed");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
