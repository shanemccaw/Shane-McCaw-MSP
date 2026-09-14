/**
 * audit-log-api.ts — the data seam for the MSP Console's Audit Log module
 * page (#4012, Feature #3752). Mounted twice from the same component
 * (`AuditLog.tsx`): the per-tenant leaf (`Client → Audit log`) and the
 * Operations node (`/ops/audit`) — same file, same hook, one prop.
 *
 * Wraps `GET /api/msp/audit` (`artifacts/api-server/src/routes/msp-audit-log.ts`):
 *   page, limit, search, actionType, mspId (PlatformAdmin only), customerId,
 *   outcome, from, to.
 *
 * Scoping is entirely server-side. An MSPAdmin/MSPOperator is pinned to their
 * own MSP and any `mspId` they send is silently ignored; a PlatformAdmin sees
 * every MSP unless one is named. `customerId` narrows inside whatever MSP
 * scope already applies — it is what the per-tenant mount passes.
 *
 * The wire aliases the underlying columns (actionType → action,
 * entityLabel/entityType → resource, occurredAt → createdAt) and never
 * returns customer_id, entity_id, correlation_id, ip_address, user_agent or
 * actor_service_account_id — real columns on `msp_audit_logs`
 * (`lib/db/src/schema/msp.ts`) that this route deliberately keeps off the wire.
 *
 * No fixture module — every row is a real server response.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export interface AuditLogEntry {
  readonly id: number;
  readonly eventId: string;
  readonly actorEmail: string | null;
  readonly actorName: string | null;
  readonly actorRole: string | null;
  readonly action: string;
  readonly resource: string | null;
  readonly detail: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly outcome: "success" | "failure" | "partial";
  readonly createdAt: string;
}

export interface AuditLogPage {
  entries: AuditLogEntry[];
  total: number;
  page: number;
  limit: number;
}

export interface AuditLogFilters {
  page: number;
  limit: number;
  search: string;
  actionType: string;
  outcome: "any" | "success" | "failure" | "partial";
  from: string;
  to: string;
  /** Set only by the per-tenant mount. */
  customerId?: number;
  /** PlatformAdmin-only scope narrowing; ignored server-side for anyone else. */
  mspId?: number;
}

export class AuditLogApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.clone().json()) as { error?: string | { message?: string } };
      if (typeof body?.error === "string") message = body.error;
      else if (body?.error?.message) message = body.error.message;
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new AuditLogApiError(res.status, message);
  }
  return (await res.json()) as T;
}

function buildParams(f: AuditLogFilters): URLSearchParams {
  const params = new URLSearchParams();
  params.set("page", String(f.page));
  params.set("limit", String(f.limit));
  if (f.search.trim()) params.set("search", f.search.trim());
  if (f.actionType.trim()) params.set("actionType", f.actionType.trim());
  if (f.outcome !== "any") params.set("outcome", f.outcome);
  if (f.from.trim()) params.set("from", f.from.trim());
  if (f.to.trim()) params.set("to", f.to.trim());
  if (f.customerId != null) params.set("customerId", String(f.customerId));
  if (f.mspId != null) params.set("mspId", String(f.mspId));
  return params;
}

export function useAuditLog(filters: AuditLogFilters): UseQueryResult<AuditLogPage, AuditLogApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  const params = buildParams(filters);
  return useQuery({
    queryKey: ["msp", "audit-log", params.toString()],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/msp/audit?${params.toString()}`);
      return parseJsonOrThrow<AuditLogPage>(res);
    },
    enabled: !isLoading && !!accessToken,
    staleTime: 10_000,
  });
}

/**
 * The wire never marks a fallback row itself (see the route's own comment) —
 * when no user row resolved for an actor, `actorEmail` becomes the stored
 * `actorRole` string. This is the same shape-check the design's own logic
 * class performs, not a value the server sends.
 */
export function isFallbackActor(e: Pick<AuditLogEntry, "actorName" | "actorEmail" | "actorRole">): boolean {
  return e.actorName == null && e.actorEmail != null && e.actorEmail === e.actorRole;
}

/** Three real spellings coexist in `actionType` with no shared vocabulary. */
export function actionConvention(action: string): string {
  if (/^[A-Z_]+$/.test(action)) return "SCREAMING_SNAKE — the sign-in family";
  if (action.includes(".")) return "dot.namespaced — settings, sales, MCP tools";
  return "a bare word — the oldest writers";
}

/** Real columns on `msp_audit_logs` (`lib/db/src/schema/msp.ts`) that this
 * route never puts on the wire — documentation of the schema, not fabricated
 * row data. */
export const HIDDEN_COLUMNS: readonly string[] = [
  "customer_id", "entity_id", "correlation_id", "ip_address", "user_agent", "actor_service_account_id",
];
