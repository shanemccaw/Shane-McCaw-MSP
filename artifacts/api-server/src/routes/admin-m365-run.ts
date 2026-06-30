/**
 * admin-m365-run.ts
 *
 * Script execution pipeline for the M365 Command Center.
 * Runs Library scripts (powershell_scripts table) via Azure Automation runbooks.
 *
 * POST /api/admin/run-script        — execute a single library script
 * POST /api/admin/scores/update     — directly upsert client M365 scores
 * POST /api/admin/profile/update    — merge partial updates into client M365 profile
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import {
  db,
  powershellScriptsTable,
  scriptRunResultsTable,
  scriptModulesTable,
  clientScoresTable,
  clientM365ProfilesTable,
  clientHealthHistoryTable,
  azureTenantCredentialsTable,
  clientAppRegistrationsTable,
  clientAutomationRunsTable,
  usersTable,
  servicesTable,
  kanbanTasksTable,
} from "@workspace/db";
import { eq, desc, and, sql, inArray } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { advancePhaseIfComplete, syncProjectProgress } from "../lib/kanban-phase-advance";
import { broadcastKanbanChange } from "../lib/sse-broadcast";
import { createRunbookJob, getJobStatus, getJobOutput, isTerminalStatus } from "../lib/azure-automation";
import { runAiAnalyzer } from "../lib/ai-analyzer";
import { parseM365ScriptOutput, normaliseProfileUpdates } from "../lib/parse-m365-script-output";
import { getSecretValue } from "../lib/azure-keyvault";
import { computeM365Scores, type M365ScoreCategory } from "../lib/m365-scores";

const router: IRouter = Router();

// ── Zod schemas ────────────────────────────────────────────────────────────────

const runScriptSchema = z.union([
  z.object({
    libraryScriptId: z.string().uuid(),
    customerId: z.number().int().positive().optional(),
    credentialId: z.number().int().positive(),
    packageContext: z.string().optional(),
    kanbanTaskId: z.number().int().positive().optional(),
  }),
  z.object({
    libraryScriptId: z.string().uuid(),
    customerId: z.number().int().positive().optional(),
    appRegistrationId: z.number().int().positive(),
    packageContext: z.string().optional(),
    kanbanTaskId: z.number().int().positive().optional(),
  }),
  z.object({
    libraryScriptId: z.string().uuid(),
    customerId: z.number().int().positive().optional(),
    tenantId: z.string().min(1),
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
    packageContext: z.string().optional(),
    kanbanTaskId: z.number().int().positive().optional(),
  }),
  z.object({
    libraryModuleId: z.string().uuid(),
    customerId: z.number().int().positive().optional(),
    credentialId: z.number().int().positive(),
    packageContext: z.string().optional(),
    kanbanTaskId: z.number().int().positive().optional(),
  }),
  z.object({
    libraryModuleId: z.string().uuid(),
    customerId: z.number().int().positive().optional(),
    appRegistrationId: z.number().int().positive(),
    packageContext: z.string().optional(),
    kanbanTaskId: z.number().int().positive().optional(),
  }),
  z.object({
    libraryModuleId: z.string().uuid(),
    customerId: z.number().int().positive().optional(),
    tenantId: z.string().min(1),
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
    packageContext: z.string().optional(),
    kanbanTaskId: z.number().int().positive().optional(),
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

}

/** Merge profileUpdates into client_m365_profiles. */
async function applyProfileUpdates(
  clientId: number,
  profileUpdates: Record<string, unknown>,
): Promise<void> {
  if (Object.keys(profileUpdates).length === 0) return;

  // Normalise: convert legacy authMethod string → authMethods array
  const normalised = normaliseProfileUpdates(profileUpdates);

  const [existing] = await db
    .select()
    .from(clientM365ProfilesTable)
    .where(eq(clientM365ProfilesTable.clientId, clientId))
    .limit(1);

  const existingProfile = (existing?.profile as Record<string, unknown>) ?? {};
  // Also normalise the existing stored profile (backward compat)
  const normalisedExisting = normaliseProfileUpdates(existingProfile);

  const merged = { ...normalisedExisting, ...normalised };

  if (existing) {
    await db
      .update(clientM365ProfilesTable)
      .set({ profile: merged, updatedAt: new Date() })
      .where(eq(clientM365ProfilesTable.clientId, clientId));
  } else {
    await db
      .insert(clientM365ProfilesTable)
      .values({ clientId, profile: merged });
  }
}

/**
 * Snapshot the client's current M365 health scores derived from their profile
 * into clientHealthHistoryTable. Called after every profile update so both the
 * Health page and the Insights page always reflect the same source of truth.
 */
async function snapshotHealthFromProfile(clientId: number): Promise<void> {
  const [row] = await db
    .select({ profile: clientM365ProfilesTable.profile })
    .from(clientM365ProfilesTable)
    .where(eq(clientM365ProfilesTable.clientId, clientId))
    .limit(1);

  if (!row?.profile) return;

  const scores = computeM365Scores(row.profile as Record<string, unknown>);
  const now = new Date();

  await db.insert(clientHealthHistoryTable).values(
    (Object.entries(scores) as [M365ScoreCategory, number][]).map(([category, score]) => ({
      clientId,
      category,
      score,
      recordedAt: now,
    }))
  );
}

// ── Sibling task resolution ───────────────────────────────────────────────────

/**
 * Given a triggering kanban task ID, returns the IDs of all kanban tasks in the
 * same project that share the same `linkedRunbook.azureRunbookName` in their
 * task metadata. The triggering task is always included in the result.
 */
async function resolveSiblingTaskIds(kanbanTaskId: number): Promise<number[]> {
  const [task] = await db
    .select({ projectId: kanbanTasksTable.projectId, taskMetadata: kanbanTasksTable.taskMetadata })
    .from(kanbanTasksTable)
    .where(eq(kanbanTasksTable.id, kanbanTaskId))
    .limit(1);

  if (!task) return [kanbanTaskId];

  const meta = (task.taskMetadata ?? {}) as Record<string, unknown>;
  const linkedRunbook = meta.linkedRunbook as { azureRunbookName?: string } | null | undefined;
  const azureRunbookName = linkedRunbook?.azureRunbookName;

  if (!azureRunbookName) return [kanbanTaskId];

  const siblings = await db
    .select({ id: kanbanTasksTable.id })
    .from(kanbanTasksTable)
    .where(
      and(
        eq(kanbanTasksTable.projectId, task.projectId),
        sql`task_metadata->'linkedRunbook'->>'azureRunbookName' = ${azureRunbookName}`,
      )
    );

  const ids = siblings.map(s => s.id);
  if (!ids.includes(kanbanTaskId)) ids.push(kanbanTaskId);
  return ids;
}

// ── Background job processor (detached — no await) ────────────────────────────

async function processRunInBackground(
  runResultId: number,
  jobId: string,
  libraryScriptId: string,
  customerId: number | undefined,
  packageContext: string,
  aiInstructions: string,
  kanbanTaskId?: number,
  automationRunId?: number,
  siblingTaskIds?: number[],
): Promise<void> {
  // All kanban task IDs to update (siblings share the same run outcome).
  const kanbanIds: number[] = siblingTaskIds?.length
    ? siblingTaskIds
    : (kanbanTaskId ? [kanbanTaskId] : []);

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
    if (automationRunId) {
      await db.update(clientAutomationRunsTable)
        .set({ status: "failed", errorMessage: String(err), finishedAt: new Date() })
        .where(eq(clientAutomationRunsTable.id, automationRunId));
    }
    if (kanbanIds.length > 0) {
      try {
        await db.update(kanbanTasksTable)
          .set({ completionStatus: "script_failed", completionNotes: `Script run failed (job ${jobId})`, updatedAt: new Date() })
          .where(inArray(kanbanTasksTable.id, kanbanIds));
        // Clear runningJobRef so the button no longer shows "Running…" after reload
        const rows = await db.select({ id: kanbanTasksTable.id, taskMetadata: kanbanTasksTable.taskMetadata })
          .from(kanbanTasksTable).where(inArray(kanbanTasksTable.id, kanbanIds));
        for (const row of rows) {
          const meta = ((row.taskMetadata ?? {}) as Record<string, unknown>);
          await db.update(kanbanTasksTable)
            .set({ taskMetadata: { ...meta, runningJobRef: null } })
            .where(eq(kanbanTasksTable.id, row.id));
        }
      } catch (patchErr) {
        logger.warn({ patchErr, kanbanIds }, "admin-m365-run: failed to update kanban tasks on timeout (non-fatal)");
      }
    }
    return;
  }

  const finalStatus: "completed" | "failed" = jobStatus === "Completed" ? "completed" : "failed";

  // Deterministic extraction — runs before AI so known fields are always captured
  const deterministicUpdates = parseM365ScriptOutput(jobOutput);

  let aiResult = { findings: [] as string[], recommendations: [] as string[], scoreImpact: {} as Record<string, number>, profileUpdates: {} as Record<string, unknown> };
  if (jobOutput.trim()) {
    try {
      aiResult = await runAiAnalyzer({
        scriptOutput: jobOutput,
        aiInstructions,
        packageContext,
      });
    } catch (err) {
      logger.warn({ err, libraryScriptId, jobId }, "admin-m365-run: AI analysis failed (non-fatal)");
    }
  }

  // Deterministic fields override AI guesses for the same keys
  const mergedProfileUpdates = { ...aiResult.profileUpdates, ...deterministicUpdates };

  await db
    .update(scriptRunResultsTable)
    .set({
      rawOutput: { output: jobOutput, jobStatus },
      parsedFindings: aiResult.findings,
      recommendations: aiResult.recommendations,
      scoreImpact: aiResult.scoreImpact,
      profileUpdates: mergedProfileUpdates,
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
      await applyProfileUpdates(customerId, mergedProfileUpdates);
    } catch (err) {
      logger.warn({ err, customerId }, "admin-m365-run: failed to apply profile updates (non-fatal)");
    }
    try {
      await snapshotHealthFromProfile(customerId);
    } catch (err) {
      logger.warn({ err, customerId }, "admin-m365-run: failed to snapshot health scores (non-fatal)");
    }
  }

  if (kanbanIds.length > 0) {
    try {
      // Build a consistent output summary so every sibling card gets identical completion notes.
      const outputLines = jobOutput.split("\n").map(l => l.replace(/\r$/, "")).filter(Boolean);
      const outputSummary = outputLines.slice(-10).join("\n");
      const notesBody = outputSummary ? `\n\nOutput:\n${outputSummary}` : "";
      const kanbanPatch: { column?: "completed"; completionStatus: string; completionNotes: string; updatedAt: Date } = {
        completionStatus: finalStatus === "completed" ? "script_completed" : "script_failed",
        completionNotes: finalStatus === "completed"
          ? `Script run completed (job ${jobId}).${notesBody}`
          : `Script run failed (job ${jobId}).${notesBody}`,
        updatedAt: new Date(),
      };
      if (finalStatus === "completed") kanbanPatch.column = "completed";
      await db.update(kanbanTasksTable).set(kanbanPatch).where(inArray(kanbanTasksTable.id, kanbanIds));
      // Clear runningJobRef so the button no longer shows "Running…" after reload
      const metaRows = await db.select({ id: kanbanTasksTable.id, taskMetadata: kanbanTasksTable.taskMetadata })
        .from(kanbanTasksTable).where(inArray(kanbanTasksTable.id, kanbanIds));
      for (const row of metaRows) {
        const meta = ((row.taskMetadata ?? {}) as Record<string, unknown>);
        await db.update(kanbanTasksTable)
          .set({ taskMetadata: { ...meta, runningJobRef: null } })
          .where(eq(kanbanTasksTable.id, row.id));
      }
      {
        const clearedRows = await db.select().from(kanbanTasksTable).where(inArray(kanbanTasksTable.id, kanbanIds));
        for (const t of clearedRows) if (t.projectId != null) broadcastKanbanChange(t.projectId, { action: "updated", task: t });
      }
      logger.info({ kanbanIds, finalStatus }, "admin-m365-run: kanban tasks synced from script result");

      // Phase advance: if script succeeded, check whether this step is fully done
      // and activate the next phase. Works for each unique workflowStepId across the cards.
      if (finalStatus === "completed") {
        try {
          const completedRows = await db
            .select({ workflowStepId: kanbanTasksTable.workflowStepId, projectId: kanbanTasksTable.projectId })
            .from(kanbanTasksTable)
            .where(inArray(kanbanTasksTable.id, kanbanIds));

          const stepGroups = new Map<number, number>(); // stepId → projectId
          for (const row of completedRows) {
            if (row.workflowStepId != null && row.projectId != null) {
              stepGroups.set(row.workflowStepId, row.projectId);
            }
          }

          for (const [stepId, projId] of stepGroups) {
            await advancePhaseIfComplete(stepId, projId);
            await syncProjectProgress(projId);
          }
        } catch (phaseErr) {
          logger.warn({ phaseErr, kanbanIds }, "admin-m365-run: phase advance check failed (non-fatal)");
        }
      }
    } catch (patchErr) {
      logger.warn({ patchErr, kanbanIds }, "admin-m365-run: failed to sync kanban task status (non-fatal)");
    }
  }

  // Update the CRM portal automation run row so the client sees the final status
  if (automationRunId) {
    try {
      await db.update(clientAutomationRunsTable)
        .set({
          status: finalStatus,
          modulesCompleted: 1,
          finishedAt: new Date(),
          lastLogSnippet: jobOutput.slice(-500) || null,
          errorMessage: finalStatus === "failed" ? (jobOutput.slice(-200) || "Script failed") : null,
        })
        .where(eq(clientAutomationRunsTable.id, automationRunId));
    } catch (err) {
      logger.warn({ err, automationRunId }, "admin-m365-run: failed to finalize automation run row (non-fatal)");
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

  const packageContext = "packageContext" in parsed.data ? (parsed.data.packageContext ?? "") : "";

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
  } else if ("appRegistrationId" in parsed.data) {
    const [appReg] = await db
      .select()
      .from(clientAppRegistrationsTable)
      .where(eq(clientAppRegistrationsTable.id, parsed.data.appRegistrationId))
      .limit(1);
    if (!appReg) {
      res.status(404).json({ error: "App Registration not found" });
      return;
    }
    if (!customerId) {
      customerId = appReg.clientUserId;
    }
    try {
      clientSecret = await getSecretValue(appReg.keyVaultSecretName);
    } catch (err) {
      logger.error({ err, appRegistrationId: parsed.data.appRegistrationId }, "admin-m365-run: failed to fetch secret from Key Vault");
      res.status(502).json({ error: "Failed to retrieve client secret from Key Vault" });
      return;
    }
    tenantId = appReg.tenantId;
    clientId = appReg.azureClientId;
  } else {
    tenantId = parsed.data.tenantId;
    clientId = parsed.data.clientId;
    clientSecret = parsed.data.clientSecret;
  }

  // Resolve what to run — either a standalone library script or a package module
  let resolvedRunbookName: string;
  let resolvedLibraryScriptId: string | null = null;

  if ("libraryModuleId" in parsed.data) {
    // Running a module from a script set
    const moduleId = parsed.data.libraryModuleId;
    const [mod] = await db
      .select()
      .from(scriptModulesTable)
      .where(eq(scriptModulesTable.id, moduleId))
      .limit(1);
    if (!mod) {
      res.status(404).json({ error: `Module ${moduleId} not found` });
      return;
    }
    resolvedRunbookName = mod.filename
      .replace(/\.ps1$/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 63) || "script";
  } else {
    // Running a standalone library script
    const libraryScriptId = parsed.data.libraryScriptId;
    const [script] = await db
      .select()
      .from(powershellScriptsTable)
      .where(eq(powershellScriptsTable.id, libraryScriptId))
      .limit(1);
    if (!script) {
      res.status(404).json({ error: `Library script ${libraryScriptId} not found` });
      return;
    }
    if (!script.azureRunbookName) {
      res.status(400).json({ error: "This script has not been pushed to Azure Automation yet — push it first from the Library editor" });
      return;
    }
    resolvedRunbookName = script.azureRunbookName;
    resolvedLibraryScriptId = libraryScriptId;
  }

  const kanbanTaskId: number | undefined = "kanbanTaskId" in parsed.data ? (parsed.data.kanbanTaskId ?? undefined) : undefined;

  // Create a placeholder run result row
  let runResultId: number;
  try {
    const [row] = await db
      .insert(scriptRunResultsTable)
      .values({
        customerId: customerId ?? null,
        libraryScriptId: resolvedLibraryScriptId,
        kanbanTaskId: kanbanTaskId ?? null,
        status: "running",
      })
      .returning({ id: scriptRunResultsTable.id });
    runResultId = row.id;
  } catch (err) {
    logger.error({ err, resolvedLibraryScriptId }, "admin-m365-run: failed to create run result placeholder");
    res.status(500).json({ error: "Failed to initialize run result" });
    return;
  }

  // Trigger runbook
  let jobId: string;
  try {
    const job = await createRunbookJob({
      runbookName: resolvedRunbookName,
      parameters: {
        TenantId: tenantId,
        ClientId: clientId,
        ClientSecret: clientSecret,
      },
    });
    jobId = job.jobId;
  } catch (err) {
    logger.error({ err, runbookName: resolvedRunbookName }, "admin-m365-run: runbook job creation failed");
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

  // Create a clientAutomationRuns row so the CRM portal can show progress
  let automationRunId: number | undefined;
  if (customerId) {
    try {
      const [autoRun] = await db.insert(clientAutomationRunsTable).values({
        clientUserId: customerId,
        status: "running",
        modulesTotal: 1,
        modulesCompleted: 0,
        lastLogSnippet: resolvedRunbookName,
      }).returning({ id: clientAutomationRunsTable.id });
      automationRunId = autoRun?.id;
    } catch (err) {
      logger.warn({ err, customerId }, "admin-m365-run: failed to create automation run row (non-fatal)");
    }
  }

  // Resolve sibling task IDs (other cards in the same project sharing this runbook)
  // and bulk-move them to In Progress so the board reflects that the job is underway.
  let siblingTaskIds: number[] | undefined;
  if (kanbanTaskId) {
    try {
      siblingTaskIds = await resolveSiblingTaskIds(kanbanTaskId);
      if (siblingTaskIds.length > 0) {
        await db
          .update(kanbanTasksTable)
          .set({ column: "in_progress", updatedAt: new Date() })
          .where(inArray(kanbanTasksTable.id, siblingTaskIds));
        const inProgressRows = await db.select().from(kanbanTasksTable).where(inArray(kanbanTasksTable.id, siblingTaskIds)).catch(() => []);
        for (const t of inProgressRows) if (t.projectId != null) broadcastKanbanChange(t.projectId, { action: "updated", task: t });
        logger.info({ siblingTaskIds, kanbanTaskId }, "admin-m365-run: bulk moved sibling tasks to in_progress");
      }
    } catch (err) {
      logger.warn({ err, kanbanTaskId }, "admin-m365-run: failed to resolve/move sibling tasks (non-fatal)");
      siblingTaskIds = undefined;
    }
  }

  // Persist runningJobRef in taskMetadata so the "Running…" button state survives
  // page reloads and new browser tabs — cleared by processRunInBackground on completion.
  if (kanbanTaskId) {
    const idsToMark = siblingTaskIds ?? [kanbanTaskId];
    try {
      const rows = await db
        .select({ id: kanbanTasksTable.id, taskMetadata: kanbanTasksTable.taskMetadata })
        .from(kanbanTasksTable)
        .where(inArray(kanbanTasksTable.id, idsToMark));
      for (const row of rows) {
        const meta = ((row.taskMetadata ?? {}) as Record<string, unknown>);
        await db.update(kanbanTasksTable)
          .set({ taskMetadata: { ...meta, runningJobRef: jobId }, updatedAt: new Date() })
          .where(eq(kanbanTasksTable.id, row.id));
      }
      const stampedRows = await db.select().from(kanbanTasksTable).where(inArray(kanbanTasksTable.id, idsToMark)).catch(() => []);
      for (const t of stampedRows) if (t.projectId != null) broadcastKanbanChange(t.projectId, { action: "updated", task: t });
    } catch (err) {
      logger.warn({ err, kanbanTaskId }, "admin-m365-run: failed to set runningJobRef (non-fatal)");
    }
  }

  // Kick off background processing (detached — do NOT await)
  void processRunInBackground(
    runResultId,
    jobId,
    resolvedLibraryScriptId ?? "",
    customerId,
    packageContext,
    "",
    kanbanTaskId,
    automationRunId,
    siblingTaskIds,
  );

  res.json({ jobRef: jobId, resultId: runResultId, libraryScriptId: resolvedLibraryScriptId, status: "running" });
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

    let outputLines: string[] = [];
    if (row.status === "running") {
      try {
        const lines = await getJobOutput(jobRef);
        outputLines = lines.map(l => l.text).filter(Boolean);
      } catch (err) {
        logger.warn({ err, jobRef }, "admin-m365-run: failed to fetch job output during polling (non-fatal)");
      }
    } else {
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
        libraryScriptId: scriptRunResultsTable.libraryScriptId,
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
        scriptName: powershellScriptsTable.title,
        clientName: usersTable.name,
        packageName: servicesTable.name,
      })
      .from(scriptRunResultsTable)
      .leftJoin(powershellScriptsTable, eq(scriptRunResultsTable.libraryScriptId, powershellScriptsTable.id))
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

    const rawOutput = row.rawOutput as Record<string, unknown> | null;
    if (!rawOutput) {
      res.status(400).json({ error: "No raw output to apply" });
      return;
    }

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

    // Snapshot health scores from the updated profile so Health and Insights pages stay in sync
    try {
      await snapshotHealthFromProfile(clientId);
    } catch (snapErr) {
      logger.warn({ snapErr, clientId }, "admin-m365-run: failed to snapshot health after profile update (non-fatal)");
    }

    res.json(row);
  } catch (err) {
    logger.error({ err, clientId }, "admin-m365-run: failed to update M365 profile");
    res.status(500).json({ error: "Failed to update M365 profile" });
  }
});

export default router;
