/**
 * kanban-auto-fire.ts
 *
 * Auto-fires the first eligible "backlog" kanban task (taskType="script" with a linkedRunbook)
 * in a client's active project phase when their App Registration credentials are verified.
 *
 * Called from portal.ts after PUT /portal/app-registration succeeds (fire-and-forget).
 *
 * Flow:
 *  1. Find the client's projects.
 *  2. Find the first "backlog" script card in an in_progress workflow step.
 *  3. Get the client's verified App Registration and fetch the secret from Key Vault.
 *  4. Resolve sibling cards that share the same azureRunbookName in the project.
 *  5. Bulk-move all sibling cards to "in_progress" and stamp runningJobRef.
 *  6. Create the Azure Automation runbook job.
 *  7. Poll the job to completion in the background (detached — does NOT block the response).
 *  8. On completion: move cards to "completed" (or leave in "in_progress" on failure),
 *     call advancePhaseIfComplete, and sync project progress.
 */

import {
  db,
  kanbanTasksTable,
  projectsTable,
  clientAppRegistrationsTable,
  workflowStepsTable,
  workflowTemplateStepTasksTable,
  scriptModulesTable,
  powershellScriptsTable,
  scriptRunResultsTable,
  clientAutomationRunsTable,
} from "@workspace/db";
import { eq, and, asc, inArray, isNotNull, sql } from "drizzle-orm";
import { logger } from "./logger";
import { createRunbookJob, getJobStatus, getJobOutput, isTerminalStatus, isAzureConfigured } from "./azure-automation";
import { getSecretValue } from "./azure-keyvault";
import { advancePhaseIfComplete, syncProjectProgress } from "./kanban-phase-advance";
import { broadcastKanbanChange } from "./sse-broadcast";
import { runAiAnalyzer } from "./ai-analyzer";
import { generateAndDeliverDocument, type DocumentGenerationConfig } from "./document-generator";

const POLL_INTERVAL_MS = 5_000;
const JOB_TIMEOUT_MS   = 10 * 60 * 1000;

interface LinkedRunbook {
  scriptId: string;
  azureRunbookName: string;
  scriptTitle: string;
}

interface EligibleCard {
  id: number;
  projectId: number;
  workflowStepId: number | null;
  linkedRunbook: LinkedRunbook;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function filenameSlug(filename: string): string {
  return filename.replace(/\.ps1$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63) || "script";
}

async function findFirstBacklogScriptCard(clientUserId: number): Promise<EligibleCard | null> {
  const projects = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(eq(projectsTable.clientUserId, clientUserId));

  if (projects.length === 0) return null;
  const projectIds = projects.map(p => p.id);

  // Fetch in_progress workflow steps, including their template step id for fallback resolution
  const activeSteps = await db
    .select({ id: workflowStepsTable.id, templateStepId: workflowStepsTable.workflowTemplateStepId })
    .from(workflowStepsTable)
    .where(
      and(
        inArray(workflowStepsTable.projectId, projectIds),
        eq(workflowStepsTable.status, "in_progress"),
      ),
    );

  const activeStepIds = activeSteps.map(s => s.id);
  if (activeStepIds.length === 0) return null;

  const stepToTemplateStep = new Map(activeSteps.map(s => [s.id, s.templateStepId]));

  // Fetch backlog cards ordered by (stepId asc, order asc)
  const candidates = await db
    .select({
      id:             kanbanTasksTable.id,
      title:          kanbanTasksTable.title,
      projectId:      kanbanTasksTable.projectId,
      workflowStepId: kanbanTasksTable.workflowStepId,
      taskMetadata:   kanbanTasksTable.taskMetadata,
    })
    .from(kanbanTasksTable)
    .where(
      and(
        inArray(kanbanTasksTable.workflowStepId, activeStepIds),
        eq(kanbanTasksTable.column, "backlog"),
      ),
    )
    .orderBy(asc(kanbanTasksTable.workflowStepId), asc(kanbanTasksTable.order));

  // First pass: return immediately if any card already has linkedRunbook in its stored metadata
  for (const card of candidates) {
    const meta = (card.taskMetadata ?? {}) as Record<string, unknown>;
    const lr = meta.linkedRunbook as LinkedRunbook | null | undefined;
    if (lr?.azureRunbookName) {
      return { id: card.id, projectId: card.projectId, workflowStepId: card.workflowStepId, linkedRunbook: lr };
    }
  }

  // Second pass (fallback): metadata.linkedRunbook is null for all cards — this happens when
  // provisioning ran before the dual-format fix was deployed, so the stored metadata has
  // linkedRunbook: null even though the template tasks have runbook_id set.
  // Resolve via: workflowStepId → workflowTemplateStepId → workflow_template_step_tasks.runbook_id
  const templateStepIds = [...new Set(
    candidates.map(c => (c.workflowStepId != null ? stepToTemplateStep.get(c.workflowStepId) : undefined))
      .filter((id): id is number => id != null),
  )];

  if (templateStepIds.length === 0) {
    logger.info({ clientUserId }, "kanban-auto-fire: no eligible backlog script card found (no template steps)");
    return null;
  }

  // Fetch all template tasks that have a runbook_id for these steps
  const templateTasks = await db
    .select({
      workflowTemplateStepId: workflowTemplateStepTasksTable.workflowTemplateStepId,
      runbookId:              workflowTemplateStepTasksTable.runbookId,
      title:                  workflowTemplateStepTasksTable.title,
      order:                  workflowTemplateStepTasksTable.order,
    })
    .from(workflowTemplateStepTasksTable)
    .where(
      and(
        inArray(workflowTemplateStepTasksTable.workflowTemplateStepId, templateStepIds),
        isNotNull(workflowTemplateStepTasksTable.runbookId),
      ),
    )
    .orderBy(asc(workflowTemplateStepTasksTable.order));

  if (templateTasks.length === 0) {
    logger.info({ clientUserId }, "kanban-auto-fire: no eligible backlog script card found (no template runbook tasks)");
    return null;
  }

  // Batch-resolve all runbook_ids — UUIDs only; non-UUID values are skipped with a warning
  const allRunbookIds = [...new Set(templateTasks.map(t => t.runbookId!))];
  const uuidIds = allRunbookIds.filter(id => UUID_RE.test(id));
  const nonUuidIds = allRunbookIds.filter(id => !UUID_RE.test(id));

  if (nonUuidIds.length > 0) {
    logger.warn({ clientUserId, nonUuidIds }, "kanban-auto-fire: ignoring non-UUID runbook_id values (legacy slugs — update workflow template tasks)");
  }

  const [moduleRows, scriptRows] = await Promise.all([
    uuidIds.length > 0
      ? db.select({ id: scriptModulesTable.id, filename: scriptModulesTable.filename, description: scriptModulesTable.description, azureRunbookName: scriptModulesTable.azureRunbookName })
          .from(scriptModulesTable).where(inArray(scriptModulesTable.id, uuidIds))
      : Promise.resolve([]),
    uuidIds.length > 0
      ? db.select({ id: powershellScriptsTable.id, title: powershellScriptsTable.title, azureRunbookName: powershellScriptsTable.azureRunbookName })
          .from(powershellScriptsTable).where(inArray(powershellScriptsTable.id, uuidIds))
      : Promise.resolve([]),
  ]);

  const moduleMap = new Map(moduleRows.map(m => [m.id, m]));
  const scriptMap = new Map(scriptRows.map(s => [s.id, s]));

  function resolveRunbook(runbookId: string): LinkedRunbook | null {
    if (!UUID_RE.test(runbookId)) return null;
    const mod = moduleMap.get(runbookId);
    if (mod) {
      if (!mod.azureRunbookName) {
        logger.warn({ runbookId, filename: mod.filename }, "kanban-auto-fire: module not yet pushed to Azure — skipping");
        return null;
      }
      return { scriptId: mod.id, azureRunbookName: mod.azureRunbookName, scriptTitle: mod.description ?? mod.filename.replace(/\.ps1$/i, "") };
    }
    const script = scriptMap.get(runbookId);
    if (script?.azureRunbookName) {
      return { scriptId: script.id, azureRunbookName: script.azureRunbookName, scriptTitle: script.title };
    }
    return null;
  }

  // Build a map: templateStepId → first resolved runbook (ordered by task order)
  const stepRunbookMap = new Map<number, LinkedRunbook>();
  for (const tt of templateTasks) {
    if (stepRunbookMap.has(tt.workflowTemplateStepId)) continue;
    const resolved = resolveRunbook(tt.runbookId!);
    if (resolved) stepRunbookMap.set(tt.workflowTemplateStepId, resolved);
  }

  logger.info({ clientUserId, uuidIds, moduleRows: moduleRows.length, scriptRows: scriptRows.length, stepRunbookMap: Object.fromEntries(stepRunbookMap) },
    "kanban-auto-fire: fallback template resolution");

  // Return the first candidate whose step resolves to a runbook
  for (const card of candidates) {
    if (card.workflowStepId == null) continue;
    const tStepId = stepToTemplateStep.get(card.workflowStepId);
    if (!tStepId) continue;
    const lr = stepRunbookMap.get(tStepId);
    if (lr) {
      return { id: card.id, projectId: card.projectId, workflowStepId: card.workflowStepId, linkedRunbook: lr };
    }
  }

  logger.info({ clientUserId }, "kanban-auto-fire: no eligible backlog script card found");
  return null;
}

async function resolveSiblingIds(taskId: number, projectId: number, azureRunbookName: string): Promise<number[]> {
  const siblings = await db
    .select({ id: kanbanTasksTable.id })
    .from(kanbanTasksTable)
    .where(
      and(
        eq(kanbanTasksTable.projectId, projectId),
        sql`task_metadata->'linkedRunbook'->>'azureRunbookName' = ${azureRunbookName}`,
        // Never pull already-completed cards back into a new job's sibling set.
        // Without this, firing the next backlog card (same runbook) would move the
        // just-completed sibling back to in_progress, erasing its completed state.
        sql`"column" != 'completed'`,
      ),
    );
  const ids = siblings.map(s => s.id);
  if (!ids.includes(taskId)) ids.push(taskId);
  return ids;
}

async function pollJobToCompletion(jobId: string): Promise<{ success: boolean; lastStatus: string; output: string }> {
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    const status = await getJobStatus(jobId);
    if (isTerminalStatus(status.status)) {
      const outputLines = await getJobOutput(jobId).catch(() => [] as Array<{ text: string }>);
      const output = outputLines.map((l: { text: string }) => l.text).join("\n");
      return { success: status.status === "Completed", lastStatus: status.status, output };
    }
  }
  return { success: false, lastStatus: "Timeout", output: "" };
}

async function runInBackground(
  jobId:    string,
  cardIds:  number[],
  projectId: number,
  workflowStepId: number | null,
  clientUserId: number,
  runResultId: number | undefined,
  scriptTitle: string,
  automationRunId: number | undefined,
): Promise<void> {
  try {
    const { success, lastStatus, output } = await pollJobToCompletion(jobId);

    const outputSummary = output.split("\n").filter(Boolean).slice(-10).join("\n");
    const notesBody = outputSummary ? `\n\nOutput:\n${outputSummary}` : "";

    // Run AI analysis on the script output (non-fatal if it fails)
    let aiResult: Awaited<ReturnType<typeof runAiAnalyzer>> | null = null;
    if (output.trim()) {
      try {
        aiResult = await runAiAnalyzer({
          scriptOutput: output,
          aiInstructions: `Analyze the output of the "${scriptTitle}" runbook for security, governance, and Copilot readiness findings.`,
          packageContext: "Automated M365 analysis triggered by client App Registration",
        });
        logger.info({ runResultId, jobId, scriptTitle }, "kanban-auto-fire: AI analysis completed");
      } catch (aiErr) {
        logger.warn({ aiErr, jobId, scriptTitle }, "kanban-auto-fire: AI analysis failed (non-fatal)");
      }
    }

    // WRITE 1: persist raw output + AI findings to the script_run_results row
    if (runResultId != null) {
      try {
        await db.update(scriptRunResultsTable)
          .set({
            status:         success ? "completed" : "failed",
            rawOutput:      { text: output, azureStatus: lastStatus },
            parsedFindings: aiResult?.findings ?? [],
            recommendations: aiResult?.recommendations ?? [],
            scoreImpact:    aiResult?.scoreImpact ?? {},
            profileUpdates: aiResult?.profileUpdates ?? {},
          })
          .where(eq(scriptRunResultsTable.id, runResultId));
      } catch (updateErr) {
        logger.warn({ updateErr, runResultId, jobId }, "kanban-auto-fire: could not update script_run_results (non-fatal)");
      }
    }

    // WRITE 2: persist raw output + AI analysis to the primary kanban card's metadata
    const primaryCardId = cardIds[0];
    if (primaryCardId != null) {
      try {
        const [task] = await db.select().from(kanbanTasksTable).where(eq(kanbanTasksTable.id, primaryCardId)).limit(1);
        if (task) {
          const existingMeta = (task.taskMetadata ?? {}) as Record<string, unknown>;
          await db.update(kanbanTasksTable)
            .set({
              taskMetadata: {
                ...existingMeta,
                scriptOutput:  output.slice(0, 50_000),
                lastJobId:     jobId,
                lastJobStatus: success ? "Completed" : lastStatus,
                runningJobRef: null,
                ...(aiResult ? { aiAnalysis: aiResult } : {}),
                ...(success ? { completedAt: new Date().toISOString() } : { failedAt: new Date().toISOString() }),
              },
              updatedAt: new Date(),
            })
            .where(eq(kanbanTasksTable.id, primaryCardId));
        }
      } catch (metaErr) {
        logger.warn({ metaErr, primaryCardId, jobId }, "kanban-auto-fire: could not save script output to kanban card (non-fatal)");
      }
    }

    // WRITE 3: update the clientAutomationRunsTable row so the CRM progress widget reflects the result
    if (automationRunId != null) {
      try {
        await db.update(clientAutomationRunsTable)
          .set({
            status:           success ? "completed" : "failed",
            modulesCompleted: 1,
            finishedAt:       new Date(),
            ...(success ? {} : { errorMessage: `Job ${jobId} finished with status: ${lastStatus}` }),
          })
          .where(eq(clientAutomationRunsTable.id, automationRunId));
      } catch (arErr) {
        logger.warn({ arErr, automationRunId, jobId }, "kanban-auto-fire: could not update client_automation_runs (non-fatal)");
      }
    }

    if (success) {
      await db.update(kanbanTasksTable)
        .set({
          column:           "completed",
          completionStatus: "script_completed",
          completionNotes:  `Script run completed (job ${jobId}).${notesBody}`,
          updatedAt:        new Date(),
        })
        .where(inArray(kanbanTasksTable.id, cardIds));

      {
        const completedRows = await db.select().from(kanbanTasksTable).where(inArray(kanbanTasksTable.id, cardIds));
        for (const t of completedRows) broadcastKanbanChange(projectId, { action: "updated", task: t });
      }

      logger.info({ cardIds, jobId }, "kanban-auto-fire: script completed — cards moved to completed");

      // Phase advance (activates the next workflow phase if every card in this step is done)
      if (workflowStepId != null) {
        const { spawnedTasks } = await advancePhaseIfComplete(workflowStepId, projectId);
        if (spawnedTasks.length > 0) {
          logger.info({ workflowStepId, projectId, spawnedCount: spawnedTasks.length }, "kanban-auto-fire: next phase activated");
        }
      }

      // Always look for the next backlog card (script or document) in this client's active phase.
      // Without this, only the first card fires — subsequent cards in the same phase
      // never get picked up because advancePhaseIfComplete only fires when ALL cards
      // in the step are complete.
      void autoFireFirstBacklogScript(clientUserId);
      void autoFireDocumentCard(clientUserId);
    } else {
      // On failure: stamp completionNotes but leave column as in_progress
      await db.update(kanbanTasksTable)
        .set({
          completionStatus: "script_failed",
          completionNotes:  `Script run failed — status: ${lastStatus} (job ${jobId}).${notesBody}`,
          updatedAt:        new Date(),
        })
        .where(inArray(kanbanTasksTable.id, cardIds));

      // Also clear runningJobRef on failure for all sibling cards
      const failMetaRows = await db
        .select({ id: kanbanTasksTable.id, taskMetadata: kanbanTasksTable.taskMetadata })
        .from(kanbanTasksTable)
        .where(inArray(kanbanTasksTable.id, cardIds));
      for (const row of failMetaRows) {
        const meta = (row.taskMetadata ?? {}) as Record<string, unknown>;
        await db.update(kanbanTasksTable)
          .set({ taskMetadata: { ...meta, runningJobRef: null, lastJobStatus: lastStatus } })
          .where(eq(kanbanTasksTable.id, row.id));
      }

      {
        const failedRows = await db.select().from(kanbanTasksTable).where(inArray(kanbanTasksTable.id, cardIds));
        for (const t of failedRows) broadcastKanbanChange(projectId, { action: "updated", task: t });
      }

      logger.warn({ cardIds, jobId, lastStatus }, "kanban-auto-fire: script failed — cards remain in_progress");
    }

    await syncProjectProgress(projectId);
  } catch (err) {
    logger.warn({ err, jobId, cardIds }, "kanban-auto-fire: background run error (non-fatal)");
  }
}

/**
 * Main entry point. Called fire-and-forget from portal.ts after credentials are saved.
 * Finds the first backlog script card in the client's active phase, fires the runbook,
 * and handles completion in the background.
 */
// ── Document-generation auto-fire ────────────────────────────────────────────

interface DocumentCard {
  id: number;
  projectId: number;
  workflowStepId: number | null;
  documentGeneration: DocumentGenerationConfig;
}

async function findFirstBacklogDocumentCard(clientUserId: number): Promise<DocumentCard | null> {
  const projects = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(eq(projectsTable.clientUserId, clientUserId));

  if (projects.length === 0) return null;
  const projectIds = projects.map(p => p.id);

  const activeSteps = await db
    .select({ id: workflowStepsTable.id })
    .from(workflowStepsTable)
    .where(
      and(
        inArray(workflowStepsTable.projectId, projectIds),
        eq(workflowStepsTable.status, "in_progress"),
      ),
    );

  const activeStepIds = activeSteps.map(s => s.id);
  if (activeStepIds.length === 0) return null;

  const candidates = await db
    .select({
      id:             kanbanTasksTable.id,
      projectId:      kanbanTasksTable.projectId,
      workflowStepId: kanbanTasksTable.workflowStepId,
      taskType:       kanbanTasksTable.taskType,
      taskMetadata:   kanbanTasksTable.taskMetadata,
    })
    .from(kanbanTasksTable)
    .where(
      and(
        inArray(kanbanTasksTable.workflowStepId, activeStepIds),
        eq(kanbanTasksTable.column, "backlog"),
        eq(kanbanTasksTable.taskType, "document_generation"),
      ),
    )
    .orderBy(asc(kanbanTasksTable.workflowStepId), asc(kanbanTasksTable.order));

  for (const card of candidates) {
    const meta = (card.taskMetadata ?? {}) as Record<string, unknown>;
    const dg = meta.documentGeneration as DocumentGenerationConfig | undefined;
    if (dg?.category && dg?.docType && dg?.title) {
      return {
        id: card.id,
        projectId: card.projectId,
        workflowStepId: card.workflowStepId,
        documentGeneration: dg,
      };
    }
  }
  return null;
}

/**
 * Auto-fires the first eligible "backlog" document_generation kanban card in
 * a client's active project phase.  Unlike script tasks, document generation
 * is synchronous (AI call + DB write), so no external polling is needed.
 *
 * Called alongside autoFireFirstBacklogScript everywhere so both task types are
 * picked up in the same chain reaction.
 */
export async function autoFireDocumentCard(clientUserId: number): Promise<void> {
  try {
    const card = await findFirstBacklogDocumentCard(clientUserId);
    if (!card) {
      logger.debug({ clientUserId }, "kanban-auto-fire: no eligible backlog document card found");
      return;
    }

    logger.info(
      { clientUserId, cardId: card.id, docType: card.documentGeneration.docType },
      "kanban-auto-fire: auto-firing document generation card",
    );

    // Move card to in_progress
    await db.update(kanbanTasksTable)
      .set({ column: "in_progress", updatedAt: new Date() })
      .where(eq(kanbanTasksTable.id, card.id));
    {
      const [updated] = await db.select().from(kanbanTasksTable).where(eq(kanbanTasksTable.id, card.id));
      if (updated) broadcastKanbanChange(card.projectId, { action: "updated", task: updated });
    }

    let documentId: number;
    try {
      const result = await generateAndDeliverDocument(clientUserId, card.projectId, card.documentGeneration);
      documentId = result.documentId;
    } catch (genErr) {
      // Revert to backlog if generation fails
      await db.update(kanbanTasksTable)
        .set({ column: "backlog", updatedAt: new Date() })
        .where(eq(kanbanTasksTable.id, card.id));
      const [reverted] = await db.select().from(kanbanTasksTable).where(eq(kanbanTasksTable.id, card.id));
      if (reverted) broadcastKanbanChange(card.projectId, { action: "updated", task: reverted });
      logger.error({ genErr, clientUserId, cardId: card.id }, "kanban-auto-fire: document generation failed — card reverted to backlog");
      return;
    }

    // Stamp documentId into metadata and move to completed
    const [metaRow] = await db
      .select({ taskMetadata: kanbanTasksTable.taskMetadata })
      .from(kanbanTasksTable)
      .where(eq(kanbanTasksTable.id, card.id));
    const prevMeta = ((metaRow?.taskMetadata ?? {}) as Record<string, unknown>);

    await db.update(kanbanTasksTable)
      .set({
        column:           "completed",
        completionStatus: "document_generated",
        completionNotes:  `Document "${card.documentGeneration.title}" generated and delivered to client portal (ID: ${documentId}).`,
        taskMetadata:     { ...prevMeta, generatedDocumentId: documentId },
        updatedAt:        new Date(),
      })
      .where(eq(kanbanTasksTable.id, card.id));
    {
      const [completed] = await db.select().from(kanbanTasksTable).where(eq(kanbanTasksTable.id, card.id));
      if (completed) broadcastKanbanChange(card.projectId, { action: "updated", task: completed });
    }

    logger.info(
      { clientUserId, cardId: card.id, documentId },
      "kanban-auto-fire: document generated and card completed",
    );

    // Phase advance (activates next workflow phase if all cards in this step are done)
    if (card.workflowStepId != null) {
      const { spawnedTasks } = await advancePhaseIfComplete(card.workflowStepId, card.projectId);
      if (spawnedTasks.length > 0) {
        logger.info(
          { workflowStepId: card.workflowStepId, projectId: card.projectId, spawnedCount: spawnedTasks.length },
          "kanban-auto-fire: next phase activated after document generation",
        );
      }
    }

    // Chain: check for more document or script cards that are now first in queue
    void autoFireDocumentCard(clientUserId);
    void autoFireFirstBacklogScript(clientUserId);
  } catch (err) {
    logger.warn({ err, clientUserId }, "kanban-auto-fire: autoFireDocumentCard unexpected error (non-fatal)");
  }
}

export async function autoFireFirstBacklogScript(clientUserId: number): Promise<void> {
  if (!isAzureConfigured()) {
    logger.warn({ clientUserId }, "kanban-auto-fire: Azure not configured — skipping auto-fire");
    return;
  }

  try {
    const card = await findFirstBacklogScriptCard(clientUserId);
    if (!card) {
      logger.info({ clientUserId }, "kanban-auto-fire: no eligible backlog script card found");
      return;
    }

    const [appReg] = await db
      .select()
      .from(clientAppRegistrationsTable)
      .where(
        and(
          eq(clientAppRegistrationsTable.clientUserId, clientUserId),
          eq(clientAppRegistrationsTable.status, "verified"),
        ),
      )
      .limit(1);

    if (!appReg) {
      logger.warn({ clientUserId }, "kanban-auto-fire: no verified App Registration found");
      return;
    }

    let clientSecret: string;
    try {
      clientSecret = await getSecretValue(appReg.keyVaultSecretName);
    } catch (kvErr) {
      logger.error({ kvErr, clientUserId }, "kanban-auto-fire: Key Vault fetch failed");
      return;
    }

    const siblingIds = await resolveSiblingIds(card.id, card.projectId, card.linkedRunbook.azureRunbookName);

    // Move all cards to in_progress immediately
    await db.update(kanbanTasksTable)
      .set({ column: "in_progress", updatedAt: new Date() })
      .where(inArray(kanbanTasksTable.id, siblingIds));

    {
      const inProgressRows = await db.select().from(kanbanTasksTable).where(inArray(kanbanTasksTable.id, siblingIds));
      for (const t of inProgressRows) broadcastKanbanChange(card.projectId, { action: "updated", task: t });
    }

    // Stamp runningJobRef placeholder so the "Running…" badge appears if admin reloads
    let jobId: string;
    try {
      ({ jobId } = await createRunbookJob({
        runbookName: card.linkedRunbook.azureRunbookName,
        parameters: {
          TenantId:     appReg.tenantId,
          ClientId:     appReg.azureClientId,
          ClientSecret: clientSecret,
        },
      }));
    } catch (azErr) {
      // Revert cards to backlog if job creation fails
      await db.update(kanbanTasksTable)
        .set({ column: "backlog", updatedAt: new Date() })
        .where(inArray(kanbanTasksTable.id, siblingIds));
      {
        const revertedRows = await db.select().from(kanbanTasksTable).where(inArray(kanbanTasksTable.id, siblingIds));
        for (const t of revertedRows) broadcastKanbanChange(card.projectId, { action: "updated", task: t });
      }
      logger.error({ azErr, clientUserId, runbook: card.linkedRunbook.azureRunbookName }, "kanban-auto-fire: Azure job creation failed — cards reverted to backlog");
      return;
    }

    // Stamp jobRef into metadata so the UI shows the running state
    const metaRows = await db
      .select({ id: kanbanTasksTable.id, taskMetadata: kanbanTasksTable.taskMetadata })
      .from(kanbanTasksTable)
      .where(inArray(kanbanTasksTable.id, siblingIds));
    for (const row of metaRows) {
      const meta = ((row.taskMetadata ?? {}) as Record<string, unknown>);
      await db.update(kanbanTasksTable)
        .set({ taskMetadata: { ...meta, runningJobRef: jobId, lastJobStatus: "Running", lastJobId: jobId }, updatedAt: new Date() })
        .where(eq(kanbanTasksTable.id, row.id));
    }
    {
      const stampedRows = await db.select().from(kanbanTasksTable).where(inArray(kanbanTasksTable.id, siblingIds));
      for (const t of stampedRows) broadcastKanbanChange(card.projectId, { action: "updated", task: t });
    }

    logger.info(
      { clientUserId, jobId, runbook: card.linkedRunbook.azureRunbookName, cardIds: siblingIds },
      "kanban-auto-fire: job started — polling in background",
    );

    // Insert a script_run_results placeholder so the Results pane shows this run immediately.
    let runResultId: number | undefined;
    try {
      const [resultRow] = await db
        .insert(scriptRunResultsTable)
        .values({
          customerId:      clientUserId,
          jobId,
          kanbanTaskId:    card.id,
          status:          "running",
          executionSource: "automated",
          scriptName:      card.linkedRunbook.scriptTitle ?? null,
        })
        .returning({ id: scriptRunResultsTable.id });
      runResultId = resultRow?.id;
    } catch (resultErr) {
      logger.warn({ resultErr, jobId }, "kanban-auto-fire: could not insert script_run_results placeholder (non-fatal)");
    }

    // Insert a client_automation_runs row so the CRM navigation progress widget shows this script.
    let automationRunId: number | undefined;
    try {
      const [arRow] = await db
        .insert(clientAutomationRunsTable)
        .values({
          clientUserId,
          status:          "running",
          modulesTotal:    1,
          modulesCompleted: 0,
          lastLogSnippet:  card.linkedRunbook.scriptTitle,
        })
        .returning({ id: clientAutomationRunsTable.id });
      automationRunId = arRow?.id;
    } catch (arErr) {
      logger.warn({ arErr, jobId }, "kanban-auto-fire: could not insert client_automation_runs row (non-fatal)");
    }

    // Detached — does NOT block the HTTP response
    void runInBackground(jobId, siblingIds, card.projectId, card.workflowStepId, clientUserId, runResultId, card.linkedRunbook.scriptTitle, automationRunId);
  } catch (err) {
    logger.warn({ err, clientUserId }, "kanban-auto-fire: unexpected error (non-fatal)");
  }
}

/**
 * Called once on server startup to recover cards that were left in_progress when
 * the previous server process was killed mid-run (e.g. during a deploy or restart).
 *
 * Strategy:
 *  1. Find all kanban cards stuck in "in_progress" that have a runningJobRef.
 *  2. Group by jobId.
 *  3. For cards whose completionStatus is already "script_completed" (sibling-stampede
 *     victims), simply flip column back to "completed" — no Azure check needed.
 *  4. For the rest: check Azure job status. If terminal, resolve the outcome and update
 *     cards. If still running, re-spawn the background poller.
 *  5. For any client whose cards were completed, fire autoFireFirstBacklogScript so the
 *     chain continues.
 */
export async function reconcileOrphanedRuns(): Promise<void> {
  if (!isAzureConfigured()) return;

  try {
    const stuck = await db
      .select({
        id:               kanbanTasksTable.id,
        projectId:        kanbanTasksTable.projectId,
        workflowStepId:   kanbanTasksTable.workflowStepId,
        completionStatus: kanbanTasksTable.completionStatus,
        jobId:            sql<string>`(task_metadata->>'runningJobRef')`,
        clientUserId:     projectsTable.clientUserId,
      })
      .from(kanbanTasksTable)
      .innerJoin(projectsTable, eq(projectsTable.id, kanbanTasksTable.projectId))
      .where(
        and(
          eq(kanbanTasksTable.column, "in_progress"),
          isNotNull(sql`task_metadata->>'runningJobRef'`),
        ),
      );

    if (stuck.length === 0) return;

    logger.info({ count: stuck.length }, "kanban-auto-fire: reconciling orphaned in_progress cards");

    // Group by jobId
    const byJob = new Map<string, typeof stuck>();
    for (const card of stuck) {
      if (!card.jobId) continue;
      const group = byJob.get(card.jobId) ?? [];
      group.push(card);
      byJob.set(card.jobId, group);
    }

    const processedClientIds = new Set<number>();

    for (const [jobId, cards] of byJob) {
      try {
        const cardIds        = cards.map(c => c.id);
        const { projectId, workflowStepId, clientUserId } = cards[0];
        if (projectId == null || clientUserId == null) continue;

        // Case 1: completionStatus already says script_completed but column is in_progress.
        // This happens when a sibling-stampede moved a completed card back. No Azure check needed.
        const allAlreadyDone = cards.every(c => c.completionStatus === "script_completed");
        if (allAlreadyDone) {
          await db.update(kanbanTasksTable)
            .set({ column: "completed", updatedAt: new Date() })
            .where(inArray(kanbanTasksTable.id, cardIds));
          const fixed = await db.select().from(kanbanTasksTable).where(inArray(kanbanTasksTable.id, cardIds));
          for (const t of fixed) broadcastKanbanChange(projectId, { action: "updated", task: t });
          logger.info({ cardIds, jobId }, "kanban-auto-fire: fixed sibling-stampede victims (column→completed)");
          processedClientIds.add(clientUserId);
          continue;
        }

        // Case 2: Check Azure for the real job outcome
        const { status } = await getJobStatus(jobId);

        if (!isTerminalStatus(status)) {
          // Still running in Azure — re-spawn the poller so we don't lose the result again
          const [runRow] = await db.select({ id: scriptRunResultsTable.id })
            .from(scriptRunResultsTable)
            .where(eq(scriptRunResultsTable.jobId, jobId))
            .limit(1);
          void runInBackground(jobId, cardIds, projectId, workflowStepId, clientUserId, runRow?.id, "(reconciled)", undefined);
          logger.info({ jobId, cardIds }, "kanban-auto-fire: re-spawned poller for job still running in Azure");
          continue;
        }

        // Terminal — settle the outcome
        const outputLines = await getJobOutput(jobId).catch(() => [] as Array<{ text: string }>);
        const output      = outputLines.map((l: { text: string }) => l.text).join("\n");
        const success     = status === "Completed";
        const summary     = output.split("\n").filter(Boolean).slice(-10).join("\n");
        const notesBody   = summary ? `\n\nOutput:\n${summary}` : "";

        // Update scriptRunResults if the row is still showing "running"
        const [runRow] = await db.select({ id: scriptRunResultsTable.id, currentStatus: scriptRunResultsTable.status })
          .from(scriptRunResultsTable)
          .where(eq(scriptRunResultsTable.jobId, jobId))
          .limit(1);
        if (runRow && runRow.currentStatus === "running") {
          await db.update(scriptRunResultsTable)
            .set({ status: success ? "completed" : "failed", rawOutput: { text: output, azureStatus: status } })
            .where(eq(scriptRunResultsTable.id, runRow.id));
        }

        if (success) {
          await db.update(kanbanTasksTable)
            .set({
              column:           "completed",
              completionStatus: "script_completed",
              completionNotes:  `Script run completed (job ${jobId}).${notesBody}`,
              updatedAt:        new Date(),
            })
            .where(inArray(kanbanTasksTable.id, cardIds));

          const completedRows = await db.select().from(kanbanTasksTable).where(inArray(kanbanTasksTable.id, cardIds));
          for (const t of completedRows) broadcastKanbanChange(projectId, { action: "updated", task: t });

          if (workflowStepId != null) {
            await advancePhaseIfComplete(workflowStepId, projectId);
          }
          processedClientIds.add(clientUserId);
        } else {
          await db.update(kanbanTasksTable)
            .set({
              completionStatus: "script_failed",
              completionNotes:  `Script run failed — status: ${status} (job ${jobId}).${notesBody}`,
              updatedAt:        new Date(),
            })
            .where(inArray(kanbanTasksTable.id, cardIds));

          const failedRows = await db.select().from(kanbanTasksTable).where(inArray(kanbanTasksTable.id, cardIds));
          for (const t of failedRows) broadcastKanbanChange(projectId, { action: "updated", task: t });
        }

        await syncProjectProgress(projectId);
        logger.info({ jobId, success, cardIds }, "kanban-auto-fire: reconciled orphaned job");
      } catch (err) {
        logger.warn({ err, jobId }, "kanban-auto-fire: could not reconcile this job (non-fatal)");
      }
    }

    // Continue the auto-fire chain for any client whose cards were just resolved
    for (const clientUserId of processedClientIds) {
      void autoFireFirstBacklogScript(clientUserId);
      void autoFireDocumentCard(clientUserId);
    }
  } catch (err) {
    logger.warn({ err }, "kanban-auto-fire: reconcileOrphanedRuns failed (non-fatal)");
  }
}

/**
 * Called once on server startup (after reconcileOrphanedRuns) to detect phases
 * that advanced successfully but whose auto-fire chain never started — e.g. because
 * the server was restarted between phase advance and the first autoFireFirstBacklogScript
 * call, or because the template runbook mapping was added after the cards were spawned.
 *
 * A "stalled phase" is: an in_progress workflow step that has at least one backlog
 * kanban card with a populated linkedRunbook in its metadata, and zero kanban cards
 * currently in_progress (meaning no job is already running for this client).
 */
export async function reconcileStalledPhases(): Promise<void> {
  if (!isAzureConfigured()) return;

  try {
    // Find projects with in_progress workflow steps
    const activeSteps = await db
      .select({
        stepId:       workflowStepsTable.id,
        projectId:    workflowStepsTable.projectId,
        clientUserId: projectsTable.clientUserId,
      })
      .from(workflowStepsTable)
      .innerJoin(projectsTable, eq(projectsTable.id, workflowStepsTable.projectId))
      .where(eq(workflowStepsTable.status, "in_progress"));

    if (activeSteps.length === 0) return;

    const stalledClientIds = new Set<number>();

    for (const step of activeSteps) {
      if (step.clientUserId == null) continue;

      // Check for any in_progress cards in this step (means auto-fire is already running)
      const [inProgressCard] = await db
        .select({ id: kanbanTasksTable.id })
        .from(kanbanTasksTable)
        .where(
          and(
            eq(kanbanTasksTable.workflowStepId, step.stepId),
            eq(kanbanTasksTable.column, "in_progress"),
          ),
        )
        .limit(1);

      if (inProgressCard) continue; // already running — skip

      // Check for backlog cards that have a linkedRunbook (auto-fireable)
      const [backlogCard] = await db
        .select({ id: kanbanTasksTable.id })
        .from(kanbanTasksTable)
        .where(
          and(
            eq(kanbanTasksTable.workflowStepId, step.stepId),
            eq(kanbanTasksTable.column, "backlog"),
            isNotNull(sql`task_metadata->'linkedRunbook'->>'azureRunbookName'`),
          ),
        )
        .limit(1);

      if (backlogCard) {
        logger.info(
          { stepId: step.stepId, projectId: step.projectId, clientUserId: step.clientUserId },
          "kanban-auto-fire: detected stalled phase — no in_progress cards but backlog script cards exist",
        );
        stalledClientIds.add(step.clientUserId);
      }
    }

    for (const clientUserId of stalledClientIds) {
      void autoFireFirstBacklogScript(clientUserId);
      void autoFireDocumentCard(clientUserId);
    }
  } catch (err) {
    logger.warn({ err }, "kanban-auto-fire: reconcileStalledPhases failed (non-fatal)");
  }
}
