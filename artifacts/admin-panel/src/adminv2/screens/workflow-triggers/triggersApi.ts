/**
 * Every network call the Workflow Triggers screen makes. All real routes in
 * `admin-workflows.ts` — `listAllTriggers` is the one new route added
 * alongside this screen (a genuine gap, see `triggersTypes.ts`'s doc
 * comment); everything else (config/enable patch, delete, events, stats,
 * test-fire, rotate-token) already existed, unused by any screen until now.
 * Same `ApiError`/`readJson` shape as `workflowApi.ts`/`servicesApi.ts`, so
 * the server's own error text surfaces rather than a generic one.
 */

import type { DefinitionLite, GlobalTriggerRow, TriggerEventRow, TriggerStats } from "./triggersTypes";
import type { TriggerType } from "../workflows/workflowTypes";

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

export async function listAllTriggers(adminFetch: AdminFetch): Promise<GlobalTriggerRow[]> {
  const res = await adminFetch(`${BASE}/triggers`);
  const data = await readJson<unknown>(res, "Failed to load triggers");
  return Array.isArray(data) ? (data as GlobalTriggerRow[]) : [];
}

export async function listDefinitionsLite(adminFetch: AdminFetch): Promise<DefinitionLite[]> {
  const res = await adminFetch(`${BASE}/definitions`);
  const data = await readJson<unknown>(res, "Failed to load workflows");
  return Array.isArray(data) ? (data as Array<{ id: number; name: string }>).map((d) => ({ id: d.id, name: d.name })) : [];
}

export async function createTrigger(adminFetch: AdminFetch, definitionId: number, input: { type: TriggerType; config?: Record<string, unknown>; enabled?: boolean }): Promise<GlobalTriggerRow> {
  const res = await json(adminFetch, `${BASE}/definitions/${definitionId}/triggers`, "POST", input);
  return readJson(res, "Failed to create the trigger");
}

export async function updateTrigger(adminFetch: AdminFetch, definitionId: number, triggerId: number, patch: { config?: Record<string, unknown>; enabled?: boolean }): Promise<GlobalTriggerRow> {
  const res = await json(adminFetch, `${BASE}/definitions/${definitionId}/triggers/${triggerId}`, "PATCH", patch);
  return readJson(res, "Failed to save the trigger");
}

export async function deleteTrigger(adminFetch: AdminFetch, definitionId: number, triggerId: number): Promise<void> {
  const res = await adminFetch(`${BASE}/definitions/${definitionId}/triggers/${triggerId}`, { method: "DELETE" });
  if (!res.ok) await readJson(res, "Failed to delete the trigger");
}

export async function listTriggerEvents(adminFetch: AdminFetch, definitionId: number, triggerId: number, limit = 50): Promise<TriggerEventRow[]> {
  const res = await adminFetch(`${BASE}/definitions/${definitionId}/triggers/${triggerId}/events?limit=${limit}`);
  const data = await readJson<unknown>(res, "Failed to load trigger events");
  return Array.isArray(data) ? (data as TriggerEventRow[]) : [];
}

export async function getTriggerStats(adminFetch: AdminFetch, definitionId: number, triggerId: number): Promise<TriggerStats> {
  const res = await adminFetch(`${BASE}/definitions/${definitionId}/triggers/${triggerId}/stats`);
  return readJson(res, "Failed to load trigger stats");
}

export async function testFireTrigger(adminFetch: AdminFetch, definitionId: number, triggerId: number): Promise<{ runId: number | null; eventId: number }> {
  const res = await adminFetch(`${BASE}/definitions/${definitionId}/triggers/${triggerId}/test-fire`, { method: "POST" });
  return readJson(res, "Failed to test-fire the trigger");
}

export async function rotateWebhookToken(adminFetch: AdminFetch, definitionId: number, triggerId: number): Promise<GlobalTriggerRow> {
  const res = await adminFetch(`${BASE}/definitions/${definitionId}/triggers/${triggerId}/rotate-token`, { method: "POST" });
  return readJson(res, "Failed to rotate the webhook token");
}
