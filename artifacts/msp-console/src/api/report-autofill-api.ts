/**
 * report-autofill-api.ts — the data seam for the MSP Console's "Autofill from a
 * delivery project" panel on the Status Reports module page (Git #4248).
 *
 * Wires the real, pre-existing `admin-projects.ts` routes (Git #3433/#4245's
 * Delivery Projects surface — the fixed five-column Kanban pipeline tied to a
 * `projectsTable` row, NOT the Simple Kanban board at `/ops/projects`):
 *
 *   GET /api/admin/projects?clientUserId=<id>        — a client's delivery projects
 *   GET /api/admin/projects/:id/report-autofill       — project/client summary +
 *       completed/pending steps + completed tasks, optionally since a date
 *
 * `projectsTable.clientUserId` points at `usersTable` (the legacy client-portal-
 * user axis), which has no FK to `tenantsTable` (the axis the MSP Console tree's
 * `customerId` is scoped to) — the exact same gap `invoices-api.ts`'s own header
 * documents for `invoicesTable`. So this module does not try to filter delivery
 * projects by the tenant currently selected in the console tree; it reuses
 * `invoices-api.ts`'s `useMspClients` for an honest, manual client picker scoped
 * to this MSP, then lists that client's own delivery projects.
 *
 * Both routes are `mspId`-scoped server-side (Git #4251, added alongside this
 * build): a PlatformAdmin session sees every project, an MSP operator only ever
 * sees / autofills from a project belonging to their own MSP's clients.
 *
 * No fixture module, no fabricated row — every value here is a real server
 * response or an honest loading/empty/error state.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export type ProjectStatus = "active" | "on_hold" | "completed";

/** Real shape of a `projectsTable` row, as returned by `GET /admin/projects`. */
export interface DeliveryProject {
  readonly id: number;
  readonly title: string;
  readonly status: ProjectStatus;
  readonly phase: string | null;
  readonly progress: number;
  readonly description: string | null;
  readonly clientUserId: number | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly createdAt: string;
}

export interface ReportAutofillClient {
  readonly id: number;
  readonly name: string | null;
  readonly email: string;
  readonly company: string | null;
}

export interface ReportAutofillCompletedStep {
  readonly title: string;
  readonly description: string;
}

export interface ReportAutofillPendingStep {
  readonly label: "In Progress" | "Upcoming";
  readonly title: string;
  readonly description: string;
}

export interface ReportAutofillCompletedTask {
  readonly title: string;
  readonly description: string;
  readonly completionStatus: string | null;
  readonly completionNotes: string | null;
}

/** Real shape of `GET /admin/projects/:id/report-autofill`'s response (`admin-projects.ts:918`). */
export interface ReportAutofillResponse {
  readonly project: {
    readonly id: number;
    readonly title: string;
    readonly status: ProjectStatus;
    readonly progress: number;
    readonly description: string | null;
    readonly endDate: string | null;
  };
  readonly client: ReportAutofillClient | null;
  readonly completedTasks: ReportAutofillCompletedTask[];
  readonly completedSteps: ReportAutofillCompletedStep[];
  readonly pendingSteps: ReportAutofillPendingStep[];
  readonly blockedCount: number;
  readonly totalSteps: number;
  readonly completedStepsCount: number;
  readonly lastReportDate: string | null;
  readonly lastReportPeriod: string | null;
  readonly sinceDate: string | null;
}

export class ReportAutofillApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function requestJson<T>(
  fetchWithAuth: (i: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  url: string,
): Promise<T> {
  const res = await fetchWithAuth(url);
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.clone().json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new ReportAutofillApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export function useDeliveryProjectsForClient(clientUserId: number | null): UseQueryResult<DeliveryProject[], ReportAutofillApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["admin", "projects", "byClient", clientUserId],
    queryFn: () => requestJson<DeliveryProject[]>(fetchWithAuth, `/api/admin/projects?clientUserId=${clientUserId}`),
    enabled: !isLoading && !!accessToken && clientUserId != null,
    staleTime: 15_000,
  });
}

/**
 * Fires only once `projectId` is set — the panel sets it from an explicit
 * "Generate draft" click, not on every picker change, both to give the operator
 * a real trigger (per #4248's own ask) and because the route writes a real
 * `auditPrivilegedRead` row on every call.
 */
export function useReportAutofill(
  projectId: number | null,
  since: string | null,
): UseQueryResult<ReportAutofillResponse, ReportAutofillApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["admin", "projects", projectId, "report-autofill", since],
    queryFn: () => {
      const qs = since ? `?since=${encodeURIComponent(since)}` : "";
      return requestJson<ReportAutofillResponse>(fetchWithAuth, `/api/admin/projects/${projectId}/report-autofill${qs}`);
    },
    enabled: !isLoading && !!accessToken && projectId != null,
    staleTime: 0,
  });
}
