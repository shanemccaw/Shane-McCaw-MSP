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
import { logger } from "./logger.ts";

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
    /** Maximum parallel Azure API calls per iteration. Tune here if rate-limiting occurs. */
    const CHUNK_SIZE = 20;
    /** Retry delays in ms for exponential backoff on transient jobStream.get failures. */
    const RETRY_DELAYS_MS = [200, 400, 800];

    const fetchStreamWithRetry = async (s: StreamItem): Promise<{ id: string; text: string; fallback: boolean }> => {
      let lastErr: unknown;
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        if (attempt > 0) {
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS_MS[attempt - 1]));
        }
        try {
          const detail = await client.jobStream.get(
            cfg.resourceGroup,
            cfg.accountName,
            jobId,
            s.jobStreamId!,
          ) as StreamItem;
          return { id: s.jobStreamId!, text: detail.streamText ?? "", fallback: false };
        } catch (e) {
          lastErr = e;
        }
      }
      logger.warn(
        { err: lastErr, jobStreamId: s.jobStreamId, jobId, attempts: RETRY_DELAYS_MS.length + 1 },
        "azure-automation: jobStream.get failed after retries — using summary stub as fallback",
      );
      return { id: s.jobStreamId!, text: s.summary ?? "", fallback: true };
    };

    let fallbackCount = 0;

    for (let i = 0; i < needsFetch.length; i += CHUNK_SIZE) {
      const chunk = needsFetch.slice(i, i + CHUNK_SIZE);
      const fetched = await Promise.all(chunk.map(fetchStreamWithRetry));
      fallbackCount += fetched.filter(f => f.fallback).length;
      const textMap = new Map(fetched.map(f => [f.id, f.text]));
      for (const line of rawLines) {
        if (line.jobStreamId && textMap.has(line.jobStreamId)) {
          line.streamText = textMap.get(line.jobStreamId) ?? line.streamText;
        }
      }
    }

    if (fallbackCount > 0) {
      logger.warn(
        { jobId, fallbackCount, totalFetched: needsFetch.length },
        "azure-automation: some job stream records used summary stub fallback after repeated API failures — full stream text unavailable for those lines",
      );
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

/**
 * Returns true when all required Azure env vars are present.
 * Use this before calling any Azure helper to skip gracefully when not configured.
 */
export function isAzureConfigured(): boolean {
  return !!(
    process.env.AZURE_TENANT_ID &&
    process.env.AZURE_CLIENT_ID &&
    process.env.AZURE_CLIENT_SECRET &&
    process.env.AZURE_SUBSCRIPTION_ID &&
    process.env.AZURE_AUTOMATION_RESOURCE_GROUP &&
    process.env.AZURE_AUTOMATION_ACCOUNT_NAME
  );
}

/**
 * Create or update a PowerShell runbook in Azure Automation and upload the
 * provided script content to its draft slot, ready for publishing.
 *
 * - If the runbook does not exist it is created with type "PowerShell72" (PowerShell 7.2).
 * - If the runbook already exists, `createOrUpdate` updates only metadata
 *   and the content is replaced via a direct REST PUT.
 *
 * NOTE: The ARM SDK's `runbookDraft.replaceContent` is an LRO that attempts
 * to parse the response body as JSON for polling state. The response body is
 * raw PowerShell text, so the SDK throws a JSON parse error. We bypass the
 * SDK for this one call and use a raw fetch with a bearer token instead.
 */
export async function upsertRunbookContent(name: string, psCode: string): Promise<void> {
  const { client, cfg } = buildClient();
  const azCfg = getAzureConfig();

  // Fetch the Automation Account to get its location — required by the ARM API
  // when creating a new runbook resource for the first time (tolerated on updates).
  const account = await client.automationAccount.get(cfg.resourceGroup, cfg.accountName);
  const location = account.location;
  if (!location) {
    throw new Error(
      `azure-automation: could not determine location for Automation Account "${cfg.accountName}". ` +
      "The ARM API returned no location field.",
    );
  }

  // Acquire a bearer token once — reused for both the createOrUpdate and draft
  // content upload calls below (both bypass the ARM SDK, see notes on each step).
  const credential = new ClientSecretCredential(azCfg.tenantId, azCfg.clientId, azCfg.clientSecret);
  const tokenResponse = await credential.getToken("https://management.azure.com/.default");
  if (!tokenResponse?.token) {
    throw new Error("azure-automation: failed to acquire bearer token");
  }
  const bearerToken = tokenResponse.token;

  // Step 1: ensure the runbook record exists via a raw REST PUT.
  // We bypass client.runbook.createOrUpdate() because the ARM SDK v10 uses an
  // API version that predates PowerShell 7.2 support ("PowerShell72" runbook type).
  // API version 2022-08-08 is the first to support "PowerShell72".
  const runbookUrl =
    `https://management.azure.com/subscriptions/${azCfg.subscriptionId}` +
    `/resourceGroups/${azCfg.resourceGroup}` +
    `/providers/Microsoft.Automation/automationAccounts/${azCfg.accountName}` +
    `/runbooks/${encodeURIComponent(name)}` +
    `?api-version=2022-08-08`;

  // Check whether the runbook already exists and, if so, what type it is.
  // Azure does not allow changing a runbook's type after creation — attempting
  // to PUT with a different runbookType returns HTTP 400. We must preserve
  // whatever type the runbook was originally created with.
  let existingRunbookType: string | undefined;
  const getRes = await fetch(runbookUrl, {
    method: "GET",
    headers: { "Authorization": `Bearer ${bearerToken}` },
  });
  if (getRes.ok) {
    const getBody = await getRes.json().catch(() => ({})) as { properties?: { runbookType?: string } };
    existingRunbookType = getBody?.properties?.runbookType;
  }
  // Fall back to PowerShell72 only when creating a new runbook from scratch.
  const runbookType = existingRunbookType ?? "PowerShell72";

  const createRes = await fetch(runbookUrl, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${bearerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      location,
      properties: {
        runbookType,
        description: "Managed by Shane McCaw Consulting admin panel",
        logVerbose: false,
        logProgress: false,
        draft: {},
      },
    }),
  });

  if (!createRes.ok) {
    const errBody = await createRes.text().catch(() => "");
    throw new Error(
      `azure-automation: runbook createOrUpdate failed — HTTP ${createRes.status}: ${errBody}`,
    );
  }

  // Step 2: upload script content via a raw REST PUT.
  // We cannot use client.runbookDraft.replaceContent() because the ARM SDK
  // treats the endpoint as an LRO and tries to JSON-parse the response body
  // (which is the raw PS script text) — causing "Unexpected token 'C'..." errors.
  const contentUrl =
    `https://management.azure.com/subscriptions/${azCfg.subscriptionId}` +
    `/resourceGroups/${azCfg.resourceGroup}` +
    `/providers/Microsoft.Automation/automationAccounts/${azCfg.accountName}` +
    `/runbooks/${encodeURIComponent(name)}/draft/content` +
    `?api-version=2019-06-01`;

  const uploadRes = await fetch(contentUrl, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${bearerToken}`,
      "Content-Type": "text/powershell",
    },
    body: psCode,
  });

  if (!uploadRes.ok) {
    const errBody = await uploadRes.text().catch(() => "");
    throw new Error(
      `azure-automation: draft content upload failed — HTTP ${uploadRes.status}: ${errBody}`,
    );
  }

  logger.info({ runbookName: name }, "azure-automation: runbook content upserted");
}

/**
 * Publish the draft slot of the named runbook so it becomes immediately executable.
 *
 * Uses `client.runbook.publish()` which is the correct surface in
 * @azure/arm-automation v10 — it internally calls `beginPublish` and polls
 * until the LRO finishes.  Do NOT use `client.runbookDraft.beginPublish`
 * which is a different (upload-only) surface and does not trigger publication.
 */
export async function publishRunbook(name: string): Promise<void> {
  const { client, cfg } = buildClient();

  // client.runbook.publish() → internally delegates to beginPublish + poll
  // Falls back to beginPublish if the synchronous wrapper is absent (type-cast
  // only to satisfy strict TS — both methods exist on RunbookOperations in v10).
  const runbookOps = client.runbook as unknown as {
    publish?: (rg: string, acct: string, name: string) => Promise<unknown>;
    beginPublish?: (rg: string, acct: string, name: string) => Promise<{ pollUntilFinished?: () => Promise<unknown> }>;
  };

  if (typeof runbookOps.publish === "function") {
    await runbookOps.publish(cfg.resourceGroup, cfg.accountName, name);
  } else if (typeof runbookOps.beginPublish === "function") {
    const poller = await runbookOps.beginPublish(cfg.resourceGroup, cfg.accountName, name);
    if (poller && typeof poller.pollUntilFinished === "function") {
      await poller.pollUntilFinished();
    }
  } else {
    throw new Error("azure-automation: runbook publish API not available on this SDK version");
  }

  logger.info({ runbookName: name }, "azure-automation: runbook published");
}

/**
 * Convenience helper: upsert content then publish in one call.
 * Throws if Azure is not configured — callers should guard with isAzureConfigured().
 */
export async function pushScriptToAzure(runbookName: string, psCode: string): Promise<void> {
  await upsertRunbookContent(runbookName, psCode);
  await publishRunbook(runbookName);
}

/**
 * Delete a runbook from Azure Automation by name.
 *
 * - If the runbook does not exist (404) the function resolves silently — this
 *   is the "already gone" case and should not be treated as an error.
 * - All other errors are rethrown so callers can decide whether to surface them.
 * - Callers should guard with isAzureConfigured() before calling this.
 */
export async function deleteRunbook(name: string): Promise<void> {
  const { client, cfg } = buildClient();
  try {
    await client.runbook.deleteMethod(cfg.resourceGroup, cfg.accountName, name);
    logger.info({ runbookName: name }, "azure-automation: runbook deleted");
  } catch (err: unknown) {
    // 404 means the runbook was already gone — treat as success
    const status = (err as { statusCode?: number; code?: string })?.statusCode
      ?? (err as { response?: { status?: number } })?.response?.status;
    if (status === 404) {
      logger.info({ runbookName: name }, "azure-automation: runbook not found in Azure — skipping delete (already gone)");
      return;
    }
    throw err;
  }
}
