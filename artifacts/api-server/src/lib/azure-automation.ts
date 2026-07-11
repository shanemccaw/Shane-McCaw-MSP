/**
 * azure-automation.ts — RETIRED STUB
 *
 * Azure Automation was retired as part of the Script Runner rework.
 * All functions in this file are no-ops / permanent-false guards so that
 * existing callers (workflow-executor, kanban-auto-fire, client-script-sequence)
 * continue to compile and run safely.  Their internal guards all check
 * `isAzureConfigured()` before calling any job APIs, so returning `false`
 * there causes them to skip the Azure path entirely.
 */

import { logger } from "./logger.ts";

/** Always returns false — Azure Automation has been retired. */
export function isAzureConfigured(): boolean {
  return false;
}

/** No-op stub. isAzureConfigured() is false so this should never be called. */
export async function pushScriptToAzure(_runbookName: string, _psCode: string): Promise<void> {
  logger.warn("azure-automation: pushScriptToAzure called on retired stub — skipping");
}

/** No-op stub. */
export async function createRunbookJob(_opts: {
  runbookName: string;
  parameters?: Record<string, string>;
}): Promise<{ jobId: string; status: string }> {
  throw new Error("Azure Automation has been retired — createRunbookJob is no longer available");
}

/** No-op stub. */
export async function getJobStatus(_jobId: string): Promise<{ status: string; jobId?: string }> {
  throw new Error("Azure Automation has been retired — getJobStatus is no longer available");
}

/** No-op stub. */
export async function getJobOutput(
  _jobId: string,
): Promise<Array<{ streamType: string; text: string }>> {
  throw new Error("Azure Automation has been retired — getJobOutput is no longer available");
}

/** Returns true for any status value that would terminate a polling loop. */
export function isTerminalStatus(status: string): boolean {
  return ["Completed", "Failed", "Stopped", "Suspended", "Disconnected"].includes(status);
}

/** No-op stub — always throws since Azure Automation is retired. */
export async function resolveRunbookNameById(runbookId: string): Promise<string> {
  throw new Error(`Azure Automation has been retired — runbook "${runbookId}" cannot be resolved`);
}

/** No-op stub — always returns null (no active job). */
export async function findActiveJobForRunbook(_runbookName: string): Promise<string | null> {
  return null;
}
