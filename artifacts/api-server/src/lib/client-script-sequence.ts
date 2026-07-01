/**
 * client-script-sequence.ts
 *
 * Runs all script packages linked to a client's active services sequentially.
 * Each script module becomes a runbook that is pushed to Azure Automation,
 * then a job is created (passing the client's own tenant credentials as
 * runbook parameters) and polled to completion before the next module starts.
 *
 * Progress is written to `client_automation_runs` so the CRM portal can poll it.
 *
 * On failure: sets status=failed, records errorMessage, sends Shane an admin alert.
 * Azure env vars are required — if absent the run is marked failed immediately.
 *
 * On completion (success or failure) with an associated kanbanTaskId:
 *   - Full accumulated job output is saved to kanban_tasks.taskMetadata.scriptOutput
 *     in a FIRST DB write (so output is never lost even if AI analysis fails)
 *   - AI analysis (summary, risks, recommendations, nextSteps) is auto-generated
 *     using the same claude-sonnet-4-6 model and prompt as /api/admin/scripts/analyze-output
 *     and saved in a SECOND DB write (patch-only, non-destructive)
 *   - Successful runs move the card to column=completed with completedAt timestamp
 *   - Failed runs move the card to column=in_progress with failedAt timestamp
 */

import {
  db,
  clientAutomationRunsTable,
  clientServicesTable,
  serviceScriptSetsTable,
  scriptPackagesTable,
  scriptModulesTable,
  usersTable,
  clientAppRegistrationsTable,
  kanbanTasksTable,
} from "@workspace/db";
import { eq, and, asc, inArray } from "drizzle-orm";
import {
  pushScriptToAzure,
  createRunbookJob,
  getJobStatus,
  getJobOutput,
  isTerminalStatus,
  isAzureConfigured,
} from "./azure-automation";
import { getSecretValue } from "./azure-keyvault";
import { sendEmail } from "./mailer";
import { logger } from "./logger";
import { broadcastKanbanChange } from "./sse-broadcast";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const POLL_INTERVAL_MS = 5_000;
const JOB_TIMEOUT_MS = 10 * 60 * 1000;

async function advanceProgress(runId: number, completed: number, packageId: string, moduleId: string, snippet: string) {
  await db.update(clientAutomationRunsTable)
    .set({
      status: "running",
      modulesCompleted: completed,
      currentPackageId: packageId,
      currentModuleId: moduleId,
      lastLogSnippet: snippet.slice(0, 500),
    })
    .where(eq(clientAutomationRunsTable.id, runId));
}

async function markCompleted(runId: number, total: number) {
  await db.update(clientAutomationRunsTable)
    .set({
      status: "completed",
      modulesCompleted: total,
      finishedAt: new Date(),
      lastLogSnippet: "All script modules completed successfully.",
    })
    .where(eq(clientAutomationRunsTable.id, runId));
}

async function markFailed(runId: number, errorMessage: string) {
  await db.update(clientAutomationRunsTable)
    .set({ status: "failed", finishedAt: new Date(), errorMessage: errorMessage.slice(0, 1000) })
    .where(eq(clientAutomationRunsTable.id, runId));
}

async function pollJobToCompletion(jobId: string): Promise<{ success: boolean; lastStatus: string; output: string }> {
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    const status = await getJobStatus(jobId);
    if (isTerminalStatus(status.status)) {
      const outputLines = await getJobOutput(jobId).catch(() => []);
      const output = outputLines.map((l: { text: string }) => l.text).join("\n");
      return { success: status.status === "Completed", lastStatus: status.status, output };
    }
  }
  return { success: false, lastStatus: "Timeout", output: "" };
}

/**
 * Run AI analysis on accumulated script output.
 * Uses the exact same model, max_tokens, and prompt as POST /api/admin/scripts/analyze-output
 * so behaviour is consistent with the manual "Analyze" button in the Admin Panel.
 *
 * Returns null (non-fatal) if the AI call fails.
 */
async function runAutoAnalysis(
  output: string,
  runbookName: string,
  clientName: string,
): Promise<{ summary: string; risks: string[]; recommendations: string[]; nextSteps: string[] } | null> {
  if (!output.trim()) return null;

  const prompt = `You are a Microsoft 365 and Azure automation expert. Analyze the following PowerShell runbook execution output and provide a structured assessment.

Runbook: ${runbookName}
Customer Tenant: ${clientName}

=== EXECUTION OUTPUT ===
${output.slice(0, 7000)}
=== END OUTPUT ===

Return a JSON object with exactly these fields:
{
  "summary": "2-3 sentence plain-English summary of what the runbook did and the overall outcome",
  "risks": ["specific risk or issue found in the output"],
  "recommendations": ["actionable recommendation based on what was found"],
  "nextSteps": ["concrete next step for the M365 administrator"]
}

Rules:
- Provide 2-5 items per array
- Be specific about what you see in the output — reference actual values, errors, or warnings where present
- If the output shows errors, surface them clearly in risks
- Focus on Microsoft 365 security, governance, and Copilot readiness implications
- Return ONLY the JSON object, no markdown fences, no other text`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = message.content.find(b => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;

    const raw = textBlock.text.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    return JSON.parse(jsonMatch[0]) as {
      summary: string;
      risks: string[];
      recommendations: string[];
      nextSteps: string[];
    };
  } catch (err) {
    logger.warn({ err }, "client-script-sequence: auto AI analysis failed (non-fatal)");
    return null;
  }
}

/**
 * WRITE 1: Persist raw scriptOutput and move the column immediately.
 * This ensures output is never lost even if the subsequent AI call fails.
 * WRITE 2 (patchKanbanAiAnalysis): patches aiAnalysis onto the already-saved record.
 */
async function saveKanbanOutput(options: {
  kanbanTaskId: number;
  scriptOutput: string;
  success: boolean;
  lastJobStatus: string;
  jobId: string;
}): Promise<void> {
  const { kanbanTaskId, scriptOutput, success, lastJobStatus, jobId } = options;
  try {
    const [task] = await db
      .select()
      .from(kanbanTasksTable)
      .where(eq(kanbanTasksTable.id, kanbanTaskId))
      .limit(1);

    if (!task) {
      logger.warn({ kanbanTaskId }, "client-script-sequence: kanban task not found — skipping output save");
      return;
    }

    const now = new Date().toISOString();
    const existingMeta = (task.taskMetadata ?? {}) as Record<string, unknown>;

    await db
      .update(kanbanTasksTable)
      .set({
        taskMetadata: {
          ...existingMeta,
          lastJobId: jobId,
          lastJobStatus,
          runningJobRef: null,
          scriptOutput: scriptOutput.slice(0, 50_000),
          ...(success ? { completedAt: now } : { failedAt: now }),
        },
        column: success ? "completed" : "in_progress",
        updatedAt: new Date(),
      })
      .where(eq(kanbanTasksTable.id, kanbanTaskId));

    logger.info({ kanbanTaskId, success }, "client-script-sequence: scriptOutput saved to kanban card");

    const [updated] = await db.select().from(kanbanTasksTable).where(eq(kanbanTasksTable.id, kanbanTaskId)).limit(1).catch(() => [null]);
    if (updated) broadcastKanbanChange(updated.projectId, { action: "updated", task: updated });
  } catch (err) {
    logger.warn({ err, kanbanTaskId }, "client-script-sequence: failed to save scriptOutput to kanban card (non-fatal)");
  }
}

/**
 * WRITE 2: Patch aiAnalysis onto the kanban card after successful AI call.
 * Non-fatal — if this write fails the output from WRITE 1 is already safe.
 */
async function patchKanbanAiAnalysis(
  kanbanTaskId: number,
  aiAnalysis: { summary: string; risks: string[]; recommendations: string[]; nextSteps: string[] },
): Promise<void> {
  try {
    const [task] = await db
      .select()
      .from(kanbanTasksTable)
      .where(eq(kanbanTasksTable.id, kanbanTaskId))
      .limit(1);

    if (!task) return;

    const existingMeta = (task.taskMetadata ?? {}) as Record<string, unknown>;

    await db
      .update(kanbanTasksTable)
      .set({
        taskMetadata: { ...existingMeta, aiAnalysis },
        updatedAt: new Date(),
      })
      .where(eq(kanbanTasksTable.id, kanbanTaskId));

    logger.info({ kanbanTaskId }, "client-script-sequence: aiAnalysis patched onto kanban card");

    const [updated] = await db.select().from(kanbanTasksTable).where(eq(kanbanTasksTable.id, kanbanTaskId)).limit(1).catch(() => [null]);
    if (updated) broadcastKanbanChange(updated.projectId, { action: "updated", task: updated });
  } catch (err) {
    logger.warn({ err, kanbanTaskId }, "client-script-sequence: failed to patch aiAnalysis (non-fatal — raw output already saved)");
  }
}

export async function runClientScriptSequence(
  clientUserId: number,
  runId: number,
  kanbanTaskId?: number,
): Promise<void> {
  if (!isAzureConfigured()) {
    logger.warn({ clientUserId, runId }, "client-script-sequence: Azure not configured — marking run failed");
    await markFailed(runId, "Azure Automation is not configured on this server.");
    return;
  }

  try {
    const [client] = await db
      .select({ name: usersTable.name, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, clientUserId));

    const [appReg] = await db
      .select()
      .from(clientAppRegistrationsTable)
      .where(
        and(
          eq(clientAppRegistrationsTable.clientUserId, clientUserId),
          eq(clientAppRegistrationsTable.status, "verified"),
        ),
      );

    if (!appReg) {
      logger.warn({ clientUserId, runId }, "client-script-sequence: no verified App Registration — marking failed");
      await markFailed(runId, "No verified Azure App Registration found for this client.");
      return;
    }

    let clientSecret: string;
    try {
      clientSecret = await getSecretValue(appReg.keyVaultSecretName);
    } catch (kvErr) {
      const msg = kvErr instanceof Error ? kvErr.message : String(kvErr);
      logger.error({ kvErr, runId, clientUserId }, "client-script-sequence: Key Vault fetch failed");
      await markFailed(runId, `Key Vault error: ${msg}`);
      return;
    }

    const activeServices = await db
      .select({ serviceId: clientServicesTable.serviceId })
      .from(clientServicesTable)
      .where(
        and(
          eq(clientServicesTable.clientUserId, clientUserId),
          eq(clientServicesTable.status, "active"),
        ),
      );

    if (activeServices.length === 0) {
      logger.info({ clientUserId, runId }, "client-script-sequence: no active services — nothing to run");
      await db.update(clientAutomationRunsTable)
        .set({
          status: "completed",
          modulesCompleted: 0,
          modulesTotal: 0,
          finishedAt: new Date(),
          lastLogSnippet: "No active services with linked script packages.",
        })
        .where(eq(clientAutomationRunsTable.id, runId));
      return;
    }

    const serviceIds = activeServices.map(s => s.serviceId);
    const scriptSets = await db
      .select({ scriptPackageId: serviceScriptSetsTable.scriptPackageId, displayOrder: serviceScriptSetsTable.displayOrder })
      .from(serviceScriptSetsTable)
      .where(inArray(serviceScriptSetsTable.serviceId, serviceIds))
      .orderBy(asc(serviceScriptSetsTable.displayOrder));

    if (scriptSets.length === 0) {
      await db.update(clientAutomationRunsTable)
        .set({
          status: "completed",
          modulesCompleted: 0,
          modulesTotal: 0,
          finishedAt: new Date(),
          lastLogSnippet: "No script packages linked to active services.",
        })
        .where(eq(clientAutomationRunsTable.id, runId));
      return;
    }

    const packageIds = [...new Set(scriptSets.map(s => s.scriptPackageId))];

    const packages = await db.select().from(scriptPackagesTable)
      .where(inArray(scriptPackagesTable.id, packageIds));

    const packageMap = new Map(packages.map(p => [p.id, p]));

    const seenPkgIds = new Set<string>();
    const orderedPackages = scriptSets
      .map(s => packageMap.get(s.scriptPackageId))
      .filter((p): p is typeof packages[0] => {
        if (!p || seenPkgIds.has(p.id)) return false;
        seenPkgIds.add(p.id);
        return true;
      });

    const allModules = await db.select().from(scriptModulesTable)
      .where(inArray(scriptModulesTable.packageId, packageIds))
      .orderBy(asc(scriptModulesTable.sortOrder));

    const modulesByPackage = new Map<string, typeof allModules>();
    for (const mod of allModules) {
      const existing = modulesByPackage.get(mod.packageId) ?? [];
      existing.push(mod);
      modulesByPackage.set(mod.packageId, existing);
    }

    const totalModules = allModules.length;
    if (totalModules === 0) {
      await db.update(clientAutomationRunsTable)
        .set({
          status: "completed",
          modulesCompleted: 0,
          modulesTotal: 0,
          finishedAt: new Date(),
          lastLogSnippet: "Script packages have no modules to run.",
        })
        .where(eq(clientAutomationRunsTable.id, runId));
      return;
    }

    await db.update(clientAutomationRunsTable)
      .set({ status: "running", modulesTotal: totalModules })
      .where(eq(clientAutomationRunsTable.id, runId));

    let completedCount = 0;
    const clientLabel = client?.name ?? client?.email ?? `client #${clientUserId}`;

    const accumulatedOutputParts: string[] = [];
    let lastJobId = "";

    for (const pkg of orderedPackages) {
      const modules = modulesByPackage.get(pkg.id) ?? [];
      for (const mod of modules) {
        await db.update(clientAutomationRunsTable)
          .set({
            currentPackageId: pkg.id,
            currentModuleId: mod.id,
            lastLogSnippet: `Running: ${mod.filename} (${pkg.title})`,
          })
          .where(eq(clientAutomationRunsTable.id, runId));

        let runbookName: string;
        if (mod.azureRunbookName?.trim()) {
          runbookName = mod.azureRunbookName.trim();
          logger.info({ runId, clientUserId, runbookName, module: mod.filename }, "client-script-sequence: using existing Azure runbook (skipping push)");
        } else {
          runbookName = `client-${clientUserId}-${mod.id}`;
          logger.info({ runId, clientUserId, runbookName, module: mod.filename }, "client-script-sequence: pushing module to Azure");
          await pushScriptToAzure(runbookName, mod.content);
        }

        const { jobId } = await createRunbookJob({
          runbookName,
          parameters: {
            TenantId: appReg.tenantId,
            ClientId: appReg.azureClientId,
            ClientSecret: clientSecret,
          },
        });

        lastJobId = jobId;
        logger.info({ runId, clientUserId, jobId, runbookName }, "client-script-sequence: job created, polling");

        const result = await pollJobToCompletion(jobId);

        if (result.output) {
          accumulatedOutputParts.push(`=== Module: ${mod.filename} (${pkg.title}) | Job: ${jobId} ===`);
          accumulatedOutputParts.push(result.output);
        }

        if (!result.success) {
          const errMsg = `Module "${mod.filename}" (package "${pkg.title}") job ended with status: ${result.lastStatus}`;
          logger.error({ runId, clientUserId, jobId, status: result.lastStatus }, "client-script-sequence: job failed");
          await markFailed(runId, errMsg);

          if (kanbanTaskId) {
            const accumulatedOutput = accumulatedOutputParts.join("\n");

            // WRITE 1: persist raw output immediately (never lost even if AI fails)
            await saveKanbanOutput({
              kanbanTaskId,
              scriptOutput: accumulatedOutput,
              success: false,
              lastJobStatus: result.lastStatus,
              jobId,
            });

            // WRITE 2: patch AI analysis (non-fatal if it fails)
            const aiAnalysis = await runAutoAnalysis(accumulatedOutput, runbookName, clientLabel);
            if (aiAnalysis) {
              await patchKanbanAiAnalysis(kanbanTaskId, aiAnalysis);
            }
          }

          const adminEmail = process.env.CRM_ADMIN_EMAIL;
          if (adminEmail) {
            await sendEmail(
              adminEmail,
              `Script run failed — ${clientLabel}`,
              `<p>Hi Shane,</p>
               <p>An automated script run for <strong>${clientLabel}</strong> failed at module <strong>${mod.filename}</strong> (package: <em>${pkg.title}</em>).</p>
               <p>Job status: <strong>${result.lastStatus}</strong></p>
               <p>Run ID: ${runId} — check the CRM portal for details.</p>`,
            );
          }
          return;
        }

        completedCount++;
        await advanceProgress(runId, completedCount, pkg.id, mod.id, `Completed: ${mod.filename} (${pkg.title})`);
        logger.info({ runId, clientUserId, completedCount, totalModules }, "client-script-sequence: module done");
      }
    }

    await markCompleted(runId, totalModules);
    logger.info({ runId, clientUserId, totalModules }, "client-script-sequence: all modules completed");

    if (kanbanTaskId) {
      const accumulatedOutput = accumulatedOutputParts.join("\n");

      // Derive a representative runbook name from the last module
      const lastPkg = orderedPackages[orderedPackages.length - 1];
      const lastModules = lastPkg ? (modulesByPackage.get(lastPkg.id) ?? []) : [];
      const lastMod = lastModules[lastModules.length - 1];
      const finalRunbookName = lastMod
        ? `client-${clientUserId}-${lastMod.id}`
        : `client-${clientUserId}-run`;

      // WRITE 1: persist raw output immediately
      await saveKanbanOutput({
        kanbanTaskId,
        scriptOutput: accumulatedOutput,
        success: true,
        lastJobStatus: "Completed",
        jobId: lastJobId,
      });

      // WRITE 2: patch AI analysis
      const aiAnalysis = await runAutoAnalysis(accumulatedOutput, finalRunbookName, clientLabel);
      if (aiAnalysis) {
        await patchKanbanAiAnalysis(kanbanTaskId, aiAnalysis);
      }
    }
  } catch (err) {
    logger.error({ err, runId, clientUserId }, "client-script-sequence: unexpected error");
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(runId, message).catch(() => {});
  }
}
