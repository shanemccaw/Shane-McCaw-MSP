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
  clientScoresTable,
  clientM365ProfilesTable,
  usersTable,
} from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { runAiAnalyzer } from "../lib/ai-analyzer";
import { generateManualScriptPackage } from "../lib/manual-script-package";

const router: IRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function clampScore(current: number, delta: number): number {
  return Math.max(0, Math.min(100, current + delta));
}

async function applyScoreImpact(clientId: number, scoreImpact: Record<string, number>): Promise<void> {
  if (Object.keys(scoreImpact).length === 0) return;

  const [existing] = await db
    .select()
    .from(clientScoresTable)
    .where(eq(clientScoresTable.clientId, clientId))
    .limit(1);

  const base = {
    identity: existing?.identity ?? 0,
    security: existing?.security ?? 0,
    collaboration: existing?.collaboration ?? 0,
    compliance: existing?.compliance ?? 0,
    copilotReadiness: existing?.copilotReadiness ?? 0,
  };

  const updated = {
    identity: scoreImpact.identity !== undefined ? clampScore(base.identity, scoreImpact.identity) : base.identity,
    security: scoreImpact.security !== undefined ? clampScore(base.security, scoreImpact.security) : base.security,
    collaboration: scoreImpact.collaboration !== undefined ? clampScore(base.collaboration, scoreImpact.collaboration) : base.collaboration,
    compliance: scoreImpact.compliance !== undefined ? clampScore(base.compliance, scoreImpact.compliance) : base.compliance,
    copilotReadiness: scoreImpact.copilotReadiness !== undefined ? clampScore(base.copilotReadiness, scoreImpact.copilotReadiness) : base.copilotReadiness,
  };

  if (existing) {
    await db.update(clientScoresTable).set({ ...updated, updatedAt: new Date() }).where(eq(clientScoresTable.clientId, clientId));
  } else {
    await db.insert(clientScoresTable).values({ clientId, ...updated });
  }
}

async function applyProfileUpdates(clientId: number, profileUpdates: Record<string, unknown>): Promise<void> {
  if (Object.keys(profileUpdates).length === 0) return;

  const [existing] = await db
    .select()
    .from(clientM365ProfilesTable)
    .where(eq(clientM365ProfilesTable.clientId, clientId))
    .limit(1);

  if (existing) {
    const merged = { ...(existing.profile as Record<string, unknown> ?? {}), ...profileUpdates };
    await db.update(clientM365ProfilesTable).set({ profile: merged, updatedAt: new Date() }).where(eq(clientM365ProfilesTable.clientId, clientId));
  } else {
    await db.insert(clientM365ProfilesTable).values({ clientId, profile: profileUpdates });
  }
}

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

    res.json({
      runResultId,
      scriptId,
      scriptName: script.name,
      filename: pkg.filename,
      psContent: pkg.psContent,
      instructions: pkg.instructions,
      uploadUrl: `${getUploadBaseUrl()}/api/admin/manual-scripts/${runResultId}/upload`,
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

    if (runResult.status === "completed") {
      res.status(409).json({ error: "Results have already been uploaded for this run — to re-process, create a new package" });
      return;
    }

    const [script] = await db
      .select()
      .from(scriptCatalogTable)
      .where(eq(scriptCatalogTable.id, runResult.scriptId))
      .limit(1);

    const scriptOutput = JSON.stringify(jsonData, null, 2);

    let aiResult = {
      findings: [] as string[],
      recommendations: [] as string[],
      scoreImpact: {} as Record<string, number>,
      profileUpdates: {} as Record<string, unknown>,
    };

    try {
      aiResult = await runAiAnalyzer({
        scriptOutput,
        aiInstructions: script?.aiInstructions ?? "",
        packageContext: runResult.packageId ? `Package ${runResult.packageId}` : "Manual script upload",
      });
    } catch (aiErr) {
      logger.warn({ aiErr, runResultId }, "admin-manual-scripts: AI analysis failed (non-fatal)");
    }

    await db
      .update(scriptRunResultsTable)
      .set({
        rawOutput: jsonData,
        parsedFindings: aiResult.findings,
        recommendations: aiResult.recommendations,
        scoreImpact: aiResult.scoreImpact,
        profileUpdates: aiResult.profileUpdates,
        status: "completed",
        uploadedBy: uploadedBy ?? null,
        uploadedAt: new Date(),
      })
      .where(eq(scriptRunResultsTable.id, runResultId));

    if (runResult.customerId) {
      try {
        await applyScoreImpact(runResult.customerId, aiResult.scoreImpact);
      } catch (err) {
        logger.warn({ err, customerId: runResult.customerId }, "admin-manual-scripts: score impact failed (non-fatal)");
      }
      try {
        await applyProfileUpdates(runResult.customerId, aiResult.profileUpdates);
      } catch (err) {
        logger.warn({ err, customerId: runResult.customerId }, "admin-manual-scripts: profile updates failed (non-fatal)");
      }
    }

    logger.info({ runResultId, scriptId: runResult.scriptId }, "admin-manual-scripts: upload processed");

    res.json({
      runResultId,
      scriptId: runResult.scriptId,
      status: "completed",
      findings: aiResult.findings,
      recommendations: aiResult.recommendations,
      scoreImpact: aiResult.scoreImpact,
    });
  } catch (err) {
    logger.error({ err, runResultId }, "admin-manual-scripts: upload failed");
    res.status(500).json({ error: "Failed to process uploaded results" });
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
