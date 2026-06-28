/**
 * admin-m365-run.ts
 *
 * Script and package execution pipeline for the M365 Command Center.
 *
 * POST /api/admin/run-script        — execute a single cataloged script
 * POST /api/admin/run-package       — run all scripts in a package in order
 * POST /api/admin/scores/update     — directly upsert client M365 scores
 * POST /api/admin/profile/update    — merge partial updates into client M365 profile
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import {
  db,
  scriptCatalogTable,
  packageScriptsTable,
  scriptRunResultsTable,
  clientScoresTable,
  clientM365ProfilesTable,
  clientHealthHistoryTable,
  azureTenantCredentialsTable,
  usersTable,
  servicesTable,
} from "@workspace/db";
import { eq, asc, desc, and, isNull, isNotNull, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { createRunbookJob, getJobStatus, getJobOutput, isTerminalStatus } from "../lib/azure-automation";
import { runAiAnalyzer } from "../lib/ai-analyzer";
import { getSecretValue } from "../lib/azure-keyvault";
import { classifyScripts } from "../lib/classify-scripts";
import { generateManualScriptPackage } from "../lib/manual-script-package";

const router: IRouter = Router();

// ── Zod schemas ────────────────────────────────────────────────────────────────

const runScriptSchema = z.union([
  z.object({
    scriptId: z.number().int().positive(),
    customerId: z.number().int().positive().optional(),
    credentialId: z.number().int().positive(),
    packageId: z.number().int().positive().optional(),
    packageContext: z.string().optional(),
  }),
  z.object({
    scriptId: z.number().int().positive(),
    customerId: z.number().int().positive().optional(),
    tenantId: z.string().min(1),
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
    packageId: z.number().int().positive().optional(),
    packageContext: z.string().optional(),
  }),
]);

const runPackageSchema = z.union([
  z.object({
    packageId: z.number().int().positive(),
    credentialId: z.number().int().positive().optional(),
    customerId: z.number().int().positive().optional(),
    packageContext: z.string().optional(),
  }),
  z.object({
    packageId: z.number().int().positive(),
    tenantId: z.string().min(1),
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
    customerId: z.number().int().positive().optional(),
    packageContext: z.string().optional(),
  }),
]);

const updateScoresSchema = z.object({
  clientId: z.number().int().positive(),
  identity: z.number().int().min(0).max(100).optional(),
  security: z.number().int().min(0).max(100).optional(),
  collaboration: z.number().int().min(0).max(100).optional(),
  compliance: z.number().int().min(0).max(100).optional(),
  copilotReadiness: z.number().int().min(0).max(100).optional(),
});

const updateProfileSchema = z.object({
  clientId: z.number().int().positive(),
  updates: z.record(z.unknown()),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Poll until the job reaches a terminal status, with configurable timeout. */
async function waitForJobCompletion(jobId: string, timeoutMs = 300_000): Promise<{ status: string; output: string }> {
  const deadline = Date.now() + timeoutMs;
  const POLL_INTERVAL_MS = 5_000;

  while (Date.now() < deadline) {
    const jobStatus = await getJobStatus(jobId);
    if (isTerminalStatus(jobStatus.status)) {
      const lines = await getJobOutput(jobId);
      return {
        status: jobStatus.status,
        output: lines.map(l => l.text).join("\n"),
      };
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`Job ${jobId} did not complete within ${timeoutMs / 1000}s`);
}

/** Clamp a score to [0, 100]. */
function clampScore(current: number, delta: number): number {
  return Math.max(0, Math.min(100, current + delta));
}

/** Apply score deltas to existing client_scores row. */
async function applyScoreImpact(
  clientId: number,
  scoreImpact: Record<string, number>,
): Promise<void> {
  if (Object.keys(scoreImpact).length === 0) return;

  // Fetch existing scores (or defaults)
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
    await db
      .update(clientScoresTable)
      .set({ ...updated, updatedAt: new Date() })
      .where(eq(clientScoresTable.clientId, clientId));
  } else {
    await db
      .insert(clientScoresTable)
      .values({ clientId, ...updated });
  }

  // Snapshot into client_health_history so the portal scorecard reflects the change.
  // client_health_history uses "copilot" for what client_scores calls "copilotReadiness".
  const categoryMap: Array<{ historyKey: "identity" | "security" | "collaboration" | "compliance" | "copilot"; score: number }> = [
    { historyKey: "identity",      score: updated.identity },
    { historyKey: "security",      score: updated.security },
    { historyKey: "collaboration", score: updated.collaboration },
    { historyKey: "compliance",    score: updated.compliance },
    { historyKey: "copilot",       score: updated.copilotReadiness },
  ];

  const now = new Date();
  await db.insert(clientHealthHistoryTable).values(
    categoryMap.map(({ historyKey, score }) => ({
      clientId,
      category: historyKey,
      score,
      recordedAt: now,
    }))
  );
}

/** Merge profileUpdates into client_m365_profiles. */
async function applyProfileUpdates(
  clientId: number,
  profileUpdates: Record<string, unknown>,
): Promise<void> {
  if (Object.keys(profileUpdates).length === 0) return;

  const [existing] = await db
    .select()
    .from(clientM365ProfilesTable)
    .where(eq(clientM365ProfilesTable.clientId, clientId))
    .limit(1);

  if (existing) {
    const merged = { ...(existing.profile as Record<string, unknown> ?? {}), ...profileUpdates };
    await db
      .update(clientM365ProfilesTable)
      .set({ profile: merged, updatedAt: new Date() })
      .where(eq(clientM365ProfilesTable.clientId, clientId));
  } else {
    await db
      .insert(clientM365ProfilesTable)
      .values({ clientId, profile: profileUpdates });
  }
}

// ── Background job processor (detached — no await) ────────────────────────────

async function processRunInBackground(
  runResultId: number,
  jobId: string,
  scriptId: number,
  customerId: number | undefined,
  packageContext: string,
  aiInstructions: string,
): Promise<void> {
  let jobOutput: string;
  let jobStatus: string;
  try {
    ({ status: jobStatus, output: jobOutput } = await waitForJobCompletion(jobId));
  } catch (err) {
    logger.error({ err, jobId }, "admin-m365-run: background job polling timed out or failed");
    await db
      .update(scriptRunResultsTable)
      .set({ status: "failed", rawOutput: { error: String(err) } })
      .where(eq(scriptRunResultsTable.id, runResultId));
    return;
  }

  const finalStatus: "completed" | "failed" = jobStatus === "Completed" ? "completed" : "failed";

  let aiResult = { findings: [] as string[], recommendations: [] as string[], scoreImpact: {} as Record<string, number>, profileUpdates: {} as Record<string, unknown> };
  if (jobOutput.trim()) {
    try {
      aiResult = await runAiAnalyzer({
        scriptOutput: jobOutput,
        aiInstructions,
        packageContext,
      });
    } catch (err) {
      logger.warn({ err, scriptId, jobId }, "admin-m365-run: AI analysis failed (non-fatal)");
    }
  }

  await db
    .update(scriptRunResultsTable)
    .set({
      rawOutput: { output: jobOutput, jobStatus },
      parsedFindings: aiResult.findings,
      recommendations: aiResult.recommendations,
      scoreImpact: aiResult.scoreImpact,
      profileUpdates: aiResult.profileUpdates,
      status: finalStatus,
    })
    .where(eq(scriptRunResultsTable.id, runResultId));

  if (customerId) {
    try {
      await applyScoreImpact(customerId, aiResult.scoreImpact);
    } catch (err) {
      logger.warn({ err, customerId }, "admin-m365-run: failed to apply score impact (non-fatal)");
    }
    try {
      await applyProfileUpdates(customerId, aiResult.profileUpdates);
    } catch (err) {
      logger.warn({ err, customerId }, "admin-m365-run: failed to apply profile updates (non-fatal)");
    }
  }

  logger.info({ runResultId, jobId, finalStatus }, "admin-m365-run: background job processing complete");
}

// ── POST /api/admin/run-script ────────────────────────────────────────────────

router.post("/admin/run-script", requireAdmin, async (req: Request, res: Response) => {
  const parsed = runScriptSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  const { scriptId, packageId, packageContext } = parsed.data;

  // Resolve credentials — either from credentialId (Key Vault) or raw fields
  let tenantId: string;
  let clientId: string;
  let clientSecret: string;
  let customerId: number | undefined = parsed.data.customerId;

  if ("credentialId" in parsed.data) {
    const [cred] = await db
      .select()
      .from(azureTenantCredentialsTable)
      .where(eq(azureTenantCredentialsTable.id, parsed.data.credentialId))
      .limit(1);
    if (!cred) {
      res.status(404).json({ error: "Credential not found" });
      return;
    }
    // Derive customerId from the credential's linked user if not explicitly provided
    if (!customerId && cred.clientUserId) {
      customerId = cred.clientUserId;
    }
    try {
      clientSecret = await getSecretValue(cred.keyVaultSecretName);
    } catch (err) {
      logger.error({ err, credentialId: parsed.data.credentialId }, "admin-m365-run: failed to fetch secret from Key Vault");
      res.status(502).json({ error: "Failed to retrieve client secret from Key Vault" });
      return;
    }
    tenantId = cred.tenantId;
    clientId = cred.clientId;
  } else {
    tenantId = parsed.data.tenantId;
    clientId = parsed.data.clientId;
    clientSecret = parsed.data.clientSecret;
  }

  // Fetch script
  const [script] = await db
    .select()
    .from(scriptCatalogTable)
    .where(eq(scriptCatalogTable.id, scriptId))
    .limit(1);

  if (!script) {
    res.status(404).json({ error: `Script ${scriptId} not found in catalog` });
    return;
  }

  // Create a placeholder run result row
  let runResultId: number;
  try {
    const [row] = await db
      .insert(scriptRunResultsTable)
      .values({
        customerId: customerId ?? null,
        scriptId,
        packageId: packageId ?? null,
        status: "running",
      })
      .returning({ id: scriptRunResultsTable.id });
    runResultId = row.id;
  } catch (err) {
    logger.error({ err, scriptId }, "admin-m365-run: failed to create run result placeholder");
    res.status(500).json({ error: "Failed to initialize run result" });
    return;
  }

  // Trigger runbook
  let jobId: string;
  try {
    const job = await createRunbookJob({
      runbookName: script.runbookName,
      parameters: {
        TenantId: tenantId,
        ClientId: clientId,
        ClientSecret: clientSecret,
      },
    });
    jobId = job.jobId;
  } catch (err) {
    logger.error({ err, runbookName: script.runbookName }, "admin-m365-run: runbook job creation failed");
    await db
      .update(scriptRunResultsTable)
      .set({ status: "failed", rawOutput: { error: String(err) } })
      .where(eq(scriptRunResultsTable.id, runResultId));
    res.status(502).json({ error: `Azure Automation error: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }

  // Store jobId
  await db
    .update(scriptRunResultsTable)
    .set({ jobId })
    .where(eq(scriptRunResultsTable.id, runResultId));

  // Kick off background processing (detached — do NOT await)
  void processRunInBackground(
    runResultId,
    jobId,
    scriptId,
    customerId,
    packageContext ?? "",
    script.aiInstructions ?? "",
  );

  // Return immediately so the client can start polling
  res.json({ jobRef: jobId, resultId: runResultId, scriptId, status: "running" });
});

// ── GET /api/admin/run-script/:jobRef/status ──────────────────────────────────

router.get("/admin/run-script/:jobRef/status", requireAdmin, async (req: Request, res: Response) => {
  const jobRef = String(req.params.jobRef ?? "");
  if (!jobRef) {
    res.status(400).json({ error: "Missing jobRef" });
    return;
  }

  try {
    const [row] = await db
      .select({
        id: scriptRunResultsTable.id,
        status: scriptRunResultsTable.status,
        parsedFindings: scriptRunResultsTable.parsedFindings,
        recommendations: scriptRunResultsTable.recommendations,
        scoreImpact: scriptRunResultsTable.scoreImpact,
        rawOutput: scriptRunResultsTable.rawOutput,
      })
      .from(scriptRunResultsTable)
      .where(eq(scriptRunResultsTable.jobId, jobRef))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    // Fetch live output lines from Azure while still running
    let outputLines: string[] = [];
    if (row.status === "running") {
      try {
        const lines = await getJobOutput(jobRef);
        outputLines = lines.map(l => l.text).filter(Boolean);
      } catch (err) {
        logger.warn({ err, jobRef }, "admin-m365-run: failed to fetch job output during polling (non-fatal)");
      }
    } else {
      // Job is terminal — serve output from the stored rawOutput
      const raw = row.rawOutput as Record<string, unknown> | null;
      const stored = typeof raw?.output === "string" ? raw.output : "";
      if (stored) {
        outputLines = stored
          .replace(/\r\n/g, "\n")
          .replace(/\r/g, "\n")
          .split("\n")
          .filter(Boolean);
      }
    }

    res.json({
      status: row.status,
      outputLines,
      findings: row.parsedFindings ?? [],
      recommendations: row.recommendations ?? [],
      scoreImpact: row.scoreImpact ?? {},
    });
  } catch (err) {
    logger.error({ err, jobRef }, "admin-m365-run: failed to get job status");
    res.status(500).json({ error: "Failed to get job status" });
  }
});

// ── GET /api/admin/clients/:id/scores ─────────────────────────────────────────

router.get("/admin/clients/:id/scores", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid client id" });
    return;
  }

  try {
    const [row] = await db
      .select()
      .from(clientScoresTable)
      .where(eq(clientScoresTable.clientId, id))
      .limit(1);

    res.json({
      identity:         row?.identity         ?? 0,
      security:         row?.security         ?? 0,
      collaboration:    row?.collaboration    ?? 0,
      compliance:       row?.compliance       ?? 0,
      copilotReadiness: row?.copilotReadiness ?? 0,
    });
  } catch (err) {
    logger.error({ err, clientId: id }, "admin-m365-run: failed to fetch client scores");
    res.status(500).json({ error: "Failed to fetch client scores" });
  }
});

// ── GET /api/admin/script-run-results ────────────────────────────────────────

router.get("/admin/script-run-results", requireAdmin, async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? "200")), 500);

  try {
    const rows = await db
      .select({
        id: scriptRunResultsTable.id,
        customerId: scriptRunResultsTable.customerId,
        scriptId: scriptRunResultsTable.scriptId,
        packageId: scriptRunResultsTable.packageId,
        jobId: scriptRunResultsTable.jobId,
        rawOutput: scriptRunResultsTable.rawOutput,
        parsedFindings: scriptRunResultsTable.parsedFindings,
        recommendations: scriptRunResultsTable.recommendations,
        scoreImpact: scriptRunResultsTable.scoreImpact,
        profileUpdates: scriptRunResultsTable.profileUpdates,
        status: scriptRunResultsTable.status,
        executionSource: scriptRunResultsTable.executionSource,
        uploadedBy: scriptRunResultsTable.uploadedBy,
        uploadedAt: scriptRunResultsTable.uploadedAt,
        reviewedAt: scriptRunResultsTable.reviewedAt,
        createdAt: scriptRunResultsTable.createdAt,
        scriptName: scriptCatalogTable.name,
        clientName: usersTable.name,
        packageName: servicesTable.name,
      })
      .from(scriptRunResultsTable)
      .leftJoin(scriptCatalogTable, eq(scriptRunResultsTable.scriptId, scriptCatalogTable.id))
      .leftJoin(usersTable, eq(scriptRunResultsTable.customerId, usersTable.id))
      .leftJoin(servicesTable, eq(scriptRunResultsTable.packageId, servicesTable.id))
      .orderBy(desc(scriptRunResultsTable.createdAt))
      .limit(limit);

    res.json(rows);
  } catch (err) {
    logger.error({ err }, "admin-m365-run: failed to list script run results");
    res.status(500).json({ error: "Failed to list script run results" });
  }
});

// ── PATCH /api/admin/script-run-results/:id/mark-reviewed ────────────────────

router.patch("/admin/script-run-results/:id/mark-reviewed", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  try {
    const [updated] = await db
      .update(scriptRunResultsTable)
      .set({ reviewedAt: sql`now()` })
      .where(eq(scriptRunResultsTable.id, id))
      .returning({ id: scriptRunResultsTable.id, reviewedAt: scriptRunResultsTable.reviewedAt });

    if (!updated) {
      res.status(404).json({ error: "Script run result not found" });
      return;
    }

    res.json(updated);
  } catch (err) {
    logger.error({ err }, "admin-m365-run: failed to mark script run result reviewed");
    res.status(500).json({ error: "Failed to mark as reviewed" });
  }
});

// ── POST /api/admin/script-run-results/:id/apply-to-client ───────────────────

router.post("/admin/script-run-results/:id/apply-to-client", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  try {
    const [row] = await db
      .select({
        customerId: scriptRunResultsTable.customerId,
        scoreImpact: scriptRunResultsTable.scoreImpact,
        profileUpdates: scriptRunResultsTable.profileUpdates,
      })
      .from(scriptRunResultsTable)
      .where(eq(scriptRunResultsTable.id, id))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Script run result not found" });
      return;
    }

    if (!row.customerId) {
      res.status(400).json({ error: "This result has no client linked — cannot apply scores" });
      return;
    }

    const scoreImpact = (row.scoreImpact ?? {}) as Record<string, number>;
    const profileUpdates = (row.profileUpdates ?? {}) as Record<string, unknown>;

    await applyScoreImpact(row.customerId, scoreImpact);
    await applyProfileUpdates(row.customerId, profileUpdates);

    res.json({
      ok: true,
      appliedScores: Object.keys(scoreImpact).length,
      appliedProfileFields: Object.keys(profileUpdates).length,
    });
  } catch (err) {
    logger.error({ err }, "admin-m365-run: failed to apply run result to client");
    res.status(500).json({ error: "Failed to apply result to client" });
  }
});

// ── POST /api/admin/script-run-results/:id/apply-raw-to-profile ──────────────
// Parses the raw script output as JSON and merges the fields directly into the
// client's M365 profile — no AI intermediary.

router.post("/admin/script-run-results/:id/apply-raw-to-profile", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  try {
    const [row] = await db
      .select({
        customerId: scriptRunResultsTable.customerId,
        rawOutput: scriptRunResultsTable.rawOutput,
        status: scriptRunResultsTable.status,
      })
      .from(scriptRunResultsTable)
      .where(eq(scriptRunResultsTable.id, id))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Script run result not found" });
      return;
    }

    if (!row.customerId) {
      res.status(400).json({ error: "This result has no client linked — cannot update profile" });
      return;
    }

    // Extract the raw output string or object
    const rawOutput = row.rawOutput as Record<string, unknown> | null;
    if (!rawOutput) {
      res.status(400).json({ error: "No raw output to apply" });
      return;
    }

    // The raw output is stored as { output: "<string>", jobStatus: "..." }.
    // Try to parse the inner output string as JSON first; fall back to using
    // the rawOutput object itself if it already looks like profile data.
    let profileData: Record<string, unknown>;
    const outputStr = rawOutput.output;
    if (typeof outputStr === "string") {
      try {
        const parsed = JSON.parse(outputStr) as unknown;
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          profileData = parsed as Record<string, unknown>;
        } else {
          res.status(400).json({ error: "Raw output is not a JSON object — cannot apply to profile" });
          return;
        }
      } catch {
        res.status(400).json({ error: "Raw output is not valid JSON — cannot apply to profile" });
        return;
      }
    } else if (typeof rawOutput === "object") {
      // rawOutput itself is already the profile object (manual upload path)
      const { output: _o, jobStatus: _j, ...rest } = rawOutput;
      if (Object.keys(rest).length === 0) {
        res.status(400).json({ error: "No profile fields found in raw output" });
        return;
      }
      profileData = rest;
    } else {
      res.status(400).json({ error: "Unexpected raw output format" });
      return;
    }

    await applyProfileUpdates(row.customerId, profileData);

    res.json({
      ok: true,
      appliedProfileFields: Object.keys(profileData).length,
      fields: Object.keys(profileData),
    });
  } catch (err) {
    logger.error({ err }, "admin-m365-run: failed to apply raw output to profile");
    res.status(500).json({ error: "Failed to apply raw output to profile" });
  }
});

// ── POST /api/admin/run-package ───────────────────────────────────────────────

router.post("/admin/run-package", requireAdmin, async (req: Request, res: Response) => {
  const parsed = runPackageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  const { packageId, customerId, packageContext } = parsed.data;

  // Fetch scripts first so we know whether any automated scripts need credentials
  const packageScripts = await db
    .select({
      mappingId: packageScriptsTable.id,
      runOrder: packageScriptsTable.runOrder,
      script: scriptCatalogTable,
    })
    .from(packageScriptsTable)
    .innerJoin(scriptCatalogTable, eq(packageScriptsTable.scriptId, scriptCatalogTable.id))
    .where(eq(packageScriptsTable.packageId, packageId))
    .orderBy(asc(packageScriptsTable.runOrder));

  if (packageScripts.length === 0) {
    res.status(404).json({ error: `No scripts assigned to package ${packageId}` });
    return;
  }

  // Classify scripts into automated vs manual
  const classified = classifyScripts(packageScripts.map(ps => ({
    ...ps.script,
    _runOrder: ps.runOrder,
    _mappingId: ps.mappingId,
  })));

  const hasAutomatedScripts = classified.automated.length > 0;

  // Resolve Azure credentials only when there are automated scripts to run
  let tenantId = "";
  let clientId = "";
  let clientSecret = "";

  if (hasAutomatedScripts) {
    if ("credentialId" in parsed.data && parsed.data.credentialId) {
      const [cred] = await db
        .select()
        .from(azureTenantCredentialsTable)
        .where(eq(azureTenantCredentialsTable.id, parsed.data.credentialId))
        .limit(1);
      if (!cred) {
        res.status(404).json({ error: "Credential not found" });
        return;
      }
      try {
        clientSecret = await getSecretValue(cred.keyVaultSecretName);
      } catch (err) {
        logger.error({ err, credentialId: parsed.data.credentialId }, "admin-m365-run: failed to fetch secret from Key Vault");
        res.status(502).json({ error: "Failed to retrieve client secret from Key Vault" });
        return;
      }
      tenantId = cred.tenantId;
      clientId = cred.clientId;
    } else if ("tenantId" in parsed.data) {
      tenantId = parsed.data.tenantId;
      clientId = parsed.data.clientId;
      clientSecret = parsed.data.clientSecret;
    } else {
      res.status(400).json({ error: "This package contains automated scripts — either credentialId or tenantId/clientId/clientSecret must be provided" });
      return;
    }
  }

  const uploadBaseUrl = (() => {
    const domains = process.env.REPLIT_DOMAINS;
    if (domains) {
      const primary = domains.split(",")[0]?.trim();
      if (primary) return `https://${primary}`;
    }
    return process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://localhost:8080";
  })();

  const results: Array<{
    scriptId: number;
    scriptName: string;
    runOrder: number;
    runResultId: number;
    jobId: string | null;
    status: string;
    executionMode: "automated" | "manual";
    findings: string[];
    recommendations: string[];
    scoreImpact: Record<string, number>;
    psContent?: string;
    instructions?: string;
    filename?: string;
    uploadUrl?: string;
    reused?: boolean;
    packageCreatedAt?: string;
  }> = [];

  // ── Automated scripts — run via Azure Automation ──────────────────────────
  for (const { script, runOrder } of packageScripts.filter(ps => ps.script.executionMode !== "manual")) {
    logger.info({ scriptId: script.id, runOrder, packageId }, "admin-m365-run: executing automated package script");

    const [resultRow] = await db
      .insert(scriptRunResultsTable)
      .values({
        customerId: customerId ?? null,
        scriptId: script.id,
        packageId,
        status: "running",
        executionSource: "automated",
      })
      .returning({ id: scriptRunResultsTable.id });

    const runResultId = resultRow.id;
    let jobId: string | null = null;
    let scriptFindings: string[] = [];
    let scriptRecommendations: string[] = [];
    let scriptScoreImpact: Record<string, number> = {};
    let scriptProfileUpdates: Record<string, unknown> = {};
    let finalStatus: "completed" | "failed" = "failed";

    try {
      const job = await createRunbookJob({
        runbookName: script.runbookName,
        parameters: {
          TenantId: tenantId,
          ClientId: clientId,
          ClientSecret: clientSecret,
        },
      });
      jobId = job.jobId;

      await db
        .update(scriptRunResultsTable)
        .set({ jobId })
        .where(eq(scriptRunResultsTable.id, runResultId));

      const { status: jobStatus, output: jobOutput } = await waitForJobCompletion(jobId);
      finalStatus = jobStatus === "Completed" ? "completed" : "failed";

      if (jobOutput.trim()) {
        try {
          const aiResult = await runAiAnalyzer({
            scriptOutput: jobOutput,
            aiInstructions: script.aiInstructions ?? "",
            packageContext: packageContext ?? `Package ${packageId}`,
          });
          scriptFindings = aiResult.findings;
          scriptRecommendations = aiResult.recommendations;
          scriptScoreImpact = aiResult.scoreImpact;
          scriptProfileUpdates = aiResult.profileUpdates;
        } catch (aiErr) {
          logger.warn({ aiErr, scriptId: script.id }, "admin-m365-run: AI analysis failed for package script (non-fatal)");
        }
      }

      await db
        .update(scriptRunResultsTable)
        .set({
          rawOutput: { output: jobOutput, jobStatus },
          parsedFindings: scriptFindings,
          recommendations: scriptRecommendations,
          scoreImpact: scriptScoreImpact,
          profileUpdates: scriptProfileUpdates,
          status: finalStatus,
        })
        .where(eq(scriptRunResultsTable.id, runResultId));

      if (customerId) {
        try {
          await applyScoreImpact(customerId, scriptScoreImpact);
        } catch (err) {
          logger.warn({ err, customerId }, "admin-m365-run: score impact application failed (non-fatal)");
        }
        try {
          await applyProfileUpdates(customerId, scriptProfileUpdates);
        } catch (err) {
          logger.warn({ err, customerId }, "admin-m365-run: profile update application failed (non-fatal)");
        }
      }
    } catch (err) {
      logger.error({ err, scriptId: script.id, runOrder }, "admin-m365-run: automated package script execution failed");
      finalStatus = "failed";
      await db
        .update(scriptRunResultsTable)
        .set({ status: "failed", rawOutput: { error: String(err) } })
        .where(eq(scriptRunResultsTable.id, runResultId));
    }

    results.push({
      scriptId: script.id,
      scriptName: script.name,
      runOrder,
      runResultId,
      jobId,
      status: finalStatus,
      executionMode: "automated",
      findings: scriptFindings,
      recommendations: scriptRecommendations,
      scoreImpact: scriptScoreImpact,
    });
  }

  // ── Manual scripts — generate .ps1 package and enter awaiting_upload ────────
  for (const { script, runOrder } of packageScripts.filter(ps => ps.script.executionMode === "manual")) {
    logger.info({ scriptId: script.id, runOrder, packageId }, "admin-m365-run: creating manual script placeholder");

    let customerDisplayName: string | undefined;
    if (customerId) {
      try {
        const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, customerId)).limit(1);
        customerDisplayName = user?.name ?? undefined;
      } catch (_) { /* non-fatal */ }
    }

    // Deduplication: reuse an existing awaiting_upload row for the same
    // (scriptId, customerId, packageId) triple rather than creating orphans.
    const dedupConditions = [
      eq(scriptRunResultsTable.scriptId, script.id),
      eq(scriptRunResultsTable.status, "awaiting_upload"),
      eq(scriptRunResultsTable.executionSource, "manual"),
      customerId
        ? eq(scriptRunResultsTable.customerId, customerId)
        : isNull(scriptRunResultsTable.customerId),
      packageId
        ? eq(scriptRunResultsTable.packageId, packageId)
        : isNull(scriptRunResultsTable.packageId),
    ];

    const [existing] = await db
      .select({ id: scriptRunResultsTable.id, createdAt: scriptRunResultsTable.createdAt })
      .from(scriptRunResultsTable)
      .where(and(...dedupConditions))
      .limit(1);

    let runResultId: number;
    let packageCreatedAt: Date;
    const reused = !!existing;

    if (existing) {
      runResultId = existing.id;
      packageCreatedAt = existing.createdAt;
      logger.info({ scriptId: script.id, runResultId, customerId }, "admin-m365-run: reusing existing awaiting_upload row");
    } else {
      const [resultRow] = await db
        .insert(scriptRunResultsTable)
        .values({
          customerId: customerId ?? null,
          scriptId: script.id,
          packageId,
          status: "awaiting_upload",
          executionSource: "manual",
        })
        .returning({ id: scriptRunResultsTable.id, createdAt: scriptRunResultsTable.createdAt });
      runResultId = resultRow.id;
      packageCreatedAt = resultRow.createdAt;
    }

    const pkg = generateManualScriptPackage({
      scriptId: script.id,
      scriptName: script.name,
      description: script.description,
      manualRequirements: Array.isArray(script.manualRequirements) ? script.manualRequirements as string[] : [],
      psScriptBody: script.psScriptBody ?? null,
      runResultId,
      customerDisplayName,
      uploadBaseUrl,
    });

    results.push({
      scriptId: script.id,
      scriptName: script.name,
      runOrder,
      runResultId,
      jobId: null,
      status: "awaiting_upload",
      executionMode: "manual",
      findings: [],
      recommendations: [],
      scoreImpact: {},
      psContent: pkg.psContent,
      instructions: pkg.instructions,
      filename: pkg.filename,
      uploadUrl: `${uploadBaseUrl}/api/admin/manual-scripts/${runResultId}/upload`,
      reused,
      packageCreatedAt: packageCreatedAt.toISOString(),
    });
  }

  // Sort all results by runOrder to preserve original ordering
  results.sort((a, b) => a.runOrder - b.runOrder);

  const completedCount = results.filter(r => r.status === "completed").length;
  const failedCount = results.filter(r => r.status === "failed").length;
  const awaitingUploadCount = results.filter(r => r.status === "awaiting_upload").length;

  res.json({
    packageId,
    customerId: customerId ?? null,
    totalScripts: results.length,
    completedCount,
    failedCount,
    awaitingUploadCount,
    requiresManualExecution: classified.requiresManualExecution,
    results,
  });
});

// ── POST /api/admin/scores/update ─────────────────────────────────────────────

router.post("/admin/scores/update", requireAdmin, async (req: Request, res: Response) => {
  const parsed = updateScoresSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  const { clientId, ...scoreFields } = parsed.data;

  if (Object.keys(scoreFields).length === 0) {
    res.status(400).json({ error: "At least one score field is required" });
    return;
  }

  try {
    const [existing] = await db
      .select()
      .from(clientScoresTable)
      .where(eq(clientScoresTable.clientId, clientId))
      .limit(1);

    let row;
    if (existing) {
      [row] = await db
        .update(clientScoresTable)
        .set({ ...scoreFields, updatedAt: new Date() })
        .where(eq(clientScoresTable.clientId, clientId))
        .returning();
    } else {
      [row] = await db
        .insert(clientScoresTable)
        .values({
          clientId,
          identity: scoreFields.identity ?? 0,
          security: scoreFields.security ?? 0,
          collaboration: scoreFields.collaboration ?? 0,
          compliance: scoreFields.compliance ?? 0,
          copilotReadiness: scoreFields.copilotReadiness ?? 0,
        })
        .returning();
    }

    res.json(row);
  } catch (err) {
    logger.error({ err, clientId }, "admin-m365-run: failed to update client scores");
    res.status(500).json({ error: "Failed to update client scores" });
  }
});

// ── POST /api/admin/profile/update ────────────────────────────────────────────

router.post("/admin/profile/update", requireAdmin, async (req: Request, res: Response) => {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  const { clientId, updates } = parsed.data;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "updates object must not be empty" });
    return;
  }

  try {
    const [existing] = await db
      .select()
      .from(clientM365ProfilesTable)
      .where(eq(clientM365ProfilesTable.clientId, clientId))
      .limit(1);

    let row;
    if (existing) {
      const merged = { ...(existing.profile as Record<string, unknown> ?? {}), ...updates };
      [row] = await db
        .update(clientM365ProfilesTable)
        .set({ profile: merged, updatedAt: new Date() })
        .where(eq(clientM365ProfilesTable.clientId, clientId))
        .returning();
    } else {
      [row] = await db
        .insert(clientM365ProfilesTable)
        .values({ clientId, profile: updates })
        .returning();
    }

    res.json(row);
  } catch (err) {
    logger.error({ err, clientId }, "admin-m365-run: failed to update M365 profile");
    res.status(500).json({ error: "Failed to update M365 profile" });
  }
});

export default router;
