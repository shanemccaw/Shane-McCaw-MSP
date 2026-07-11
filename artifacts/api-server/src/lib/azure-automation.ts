/**
 * azure-automation.ts — RETIRED STUB
 *
 * Azure script execution was retired as part of the Script Runner rework.
 * All functions in this file are no-ops / permanent-false guards so that
 * existing callers (workflow-executor, kanban-auto-fire, client-script-sequence)
 * continue to compile and run safely.  Their internal guards all check
 * `isAzureConfigured()` before calling any job APIs, so returning `false`
 * there causes them to skip the Azure path entirely.
 */

import { logger } from "./logger.ts";

/** Always returns false — Azure script execution has been retired. */
export function isAzureConfigured(): boolean {
  return false;
}

/** No-op stub. isAzureConfigured() is false so this should never be called. */
export async function pushScriptToAzure(_scriptName: string, _psCode: string): Promise<void> {
  logger.warn("azure-automation: pushScriptToAzure called on retired stub — skipping");
}

/** No-op stub. */
export async function createScriptJob(_opts: {
  runbookName: string;
  parameters?: Record<string, string>;
}): Promise<{ jobId: string; status: string }> {
  throw new Error("Azure script execution has been retired — job creation is no longer available");
}

/** No-op stub. */
export async function getJobStatus(_jobId: string): Promise<{ status: string; jobId?: string }> {
  throw new Error("Azure script execution has been retired — getJobStatus is no longer available");
}

/** No-op stub. */
export async function getJobOutput(
  _jobId: string,
): Promise<Array<{ streamType: string; text: string }>> {
  throw new Error("Azure script execution has been retired — getJobOutput is no longer available");
}

/** Returns true for any status value that would terminate a polling loop. */
export function isTerminalStatus(status: string): boolean {
  return ["Completed", "Failed", "Stopped", "Suspended", "Disconnected"].includes(status);
}

/** No-op stub — always throws since Azure script execution is retired. */
export async function resolveScriptById(scriptId: string): Promise<string> {
  throw new Error(`Azure script execution has been retired — script "${scriptId}" cannot be resolved`);
}

/** No-op stub — always returns null (no active job). */
export async function findActiveJobForScript(_scriptName: string): Promise<string | null> {
  return null;
}
