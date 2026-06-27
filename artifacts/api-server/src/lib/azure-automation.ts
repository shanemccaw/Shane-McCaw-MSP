/**
 * azure-automation.ts
 *
 * Helper for Azure Automation: list runbooks, create jobs, poll status,
 * and stream job output streams.
 *
 * Required env vars:
 *   AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID,
 *   AZURE_SUBSCRIPTION_ID, AZURE_AUTOMATION_RESOURCE_GROUP,
 *   AZURE_AUTOMATION_ACCOUNT_NAME
 *
 * Uses @azure/arm-automation v10 (ms-rest-js style SDK — NOT the track-2 SDK).
 * Constructor: new AutomationClient(credential, subscriptionId, countType)
 * Properties:  client.runbook, client.job, client.jobStream
 */

import { AutomationClient } from "@azure/arm-automation";
import { ClientSecretCredential } from "@azure/identity";
import { logger } from "./logger";

function getAzureConfig() {
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
  const resourceGroup = process.env.AZURE_AUTOMATION_RESOURCE_GROUP;
  const accountName = process.env.AZURE_AUTOMATION_ACCOUNT_NAME;

  if (!tenantId || !clientId || !clientSecret || !subscriptionId || !resourceGroup || !accountName) {
    throw new Error(
      "Missing Azure env vars: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, " +
      "AZURE_SUBSCRIPTION_ID, AZURE_AUTOMATION_RESOURCE_GROUP, AZURE_AUTOMATION_ACCOUNT_NAME",
    );
  }

  return { tenantId, clientId, clientSecret, subscriptionId, resourceGroup, accountName };
}

function buildClient() {
  const cfg = getAzureConfig();
  const credential = new ClientSecretCredential(cfg.tenantId, cfg.clientId, cfg.clientSecret);
  const client = new AutomationClient(credential, cfg.subscriptionId, "status");
  return { client, cfg };
}

export interface RunbookSummary {
  name: string;
  description?: string;
  runbookType?: string;
  state?: string;
}

/**
 * List all runbooks in the configured Automation account.
 */
export async function listRunbooks(): Promise<RunbookSummary[]> {
  const { client, cfg } = buildClient();
  const res = await client.runbook.listByAutomationAccount(cfg.resourceGroup, cfg.accountName);
  const results: RunbookSummary[] = ([...res] as Array<{ name?: string; description?: string; runbookType?: string; state?: string }>).map(rb => ({
    name: rb.name ?? "(unnamed)",
    description: rb.description ?? undefined,
    runbookType: rb.runbookType ?? undefined,
    state: rb.state ?? undefined,
  }));

  let nextLink = res.nextLink;
  while (nextLink) {
    const page = await client.runbook.listByAutomationAccountNext(nextLink);
    for (const rb of [...page] as Array<{ name?: string; description?: string; runbookType?: string; state?: string }>) {
      results.push({
        name: rb.name ?? "(unnamed)",
        description: rb.description ?? undefined,
        runbookType: rb.runbookType ?? undefined,
        state: rb.state ?? undefined,
      });
    }
    nextLink = page.nextLink;
  }

  return results;
}

export interface CreateJobParams {
  runbookName: string;
  parameters?: Record<string, string>;
}

export interface JobResult {
  jobId: string;
  status: string;
}

/**
 * Create (trigger) a runbook job.
 * Returns the job name (GUID) assigned by Azure Automation.
 */
export async function createRunbookJob(params: CreateJobParams): Promise<JobResult> {
  const { client, cfg } = buildClient();
  const jobName = crypto.randomUUID();

  const job = await client.job.create(
    cfg.resourceGroup,
    cfg.accountName,
    jobName,
    {
      runbook: { name: params.runbookName },
      parameters: params.parameters ?? {},
    },
  );

  const jobId = job.name ?? jobName;
  logger.info({ jobId, runbook: params.runbookName }, "azure-automation: job created");
  return { jobId, status: job.status ?? "New" };
}

export interface JobStatus {
  jobId: string;
  status: string;
  statusDetails?: string;
  startTime?: Date;
  endTime?: Date;
  exception?: string;
}

/**
 * Get the current status of a runbook job.
 */
export async function getJobStatus(jobId: string): Promise<JobStatus> {
  const { client, cfg } = buildClient();
  const job = await client.job.get(cfg.resourceGroup, cfg.accountName, jobId);
  return {
    jobId,
    status: job.status ?? "Unknown",
    statusDetails: job.statusDetails ?? undefined,
    startTime: job.startTime ?? undefined,
    endTime: job.endTime ?? undefined,
    exception: job.exception ?? undefined,
  };
}

export interface JobOutputLine {
  sequence: number;
  streamType: string;
  text: string;
  time?: Date;
}

/**
 * Fetch all output streams accumulated so far for a job.
 *
 * SDK deserialization note (@azure/arm-automation v10):
 *   The SDK maps JSON `properties.X` fields to flat JS properties on the
 *   deserialized object. After deserialization the shape is:
 *     { id, jobStreamId, time, streamType, streamText, summary, value }
 *   NOT { properties: { jobStreamId, streamType, ... } }.
 *
 * Sequence: We sort all accumulated streams by `time` (Azure only appends,
 * never removes) and use the stable 0-based index as the sequence number.
 * This gives reliable `sequence > since` filtering across repeated polls.
 */
export async function getJobOutput(jobId: string): Promise<JobOutputLine[]> {
  const { client, cfg } = buildClient();

  type StreamItem = {
    id?: string;
    jobStreamId?: string;
    time?: Date;
    streamType?: string;
    streamText?: string;
    summary?: string;
  };

  const rawLines: StreamItem[] = [];

  const res = await client.jobStream.listByJob(cfg.resourceGroup, cfg.accountName, jobId);
  for (const stream of [...res] as unknown as StreamItem[]) {
    rawLines.push(stream);
  }

  let nextLink = res.nextLink;
  while (nextLink) {
    const page = await client.jobStream.listByJobNext(nextLink);
    for (const stream of [...page] as unknown as StreamItem[]) {
      rawLines.push(stream);
    }
    nextLink = page.nextLink;
  }

  // listByJob returns summary-level stubs where streamText is null.
  // Fetch the full stream detail for each item that has a jobStreamId but no text.
  const needsFetch = rawLines.filter(s => !s.streamText?.trim() && s.jobStreamId);

  if (needsFetch.length > 0) {
    const CHUNK = 20;
    for (let i = 0; i < needsFetch.length; i += CHUNK) {
      const chunk = needsFetch.slice(i, i + CHUNK);
      const fetched = await Promise.all(
        chunk.map(async s => {
          try {
            const detail = await client.jobStream.get(
              cfg.resourceGroup,
              cfg.accountName,
              jobId,
              s.jobStreamId!,
            ) as StreamItem;
            return { id: s.jobStreamId!, text: detail.streamText ?? "" };
          } catch (e) {
            logger.warn({ err: e, jobStreamId: s.jobStreamId, jobId }, "azure-automation: jobStream.get failed");
            return { id: s.jobStreamId!, text: "" };
          }
        }),
      );
      const textMap = new Map(fetched.map(f => [f.id, f.text]));
      for (const line of rawLines) {
        if (line.jobStreamId && textMap.has(line.jobStreamId)) {
          line.streamText = textMap.get(line.jobStreamId) ?? line.streamText;
        }
      }
    }
  }

  rawLines.sort((a, b) => {
    const ta = a.time ? new Date(a.time).getTime() : 0;
    const tb = b.time ? new Date(b.time).getTime() : 0;
    return ta - tb;
  });

  const lines: JobOutputLine[] = rawLines.map((stream, i) => ({
    sequence: i,
    streamType: stream.streamType ?? "Output",
    text: stream.streamText ?? stream.summary ?? "",
    time: stream.time ?? undefined,
  }));

  return lines;
}

export type JobTerminalStatus = "Completed" | "Failed" | "Stopped" | "Suspended";
const TERMINAL_STATUSES = new Set<string>(["Completed", "Failed", "Stopped", "Suspended"]);

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}
