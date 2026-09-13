/**
 * msp-plan-api.ts — the data seam for the MSP Console's Plan Self-Service
 * module (#3796, wiring the four real routes in
 * `artifacts/api-server/src/routes/msp-plan-self-service.ts`).
 *
 *   GET  /api/msp/plan/current               — the MSP's own tier, interval, pending change
 *   GET  /api/msp/plan/available              — every public platform tier (Free/Growth/Pro)
 *   POST /api/msp/plan/change                 — schedule a tier/interval change
 *   POST /api/msp/plan/cancel-pending-change  — release the schedule, clear pending state
 *
 * See `docs/msp-console/msp-plan-self-service-contract-pack.md` for the full
 * wire contract this file copies field-for-field. Two things load-bearing to
 * this file's shape, both from that pack:
 *
 * - Every write here is a Stripe Subscription Schedule, never an immediate
 *   change — the live tier is only flipped later, by the billing webhook,
 *   once Stripe actually advances into the target phase (§3.1). This surface
 *   only ever proposes a change via `pendingChange` + a schedule.
 * - `GET /msp/plan/current` returns the JSON literal `null` (HTTP 200, not
 *   404) when the MSP has no subscription row at all (§5) — callers must
 *   check `data === null`, not falsiness of a field inside it.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export type MspSubscriptionStatus = "trialing" | "active" | "past_due" | "canceled" | "unpaid";
export type MspDunningState = "reminder_sent" | "suspended" | "access_revoked" | "archival_flagged";
export type MspBillingInterval = "month" | "year";

export interface PlanTier {
  readonly id: number;
  readonly name: string;
  readonly slug: string | null;
  readonly monthlyPriceCents: number | null;
  readonly annualPriceCents: number | null;
  readonly tenantAllowance: number | null;
}

export interface AvailableTier extends PlanTier {
  readonly description: string | null;
}

export interface PendingPlanChange {
  readonly serviceId: number;
  readonly serviceName: string;
  readonly billingInterval: MspBillingInterval;
  readonly effectiveAt: string | null;
}

export interface CurrentPlan {
  readonly tier: PlanTier;
  readonly billingInterval: MspBillingInterval;
  readonly status: MspSubscriptionStatus;
  readonly dunningState: MspDunningState | null;
  readonly currentPeriodEnd: string | null;
  readonly tenantCountSnapshot: number;
  readonly pendingChange: PendingPlanChange | null;
}

export interface ChangePlanResult {
  readonly ok: true;
  readonly effectiveAt: string;
  readonly pendingChange: PendingPlanChange;
}

/** A failed call reports its real HTTP status and the route's own `{ error }`
 * message text, so the UI can show the exact wire response rather than a
 * generic failure — the design's own "wire log" panel is built around this. */
export class MspPlanApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function requestJson<T>(
  fetchWithAuth: (i: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetchWithAuth(url, init);
  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body.error === "string" && body.error.length > 0) message = body.error;
    } catch { /* body wasn't JSON — keep the generic message */ }
    throw new MspPlanApiError(res.status, message);
  }
  return (await res.json()) as T;
}

/** `null` is the honest, real "no subscription row" response (§5) — not an
 * error, not an empty object. Consumers must branch on `data === null`. */
export function useMspCurrentPlan(): UseQueryResult<CurrentPlan | null, MspPlanApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["msp", "plan", "current"],
    queryFn: () => requestJson<CurrentPlan | null>(fetchWithAuth, "/api/msp/plan/current"),
    enabled: !isLoading && !!accessToken,
    staleTime: 15_000,
  });
}

export function useMspAvailableTiers(): UseQueryResult<readonly AvailableTier[], MspPlanApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["msp", "plan", "available"],
    queryFn: () => requestJson<AvailableTier[]>(fetchWithAuth, "/api/msp/plan/available"),
    enabled: !isLoading && !!accessToken,
    staleTime: 60_000,
  });
}

export function useChangeMspPlan() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation<ChangePlanResult, MspPlanApiError, { targetServiceId: number; targetInterval: MspBillingInterval }>({
    mutationFn: (body) =>
      requestJson<ChangePlanResult>(fetchWithAuth, "/api/msp/plan/change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["msp", "plan", "current"] });
    },
  });
}

export function useCancelPendingPlanChange() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation<{ ok: true }, MspPlanApiError, void>({
    mutationFn: () =>
      requestJson<{ ok: true }>(fetchWithAuth, "/api/msp/plan/cancel-pending-change", { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["msp", "plan", "current"] });
    },
  });
}
