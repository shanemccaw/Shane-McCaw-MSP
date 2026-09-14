/**
 * seat-pricing-api.ts — the data seam for the MSP Console's Seat Pricing
 * module (Git #4111), wiring the real route surface in
 * `artifacts/api-server/src/routes/msp-seat-pricing.ts`:
 *
 *   GET  /api/msp/customers/:customerId/seat-pricing
 *   PUT  /api/msp/customers/:customerId/seat-pricing/override
 *   POST /api/msp/customers/:customerId/seat-pricing/apply
 *
 * Seat-based pricing is automatic: the customer's price is the real, live
 * count of active licensed M365 users, not an operator-picked number. The
 * only manual input is the "service account" seat exclusion below, with a
 * reason.
 *
 * No fixture module, no fabricated row — every value here is a real server
 * response or an honest loading/empty/error state.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export interface LicenseSource {
  checkKey: string;
  collectedAt: string | null;
  paidSkuPartNumbers: string[];
}

export interface ActiveSubscriptionSummary {
  id: number;
  serviceId: number | null;
  planName: string | null;
  unitAmountCents: number | null;
  billingParty: string;
}

export interface PerSeatRate {
  serviceId: number;
  serviceName: string;
  monthlyRateCents: number;
}

export interface SeatPricingSnapshot {
  customerId: number;
  tenantGuid: string | null;
  rawActiveLicensedUserCount: number | null;
  licenseSource: LicenseSource | null;
  excludedServiceAccountSeats: number;
  overrideReason: string | null;
  billableSeatCount: number | null;
  activeSubscription: ActiveSubscriptionSummary | null;
  perSeatRate: PerSeatRate | null;
  computedMonthlyPriceCents: number | null;
}

export interface ApplyResult extends SeatPricingSnapshot {
  subscriptionId: number;
}

export class SeatPricingApiError extends Error {
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
    throw new SeatPricingApiError(res.status, message);
  }
  return (await res.json()) as T;
}

const queryKey = (customerId: number) => ["msp", "seat-pricing", customerId];

export function useSeatPricing(customerId: number): UseQueryResult<SeatPricingSnapshot, Error> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: queryKey(customerId),
    queryFn: () => requestJson<SeatPricingSnapshot>(fetchWithAuth, `/api/msp/customers/${customerId}/seat-pricing`),
    enabled: !isLoading && !!accessToken && Number.isFinite(customerId),
    staleTime: 15_000,
  });
}

export function useSetServiceAccountOverride(customerId: number) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { excludedServiceAccountSeats: number; reason?: string }) =>
      requestJson<SeatPricingSnapshot>(fetchWithAuth, `/api/msp/customers/${customerId}/seat-pricing/override`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: (data) => queryClient.setQueryData(queryKey(customerId), data),
  });
}

export function useApplySeatPricing(customerId: number) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { serviceId?: number }) =>
      requestJson<ApplyResult>(fetchWithAuth, `/api/msp/customers/${customerId}/seat-pricing/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: (data) => queryClient.setQueryData(queryKey(customerId), data),
  });
}
