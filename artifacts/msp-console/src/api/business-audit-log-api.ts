/**
 * business-audit-log-api.ts — the data seam for the Audit Log module's second
 * tab (Git #4061, Feature #1946). Independent of `audit-log-api.ts` on
 * purpose: that file wraps `GET /api/msp/audit` (`msp_audit_logs`, the
 * security/session-outcome table #4012 shipped); this one wraps the general,
 * 179+-call-site business-action trail (`audit_logs`, widened by #4044/#4047)
 * via `GET /api/audit-logs` (`artifacts/api-server/src/routes/audit-logs.ts`).
 * Two different tables, two independent fetches — no shared state between
 * the tabs.
 *
 * `GET /api/audit-logs` was platform-admin-only (`requireAdmin`) until this
 * build widened its gate to `requireCapability("ladder.msp-admin")` — the
 * same floor MSP Console's own tab already requires — so an MSPAdmin/
 * MSPOperator/PlatformAdmin session can call it. Every filter below
 * (`actorRole`, `actionCategory`, `tenantId`) is real and already supported
 * server-side; nothing here is invented.
 *
 * No fixture module — every row is a real server response.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export interface BusinessAuditLogEntry {
  readonly id: number;
  readonly actorUserId: number | null;
  readonly actorName: string;
  readonly actorRole: string;
  readonly actionType: string;
  readonly actionCategory: string | null;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly entityLabel: string | null;
  readonly clientId: number | null;
  readonly tenantId: number | null;
  readonly projectId: number | null;
  readonly metadata: Record<string, unknown> | null;
  readonly createdAt: string;
}

export interface BusinessAuditLogCoverage {
  readonly totalRows: number;
  readonly categorizedRows: number;
  readonly uncategorizedRows: number;
  readonly categorizedPercent: number | null;
}

export interface BusinessAuditLogPage {
  entries: BusinessAuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  coverage: BusinessAuditLogCoverage;
  coverageNote: string;
}

export interface BusinessAuditLogFilters {
  page: number;
  limit: number;
  actionCategory: string;
  actorRole: string;
  entityType: string;
  from: string;
  to: string;
  /** Set only by the per-tenant mount — narrows to that customer's tenant. */
  tenantId?: number;
}

export class BusinessAuditLogApiError extends Error {
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
    throw new BusinessAuditLogApiError(res.status, message);
  }
  return (await res.json()) as T;
}

function buildParams(f: BusinessAuditLogFilters): URLSearchParams {
  const params = new URLSearchParams();
  params.set("page", String(f.page));
  params.set("limit", String(f.limit));
  if (f.actionCategory && f.actionCategory !== "all") params.set("actionCategory", f.actionCategory);
  if (f.actorRole && f.actorRole !== "all") params.set("actorRole", f.actorRole);
  if (f.entityType && f.entityType !== "all") params.set("entityType", f.entityType);
  if (f.from.trim()) params.set("from", f.from.trim());
  if (f.to.trim()) params.set("to", f.to.trim());
  if (f.tenantId != null) params.set("tenantId", String(f.tenantId));
  return params;
}

export function useBusinessAuditLog(
  filters: BusinessAuditLogFilters,
): UseQueryResult<BusinessAuditLogPage, BusinessAuditLogApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  const params = buildParams(filters);
  return useQuery({
    queryKey: ["msp", "business-audit-log", params.toString()],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/audit-logs?${params.toString()}`);
      return parseJsonOrThrow<BusinessAuditLogPage>(res);
    },
    enabled: !isLoading && !!accessToken,
    staleTime: 10_000,
  });
}

/** Real, closed vocabulary from `lib/db/src/schema/index.ts` (AUDIT_ACTION_CATEGORIES). */
export const ACTION_CATEGORIES: readonly string[] = [
  "create", "update", "delete", "action", "settings", "auth", "access", "security", "system",
];

/** Real, closed vocabulary from `lib/db/src/schema/index.ts` (AUDIT_ACTOR_ROLES). */
export const ACTOR_ROLES: readonly string[] = [
  "admin", "client", "customer", "msp", "platform_admin", "service_account", "agent", "microsoft", "system",
];

export const ACTION_CATEGORY_LABELS: Record<string, string> = {
  create: "Create", update: "Update", delete: "Delete", action: "Action",
  settings: "Settings", auth: "Auth", access: "Access", security: "Security", system: "System",
};

export const ACTOR_ROLE_LABELS: Record<string, string> = {
  admin: "Admin", client: "Client", customer: "Customer", msp: "MSP",
  platform_admin: "Platform Admin", service_account: "Service Account",
  agent: "Agent", microsoft: "Microsoft", system: "System",
};
