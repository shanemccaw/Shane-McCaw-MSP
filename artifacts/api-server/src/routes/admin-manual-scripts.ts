/**
 * admin-manual-scripts.ts
 *
 * Routes for the manual script execution flow (scripts that require
 * delegated authentication and cannot run unattended in Azure Automation).
 *
 * POST /api/admin/manual-scripts/:scriptId/generate-package
 *   Generates a .ps1 file + instruction document for the given script,
 *   creates a script_run_results row with status = awaiting_upload,
 *   and returns the content inline along with the runResultId.
 *
 * POST /api/admin/manual-scripts/:runResultId/upload
 *   Accepts the JSON output collected by the customer, validates it,
 *   stores it in script_run_results, runs the AI Analyzer, and applies
 *   score + profile updates.
 *
 * GET /api/admin/manual-scripts/:scriptId/status
 *   Returns the current execution status for the most recent run result
 *   associated with this script (and optionally a customerId).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import {
  db,
  scriptCatalogTable,
  scriptRunResultsTable,
  usersTable,
} from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { generateManualScriptPackage } from "../lib/manual-script-package";
import { processManualScriptUpload, UploadError } from "../lib/manual-script-upload";
import { createManualScriptKanbanCard, completeManualScriptKanbanCard } from "../lib/manual-script-kanban";

const router: IRouter = Router();


function getUploadBaseUrl(): string {
  const domains = process.env.REPLIT_DOMAINS;
  if (domains) {
    const primary = domains.split(",")[0]?.trim();
    if (primary) return `https://${primary}`;
  }
  return process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://localhost:8080";
}

// ── POST /api/admin/manual-scripts/:scriptId/generate-package ─────────────────

const generatePackageSchema = z.object({
  customerId: z.number().int().positive().optional(),
  packageId: z.number().int().positive().optional(),
});

router.post("/admin/manual-scripts/:scriptId/generate-package", requireAdmin, async (req: Request, res: Response) => {
  const scriptId = parseInt(String(req.params.scriptId));
  if (isNaN(scriptId)) {
    res.status(400).json({ error: "Invalid scriptId" });
    return;
  }

  const parsed = generatePackageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  const { customerId, packageId } = parsed.data;

  try {
    const [script] = await db
      .select()
      .from(scriptCatalogTable)
      .where(eq(scriptCatalogTable.id, scriptId))
      .limit(1);

    if (!script) {
      res.status(404).json({ error: "Script not found" });
      return;
    }

    if (script.executionMode !== "manual") {
      res.status(400).json({ error: "Script is not marked as manual — use the automated execution flow" });
      return;
    }

    let customerDisplayName: string | undefined;
    if (customerId) {
      const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, customerId)).limit(1);
      customerDisplayName = user?.name ?? undefined;
    }

    const [resultRow] = await db
      .insert(scriptRunResultsTable)
      .values({
        customerId: customerId ?? null,
        scriptId,
        packageId: packageId ?? null,
        status: "awaiting_upload",
        executionSource: "manual",
      })
      .returning({ id: scriptRunResultsTable.id });

    const runResultId = resultRow.id;

    const pkg = generateManualScriptPackage({
      scriptId,
      scriptName: script.name,
      description: script.description,
      manualRequirements: Array.isArray(script.manualRequirements) ? script.manualRequirements as string[] : [],
      psScriptBody: script.psScriptBody ?? null,
      runResultId,
      customerDisplayName,
      uploadBaseUrl: getUploadBaseUrl(),
    });

    logger.info({ scriptId, runResultId, customerId }, "admin-manual-scripts: generated package");

    const baseUrl = getUploadBaseUrl();
    const downloadUrl = `${baseUrl}/api/admin/manual-scripts/${runResultId}/download`;
    const instructionsUrl = `${baseUrl}/api/admin/manual-scripts/${runResultId}/instructions`;
    const uploadUrl = `${baseUrl}/api/admin/manual-scripts/${runResultId}/upload`;

    if (customerId) {
      createManualScriptKanbanCard({
        scriptId,
        scriptRunResultId: runResultId,
        customerId,
        scriptName: script.name,
        manualRequirements: Array.isArray(script.manualRequirements)
          ? script.manualRequirements as string[]
          : [],
        description: script.description ?? null,
        downloadUrl,
        instructionsUrl,
        uploadUrl,
      }).catch((err) => {
        logger.warn({ err, scriptId, runResultId }, "admin-manual-scripts: kanban card creation failed (non-fatal)");
      });
    }

    res.json({
      runResultId,
      scriptId,
      scriptName: script.name,
      filename: pkg.filename,
      psContent: pkg.psContent,
      instructions: pkg.instructions,
      uploadUrl,
      status: "awaiting_upload",
    });
  } catch (err) {
    logger.error({ err, scriptId }, "admin-manual-scripts: generate-package failed");
    res.status(500).json({ error: "Failed to generate script package" });
  }
});

// ── POST /api/admin/manual-scripts/:runResultId/upload ────────────────────────

const uploadSchema = z.object({
  jsonData: z
    .record(z.unknown())
    .refine(
      (d) => Object.keys(d).length > 0,
      { message: "Uploaded JSON must not be empty" },
    )
    .refine(
      (d) => "data" in d,
      { message: "Uploaded JSON must contain a 'data' key with the collected output" },
    ),
  uploadedBy: z.string().optional(),
});

router.post("/admin/manual-scripts/:runResultId/upload", requireAdmin, async (req: Request, res: Response) => {
  const runResultId = parseInt(String(req.params.runResultId));
  if (isNaN(runResultId)) {
    res.status(400).json({ error: "Invalid runResultId" });
    return;
  }

  const parsed = uploadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  const { jsonData, uploadedBy } = parsed.data;

  try {
    const result = await processManualScriptUpload(
      runResultId,
      jsonData,
      uploadedBy ?? "admin",
    );
    res.json(result);
  } catch (err) {
    if (err instanceof UploadError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    logger.error({ err, runResultId }, "admin-manual-scripts: upload failed");
    res.status(500).json({ error: "Failed to process uploaded results" });
  }
});

// ── GET /api/admin/manual-scripts/:runResultId/download ───────────────────────
// Regenerates and serves the .ps1 script for a previously-created run result.

router.get("/admin/manual-scripts/:runResultId/download", requireAdmin, async (req: Request, res: Response) => {
  const runResultId = parseInt(String(req.params.runResultId));
  if (isNaN(runResultId)) {
    res.status(400).json({ error: "Invalid runResultId" });
    return;
  }

  try {
    const [runResult] = await db
      .select()
      .from(scriptRunResultsTable)
      .where(eq(scriptRunResultsTable.id, runResultId))
      .limit(1);

    if (!runResult) {
      res.status(404).json({ error: "Run result not found" });
      return;
    }

    const [script] = await db
      .select()
      .from(scriptCatalogTable)
      .where(eq(scriptCatalogTable.id, runResult.scriptId))
      .limit(1);

    if (!script) {
      res.status(404).json({ error: "Script not found" });
      return;
    }

    let customerDisplayName: string | undefined;
    if (runResult.customerId) {
      const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, runResult.customerId)).limit(1);
      customerDisplayName = user?.name ?? undefined;
    }

    const pkg = generateManualScriptPackage({
      scriptId: script.id,
      scriptName: script.name,
      description: script.description,
      manualRequirements: Array.isArray(script.manualRequirements) ? script.manualRequirements as string[] : [],
      psScriptBody: script.psScriptBody ?? null,
      runResultId,
      customerDisplayName,
      uploadBaseUrl: getUploadBaseUrl(),
    });

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${pkg.filename}"`);
    res.send(pkg.psContent);
  } catch (err) {
    logger.error({ err, runResultId }, "admin-manual-scripts: download failed");
    res.status(500).json({ error: "Failed to generate script download" });
  }
});

// ── GET /api/admin/manual-scripts/:runResultId/instructions ───────────────────
// Serves the plain-text instruction document for a previously-created run result.

router.get("/admin/manual-scripts/:runResultId/instructions", requireAdmin, async (req: Request, res: Response) => {
  const runResultId = parseInt(String(req.params.runResultId));
  if (isNaN(runResultId)) {
    res.status(400).json({ error: "Invalid runResultId" });
    return;
  }

  try {
    const [runResult] = await db
      .select()
      .from(scriptRunResultsTable)
      .where(eq(scriptRunResultsTable.id, runResultId))
      .limit(1);

    if (!runResult) {
      res.status(404).json({ error: "Run result not found" });
      return;
    }

    const [script] = await db
      .select()
      .from(scriptCatalogTable)
      .where(eq(scriptCatalogTable.id, runResult.scriptId))
      .limit(1);

    if (!script) {
      res.status(404).json({ error: "Script not found" });
      return;
    }

    let customerDisplayName: string | undefined;
    if (runResult.customerId) {
      const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, runResult.customerId)).limit(1);
      customerDisplayName = user?.name ?? undefined;
    }

    const pkg = generateManualScriptPackage({
      scriptId: script.id,
      scriptName: script.name,
      description: script.description,
      manualRequirements: Array.isArray(script.manualRequirements) ? script.manualRequirements as string[] : [],
      psScriptBody: script.psScriptBody ?? null,
      runResultId,
      customerDisplayName,
      uploadBaseUrl: getUploadBaseUrl(),
    });

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="instructions_${runResultId}.txt"`);
    res.send(pkg.instructions);
  } catch (err) {
    logger.error({ err, runResultId }, "admin-manual-scripts: instructions failed");
    res.status(500).json({ error: "Failed to generate instructions" });
  }
});

// ── GET /api/admin/manual-scripts/:scriptId/status ────────────────────────────

router.get("/admin/manual-scripts/:scriptId/status", requireAdmin, async (req: Request, res: Response) => {
  const scriptId = parseInt(String(req.params.scriptId));
  if (isNaN(scriptId)) {
    res.status(400).json({ error: "Invalid scriptId" });
    return;
  }

  const customerId = req.query.customerId ? parseInt(String(req.query.customerId)) : undefined;

  try {
    const conditions = [
      eq(scriptRunResultsTable.scriptId, scriptId),
      eq(scriptRunResultsTable.executionSource, "manual"),
    ];

    if (customerId && !isNaN(customerId)) {
      conditions.push(eq(scriptRunResultsTable.customerId, customerId));
    }

    const [latest] = await db
      .select({
        id: scriptRunResultsTable.id,
        status: scriptRunResultsTable.status,
        uploadedAt: scriptRunResultsTable.uploadedAt,
        uploadedBy: scriptRunResultsTable.uploadedBy,
        createdAt: scriptRunResultsTable.createdAt,
      })
      .from(scriptRunResultsTable)
      .where(and(...conditions))
      .orderBy(desc(scriptRunResultsTable.createdAt))
      .limit(1);

    if (!latest) {
      res.json({ scriptId, status: "not_started", runResultId: null });
      return;
    }

    res.json({
      scriptId,
      runResultId: latest.id,
      status: latest.status as "awaiting_upload" | "completed" | "not_started",
      uploadedAt: latest.uploadedAt,
      uploadedBy: latest.uploadedBy,
      createdAt: latest.createdAt,
    });
  } catch (err) {
    logger.error({ err, scriptId }, "admin-manual-scripts: status check failed");
    res.status(500).json({ error: "Failed to check manual script status" });
  }
});

export default router;
