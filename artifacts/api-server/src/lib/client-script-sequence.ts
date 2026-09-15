/**
 * client-script-sequence.ts
 *
 * Formerly ran every script package linked to a client's active services
 * sequentially via Azure Automation (push module → create runbook job →
 * poll to completion). Azure Automation script execution was retired as
 * part of the Script Runner rework (see #4262/#4267) and this function has
 * zero callers left in the codebase — it is kept only as an explicit,
 * clearly-failing entry point in case something still reaches for it, so a
 * caller gets a real error instead of code silently trying (and failing) to
 * reach a retired Azure integration.
 */

import { db, clientAutomationRunsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.ts";
const log = logger.child({ channel: "workflow.script" });

async function markFailed(runId: number, errorMessage: string) {
  await db.update(clientAutomationRunsTable)
    .set({ status: "failed", finishedAt: new Date(), errorMessage: errorMessage.slice(0, 1000) })
    .where(eq(clientAutomationRunsTable.id, runId));
}

export async function runClientScriptSequence(
  clientUserId: number,
  runId: number,
  kanbanTaskId?: number,
): Promise<void> {
  void kanbanTaskId;
  log.warn(
    { clientUserId, runId },
    "client-script-sequence: Azure Automation script execution has been retired — marking run failed",
  );
  await markFailed(
    runId,
    "Azure Automation script execution has been retired — this client automation run has no server-side " +
    "execution binding. Download the scripts from the library and run them against the tenant instead.",
  );
}
