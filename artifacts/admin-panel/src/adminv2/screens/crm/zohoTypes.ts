/**
 * Shapes for the real Zoho CRM / EngageBay routes this screen reads and
 * writes. Mirrors `admin-panel/src/pages/crm/zoho/useZohoCrm.ts` (the old
 * panel's own hook against the same endpoints) rather than redeclaring a
 * different contract — both read `/api/zoho/crm/*`, and a write is queued
 * (202 + jobId) on both, never applied on the request path. See
 * `zoho-crm.ts` / `zoho-read.ts` (api-server) for the routes themselves.
 */

export type ZohoEntity = "leads" | "deals" | "contacts" | "accounts";

export interface ZohoRecord {
  id?: string;
  [key: string]: unknown;
}

export interface ZohoListResponse {
  module: string;
  records: ZohoRecord[];
  page: number;
  perPage: number;
  more: boolean;
}

export interface QueuedWrite {
  queued: boolean;
  jobId: string;
  jobType: string;
  action: string;
  message: string;
}

export type JobState = "pending" | "running" | "completed" | "failed";

export interface JobStatus {
  jobId: string;
  jobType: string;
  status: JobState;
  attemptCount: number;
  maxAttempts: number;
  errorMessage: string | null;
  result: Record<string, unknown> | null;
  scheduledAt: string | null;
  completedAt: string | null;
}

/** A write this browser session queued, tracked locally — there is no server endpoint to list the full queue. */
export interface TrackedWrite {
  jobId: string;
  action: string;
  message: string;
  startedAt: number;
  state: "queued" | "syncing" | "synced" | "failed";
  detail: string | null;
}

export interface ZohoConnectionStatus {
  status: string;
  zohoOrgId?: string | null;
  connectedAt?: string | null;
  lastRefreshedAt?: string | null;
  lastErrorMessage?: string | null;
  accessTokenExpiresAt?: string | null;
}

export interface ZohoAuthStatus {
  credentialsConfigured: boolean;
  connection: ZohoConnectionStatus;
}

export interface EngageBayConnectionStatus {
  status: string;
  connectedAt?: string | null;
  lastErrorMessage?: string | null;
}

export interface EngageBayStatusResponse {
  connection: EngageBayConnectionStatus;
}

export interface EngageBayActivityEvent {
  id: string;
  triggerId: string;
  runId: string | null;
  firedAt: string;
  status: string;
  durationMs: number | null;
  payload: unknown;
  errorMessage: string | null;
  eventType: string | null;
  definitionId: string;
}

/** Pulls the readable message out of an error body without inventing one. */
export async function readZohoError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; code?: string };
    if (body.code === "zoho_not_connected") {
      return "Zoho is not connected. Connect it from the old admin panel's Settings before using this.";
    }
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

function firstString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

/** Zoho's `Owner` field is a `{name, id, email}` object on every module — never render it raw. */
export function zohoOwnerName(record: ZohoRecord): string {
  const owner = record.Owner;
  if (owner && typeof owner === "object" && "name" in owner) {
    const name = (owner as { name?: unknown }).name;
    if (typeof name === "string" && name) return name;
  }
  return typeof owner === "string" && owner ? owner : "Unassigned";
}

export function leadDisplayName(record: ZohoRecord): string {
  return (
    firstString(record.Full_Name) ??
    firstString([record.First_Name, record.Last_Name].filter(Boolean).join(" ")) ??
    "Unnamed lead"
  );
}

export function leadCompany(record: ZohoRecord): string {
  return firstString(record.Company) ?? leadDisplayName(record);
}

export function dealName(record: ZohoRecord): string {
  return firstString(record.Deal_Name) ?? "Untitled deal";
}

export function formatUsd(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function formatShortDate(value: unknown): string {
  if (typeof value !== "string" || !value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
