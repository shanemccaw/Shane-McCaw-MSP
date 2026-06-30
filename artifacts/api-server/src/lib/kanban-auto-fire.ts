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
} from "@workspace/db";
import { eq, and, asc, inArray, sql } from "drizzle-orm";
import { logger } from "./logger";
import { createRunbookJob, getJobStatus, getJobOutput, isTerminalStatus, isAzureConfigured } from "./azure-automation";
import { getSecretValue } from "./azure-keyvault";
import { advancePhaseIfComplete, syncProjectProgress } from "./kanban-phase-advance";

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

async function findFirstBacklogScriptCard(clientUserId: number): Promise<EligibleCard | null> {
  const projects = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(eq(projectsTable.clientUserId, clientUserId));

  if (projects.length === 0) return null;
  const projectIds = projects.map(p => p.id);

  // Only look at tasks inside currently in_progress workflow steps
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

  // Fetch backlog script cards ordered by (stepId asc, order asc)
  const candidates = await db
    .select({
      id:             kanbanTasksTable.id,
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

  for (const card of candidates) {
    const meta = (card.taskMetadata ?? {}) as Record<string, unknown>;
    const lr = meta.linkedRunbook as LinkedRunbook | null | undefined;
    if (lr?.azureRunbookName) {
      return {
        id:             card.id,
        projectId:      card.projectId,
        workflowStepId: card.workflowStepId,
        linkedRunbook:  lr,
      };
    }
  }

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
): Promise<void> {
  try {
    const { success, lastStatus, output } = await pollJobToCompletion(jobId);

    const outputSummary = output.split("\n").filter(Boolean).slice(-10).join("\n");
    const notesBody = outputSummary ? `\n\nOutput:\n${outputSummary}` : "";

    if (success) {
      await db.update(kanbanTasksTable)
        .set({
          column:           "completed",
          completionStatus: "script_completed",
          completionNotes:  `Script run completed (job ${jobId}).${notesBody}`,
          updatedAt:        new Date(),
        })
        .where(inArray(kanbanTasksTable.id, cardIds));

      logger.info({ cardIds, jobId }, "kanban-auto-fire: script completed — cards moved to completed");

      // Phase advance for each unique workflowStepId
      if (workflowStepId != null) {
        const { spawnedTasks } = await advancePhaseIfComplete(workflowStepId, projectId);
        if (spawnedTasks.length > 0) {
          logger.info({ workflowStepId, projectId, spawnedCount: spawnedTasks.length }, "kanban-auto-fire: next phase activated");
        }
      }
    } else {
      // On failure: stamp completionNotes but leave column as in_progress
      await db.update(kanbanTasksTable)
        .set({
          completionStatus: "script_failed",
          completionNotes:  `Script run failed — status: ${lastStatus} (job ${jobId}).${notesBody}`,
          updatedAt:        new Date(),
        })
        .where(inArray(kanbanTasksTable.id, cardIds));

      logger.warn({ cardIds, jobId, lastStatus }, "kanban-auto-fire: script failed — cards remain in_progress");
    }

    // Clear runningJobRef
    const metaRows = await db
      .select({ id: kanbanTasksTable.id, taskMetadata: kanbanTasksTable.taskMetadata })
      .from(kanbanTasksTable)
      .where(inArray(kanbanTasksTable.id, cardIds));
    for (const row of metaRows) {
      const meta = ((row.taskMetadata ?? {}) as Record<string, unknown>);
      await db.update(kanbanTasksTable)
        .set({ taskMetadata: { ...meta, runningJobRef: null } })
        .where(eq(kanbanTasksTable.id, row.id));
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
        .set({ taskMetadata: { ...meta, runningJobRef: jobId }, updatedAt: new Date() })
        .where(eq(kanbanTasksTable.id, row.id));
    }

    logger.info(
      { clientUserId, jobId, runbook: card.linkedRunbook.azureRunbookName, cardIds: siblingIds },
      "kanban-auto-fire: job started — polling in background",
    );

    // Detached — does NOT block the HTTP response
    void runInBackground(jobId, siblingIds, card.projectId, card.workflowStepId);
  } catch (err) {
    logger.warn({ err, clientUserId }, "kanban-auto-fire: unexpected error (non-fatal)");
  }
}
