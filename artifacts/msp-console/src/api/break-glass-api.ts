/**
 * break-glass-api.ts — the data seam for the MSP Console's Break-glass module
 * page (#2630, wiring #2675's real operator routes).
 *
 * Wraps the routes in `artifacts/api-server/src/routes/msp-break-glass.ts`:
 *
 *   GET  /api/msp/customers/:customerId/break-glass                         — this
 *        customer's pending-secret history, any status
 *   GET  /api/msp/customers/:customerId/break-glass/:pendingSecretId        — one
 *        secret's detail + its verification attempts
 *   POST /api/msp/customers/:customerId/break-glass/:pendingSecretId/admin-override
 *        — force a reset + reissue (delegates to the same
 *        `performBreakGlassAdminOverride` the customer portal route calls)
 *   GET  /api/msp/customers/:customerId/break-glass/audit                   — the
 *        forced-reset audit trail
 *
 * The cross-tenant pending watchlist (`GET /api/msp/break-glass`) already has a
 * hook in `console-api.ts` (`useBreakGlass`) — it feeds both the header pill and
 * the root directory's watchlist tile, so it is not duplicated here.
 *
 * Statuses and outcomes below are the schema's real enums
 * (`lib/db/src/schema/msp.ts` — `breakGlassPendingSecretsTable.status`,
 * `breakGlassVerificationAttemptsTable.linkStatus`/`verificationOutcome`), not an
 * invented vocabulary. The credential value itself is never returned by any of
 * these routes — the design's own honest note applies: "the credential itself
 * never reaches this console."
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export type BreakGlassStatus = "pending_delivery" | "delivered_purged" | "superseded_by_reset";
export type LinkStatus = "pending" | "consumed" | "expired" | "superseded";
export type VerificationOutcome = "success" | "role_not_active_pim_eligible" | "role_absent" | "expired" | "superseded" | null;

export interface BreakGlassSecretSummary {
  readonly pendingSecretId: number;
  readonly runId: number | null;
  readonly status: BreakGlassStatus;
  readonly createdAt: string;
  readonly deliveredAt: string | null;
  readonly deliveredToEmail: string | null;
}

export interface BreakGlassHistoryResponse {
  readonly secrets: readonly BreakGlassSecretSummary[];
}

export interface BreakGlassAttempt {
  readonly id: number;
  readonly invitedEmail: string;
  readonly linkStatus: LinkStatus;
  readonly verificationOutcome: VerificationOutcome;
  readonly entraUserPrincipalName: string | null;
  readonly failedAttemptCount: number | null;
  readonly attemptedAt: string | null;
  readonly createdAt: string;
}

export interface BreakGlassDetail {
  readonly pendingSecretId: number;
  readonly runId: number | null;
  readonly customerId: number;
  readonly status: BreakGlassStatus;
  readonly createdAt: string;
  readonly deliveredAt: string | null;
  readonly deliveredToEmail: string | null;
  readonly attempts: readonly BreakGlassAttempt[];
}

export interface BreakGlassAuditRow {
  readonly id: number;
  readonly adminUserId: number;
  readonly adminName: string;
  readonly reason: string;
  readonly oldPendingSecretId: number | null;
  readonly newPendingSecretId: number;
  readonly createdAt: string;
}

export interface BreakGlassAuditResponse {
  readonly audit: readonly BreakGlassAuditRow[];
}

export interface AdminOverrideResult {
  readonly ok: true;
  readonly newPendingSecretId: number;
  readonly reissued: number;
  readonly sent: number;
}

/** A fetch that failed reports its real HTTP status so the page can tell
 * "not in this MSP's book" (403) apart from a generic failure. */
export class BreakGlassApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly detail?: string) {
    super(message);
  }
}

async function getJson<T>(
  fetchWithAuth: (i: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  url: string,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetchWithAuth(url, { method: "GET", signal });
  if (!res.ok) throw new BreakGlassApiError(res.status, `Request failed: ${res.status}`);
  return (await res.json()) as T;
}

export function useMspCustomerBreakGlass(customerId: number | null): UseQueryResult<BreakGlassHistoryResponse, BreakGlassApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["msp", "break-glass", "customer", customerId],
    queryFn: ({ signal }) =>
      getJson<BreakGlassHistoryResponse>(fetchWithAuth, `/api/msp/customers/${customerId}/break-glass`, signal),
    enabled: !isLoading && !!accessToken && customerId !== null,
    staleTime: 20_000,
  });
}

export function useBreakGlassDetail(customerId: number | null, pendingSecretId: number | null): UseQueryResult<BreakGlassDetail, BreakGlassApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["msp", "break-glass", "detail", customerId, pendingSecretId],
    queryFn: ({ signal }) =>
      getJson<BreakGlassDetail>(fetchWithAuth, `/api/msp/customers/${customerId}/break-glass/${pendingSecretId}`, signal),
    enabled: !isLoading && !!accessToken && customerId !== null && pendingSecretId !== null,
    staleTime: 10_000,
  });
}

export function useBreakGlassAudit(customerId: number | null): UseQueryResult<BreakGlassAuditResponse, BreakGlassApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["msp", "break-glass", "audit", customerId],
    queryFn: ({ signal }) =>
      getJson<BreakGlassAuditResponse>(fetchWithAuth, `/api/msp/customers/${customerId}/break-glass/audit`, signal),
    enabled: !isLoading && !!accessToken && customerId !== null,
    staleTime: 20_000,
  });
}

/**
 * Force a reset + reissue. `emails`, when given, replaces the original invite
 * list (1–5 addresses) for the new credential; omitted re-invites the same
 * people the old one was sent to (msp-break-glass.ts's own contract).
 */
export function useAdminOverride(customerId: number | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ pendingSecretId, reason, emails }: { pendingSecretId: number; reason: string; emails?: string[] }) => {
      if (customerId === null) throw new BreakGlassApiError(400, "No customer selected");
      const res = await fetchWithAuth(`/api/msp/customers/${customerId}/break-glass/${pendingSecretId}/admin-override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, ...(emails && emails.length > 0 ? { emails } : {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new BreakGlassApiError(res.status, (body as { error?: string }).error ?? `Request failed: ${res.status}`, (body as { detail?: string }).detail);
      }
      return body as AdminOverrideResult;
    },
    onSuccess: () => {
      // Invalidates this customer's history, its audit trail, its detail
      // queries AND the cross-tenant watchlist (console-api.ts's useBreakGlass,
      // queryKey ["msp","break-glass"]) in one shot — all share this prefix.
      void queryClient.invalidateQueries({ queryKey: ["msp", "break-glass"] });
    },
  });
}
