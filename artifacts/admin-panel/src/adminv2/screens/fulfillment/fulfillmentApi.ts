/**
 * Every network call the Fulfillment screen makes — `admin-fulfillment.ts`
 * (queue + SLA config) and `admin-fulfillment-types.ts` (the type registry),
 * both already real and audit-logged. Same `ApiError`/`readJson` shape as
 * `servicesApi.ts`, so the server's own error text surfaces rather than a
 * generic one.
 */

import type { DeliveryRow, DeliveryStatus, FiredWhen, FulfillmentTypeRow, QueueFilters, QueueMeta, SlaConfigRow } from "./fulfillmentTypes";

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

// ── Queue ────────────────────────────────────────────────────────────────────

/** `GET /api/admin/fulfillment-queue`. `pageSize` is capped server-side at 100. */
export async function listQueue(
  adminFetch: AdminFetch,
  filters: Partial<QueueFilters> & { page?: number; pageSize?: number } = {},
): Promise<{ items: DeliveryRow[]; meta: QueueMeta }> {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.sourceType) params.set("sourceType", filters.sourceType);
  if (filters.overdue) params.set("overdue", "1");
  if (filters.q?.trim()) params.set("q", filters.q.trim());
  params.set("page", String(filters.page ?? 1));
  params.set("pageSize", String(filters.pageSize ?? 100));

  const res = await adminFetch(`/api/admin/fulfillment-queue?${params}`);
  return readJson<{ items: DeliveryRow[]; meta: QueueMeta }>(res, "Failed to load the fulfillment queue");
}

/** `PATCH /api/admin/fulfillment-queue/:id/status`. */
export async function patchDeliveryStatus(
  adminFetch: AdminFetch,
  id: number,
  patch: { deliveryStatus: DeliveryStatus; statusNote?: string | null },
): Promise<void> {
  const res = await json(adminFetch, `/api/admin/fulfillment-queue/${id}/status`, "PATCH", patch);
  await readJson<{ ok: true }>(res, "Failed to update the delivery status");
}

/** `POST /api/admin/fulfillment-queue/sync` — pulls newly-sold offers/SOWs/bundles into the queue. */
export async function syncQueue(adminFetch: AdminFetch): Promise<{ added: number; errors: number }> {
  const res = await adminFetch("/api/admin/fulfillment-queue/sync", { method: "POST" });
  return readJson<{ added: number; errors: number }>(res, "Sync failed");
}

// ── SLA config ───────────────────────────────────────────────────────────────

/** `GET /api/admin/fulfillment-sla-config`. */
export async function listSlaConfig(adminFetch: AdminFetch): Promise<SlaConfigRow[]> {
  const res = await adminFetch("/api/admin/fulfillment-sla-config");
  const data = await readJson<unknown>(res, "Failed to load SLA thresholds");
  return Array.isArray(data) ? (data as SlaConfigRow[]) : [];
}

/** `PATCH /api/admin/fulfillment-sla-config/:key`. */
export async function patchSlaConfig(adminFetch: AdminFetch, key: string, thresholdDays: number): Promise<void> {
  const res = await json(adminFetch, `/api/admin/fulfillment-sla-config/${encodeURIComponent(key)}`, "PATCH", { thresholdDays });
  await readJson<{ ok: true }>(res, "Failed to save the SLA threshold");
}

// ── Fulfillment types ────────────────────────────────────────────────────────

/** `GET /api/admin/fulfillment-types`. */
export async function listFulfillmentTypes(adminFetch: AdminFetch): Promise<FulfillmentTypeRow[]> {
  const res = await adminFetch("/api/admin/fulfillment-types");
  const data = await readJson<unknown>(res, "Failed to load fulfillment types");
  return Array.isArray(data) ? (data as FulfillmentTypeRow[]) : [];
}

export interface CreateFulfillmentTypeInput {
  key: string;
  label: string;
  description?: string;
  firedWhen: FiredWhen[];
  recurring: boolean;
  isActive: boolean;
}

/** `POST /api/admin/fulfillment-types`. */
export async function createFulfillmentType(adminFetch: AdminFetch, input: CreateFulfillmentTypeInput): Promise<FulfillmentTypeRow> {
  const res = await json(adminFetch, "/api/admin/fulfillment-types", "POST", input);
  return readJson<FulfillmentTypeRow>(res, "Failed to create the fulfillment type");
}

/** `PUT /api/admin/fulfillment-types/:key`. `key` is immutable — never sent in the patch. */
export async function updateFulfillmentType(
  adminFetch: AdminFetch,
  key: string,
  patch: Partial<Omit<CreateFulfillmentTypeInput, "key">>,
): Promise<FulfillmentTypeRow> {
  const res = await json(adminFetch, `/api/admin/fulfillment-types/${encodeURIComponent(key)}`, "PUT", patch);
  return readJson<FulfillmentTypeRow>(res, "Failed to save the fulfillment type");
}

/** `DELETE /api/admin/fulfillment-types/:key`. */
export async function deleteFulfillmentType(adminFetch: AdminFetch, key: string): Promise<void> {
  const res = await adminFetch(`/api/admin/fulfillment-types/${encodeURIComponent(key)}`, { method: "DELETE" });
  await readJson<{ ok: true }>(res, "Failed to delete the fulfillment type");
}

/** `POST /api/admin/fulfillment-types/resolve` — manually fires `resolve_fulfillment` for testing. */
export async function resolveFulfillmentType(
  adminFetch: AdminFetch,
  fulfillmentTypeKey: string,
  payload: Record<string, unknown>,
): Promise<{ status: string; eventName?: string }> {
  const res = await json(adminFetch, "/api/admin/fulfillment-types/resolve", "POST", { fulfillmentTypeKey, payload });
  return readJson<{ status: string; eventName?: string }>(res, "Resolve failed");
}

/** `GET /api/admin/fulfillment-types/export` — the whole registry, for "Copy the catalog". */
export async function exportFulfillmentTypes(adminFetch: AdminFetch): Promise<unknown> {
  const res = await adminFetch("/api/admin/fulfillment-types/export");
  return readJson<unknown>(res, "Export failed");
}
