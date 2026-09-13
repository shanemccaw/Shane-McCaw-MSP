/**
 * admin-manual-scripts.ts
 *
 * Backend for the manual-execution-and-upload flow surfaced by
 * `AwaitingUploadActions` in the Admin Panel's `RunResultDetailPanel.tsx`
 * (Git #3845 — these two routes were called by the UI but never registered).
 *
 * GET  /api/admin/manual-scripts/:id/download — regenerates and streams the
 *   .ps1 for a `script_run_results` row created by the manual-execution flow
 *   (`executionSource: "manual"`), built from the library script it was
 *   assigned (`library_script_id` on `powershell_scripts`).
 * POST /api/admin/manual-scripts/:id/upload   — accepts the pasted JSON
 *   output and hands it to `processManualScriptUpload` (already fully built
 *   in `manual-script-upload.ts` — AI analysis, score/profile side-effects,
 *   Kanban card completion — just never wired to a route until now).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, scriptRunResultsTable, powershellScriptsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "workflow.script" });
import { generateManualScriptPackage } from "../lib/manual-script-package.ts";
import { processManualScriptUpload, UploadError } from "../lib/manual-script-upload.ts";

const router: IRouter = Router();

function buildUploadBaseUrl(): string {
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (domain) return `https://${domain}`;
  return process.env.API_BASE_URL ?? "http://localhost:8080";
}

function parseRunResultId(raw: unknown): number | null {
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

// ── GET /api/admin/manual-scripts/:id/download ────────────────────────────────

router.get("/admin/manual-scripts/:id/download", requireAdmin, async (req: Request, res: Response) => {
  const runResultId = parseRunResultId(req.params.id);
  if (runResultId === null) {
    res.status(400).json({ error: "Invalid run result id" });
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
    if (runResult.executionSource !== "manual") {
      res.status(400).json({ error: "This run result was not created by the manual execution flow" });
      return;
    }
    if (!runResult.libraryScriptId) {
      res.status(404).json({ error: "No library script is linked to this run result" });
      return;
    }

    const [libraryScript] = await db
      .select()
      .from(powershellScriptsTable)
      .where(eq(powershellScriptsTable.id, runResult.libraryScriptId))
      .limit(1);

    if (!libraryScript) {
      res.status(404).json({ error: "Linked library script no longer exists" });
      return;
    }

    let customerDisplayName: string | undefined;
    if (runResult.customerId) {
      const [customer] = await db
        .select({ name: usersTable.name, email: usersTable.email })
        .from(usersTable)
        .where(eq(usersTable.id, runResult.customerId))
        .limit(1);
      customerDisplayName = customer?.name ?? customer?.email ?? undefined;
    }

    const manualRequirements = libraryScript.permissions?.notes
      ? [libraryScript.permissions.notes]
      : [];

    const { psContent, filename } = generateManualScriptPackage({
      scriptId: 0,
      scriptName: libraryScript.title,
      description: libraryScript.description,
      manualRequirements,
      psScriptBody: libraryScript.scriptBody,
      runResultId,
      customerDisplayName,
      uploadBaseUrl: buildUploadBaseUrl(),
    });

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(psContent);

    log.info({ runResultId, libraryScriptId: runResult.libraryScriptId }, "admin-manual-scripts: script downloaded");
  } catch (err) {
    log.error({ err, runResultId }, "admin-manual-scripts: download failed");
    res.status(500).json({ error: "Failed to generate script download" });
  }
});

// ── POST /api/admin/manual-scripts/:id/upload ─────────────────────────────────

router.post("/admin/manual-scripts/:id/upload", requireAdmin, async (req: Request, res: Response) => {
  const runResultId = parseRunResultId(req.params.id);
  if (runResultId === null) {
    res.status(400).json({ error: "Invalid run result id" });
    return;
  }

  const jsonData = (req.body as { jsonData?: unknown } | undefined)?.jsonData;
  if (!jsonData || typeof jsonData !== "object" || Array.isArray(jsonData)) {
    res.status(400).json({ error: "Request body must include a jsonData object" });
    return;
  }

  const uploadedBy = req.user?.email ?? req.user?.name ?? "admin";

  try {
    const result = await processManualScriptUpload(runResultId, jsonData as Record<string, unknown>, uploadedBy);
    log.info({ runResultId, uploadedBy }, "admin-manual-scripts: results uploaded and processed");
    res.json(result);
  } catch (err) {
    if (err instanceof UploadError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    log.error({ err, runResultId }, "admin-manual-scripts: upload processing failed");
    res.status(500).json({ error: "Failed to process uploaded results" });
  }
});

export default router;
