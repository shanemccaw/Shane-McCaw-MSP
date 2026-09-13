/**
 * status-reports-api.ts — the data seam for the MSP Console's Status Reports
 * module page (Git #3765, Feature #3434 phase 4 of 4). Mounts at
 * `/tenants/:id/status-reports`
 * (`Design/MSP_Console/design_handoff_msp_console/Status Reports.dc.html`,
 * README screen 40), wiring the real, just-shipped operator backend
 * (`artifacts/api-server/src/routes/msp-status-reports.ts`, Git #3762,
 * `msp_status_reports` table — no fixture data):
 *
 *   POST   /api/msp/customers/:customerId/status-reports        — create a draft
 *   GET    /api/msp/customers/:customerId/status-reports        — list, paginated
 *   PATCH  /api/msp/status-reports/:id                          — edit while draft
 *   POST   /api/msp/status-reports/:id/publish                  — draft -> published,
 *          irreversible in v1, no unpublish
 *
 * The list route already returns each row's full content (see
 * `reportToWire` server-side), so the "open a report to read it" flow reads
 * straight out of the already-fetched list — there is no separate
 * `GET /api/msp/status-reports/:id` call in this module, matching the design's
 * own logic class, which also derives `open` from the already-loaded `reports`
 * array rather than issuing a second fetch.
 *
 * `authoredByName` is genuinely nullable on the wire with no fallback
 * (server-side comment, `msp-status-reports.ts` `reportToWire`) — this seam
 * does not invent one; the module renders "Unknown operator" itself.
 *
 * No fixture module, no fabricated row — every value here comes from a real
 * server response.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export type StatusReportState = "draft" | "published";

/** Real shape of `reportToWire` in `msp-status-reports.ts`. */
export interface StatusReport {
  readonly id: number;
  readonly customerId: number;
  readonly periodLabel: string;
  readonly asOfDate: string;
  readonly content: string;
  readonly state: StatusReportState;
  readonly authoredByUserId: number;
  readonly authoredByName: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
}

export interface StatusReportsListResponse {
  readonly reports: StatusReport[];
  readonly limit: number;
  readonly offset: number;
}

export interface CreateStatusReportInput {
  readonly periodLabel: string;
  readonly asOfDate: string;
  readonly content: string;
}

export type PatchStatusReportInput = Partial<CreateStatusReportInput>;

/** A fetch that failed reports its real HTTP status so the module can tell a
 * 409 (published, can't edit / already published) apart from a 400 (bad
 * body) apart from a generic failure — same pattern as `data-rights-api.ts`'s
 * `DataRightsApiError`. */
export class StatusReportsApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let details: unknown;
    try {
      const body = (await res.clone().json()) as { error?: string; details?: unknown };
      if (body?.error) message = body.error;
      details = body?.details;
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new StatusReportsApiError(res.status, message, details);
  }
  return (await res.json()) as T;
}

const LIST_LIMIT_DEFAULT = 50; // matches the route's own default (msp-status-reports.ts)

const listKey = (customerId: number, limit: number, offset: number) =>
  ["msp", "status-reports", "customers", customerId, { limit, offset }] as const;

function invalidateList(queryClient: ReturnType<typeof useQueryClient>, customerId: number) {
  void queryClient.invalidateQueries({ queryKey: ["msp", "status-reports", "customers", customerId] });
}

export function useStatusReportsList(
  customerId: number,
  limit: number = LIST_LIMIT_DEFAULT,
  offset: number = 0,
): UseQueryResult<StatusReportsListResponse, StatusReportsApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: listKey(customerId, limit, offset),
    queryFn: async () => {
      const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      const res = await fetchWithAuth(`/api/msp/customers/${customerId}/status-reports?${qs.toString()}`);
      return parseJsonOrThrow<StatusReportsListResponse>(res);
    },
    enabled: !isLoading && !!accessToken && Number.isInteger(customerId),
    staleTime: 15_000,
  });
}

export function useCreateStatusReport(customerId: number) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateStatusReportInput) => {
      const res = await fetchWithAuth(`/api/msp/customers/${customerId}/status-reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      return parseJsonOrThrow<{ report: StatusReport }>(res);
    },
    onSuccess: () => invalidateList(queryClient, customerId),
  });
}

export function useUpdateStatusReport(customerId: number) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: number; input: PatchStatusReportInput }) => {
      const res = await fetchWithAuth(`/api/msp/status-reports/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      return parseJsonOrThrow<{ report: StatusReport }>(res);
    },
    onSuccess: () => invalidateList(queryClient, customerId),
  });
}

export function usePublishStatusReport(customerId: number) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetchWithAuth(`/api/msp/status-reports/${id}/publish`, { method: "POST" });
      return parseJsonOrThrow<{ report: StatusReport }>(res);
    },
    onSuccess: () => invalidateList(queryClient, customerId),
  });
}
