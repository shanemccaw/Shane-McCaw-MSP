/**
 * admin-client-documents.ts
 *
 * Routes for the client Document Hub and client-scoped report lookups.
 *
 * GET    /api/admin/clients/:clientId/documents            — list all docs for a client
 * POST   /api/admin/clients/:clientId/documents            — create doc record
 * DELETE /api/admin/clients/:clientId/documents/:docId     — delete doc record
 * GET    /api/admin/clients/:clientId/status-reports       — list sent status reports for a client
 */

import { Router, type Request, type Response } from "express";
import { db, clientDocumentsTable, usersTable, statusReportsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const router = Router();

// ── List documents for a client ────────────────────────────────────────────────
router.get("/admin/clients/:clientId/documents", requireAdmin, async (req: Request, res: Response) => {
  const clientId = parseInt(req.params["clientId"] as string, 10);
  if (isNaN(clientId)) {
    res.status(400).json({ error: "Invalid clientId" });
    return;
  }

  try {
    const docs = await db
      .select()
      .from(clientDocumentsTable)
      .where(eq(clientDocumentsTable.clientUserId, clientId))
      .orderBy(desc(clientDocumentsTable.createdAt));

    res.json(docs);
  } catch (err) {
    logger.error({ err, clientId }, "admin-client-documents: failed to list documents");
    res.status(500).json({ error: "Failed to fetch documents" });
  }
});

// ── Create a document record ───────────────────────────────────────────────────
router.post("/admin/clients/:clientId/documents", requireAdmin, async (req: Request, res: Response) => {
  const clientId = parseInt(req.params["clientId"] as string, 10);
  if (isNaN(clientId)) {
    res.status(400).json({ error: "Invalid clientId" });
    return;
  }

  // Verify client exists
  const [client] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, clientId))
    .limit(1);

  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }

  const { name, category, description, fileUrl, filename, mimeType, sizeBytes } = req.body as {
    name?: string;
    category?: string;
    description?: string;
    fileUrl?: string;
    filename?: string;
    mimeType?: string;
    sizeBytes?: number;
  };

  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const validCategories = ["contracts", "reports", "proposals", "sows", "assessments", "other"] as const;
  const safeCategory = validCategories.includes(category as typeof validCategories[number])
    ? (category as typeof validCategories[number])
    : "other";

  try {
    const [doc] = await db
      .insert(clientDocumentsTable)
      .values({
        clientUserId: clientId,
        name: name.trim(),
        category: safeCategory,
        description: description?.trim() ?? null,
        fileUrl: fileUrl?.trim() ?? null,
        filename: filename?.trim() ?? null,
        mimeType: mimeType?.trim() ?? null,
        sizeBytes: sizeBytes ?? null,
      })
      .returning();

    res.status(201).json(doc);
  } catch (err) {
    logger.error({ err, clientId }, "admin-client-documents: failed to create document");
    res.status(500).json({ error: "Failed to create document" });
  }
});

// ── Delete a document record ───────────────────────────────────────────────────
router.delete("/admin/clients/:clientId/documents/:docId", requireAdmin, async (req: Request, res: Response) => {
  const clientId = parseInt(req.params["clientId"] as string, 10);
  const docId = parseInt(req.params["docId"] as string, 10);

  if (isNaN(clientId) || isNaN(docId)) {
    res.status(400).json({ error: "Invalid clientId or docId" });
    return;
  }

  try {
    const [deleted] = await db
      .delete(clientDocumentsTable)
      .where(and(eq(clientDocumentsTable.id, docId), eq(clientDocumentsTable.clientUserId, clientId)))
      .returning({ id: clientDocumentsTable.id });

    if (!deleted) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, clientId, docId }, "admin-client-documents: failed to delete document");
    res.status(500).json({ error: "Failed to delete document" });
  }
});

// ── List status reports for a client (sent only) ──────────────────────────────
router.get("/admin/clients/:clientId/status-reports", requireAdmin, async (req: Request, res: Response) => {
  const clientId = parseInt(req.params["clientId"] as string, 10);
  if (isNaN(clientId)) {
    res.status(400).json({ error: "Invalid clientId" });
    return;
  }

  try {
    const reports = await db
      .select({
        id: statusReportsTable.id,
        title: statusReportsTable.title,
        period: statusReportsTable.period,
        reportStatus: statusReportsTable.reportStatus,
        clientStatus: statusReportsTable.clientStatus,
        executiveSummary: statusReportsTable.executiveSummary,
        keyOutcomes: statusReportsTable.keyOutcomes,
        sentAt: statusReportsTable.sentAt,
        reportDate: statusReportsTable.reportDate,
        createdAt: statusReportsTable.createdAt,
        projectId: statusReportsTable.projectId,
      })
      .from(statusReportsTable)
      .where(eq(statusReportsTable.clientUserId, clientId))
      .orderBy(desc(statusReportsTable.createdAt))
      .limit(20);

    res.json(reports);
  } catch (err) {
    logger.error({ err, clientId }, "admin-client-documents: failed to list status reports");
    res.status(500).json({ error: "Failed to fetch status reports" });
  }
});

export default router;
