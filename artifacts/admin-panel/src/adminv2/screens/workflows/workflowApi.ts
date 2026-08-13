/**
 * Every network call the Workflow Builder screen makes — all real,
 * already-live routes in `admin-workflows.ts`. Same `ApiError`/`readJson`
 * shape as `fulfillmentApi.ts`/`servicesApi.ts`, so the server's own error
 * text surfaces rather than a generic one.
 */

import type {
  DefinitionRow,
  PendingApprovalRow,
  RunDetail,
  RunRow,
  StoredEdge,
  StoredNode,
  TriggerRow,
  TriggerType,
  VersionRow,
} from "./workflowTypes";

export type AdminFetch = (path: string, init?: RequestInit) => Promise<Response>;

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const message = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error
      : fallback;
    throw new ApiError(res.status, message);
  }
  return body as T;
}

function json(adminFetch: AdminFetch, path: string, method: string, payload?: unknown): Promise<Response> {
  return adminFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
}

const BASE = "/api/admin/workflows";

// ── Definitions ──────────────────────────────────────────────────────────────

export async function listDefinitions(adminFetch: AdminFetch): Promise<DefinitionRow[]> {
  const res = await adminFetch(`${BASE}/definitions`);
  const data = await readJson<unknown>(res, "Failed to load workflow definitions");
  return Array.isArray(data) ? (data as DefinitionRow[]) : [];
}

export interface CreateDefinitionInput {
  name: string;
  description?: string;
}

export async function createDefinition(adminFetch: AdminFetch, input: CreateDefinitionInput): Promise<DefinitionRow & { draftVersionId: number }> {
  const res = await json(adminFetch, `${BASE}/definitions`, "POST", input);
  return readJson(res, "Failed to create the workflow");
}

export interface DefinitionCorePatch {
  name?: string;
  description?: string;
  concurrencyLimit?: number;
  maxRunDepth?: number;
}

/** `PUT` — the core, non-metadata fields. */
export async function updateDefinitionCore(adminFetch: AdminFetch, id: number, patch: DefinitionCorePatch): Promise<DefinitionRow> {
  const res = await json(adminFetch, `${BASE}/definitions/${id}`, "PUT", patch);
  return readJson(res, "Failed to save the workflow");
}

export interface DefinitionMetaPatch {
  category?: string | null;
  description?: string | null;
  owner?: string | null;
  tags?: string[] | null;
  riskLevel?: "low" | "medium" | "high" | null;
}

/** `PATCH` — the `metadata`-backed fields, merged server-side. */
export async function updateDefinitionMeta(adminFetch: AdminFetch, id: number, patch: DefinitionMetaPatch): Promise<DefinitionRow> {
  const res = await json(adminFetch, `${BASE}/definitions/${id}`, "PATCH", patch);
  return readJson(res, "Failed to save the workflow");
}

export async function duplicateDefinition(adminFetch: AdminFetch, id: number): Promise<DefinitionRow & { draftVersionId: number }> {
  const res = await adminFetch(`${BASE}/definitions/${id}/duplicate`, { method: "POST" });
  return readJson(res, "Failed to duplicate the workflow");
}

export async function deleteDefinition(adminFetch: AdminFetch, id: number): Promise<void> {
  const res = await adminFetch(`${BASE}/definitions/${id}`, { method: "DELETE" });
  if (!res.ok) await readJson(res, "Failed to delete the workflow");
}

/** `POST .../run` — fires the published version (or `versionId`, if given) for real. */
export async function runDefinition(adminFetch: AdminFetch, id: number, opts: { versionId?: number; payload?: Record<string, unknown> } = {}): Promise<{ runId: number }> {
  const res = await json(adminFetch, `${BASE}/definitions/${id}/run`, "POST", opts);
  return readJson(res, "Failed to run the workflow");
}

// ── Versions ─────────────────────────────────────────────────────────────────

export async function listVersions(adminFetch: AdminFetch, definitionId: number): Promise<VersionRow[]> {
  const res = await adminFetch(`${BASE}/definitions/${definitionId}/versions`);
  const data = await readJson<unknown>(res, "Failed to load versions");
  return Array.isArray(data) ? (data as VersionRow[]) : [];
}

export async function getVersion(adminFetch: AdminFetch, definitionId: number, versionId: number): Promise<VersionRow> {
  const res = await adminFetch(`${BASE}/definitions/${definitionId}/versions/${versionId}`);
  return readJson(res, "Failed to load the version");
}

export async function createVersion(adminFetch: AdminFetch, definitionId: number, input: { label?: string; graph?: { nodes: StoredNode[]; edges: StoredEdge[] } } = {}): Promise<VersionRow> {
  const res = await json(adminFetch, `${BASE}/definitions/${definitionId}/versions`, "POST", input);
  return readJson(res, "Failed to create a new version");
}

/**
 * `PUT` a version's graph. Saving over a *published* version does not
 * mutate it in place — the server auto-drafts a new version from it and
 * returns that instead (`autoDraftedFrom` names the source). The caller
 * must treat the response as "the version now open", not "the version I
 * asked to save".
 */
export async function saveVersionGraph(
  adminFetch: AdminFetch,
  definitionId: number,
  versionId: number,
  patch: { graph: { nodes: StoredNode[]; edges: StoredEdge[] }; label?: string },
): Promise<VersionRow & { autoDraftedFrom?: number }> {
  const res = await json(adminFetch, `${BASE}/definitions/${definitionId}/versions/${versionId}`, "PUT", patch);
  return readJson(res, "Failed to save the workflow canvas");
}

export async function publishVersion(adminFetch: AdminFetch, definitionId: number, versionId: number, label?: string): Promise<VersionRow> {
  const res = await json(adminFetch, `${BASE}/definitions/${definitionId}/versions/${versionId}/publish`, "POST", label ? { label } : {});
  return readJson(res, "Failed to publish the version");
}

// ── Triggers ─────────────────────────────────────────────────────────────────

export async function listTriggers(adminFetch: AdminFetch, definitionId: number): Promise<TriggerRow[]> {
  const res = await adminFetch(`${BASE}/definitions/${definitionId}/triggers`);
  const data = await readJson<unknown>(res, "Failed to load triggers");
  return Array.isArray(data) ? (data as TriggerRow[]) : [];
}

export async function createTrigger(adminFetch: AdminFetch, definitionId: number, input: { type: TriggerType; config?: Record<string, unknown>; enabled?: boolean }): Promise<TriggerRow> {
  const res = await json(adminFetch, `${BASE}/definitions/${definitionId}/triggers`, "POST", input);
  return readJson(res, "Failed to create the trigger");
}

export async function updateTrigger(adminFetch: AdminFetch, definitionId: number, triggerId: number, patch: { config?: Record<string, unknown>; enabled?: boolean }): Promise<TriggerRow> {
  const res = await json(adminFetch, `${BASE}/definitions/${definitionId}/triggers/${triggerId}`, "PATCH", patch);
  return readJson(res, "Failed to save the trigger");
}

export async function deleteTrigger(adminFetch: AdminFetch, definitionId: number, triggerId: number): Promise<void> {
  const res = await adminFetch(`${BASE}/definitions/${definitionId}/triggers/${triggerId}`, { method: "DELETE" });
  if (!res.ok) await readJson(res, "Failed to delete the trigger");
}

// ── Runs ─────────────────────────────────────────────────────────────────────

export async function listRuns(adminFetch: AdminFetch, opts: { definitionId?: number; limit?: number } = {}): Promise<{ runs: RunRow[]; total: number }> {
  const params = new URLSearchParams();
  if (opts.definitionId != null) params.set("definitionId", String(opts.definitionId));
  params.set("limit", String(opts.limit ?? 20));
  const res = await adminFetch(`${BASE}/runs?${params}`);
  return readJson(res, "Failed to load runs");
}

/** The full execution trace — logs, per-node outputs, branch path, graph. Heavier than `listRuns`' rows on purpose; only fetched for the one run open as a doc. */
export async function getRunDetail(adminFetch: AdminFetch, id: number): Promise<RunDetail> {
  const res = await adminFetch(`${BASE}/runs/${id}`);
  return readJson(res, "Failed to load the run");
}

export async function cancelRun(adminFetch: AdminFetch, id: number): Promise<void> {
  const res = await adminFetch(`${BASE}/runs/${id}/cancel`, { method: "POST" });
  if (!res.ok) await readJson(res, "Failed to cancel the run");
}

export async function rerun(adminFetch: AdminFetch, id: number): Promise<{ runId: number }> {
  const res = await adminFetch(`${BASE}/runs/${id}/rerun`, { method: "POST" });
  return readJson(res, "Failed to re-run");
}

// ── Pending approvals ────────────────────────────────────────────────────────

export async function listPendingApprovals(adminFetch: AdminFetch): Promise<PendingApprovalRow[]> {
  const res = await adminFetch(`${BASE}/pending-approvals`);
  const data = await readJson<unknown>(res, "Failed to load pending approvals");
  return Array.isArray(data) ? (data as PendingApprovalRow[]) : [];
}

export async function decideApproval(adminFetch: AdminFetch, id: number, decision: "approved" | "rejected", note?: string): Promise<void> {
  const res = await json(adminFetch, `${BASE}/pending-approvals/${id}/decide`, "POST", { decision, note });
  if (!res.ok) await readJson(res, "Failed to record the decision");
}
