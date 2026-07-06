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
  wfDefinitionsTable,
  wfVersionsTable,
  wfRunsTable,
} from "@workspace/db";
import { eq, and, asc, inArray, isNotNull, sql } from "drizzle-orm";
import { logger } from "./logger";
import { createRunbookJob, getJobStatus, getJobOutput, isTerminalStatus, isAzureConfigured } from "./azure-automation";
import { getSecretValue } from "./azure-keyvault";
import { advancePhaseIfComplete, syncProjectProgress } from "./kanban-phase-advance";
import { broadcastKanbanChange } from "./sse-broadcast";
import { runAiAnalyzer } from "./ai-analyzer";
import { generateAndDeliverDocument, type DocumentGenerationConfig } from "./document-generator";
import { executeWorkflowRun } from "./workflow-executor";
import { sendWebPushToAdmins } from "./web-push";
import { sendEmailOrThrow, brandedEmail } from "./mailer";
import { MAX_AUTO_FIRE_FAILURES, computeNextFailureState } from "./kanban-auto-fire-retry-utils";
import { parseM365ScriptOutput } from "./parse-m365-script-output";
import { applyProfileUpdates, snapshotHealthFromProfile } from "./m365-profile-update";

// Re-export so callers that previously imported these from this module continue to work.
export { MAX_AUTO_FIRE_FAILURES, computeNextFailureState };

const POLL_INTERVAL_MS = 5_000;
const JOB_TIMEOUT_MS   = 10 * 60 * 1000;

/**
 * Resolves the admin-panel base URL for alert email links.
 * Mirrors the pattern used in manual-script-escalation.ts.
 */
function getAdminPanelBase(): string {
  if (process.env.ADMIN_PANEL_URL) return process.env.ADMIN_PANEL_URL;
  const domains = (process.env.REPLIT_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  const custom = domains.find((d) => !d.includes("replit."));
  if (custom) return `https://${custom}/admin-panel`;
  const app = domains.find((d) => d.endsWith(".replit.app"));
  if (app) return `https://${app}/admin-panel`;
  const dev = domains.find((d) => d.endsWith(".replit.dev")) ?? process.env.REPLIT_DEV_DOMAIN;
  if (dev) return `https://${dev}/admin-panel`;
  return "https://shanemccaw.com/admin-panel";
}

/**
 * Sends Shane a push notification and email when a Kanban auto-fire job
 * has exhausted its retry budget without succeeding.
 * Both channels are attempted independently; failures are non-fatal.
 */
async function alertAutoFireExhausted(opts: {
  cardIds: number[];
  projectId: number;
  clientUserId: number;
  jobId: string;
  lastStatus: string;
  scriptTitle: string;
  failureCount: number;
}): Promise<void> {
  const { cardIds, projectId, clientUserId, jobId, lastStatus, scriptTitle, failureCount } = opts;
  const projectUrl = `${getAdminPanelBase()}/crm/projects/${projectId}`;
  const shaneEmail = process.env.ADMIN_EMAIL ?? process.env.CRM_ADMIN_EMAIL ?? "info@shanemccaw.com";

  const pushBody =
    `Script "${scriptTitle}" failed ${failureCount}× for client #${clientUserId} ` +
    `(last status: ${lastStatus}). Cards #${cardIds.join(", ")} need manual review.`;

  try {
    await sendWebPushToAdmins({
      title: "⚠️ Kanban auto-fire exhausted retry budget",
      body: pushBody,
      linkPath: `/admin-panel/crm/projects/${projectId}`,
      playSound: true,
    });
  } catch (pushErr) {
    logger.warn({ pushErr }, "kanban-auto-fire: push notification failed (non-fatal)");
  }

  const bodyHtml = `
    <p>Hi Shane,</p>
    <p>The Kanban auto-fire workflow has exhausted its retry budget (<strong>${failureCount} consecutive failures</strong>) for the following script card and can no longer automatically recover.</p>
    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;width:100%;">
      <tbody>
        <tr style="background:#fef2f2;">
          <td style="padding:10px 16px;font-size:13px;color:#64748b;font-weight:600;white-space:nowrap;">Script</td>
          <td style="padding:10px 16px;font-size:14px;">${scriptTitle}</td>
        </tr>
        <tr>
          <td style="padding:10px 16px;font-size:13px;color:#64748b;font-weight:600;">Card IDs</td>
          <td style="padding:10px 16px;font-size:14px;">${cardIds.join(", ")}</td>
        </tr>
        <tr style="background:#f8fafc;">
          <td style="padding:10px 16px;font-size:13px;color:#64748b;font-weight:600;">Last Azure status</td>
          <td style="padding:10px 16px;font-size:14px;font-weight:700;color:#dc2626;">${lastStatus}</td>
        </tr>
        <tr>
          <td style="padding:10px 16px;font-size:13px;color:#64748b;font-weight:600;">Job ID</td>
          <td style="padding:10px 16px;font-size:14px;font-family:monospace;">${jobId}</td>
        </tr>
        <tr style="background:#f8fafc;">
          <td style="padding:10px 16px;font-size:13px;color:#64748b;font-weight:600;">Failures</td>
          <td style="padding:10px 16px;font-size:14px;font-weight:700;color:#dc2626;">${failureCount} / ${MAX_AUTO_FIRE_FAILURES}</td>
        </tr>
      </tbody>
    </table>
    <p>The cards have been left in backlog with status <strong>auto_fire_exhausted</strong>. Please review the Azure Automation account and then manually trigger the script from the Admin Panel.</p>
    <p style="margin-top:24px;">
      <a href="${projectUrl}" style="background:#0078D4;color:#ffffff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">View project in Admin Panel →</a>
    </p>
    <p style="margin-top:24px;">— Shane McCaw Consulting (automated alert)</p>
  `;

  try {
    await sendEmailOrThrow(
      shaneEmail,
      `⚠️ Kanban auto-fire exhausted — "${scriptTitle}" (${failureCount} failures)`,
      brandedEmail(bodyHtml),
    );
    logger.info({ shaneEmail, cardIds, scriptTitle }, "kanban-auto-fire: exhaustion alert email sent");
  } catch (emailErr) {
    logger.warn({ emailErr, cardIds }, "kanban-auto-fire: exhaustion alert email failed (non-fatal)");
  }
}

async function alertDocumentAutoFireExhausted(opts: {
  cardId: number;
  projectId: number;
  clientUserId: number;
  docType: string;
  docTitle: string;
  failureCount: number;
  lastError: string;
}): Promise<void> {
  const { cardId, projectId, clientUserId, docType, docTitle, failureCount, lastError } = opts;
  const projectUrl = `${getAdminPanelBase()}/crm/projects/${projectId}`;
  const shaneEmail = process.env.ADMIN_EMAIL ?? process.env.CRM_ADMIN_EMAIL ?? "info@shanemccaw.com";

  const pushBody =
    `Document "${docTitle}" (${docType}) failed ${failureCount}× for client #${clientUserId}. ` +
    `Card #${cardId} needs manual review.`;

  try {
    await sendWebPushToAdmins({
      title: "⚠️ Document auto-fire exhausted retry budget",
      body: pushBody,
      linkPath: `/admin-panel/crm/projects/${projectId}`,
      playSound: true,
    });
  } catch (pushErr) {
    logger.warn({ pushErr }, "kanban-auto-fire: document push notification failed (non-fatal)");
  }

  const bodyHtml = `
    <p>Hi Shane,</p>
    <p>The Kanban document-generation auto-fire has exhausted its retry budget (<strong>${failureCount} consecutive failures</strong>) for the following card and can no longer automatically recover.</p>
    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;width:100%;">
      <tbody>
        <tr style="background:#fef2f2;">
          <td style="padding:10px 16px;font-size:13px;color:#64748b;font-weight:600;white-space:nowrap;">Document</td>
          <td style="padding:10px 16px;font-size:14px;">${docTitle}</td>
        </tr>
        <tr>
          <td style="padding:10px 16px;font-size:13px;color:#64748b;font-weight:600;">Doc type</td>
          <td style="padding:10px 16px;font-size:14px;font-family:monospace;">${docType}</td>
        </tr>
        <tr style="background:#f8fafc;">
          <td style="padding:10px 16px;font-size:13px;color:#64748b;font-weight:600;">Card ID</td>
          <td style="padding:10px 16px;font-size:14px;">${cardId}</td>
        </tr>
        <tr>
          <td style="padding:10px 16px;font-size:13px;color:#64748b;font-weight:600;">Last error</td>
          <td style="padding:10px 16px;font-size:14px;font-weight:700;color:#dc2626;">${lastError}</td>
        </tr>
        <tr style="background:#f8fafc;">
          <td style="padding:10px 16px;font-size:13px;color:#64748b;font-weight:600;">Failures</td>
          <td style="padding:10px 16px;font-size:14px;font-weight:700;color:#dc2626;">${failureCount} / ${MAX_AUTO_FIRE_FAILURES}</td>
        </tr>
      </tbody>
    </table>
    <p>The card has been left in backlog with status <strong>auto_fire_exhausted</strong>. Please review the AI / document-generation configuration and then manually trigger the document from the Admin Panel.</p>
    <p style="margin-top:24px;">
      <a href="${projectUrl}" style="background:#0078D4;color:#ffffff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">View project in Admin Panel →</a>
    </p>
    <p style="margin-top:24px;">— Shane McCaw Consulting (automated alert)</p>
  `;

  try {
    await sendEmailOrThrow(
      shaneEmail,
      `⚠️ Document auto-fire exhausted — "${docTitle}" (${failureCount} failures)`,
      brandedEmail(bodyHtml),
    );
    logger.info({ shaneEmail, cardId, docTitle }, "kanban-auto-fire: document exhaustion alert email sent");
  } catch (emailErr) {
    logger.warn({ emailErr, cardId }, "kanban-auto-fire: document exhaustion alert email failed (non-fatal)");
  }
}

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

  // Fetch backlog cards ordered by (stepId asc, order asc).
  // Exclude cards that have exhausted their retry budget — they need manual
  // intervention and must not be auto-fired again.
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
        sql`"completion_status" IS DISTINCT FROM 'auto_fire_exhausted'`,
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

    // Merge deterministic + AI profile updates (deterministic fields take precedence)
    const deterministicUpdates = parseM365ScriptOutput(output);
    const mergedProfileUpdates = { ...(aiResult?.profileUpdates ?? {}), ...deterministicUpdates };

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
            profileUpdates: mergedProfileUpdates,
          })
          .where(eq(scriptRunResultsTable.id, runResultId));
      } catch (updateErr) {
        logger.warn({ updateErr, runResultId, jobId }, "kanban-auto-fire: could not update script_run_results (non-fatal)");
      }
    }

    // WRITE 1b: apply profile updates to client_m365_profiles and snapshot health scores.
    // This is intentionally separate from WRITE 1 so a DB error here doesn't block the
    // script_run_results update above.
    try {
      await applyProfileUpdates(clientUserId, mergedProfileUpdates);
    } catch (profileErr) {
      logger.warn({ profileErr, clientUserId, jobId }, "kanban-auto-fire: failed to apply profile updates (non-fatal)");
    }
    if (success) {
      try {
        await snapshotHealthFromProfile(clientUserId);
      } catch (snapErr) {
        logger.warn({ snapErr, clientUserId, jobId }, "kanban-auto-fire: failed to snapshot health scores (non-fatal)");
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

      // Always look for the next backlog card (script, document, or sub-workflow) in this client's
      // active phase. Without this, only the first card fires — subsequent cards in the same phase
      // never get picked up because advancePhaseIfComplete only fires when ALL cards
      // in the step are complete.
      void autoFireFirstBacklogScript(clientUserId);
      void autoFireDocumentCard(clientUserId);
      void autoFireRunWorkflowCards(clientUserId);
    } else {
      // ── Failure recovery: revert cards to backlog and track retry budget ──
      //
      // Read the primary card's metadata to get the current failure count.
      // All sibling cards track the same job, so reading the primary is sufficient.
      const primaryCardId = cardIds[0];
      let currentFailureCount = 0;
      if (primaryCardId != null) {
        try {
          const [primaryCard] = await db
            .select({ taskMetadata: kanbanTasksTable.taskMetadata })
            .from(kanbanTasksTable)
            .where(eq(kanbanTasksTable.id, primaryCardId))
            .limit(1);
          const meta = (primaryCard?.taskMetadata ?? {}) as Record<string, unknown>;
          currentFailureCount = typeof meta.autoFireFailureCount === "number" ? meta.autoFireFailureCount : 0;
        } catch (readErr) {
          logger.warn({ readErr, primaryCardId }, "kanban-auto-fire: could not read failure count (defaulting to 0)");
        }
      }
      const { newCount: newFailureCount, exhausted, completionStatus: failCompletionStatus } = computeNextFailureState(currentFailureCount);

      // Update each card: revert to backlog and stamp failure metadata
      const failMetaRows = await db
        .select({ id: kanbanTasksTable.id, taskMetadata: kanbanTasksTable.taskMetadata })
        .from(kanbanTasksTable)
        .where(inArray(kanbanTasksTable.id, cardIds));

      for (const row of failMetaRows) {
        const meta = (row.taskMetadata ?? {}) as Record<string, unknown>;
        await db.update(kanbanTasksTable)
          .set({
            // Return to backlog so the reconcile loop or the next trigger can retry
            column:           "backlog",
            completionStatus: failCompletionStatus,
            completionNotes:  `Script run failed — status: ${lastStatus} (job ${jobId}). Attempt ${newFailureCount}/${MAX_AUTO_FIRE_FAILURES}.${notesBody}`,
            taskMetadata: {
              ...meta,
              runningJobRef:        null,
              lastJobStatus:        lastStatus,
              lastJobId:            jobId,
              autoFireFailureCount: newFailureCount,
              lastFailureReason:    `${lastStatus} (job ${jobId})`,
              lastFailedAt:         new Date().toISOString(),
              ...(exhausted ? { autoFireExhaustedAt: new Date().toISOString() } : {}),
            },
            updatedAt: new Date(),
          })
          .where(eq(kanbanTasksTable.id, row.id));
      }

      {
        const revertedRows = await db.select().from(kanbanTasksTable).where(inArray(kanbanTasksTable.id, cardIds));
        for (const t of revertedRows) broadcastKanbanChange(projectId, { action: "updated", task: t });
      }

      if (exhausted) {
        logger.warn(
          { cardIds, jobId, lastStatus, newFailureCount, clientUserId },
          "kanban-auto-fire: retry budget exhausted — cards reverted to backlog with auto_fire_exhausted; alerting Shane",
        );
        // Non-blocking — alert failures must not stall the outer catch
        void alertAutoFireExhausted({
          cardIds,
          projectId,
          clientUserId,
          jobId,
          lastStatus,
          scriptTitle,
          failureCount: newFailureCount,
        });
      } else {
        logger.warn(
          { cardIds, jobId, lastStatus, newFailureCount, maxFailures: MAX_AUTO_FIRE_FAILURES },
          "kanban-auto-fire: script failed — cards reverted to backlog (will be retried by reconcile loop)",
        );
      }
    }

    await syncProjectProgress(projectId);
  } catch (err) {
    logger.warn({ err, jobId, cardIds }, "kanban-auto-fire: background run error — recovering cards to backlog");

    // Recovery: when an unexpected exception escapes the polling loop (e.g., Azure
    // network failure, auth error, or mid-poll process restart), cards are still
    // in_progress with runningJobRef. Revert them to backlog with the retry budget
    // so they are not stuck forever.
    try {
      const [primaryCard] = await db
        .select({ taskMetadata: kanbanTasksTable.taskMetadata })
        .from(kanbanTasksTable)
        .where(eq(kanbanTasksTable.id, cardIds[0]!))
        .limit(1);
      const existingMeta = ((primaryCard?.taskMetadata ?? {}) as Record<string, unknown>);
      const currentCount = typeof existingMeta.autoFireFailureCount === "number" ? existingMeta.autoFireFailureCount : 0;
      const { newCount: catchFailCount, exhausted: catchExhausted, completionStatus: catchStatus } = computeNextFailureState(currentCount);

      const catchRows = await db
        .select({ id: kanbanTasksTable.id, taskMetadata: kanbanTasksTable.taskMetadata })
        .from(kanbanTasksTable)
        .where(inArray(kanbanTasksTable.id, cardIds));

      for (const row of catchRows) {
        const rowMeta = ((row.taskMetadata ?? {}) as Record<string, unknown>);
        await db.update(kanbanTasksTable)
          .set({
            column:           "backlog",
            completionStatus: catchStatus,
            completionNotes:  `Azure polling exception. Attempt ${catchFailCount}/${MAX_AUTO_FIRE_FAILURES}.`,
            taskMetadata: {
              ...rowMeta,
              runningJobRef:        null,
              autoFireFailureCount: catchFailCount,
              lastFailureReason:    `Polling exception: ${String(err).slice(0, 200)}`,
              lastFailedAt:         new Date().toISOString(),
              ...(catchExhausted ? { autoFireExhaustedAt: new Date().toISOString() } : {}),
            },
            updatedAt: new Date(),
          })
          .where(eq(kanbanTasksTable.id, row.id));
      }

      const catchRevertedRows = await db.select().from(kanbanTasksTable).where(inArray(kanbanTasksTable.id, cardIds));
      for (const t of catchRevertedRows) broadcastKanbanChange(projectId, { action: "updated", task: t });

      if (catchExhausted) {
        void alertAutoFireExhausted({
          cardIds,
          projectId,
          clientUserId,
          jobId,
          lastStatus: "PollingException",
          scriptTitle,
          failureCount: catchFailCount,
        });
      }

      logger.info(
        { cardIds, jobId, catchFailCount, catchExhausted },
        "kanban-auto-fire: cards reverted to backlog after background polling error",
      );
    } catch (recoverErr) {
      logger.warn({ recoverErr, cardIds, jobId }, "kanban-auto-fire: catch-block recovery also failed — cards may remain in_progress");
    }
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

/** docTypes that must wait until all other document cards are done */
const SOW_DOC_TYPES = new Set(["sow", "consolidated_sow"]);

async function findAllBacklogDocumentCards(clientUserId: number): Promise<DocumentCard[]> {
  const projects = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(eq(projectsTable.clientUserId, clientUserId));

  if (projects.length === 0) return [];
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
  if (activeStepIds.length === 0) return [];

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
        sql`"completion_status" IS DISTINCT FROM 'auto_fire_exhausted'`,
      ),
    )
    .orderBy(asc(kanbanTasksTable.workflowStepId), asc(kanbanTasksTable.order));

  const results: DocumentCard[] = [];
  for (const card of candidates) {
    const meta = (card.taskMetadata ?? {}) as Record<string, unknown>;
    const dg = meta.documentGeneration as DocumentGenerationConfig | undefined;
    if (dg?.category && dg?.docType && dg?.title) {
      results.push({
        id: card.id,
        projectId: card.projectId,
        workflowStepId: card.workflowStepId,
        documentGeneration: dg,
      });
    }
  }
  return results;
}

/**
 * Returns the count of non-SOW document_generation cards that are currently
 * in_progress for the client. Used to gate SOW firing — we only start the SOW
 * once this count reaches zero.
 */
async function countInProgressNonSowDocCards(clientUserId: number): Promise<number> {
  const projects = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(eq(projectsTable.clientUserId, clientUserId));

  if (projects.length === 0) return 0;
  const projectIds = projects.map(p => p.id);

  const rows = await db
    .select({ id: kanbanTasksTable.id, taskMetadata: kanbanTasksTable.taskMetadata })
    .from(kanbanTasksTable)
    .where(
      and(
        inArray(kanbanTasksTable.projectId, projectIds),
        eq(kanbanTasksTable.column, "in_progress"),
        eq(kanbanTasksTable.taskType, "document_generation"),
      ),
    );

  return rows.filter(row => {
    const meta = (row.taskMetadata ?? {}) as Record<string, unknown>;
    const dg = meta.documentGeneration as { docType?: string } | undefined;
    return dg?.docType !== undefined && !SOW_DOC_TYPES.has(dg.docType);
  }).length;
}

/**
 * Generates and completes a single document_generation card.
 * Moves card → in_progress (caller's responsibility, done atomically before
 * parallel dispatch), calls AI, moves → completed, advances the phase, then
 * triggers the next round of auto-fire (for newly-unlocked cards).
 */
async function fireDocumentCard(clientUserId: number, card: DocumentCard): Promise<void> {
  // Read current metadata up front so we have the existing failure count and can
  // preserve all other fields on both the failure and success paths.
  const [metaRow] = await db
    .select({ taskMetadata: kanbanTasksTable.taskMetadata })
    .from(kanbanTasksTable)
    .where(eq(kanbanTasksTable.id, card.id));
  const prevMeta = ((metaRow?.taskMetadata ?? {}) as Record<string, unknown>);
  const currentFailureCount = typeof prevMeta.autoFireFailureCount === "number" ? prevMeta.autoFireFailureCount : 0;

  logger.info(
    { clientUserId, cardId: card.id, docType: card.documentGeneration.docType, currentFailureCount },
    "kanban-auto-fire: auto-firing document generation card",
  );

  let documentId: number;
  try {
    const result = await generateAndDeliverDocument(clientUserId, card.projectId, card.documentGeneration);
    documentId = result.documentId;
  } catch (genErr) {
    const { newCount, exhausted, completionStatus: failStatus } = computeNextFailureState(currentFailureCount);
    const failureReason = genErr instanceof Error ? genErr.message : String(genErr);

    await db.update(kanbanTasksTable)
      .set({
        column:           "backlog",
        completionStatus: failStatus,
        completionNotes:  `Document generation failed. Attempt ${newCount}/${MAX_AUTO_FIRE_FAILURES}. Error: ${failureReason.slice(0, 200)}`,
        taskMetadata: {
          ...prevMeta,
          autoFireFailureCount: newCount,
          lastFailureReason:    failureReason,
          lastFailedAt:         new Date().toISOString(),
          ...(exhausted ? { autoFireExhaustedAt: new Date().toISOString() } : {}),
        },
        updatedAt: new Date(),
      })
      .where(eq(kanbanTasksTable.id, card.id));

    const [reverted] = await db.select().from(kanbanTasksTable).where(eq(kanbanTasksTable.id, card.id));
    if (reverted) broadcastKanbanChange(card.projectId, { action: "updated", task: reverted });

    logger.error(
      { genErr, clientUserId, cardId: card.id, newCount, exhausted },
      "kanban-auto-fire: document generation failed — card reverted to backlog",
    );

    if (exhausted) {
      logger.warn(
        { cardId: card.id, clientUserId, failureCount: newCount },
        "kanban-auto-fire: document retry budget exhausted — alerting Shane",
      );
      void alertDocumentAutoFireExhausted({
        cardId:       card.id,
        projectId:    card.projectId,
        clientUserId,
        docType:      card.documentGeneration.docType,
        docTitle:     card.documentGeneration.title,
        failureCount: newCount,
        lastError:    failureReason,
      });
    }
    return;
  }

  // Stamp documentId into metadata and move to completed.
  // Reset the failure counter on success so future re-runs start fresh.

  const { autoFireFailureCount: _dropped1, lastFailureReason: _dropped2, lastFailedAt: _dropped3, ...cleanMeta } = prevMeta;
  await db.update(kanbanTasksTable)
    .set({
      column:           "completed",
      completionStatus: "document_generated",
      completionNotes:  `Document "${card.documentGeneration.title}" generated and delivered to client portal (ID: ${documentId}).`,
      taskMetadata:     { ...cleanMeta, generatedDocumentId: documentId },
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

  // Phase advance — activates next workflow phase if all cards in this step are done
  if (card.workflowStepId != null) {
    const { spawnedTasks } = await advancePhaseIfComplete(card.workflowStepId, card.projectId);
    if (spawnedTasks.length > 0) {
      logger.info(
        { workflowStepId: card.workflowStepId, projectId: card.projectId, spawnedCount: spawnedTasks.length },
        "kanban-auto-fire: next phase activated after document generation",
      );
    }
  }

  // Trigger a new round — picks up newly-unlocked cards AND checks whether the
  // SOW gate condition is now satisfied (all non-SOW docs done).
  void autoFireAllDocumentCards(clientUserId);
  void autoFireFirstBacklogScript(clientUserId);
  void autoFireRunWorkflowCards(clientUserId);
}

/**
 * Fires ALL eligible backlog document_generation cards for a client in parallel,
 * with one exception: SOW cards are held back until every non-SOW document card
 * is in "completed" state (i.e. none remain in backlog OR in_progress).
 *
 * This replaces the old sequential chain-reaction pattern where completing one
 * card triggered the next, producing needlessly long wall-clock times.
 *
 * Called alongside autoFireFirstBacklogScript everywhere.
 */
export async function autoFireAllDocumentCards(clientUserId: number): Promise<void> {
  try {
    const allBacklog = await findAllBacklogDocumentCards(clientUserId);

    const nonSow = allBacklog.filter(c => !SOW_DOC_TYPES.has(c.documentGeneration.docType));
    const sow    = allBacklog.filter(c =>  SOW_DOC_TYPES.has(c.documentGeneration.docType));

    // ── 1. Fire all non-SOW docs simultaneously ───────────────────────────
    if (nonSow.length > 0) {
      logger.info(
        { clientUserId, count: nonSow.length, docTypes: nonSow.map(c => c.documentGeneration.docType) },
        "kanban-auto-fire: firing non-SOW document cards in parallel",
      );

      // Move ALL cards to in_progress atomically before dispatching any AI calls.
      // This prevents concurrent callers from picking up the same cards.
      const nonSowIds = nonSow.map(c => c.id);
      await db.update(kanbanTasksTable)
        .set({ column: "in_progress", updatedAt: new Date() })
        .where(inArray(kanbanTasksTable.id, nonSowIds));

      for (const card of nonSow) {
        const [updated] = await db.select().from(kanbanTasksTable).where(eq(kanbanTasksTable.id, card.id));
        if (updated) broadcastKanbanChange(card.projectId, { action: "updated", task: updated });
      }

      // Fire all in parallel — Promise.allSettled so one failure doesn't abort the rest
      await Promise.allSettled(nonSow.map(card => fireDocumentCard(clientUserId, card)));
    }

    // ── 2. Fire SOW only when all non-SOW docs are fully done ────────────
    if (sow.length > 0) {
      // Count non-SOW cards still in_progress (could have been started by a
      // concurrent autoFireAllDocumentCards call or a prior parallel batch).
      const inProgressNonSow = await countInProgressNonSowDocCards(clientUserId);
      if (inProgressNonSow > 0) {
        logger.info(
          { clientUserId, inProgressNonSow, sowCount: sow.length },
          "kanban-auto-fire: SOW deferred — non-SOW documents still in progress",
        );
        // The last non-SOW to complete will call autoFireAllDocumentCards again,
        // which will re-evaluate this condition and fire the SOW at that point.
        return;
      }

      logger.info(
        { clientUserId, count: sow.length },
        "kanban-auto-fire: all non-SOW docs complete — firing SOW document cards",
      );

      const sowIds = sow.map(c => c.id);
      await db.update(kanbanTasksTable)
        .set({ column: "in_progress", updatedAt: new Date() })
        .where(inArray(kanbanTasksTable.id, sowIds));

      for (const card of sow) {
        const [updated] = await db.select().from(kanbanTasksTable).where(eq(kanbanTasksTable.id, card.id));
        if (updated) broadcastKanbanChange(card.projectId, { action: "updated", task: updated });
      }

      await Promise.allSettled(sow.map(card => fireDocumentCard(clientUserId, card)));
    }

    if (nonSow.length === 0 && sow.length === 0) {
      logger.debug({ clientUserId }, "kanban-auto-fire: no eligible backlog document cards found");
    }
  } catch (err) {
    logger.warn({ err, clientUserId }, "kanban-auto-fire: autoFireAllDocumentCards unexpected error (non-fatal)");
  }
}

/** @deprecated Use autoFireAllDocumentCards — kept for call-site backward compatibility */
export const autoFireDocumentCard = autoFireAllDocumentCards;

// ─── Run Workflow auto-fire ────────────────────────────────────────────────────

interface RunWorkflowCard {
  id: number;
  projectId: number;
  workflowStepId: number | null;
  runWorkflow: {
    workflowId: number;
    inputMapping: Array<{ key: string; expr: string }>;
  };
}

async function findAllBacklogRunWorkflowCards(clientUserId: number): Promise<RunWorkflowCard[]> {
  const projects = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(eq(projectsTable.clientUserId, clientUserId));

  if (projects.length === 0) return [];
  const projectIds = projects.map(p => p.id);

  const activeSteps = await db
    .select({ id: workflowStepsTable.id })
    .from(workflowStepsTable)
    .where(and(
      inArray(workflowStepsTable.projectId, projectIds),
      eq(workflowStepsTable.status, "in_progress"),
    ));

  const activeStepIds = activeSteps.map(s => s.id);
  if (activeStepIds.length === 0) return [];

  const candidates = await db
    .select({
      id:             kanbanTasksTable.id,
      projectId:      kanbanTasksTable.projectId,
      workflowStepId: kanbanTasksTable.workflowStepId,
      taskMetadata:   kanbanTasksTable.taskMetadata,
    })
    .from(kanbanTasksTable)
    .where(and(
      inArray(kanbanTasksTable.workflowStepId, activeStepIds),
      eq(kanbanTasksTable.column, "backlog"),
      eq(kanbanTasksTable.taskType, "run_workflow"),
      sql`"completion_status" IS DISTINCT FROM 'auto_fire_exhausted'`,
    ))
    .orderBy(asc(kanbanTasksTable.workflowStepId), asc(kanbanTasksTable.order));

  const results: RunWorkflowCard[] = [];
  for (const card of candidates) {
    const meta = (card.taskMetadata ?? {}) as Record<string, unknown>;
    const rw = meta.runWorkflow as { workflowId?: number; inputMapping?: Array<{ key: string; expr: string }> } | undefined;
    if (rw?.workflowId) {
      results.push({
        id: card.id,
        projectId: card.projectId,
        workflowStepId: card.workflowStepId,
        runWorkflow: {
          workflowId: rw.workflowId,
          inputMapping: rw.inputMapping ?? [],
        },
      });
    }
  }
  return results;
}

async function fireRunWorkflowCard(clientUserId: number, card: RunWorkflowCard): Promise<void> {
  const [metaRow] = await db
    .select({ taskMetadata: kanbanTasksTable.taskMetadata })
    .from(kanbanTasksTable)
    .where(eq(kanbanTasksTable.id, card.id));
  const prevMeta = ((metaRow?.taskMetadata ?? {}) as Record<string, unknown>);
  const currentFailureCount = typeof prevMeta.autoFireFailureCount === "number" ? prevMeta.autoFireFailureCount : 0;

  logger.info(
    { clientUserId, cardId: card.id, workflowId: card.runWorkflow.workflowId, currentFailureCount },
    "kanban-auto-fire: auto-firing run_workflow card",
  );

  // Find the published version for the chosen workflow definition
  const [versionRow] = await db
    .select({ id: wfVersionsTable.id })
    .from(wfVersionsTable)
    .where(and(
      eq(wfVersionsTable.definitionId, card.runWorkflow.workflowId),
      eq(wfVersionsTable.status, "published"),
    ))
    .limit(1);

  if (!versionRow) {
    const { newCount, exhausted, completionStatus: failStatus } = computeNextFailureState(currentFailureCount);
    await db.update(kanbanTasksTable)
      .set({
        column:           "backlog",
        completionStatus: failStatus,
        completionNotes:  `No published version found for workflow ${card.runWorkflow.workflowId}. Attempt ${newCount}/${MAX_AUTO_FIRE_FAILURES}.`,
        taskMetadata: {
          ...prevMeta,
          autoFireFailureCount: newCount,
          lastFailureReason:    `No published version for workflowId ${card.runWorkflow.workflowId}`,
          lastFailedAt:         new Date().toISOString(),
          ...(exhausted ? { autoFireExhaustedAt: new Date().toISOString() } : {}),
        },
        updatedAt: new Date(),
      })
      .where(eq(kanbanTasksTable.id, card.id));
    const [reverted] = await db.select().from(kanbanTasksTable).where(eq(kanbanTasksTable.id, card.id));
    if (reverted) broadcastKanbanChange(card.projectId, { action: "updated", task: reverted });
    logger.error(
      { clientUserId, cardId: card.id, workflowId: card.runWorkflow.workflowId, newCount, exhausted },
      "kanban-auto-fire: run_workflow no published version — card reverted to backlog",
    );
    return;
  }

  // Build payload: clientUserId + projectId as defaults, then inputMapping overrides
  const basePayload: Record<string, unknown> = {
    clientUserId,
    projectId: card.projectId,
  };
  for (const { key, expr } of card.runWorkflow.inputMapping) {
    if (key) basePayload[key] = expr;
  }

  // Create the run record
  let childRunId: number;
  try {
    const [runRow] = await db
      .insert(wfRunsTable)
      .values({
        versionId:    versionRow.id,
        definitionId: card.runWorkflow.workflowId,
        triggerType:  "manual",
        triggerRef:   `kanban_auto_fire:card:${card.id}`,
        payload:      basePayload,
        status:       "pending",
      })
      .returning({ id: wfRunsTable.id });
    if (!runRow?.id) throw new Error("failed to insert wf_runs row");
    childRunId = runRow.id;
  } catch (insertErr) {
    const { newCount, exhausted, completionStatus: failStatus } = computeNextFailureState(currentFailureCount);
    const failureReason = insertErr instanceof Error ? insertErr.message : String(insertErr);
    await db.update(kanbanTasksTable)
      .set({
        column:           "backlog",
        completionStatus: failStatus,
        completionNotes:  `Failed to create workflow run. Attempt ${newCount}/${MAX_AUTO_FIRE_FAILURES}.`,
        taskMetadata: {
          ...prevMeta,
          autoFireFailureCount: newCount,
          lastFailureReason:    failureReason,
          lastFailedAt:         new Date().toISOString(),
          ...(exhausted ? { autoFireExhaustedAt: new Date().toISOString() } : {}),
        },
        updatedAt: new Date(),
      })
      .where(eq(kanbanTasksTable.id, card.id));
    const [reverted] = await db.select().from(kanbanTasksTable).where(eq(kanbanTasksTable.id, card.id));
    if (reverted) broadcastKanbanChange(card.projectId, { action: "updated", task: reverted });
    logger.error({ insertErr, clientUserId, cardId: card.id, newCount, exhausted },
      "kanban-auto-fire: run_workflow failed to create run — card reverted to backlog");
    return;
  }

  // Execute synchronously
  try {
    await executeWorkflowRun(childRunId);
  } catch (execErr) {
    const { newCount, exhausted, completionStatus: failStatus } = computeNextFailureState(currentFailureCount);
    const failureReason = execErr instanceof Error ? execErr.message : String(execErr);
    const { autoFireFailureCount: _d1, lastFailureReason: _d2, lastFailedAt: _d3, ...cleanMeta } = prevMeta;
    await db.update(kanbanTasksTable)
      .set({
        column:           "backlog",
        completionStatus: failStatus,
        completionNotes:  `Workflow execution threw an exception. Attempt ${newCount}/${MAX_AUTO_FIRE_FAILURES}. Error: ${failureReason.slice(0, 200)}`,
        taskMetadata: {
          ...cleanMeta,
          runWorkflow:          { ...card.runWorkflow, childRunId },
          autoFireFailureCount: newCount,
          lastFailureReason:    failureReason,
          lastFailedAt:         new Date().toISOString(),
          ...(exhausted ? { autoFireExhaustedAt: new Date().toISOString() } : {}),
        },
        updatedAt: new Date(),
      })
      .where(eq(kanbanTasksTable.id, card.id));
    const [reverted] = await db.select().from(kanbanTasksTable).where(eq(kanbanTasksTable.id, card.id));
    if (reverted) broadcastKanbanChange(card.projectId, { action: "updated", task: reverted });
    logger.error({ execErr, clientUserId, cardId: card.id, childRunId, newCount, exhausted },
      "kanban-auto-fire: run_workflow execution threw — card reverted to backlog");
    return;
  }

  // Check the run's final status
  const [finalRun] = await db
    .select({ status: wfRunsTable.status, errorMessage: wfRunsTable.errorMessage })
    .from(wfRunsTable)
    .where(eq(wfRunsTable.id, childRunId))
    .limit(1);

  if (finalRun?.status === "failed" || finalRun?.status === "cancelled") {
    const { newCount, exhausted, completionStatus: failStatus } = computeNextFailureState(currentFailureCount);
    const failureReason = finalRun.errorMessage ?? `Sub-workflow ${finalRun.status}`;
    const { autoFireFailureCount: _d1, lastFailureReason: _d2, lastFailedAt: _d3, ...cleanMeta } = prevMeta;
    await db.update(kanbanTasksTable)
      .set({
        column:           "backlog",
        completionStatus: failStatus,
        completionNotes:  `Workflow run ${finalRun.status}. Attempt ${newCount}/${MAX_AUTO_FIRE_FAILURES}. ${failureReason.slice(0, 200)}`,
        taskMetadata: {
          ...cleanMeta,
          runWorkflow:          { ...card.runWorkflow, childRunId },
          autoFireFailureCount: newCount,
          lastFailureReason:    failureReason,
          lastFailedAt:         new Date().toISOString(),
          ...(exhausted ? { autoFireExhaustedAt: new Date().toISOString() } : {}),
        },
        updatedAt: new Date(),
      })
      .where(eq(kanbanTasksTable.id, card.id));
    const [reverted] = await db.select().from(kanbanTasksTable).where(eq(kanbanTasksTable.id, card.id));
    if (reverted) broadcastKanbanChange(card.projectId, { action: "updated", task: reverted });
    logger.error({ clientUserId, cardId: card.id, childRunId, status: finalRun.status, newCount, exhausted },
      "kanban-auto-fire: run_workflow run ended in failure — card reverted to backlog");
    return;
  }

  // Success — move to completed
  const { autoFireFailureCount: _d1, lastFailureReason: _d2, lastFailedAt: _d3, ...cleanMeta } = prevMeta;
  await db.update(kanbanTasksTable)
    .set({
      column:           "completed",
      completionStatus: "workflow_triggered",
      completionNotes:  `Sub-workflow run ${childRunId} completed successfully.`,
      taskMetadata:     { ...cleanMeta, runWorkflow: { ...card.runWorkflow, childRunId } },
      updatedAt:        new Date(),
    })
    .where(eq(kanbanTasksTable.id, card.id));
  {
    const [completed] = await db.select().from(kanbanTasksTable).where(eq(kanbanTasksTable.id, card.id));
    if (completed) broadcastKanbanChange(card.projectId, { action: "updated", task: completed });
  }

  logger.info(
    { clientUserId, cardId: card.id, childRunId },
    "kanban-auto-fire: run_workflow card completed — sub-workflow triggered",
  );

  if (card.workflowStepId != null) {
    const { spawnedTasks } = await advancePhaseIfComplete(card.workflowStepId, card.projectId);
    if (spawnedTasks.length > 0) {
      logger.info(
        { workflowStepId: card.workflowStepId, projectId: card.projectId, spawnedCount: spawnedTasks.length },
        "kanban-auto-fire: next phase activated after run_workflow",
      );
    }
  }

  void autoFireRunWorkflowCards(clientUserId);
  void autoFireAllDocumentCards(clientUserId);
  void autoFireFirstBacklogScript(clientUserId);
}

/**
 * Fires ALL eligible backlog run_workflow cards for a client in parallel.
 * Called alongside autoFireAllDocumentCards and autoFireFirstBacklogScript everywhere.
 */
export async function autoFireRunWorkflowCards(clientUserId: number): Promise<void> {
  try {
    const allBacklog = await findAllBacklogRunWorkflowCards(clientUserId);
    if (allBacklog.length === 0) {
      logger.debug({ clientUserId }, "kanban-auto-fire: no eligible backlog run_workflow cards found");
      return;
    }

    logger.info(
      { clientUserId, count: allBacklog.length },
      "kanban-auto-fire: firing run_workflow cards in parallel",
    );

    const cardIds = allBacklog.map(c => c.id);
    await db.update(kanbanTasksTable)
      .set({ column: "in_progress", updatedAt: new Date() })
      .where(inArray(kanbanTasksTable.id, cardIds));

    for (const card of allBacklog) {
      const [updated] = await db.select().from(kanbanTasksTable).where(eq(kanbanTasksTable.id, card.id));
      if (updated) broadcastKanbanChange(card.projectId, { action: "updated", task: updated });
    }

    await Promise.allSettled(allBacklog.map(card => fireRunWorkflowCard(clientUserId, card)));
  } catch (err) {
    logger.warn({ err, clientUserId }, "kanban-auto-fire: autoFireRunWorkflowCards unexpected error (non-fatal)");
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
      // Azure job creation failed (unreachable, auth error, etc.).
      // Apply the same retry-budget semantics as other failure paths:
      //   - read current failure count from the primary card
      //   - increment it and determine exhaustion
      //   - revert all sibling cards to backlog with completionStatus + metadata
      //   - alert Shane via push + email if the budget is exhausted
      const [primaryCreateFail] = await db
        .select({ taskMetadata: kanbanTasksTable.taskMetadata })
        .from(kanbanTasksTable)
        .where(eq(kanbanTasksTable.id, siblingIds[0]!))
        .limit(1);
      const createFailMeta = ((primaryCreateFail?.taskMetadata ?? {}) as Record<string, unknown>);
      const createFailCurrentCount = typeof createFailMeta.autoFireFailureCount === "number" ? createFailMeta.autoFireFailureCount : 0;
      const { newCount: createFailCount, exhausted: createFailExhausted, completionStatus: createFailStatus } = computeNextFailureState(createFailCurrentCount);

      const createFailRows = await db
        .select({ id: kanbanTasksTable.id, taskMetadata: kanbanTasksTable.taskMetadata })
        .from(kanbanTasksTable)
        .where(inArray(kanbanTasksTable.id, siblingIds));
      for (const row of createFailRows) {
        const meta = ((row.taskMetadata ?? {}) as Record<string, unknown>);
        await db.update(kanbanTasksTable)
          .set({
            column:           "backlog",
            completionStatus: createFailStatus,
            completionNotes:  `Azure job creation failed. Attempt ${createFailCount}/${MAX_AUTO_FIRE_FAILURES}.`,
            taskMetadata: {
              ...meta,
              runningJobRef:        null,
              autoFireFailureCount: createFailCount,
              lastFailureReason:    `Job creation error: ${String(azErr).slice(0, 200)}`,
              lastFailedAt:         new Date().toISOString(),
              ...(createFailExhausted ? { autoFireExhaustedAt: new Date().toISOString() } : {}),
            },
            updatedAt: new Date(),
          })
          .where(eq(kanbanTasksTable.id, row.id));
      }
      const createFailRevertedRows = await db.select().from(kanbanTasksTable).where(inArray(kanbanTasksTable.id, siblingIds));
      for (const t of createFailRevertedRows) broadcastKanbanChange(card.projectId, { action: "updated", task: t });

      logger.error(
        { azErr, clientUserId, runbook: card.linkedRunbook.azureRunbookName, createFailCount, createFailExhausted },
        "kanban-auto-fire: Azure job creation failed — cards reverted to backlog with retry budget",
      );

      if (createFailExhausted) {
        void alertAutoFireExhausted({
          cardIds:      siblingIds,
          projectId:    card.projectId,
          clientUserId,
          jobId:        "N/A (job creation failed)",
          lastStatus:   "JobCreationError",
          scriptTitle:  card.linkedRunbook.azureRunbookName,
          failureCount: createFailCount,
        });
      }
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
      void autoFireRunWorkflowCards(clientUserId);
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

      // Check for in_progress cards in this step.
      // Cards that are in_progress but have completionStatus="script_failed" and no runningJobRef
      // are legacy stuck cards from before the retry-budget fix — they never advanced and are now
      // blocking the step. Detect and revert them to backlog so reconciliation can continue.
      const inProgressCards = await db
        .select({
          id:               kanbanTasksTable.id,
          completionStatus: kanbanTasksTable.completionStatus,
          taskMetadata:     kanbanTasksTable.taskMetadata,
          updatedAt:        kanbanTasksTable.updatedAt,
        })
        .from(kanbanTasksTable)
        .where(
          and(
            eq(kanbanTasksTable.workflowStepId, step.stepId),
            eq(kanbanTasksTable.column, "in_progress"),
          ),
        );

      if (inProgressCards.length > 0) {
        const now = Date.now();
        // A runbook job can run for at most JOB_TIMEOUT_MS (10 min). Give a 5-minute
        // buffer on top for polling overhead, then treat as stale.
        const STALE_JOB_THRESHOLD_MS = JOB_TIMEOUT_MS + 5 * 60_000;

        // Classify cards into four buckets — only auto-fire-owned cards are touched:
        //
        //   stuckCards     — legacy script_failed cards with no runningJobRef (pre-fix);
        //                    these are always safe to revert
        //   staleAutoFire  — have a runningJobRef (auto-fire owns them) but updatedAt is
        //                    older than the stale threshold; Azure outage likely prevented
        //                    the poller from clearing them
        //   trulyActive    — have a runningJobRef AND are still within the polling window
        //   otherInProgress — no runningJobRef AND NOT script_failed (manual tasks, human
        //                    review cards, etc.); these are NEVER touched by auto-fire
        const stuckCards = inProgressCards.filter(c => {
          const meta = (c.taskMetadata ?? {}) as Record<string, unknown>;
          return !meta.runningJobRef && c.completionStatus === "script_failed";
        });
        const cardsWithRef = inProgressCards.filter(c => {
          const meta = (c.taskMetadata ?? {}) as Record<string, unknown>;
          return !!meta.runningJobRef;
        });
        const staleAutoFire = cardsWithRef.filter(c => {
          const updatedMs = c.updatedAt instanceof Date ? c.updatedAt.getTime() : (c.updatedAt ? new Date(c.updatedAt as string).getTime() : 0);
          return now - updatedMs > STALE_JOB_THRESHOLD_MS;
        });
        const trulyActive = cardsWithRef.filter(c => !staleAutoFire.some(s => s.id === c.id));

        if (trulyActive.length > 0) {
          // A genuinely-running auto-fire job is still within its polling window — skip.
          continue;
        }

        // Revert stuck-legacy and stale auto-fire cards to backlog with the retry budget.
        // Cards with no runningJobRef that are NOT script_failed are left untouched.
        const toRevert = [...stuckCards, ...staleAutoFire];
        if (toRevert.length > 0) {
          const toRevertIds = toRevert.map(c => c.id);
          logger.warn(
            {
              stepId: step.stepId, projectId: step.projectId, clientUserId: step.clientUserId,
              stuckIds: stuckCards.map(c => c.id), staleIds: staleAutoFire.map(c => c.id),
            },
            "kanban-auto-fire: reconcileStalledPhases — reverting stuck/stale in_progress cards to backlog",
          );
          for (const card of toRevert) {
            const meta = ((card.taskMetadata ?? {}) as Record<string, unknown>);
            const currentCount = typeof meta.autoFireFailureCount === "number" ? meta.autoFireFailureCount : 0;
            const { newCount, exhausted, completionStatus: revertStatus } = computeNextFailureState(currentCount);
            const isStale = staleAutoFire.some(s => s.id === card.id);
            await db.update(kanbanTasksTable)
              .set({
                column:           "backlog",
                completionStatus: revertStatus,
                taskMetadata: {
                  ...meta,
                  runningJobRef:        null,
                  autoFireFailureCount: newCount,
                  lastFailureReason:    isStale
                    ? "Stale runningJobRef detected by reconcileStalledPhases (Azure outage suspected)"
                    : "Stuck in_progress detected by reconcileStalledPhases",
                  lastFailedAt:         new Date().toISOString(),
                  ...(exhausted ? { autoFireExhaustedAt: new Date().toISOString() } : {}),
                },
                updatedAt: new Date(),
              })
              .where(eq(kanbanTasksTable.id, card.id));
          }
          const revertedRows = await db.select().from(kanbanTasksTable).where(inArray(kanbanTasksTable.id, toRevertIds));
          if (step.projectId != null) {
            for (const t of revertedRows) broadcastKanbanChange(step.projectId, { action: "updated", task: t });
          }
        }
      }

      // ── Document_generation stale in_progress detection ──────────────────────
      // AI document generation runs synchronously and completes within minutes.
      // If a card is still in_progress longer than the stale threshold it means the
      // server was restarted mid-generation and the card was never reverted.
      // We treat these as auto-fire failures and apply the retry budget.
      const STALE_DOC_THRESHOLD_MS = 15 * 60_000; // 15 min — generous for slow AI calls
      const staleDocCards = await db
        .select({
          id:               kanbanTasksTable.id,
          taskMetadata:     kanbanTasksTable.taskMetadata,
          updatedAt:        kanbanTasksTable.updatedAt,
        })
        .from(kanbanTasksTable)
        .where(
          and(
            eq(kanbanTasksTable.workflowStepId, step.stepId),
            eq(kanbanTasksTable.column, "in_progress"),
            eq(kanbanTasksTable.taskType, "document_generation"),
          ),
        );

      const nowMs = Date.now();
      const staleDocToRevert = staleDocCards.filter(c => {
        const updatedMs = c.updatedAt instanceof Date ? c.updatedAt.getTime() : (c.updatedAt ? new Date(c.updatedAt as string).getTime() : 0);
        return nowMs - updatedMs > STALE_DOC_THRESHOLD_MS;
      });

      if (staleDocToRevert.length > 0) {
        const staleDocIds = staleDocToRevert.map(c => c.id);
        logger.warn(
          { stepId: step.stepId, projectId: step.projectId, clientUserId: step.clientUserId, staleDocIds },
          "kanban-auto-fire: reconcileStalledPhases — reverting stale in_progress document cards to backlog",
        );
        for (const card of staleDocToRevert) {
          const meta = ((card.taskMetadata ?? {}) as Record<string, unknown>);
          const currentCount = typeof meta.autoFireFailureCount === "number" ? meta.autoFireFailureCount : 0;
          const { newCount, exhausted, completionStatus: revertStatus } = computeNextFailureState(currentCount);
          await db.update(kanbanTasksTable)
            .set({
              column:           "backlog",
              completionStatus: revertStatus,
              taskMetadata: {
                ...meta,
                autoFireFailureCount: newCount,
                lastFailureReason:    "Stale document generation detected by reconcileStalledPhases (server restart suspected)",
                lastFailedAt:         new Date().toISOString(),
                ...(exhausted ? { autoFireExhaustedAt: new Date().toISOString() } : {}),
              },
              updatedAt: new Date(),
            })
            .where(eq(kanbanTasksTable.id, card.id));
        }
        const revertedDocRows = await db.select().from(kanbanTasksTable).where(inArray(kanbanTasksTable.id, staleDocIds));
        if (step.projectId != null) {
          for (const t of revertedDocRows) broadcastKanbanChange(step.projectId, { action: "updated", task: t });
        }
      }

      // Check for backlog cards that have a linkedRunbook (auto-fireable).
      // Exhausted cards (auto_fire_exhausted) require manual intervention
      // and must NOT be auto-fired — exclude them here.
      const [backlogCard] = await db
        .select({ id: kanbanTasksTable.id })
        .from(kanbanTasksTable)
        .where(
          and(
            eq(kanbanTasksTable.workflowStepId, step.stepId),
            eq(kanbanTasksTable.column, "backlog"),
            isNotNull(sql`task_metadata->'linkedRunbook'->>'azureRunbookName'`),
            sql`"completion_status" IS DISTINCT FROM 'auto_fire_exhausted'`,
          ),
        )
        .limit(1);

      if (backlogCard) {
        logger.info(
          { stepId: step.stepId, projectId: step.projectId, clientUserId: step.clientUserId },
          "kanban-auto-fire: detected stalled phase — no active in_progress cards but backlog script cards exist",
        );
        stalledClientIds.add(step.clientUserId);
      }

      // Check for backlog document_generation cards that can be re-fired.
      // Exhausted cards are excluded — they need manual intervention.
      const [backlogDocCard] = await db
        .select({ id: kanbanTasksTable.id })
        .from(kanbanTasksTable)
        .where(
          and(
            eq(kanbanTasksTable.workflowStepId, step.stepId),
            eq(kanbanTasksTable.column, "backlog"),
            eq(kanbanTasksTable.taskType, "document_generation"),
            sql`"completion_status" IS DISTINCT FROM 'auto_fire_exhausted'`,
          ),
        )
        .limit(1);

      if (backlogDocCard) {
        logger.info(
          { stepId: step.stepId, projectId: step.projectId, clientUserId: step.clientUserId },
          "kanban-auto-fire: detected stalled phase — backlog document_generation cards need auto-fire",
        );
        stalledClientIds.add(step.clientUserId);
      }

      // ── run_workflow stale in_progress detection ──────────────────────────
      // run_workflow cards complete synchronously — if one is still in_progress
      // beyond the stale threshold the server was restarted mid-execution.
      const staleRwCards = await db
        .select({
          id:           kanbanTasksTable.id,
          taskMetadata: kanbanTasksTable.taskMetadata,
          updatedAt:    kanbanTasksTable.updatedAt,
        })
        .from(kanbanTasksTable)
        .where(
          and(
            eq(kanbanTasksTable.workflowStepId, step.stepId),
            eq(kanbanTasksTable.column, "in_progress"),
            eq(kanbanTasksTable.taskType, "run_workflow"),
          ),
        );

      const staleRwToRevert = staleRwCards.filter(c => {
        const updatedMs = c.updatedAt instanceof Date ? c.updatedAt.getTime() : (c.updatedAt ? new Date(c.updatedAt as string).getTime() : 0);
        return nowMs - updatedMs > STALE_DOC_THRESHOLD_MS;
      });

      if (staleRwToRevert.length > 0) {
        const staleRwIds = staleRwToRevert.map(c => c.id);
        logger.warn(
          { stepId: step.stepId, projectId: step.projectId, clientUserId: step.clientUserId, staleRwIds },
          "kanban-auto-fire: reconcileStalledPhases — reverting stale in_progress run_workflow cards to backlog",
        );
        for (const card of staleRwToRevert) {
          const meta = ((card.taskMetadata ?? {}) as Record<string, unknown>);
          const currentCount = typeof meta.autoFireFailureCount === "number" ? meta.autoFireFailureCount : 0;
          const { newCount, exhausted, completionStatus: revertStatus } = computeNextFailureState(currentCount);
          await db.update(kanbanTasksTable)
            .set({
              column:           "backlog",
              completionStatus: revertStatus,
              taskMetadata: {
                ...meta,
                autoFireFailureCount: newCount,
                lastFailureReason:    "Stale run_workflow card detected by reconcileStalledPhases (server restart suspected)",
                lastFailedAt:         new Date().toISOString(),
                ...(exhausted ? { autoFireExhaustedAt: new Date().toISOString() } : {}),
              },
              updatedAt: new Date(),
            })
            .where(eq(kanbanTasksTable.id, card.id));
        }
        const revertedRwRows = await db.select().from(kanbanTasksTable).where(inArray(kanbanTasksTable.id, staleRwIds));
        if (step.projectId != null) {
          for (const t of revertedRwRows) broadcastKanbanChange(step.projectId, { action: "updated", task: t });
        }
      }

      // Check for backlog run_workflow cards that can be re-fired.
      const [backlogRwCard] = await db
        .select({ id: kanbanTasksTable.id })
        .from(kanbanTasksTable)
        .where(
          and(
            eq(kanbanTasksTable.workflowStepId, step.stepId),
            eq(kanbanTasksTable.column, "backlog"),
            eq(kanbanTasksTable.taskType, "run_workflow"),
            sql`"completion_status" IS DISTINCT FROM 'auto_fire_exhausted'`,
          ),
        )
        .limit(1);

      if (backlogRwCard) {
        logger.info(
          { stepId: step.stepId, projectId: step.projectId, clientUserId: step.clientUserId },
          "kanban-auto-fire: detected stalled phase — backlog run_workflow cards need auto-fire",
        );
        stalledClientIds.add(step.clientUserId);
      }
    }

    for (const clientUserId of stalledClientIds) {
      void autoFireFirstBacklogScript(clientUserId);
      void autoFireDocumentCard(clientUserId);
      void autoFireRunWorkflowCards(clientUserId);
    }
  } catch (err) {
    logger.warn({ err }, "kanban-auto-fire: reconcileStalledPhases failed (non-fatal)");
  }
}
