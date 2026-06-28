/**
 * client-script-sequence.ts
 *
 * Runs all script packages linked to a client's active services sequentially.
 * Each script module becomes a runbook that is pushed to Azure Automation,
 * then a job is created and polled to completion before the next module starts.
 *
 * Progress is written to `client_automation_runs` so the CRM portal can poll it.
 *
 * On failure: sets status=failed, records errorMessage, sends Shane an admin alert.
 * Azure env vars are required — if absent the run is marked failed immediately.
 */

import { db, clientAutomationRunsTable, clientServicesTable, serviceScriptSetsTable, scriptPackagesTable, scriptModulesTable, usersTable } from "@workspace/db";
import { eq, and, asc, inArray } from "drizzle-orm";
import { pushScriptToAzure, createRunbookJob, getJobStatus, isTerminalStatus, isAzureConfigured } from "./azure-automation";
import { sendEmail } from "./mailer";
import { logger } from "./logger";

const POLL_INTERVAL_MS = 5_000;
const JOB_TIMEOUT_MS = 10 * 60 * 1000;

async function markRunning(runId: number, packageId: string, moduleId: string, total: number) {
  await db.update(clientAutomationRunsTable)
    .set({ status: "running", currentPackageId: packageId, currentModuleId: moduleId, modulesTotal: total })
    .where(eq(clientAutomationRunsTable.id, runId));
}

async function advanceProgress(runId: number, completed: number, packageId: string, moduleId: string, snippet: string) {
  await db.update(clientAutomationRunsTable)
    .set({ modulesCompleted: completed, currentPackageId: packageId, currentModuleId: moduleId, lastLogSnippet: snippet.slice(0, 500) })
    .where(eq(clientAutomationRunsTable.id, runId));
}

async function markCompleted(runId: number, total: number) {
  await db.update(clientAutomationRunsTable)
    .set({ status: "completed", modulesCompleted: total, finishedAt: new Date(), lastLogSnippet: "All script modules completed successfully." })
    .where(eq(clientAutomationRunsTable.id, runId));
}

async function markFailed(runId: number, errorMessage: string) {
  await db.update(clientAutomationRunsTable)
    .set({ status: "failed", finishedAt: new Date(), errorMessage: errorMessage.slice(0, 1000) })
    .where(eq(clientAutomationRunsTable.id, runId));
}

async function pollJobToCompletion(jobId: string): Promise<{ success: boolean; lastStatus: string }> {
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    const status = await getJobStatus(jobId);
    if (isTerminalStatus(status.status)) {
      return { success: status.status === "Completed", lastStatus: status.status };
    }
  }
  return { success: false, lastStatus: "Timeout" };
}

export async function runClientScriptSequence(clientUserId: number, runId: number): Promise<void> {
  if (!isAzureConfigured()) {
    logger.warn({ clientUserId, runId }, "client-script-sequence: Azure not configured — marking run failed");
    await markFailed(runId, "Azure Automation is not configured on this server.");
    return;
  }

  try {
    const [client] = await db.select({ name: usersTable.name, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, clientUserId));

    const activeServices = await db.select({ serviceId: clientServicesTable.serviceId })
      .from(clientServicesTable)
      .where(and(eq(clientServicesTable.clientUserId, clientUserId), eq(clientServicesTable.status, "active")));

    if (activeServices.length === 0) {
      logger.info({ clientUserId, runId }, "client-script-sequence: no active services — nothing to run");
      await db.update(clientAutomationRunsTable)
        .set({ status: "completed", modulesCompleted: 0, modulesTotal: 0, finishedAt: new Date(), lastLogSnippet: "No active services with linked script packages." })
        .where(eq(clientAutomationRunsTable.id, runId));
      return;
    }

    const serviceIds = activeServices.map(s => s.serviceId);
    const scriptSets = await db.select({ scriptPackageId: serviceScriptSetsTable.scriptPackageId, displayOrder: serviceScriptSetsTable.displayOrder })
      .from(serviceScriptSetsTable)
      .where(inArray(serviceScriptSetsTable.serviceId, serviceIds))
      .orderBy(asc(serviceScriptSetsTable.displayOrder));

    if (scriptSets.length === 0) {
      logger.info({ clientUserId, runId }, "client-script-sequence: no script packages linked to client services");
      await db.update(clientAutomationRunsTable)
        .set({ status: "completed", modulesCompleted: 0, modulesTotal: 0, finishedAt: new Date(), lastLogSnippet: "No script packages linked to active services." })
        .where(eq(clientAutomationRunsTable.id, runId));
      return;
    }

    const packageIds = [...new Set(scriptSets.map(s => s.scriptPackageId))];

    const packages = await db.select().from(scriptPackagesTable)
      .where(inArray(scriptPackagesTable.id, packageIds));

    const packageMap = new Map(packages.map(p => [p.id, p]));

    const orderedPackages = scriptSets
      .map(s => packageMap.get(s.scriptPackageId))
      .filter((p): p is typeof packages[0] => p !== undefined);

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
        .set({ status: "completed", modulesCompleted: 0, modulesTotal: 0, finishedAt: new Date(), lastLogSnippet: "Script packages have no modules to run." })
        .where(eq(clientAutomationRunsTable.id, runId));
      return;
    }

    await db.update(clientAutomationRunsTable)
      .set({ status: "running", modulesTotal: totalModules })
      .where(eq(clientAutomationRunsTable.id, runId));

    let completedCount = 0;

    for (const pkg of orderedPackages) {
      const modules = modulesByPackage.get(pkg.id) ?? [];
      for (const mod of modules) {
        await markRunning(runId, pkg.id, mod.id, totalModules);

        const runbookName = `client-${clientUserId}-${mod.id}`;
        logger.info({ runId, clientUserId, runbookName, module: mod.filename }, "client-script-sequence: pushing module to Azure");

        await pushScriptToAzure(runbookName, mod.content);

        const { jobId } = await createRunbookJob({ runbookName });

        logger.info({ runId, clientUserId, jobId, runbookName }, "client-script-sequence: job created, polling");

        const result = await pollJobToCompletion(jobId);

        if (!result.success) {
          const errMsg = `Module "${mod.filename}" (package "${pkg.title}") job ended with status: ${result.lastStatus}`;
          logger.error({ runId, clientUserId, jobId, status: result.lastStatus }, "client-script-sequence: job failed");
          await markFailed(runId, errMsg);

          const adminEmail = process.env.CRM_ADMIN_EMAIL;
          if (adminEmail) {
            const clientLabel = client?.name ?? client?.email ?? `client #${clientUserId}`;
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
        await advanceProgress(runId, completedCount, pkg.id, mod.id, `Completed: ${mod.filename}`);
        logger.info({ runId, clientUserId, completedCount, totalModules }, "client-script-sequence: module done");
      }
    }

    await markCompleted(runId, totalModules);
    logger.info({ runId, clientUserId, totalModules }, "client-script-sequence: all modules completed");
  } catch (err) {
    logger.error({ err, runId, clientUserId }, "client-script-sequence: unexpected error");
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(runId, message).catch(() => {});
  }
}
