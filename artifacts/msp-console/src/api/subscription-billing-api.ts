/**
 * subscription-billing-api.ts — the data seam for the MSP Console's
 * Subscription tab (Git #4110, wiring done by #2609), wiring the real route
 * surface in `artifacts/api-server/src/routes/msp-subscription-billing.ts`:
 *
 *   GET  /api/msp/:mspId/customers/:customerId/subscription          (added by #2609 — the UI needed a read)
 *   POST /api/msp/:mspId/customers/:customerId/subscription/cancel
 *   POST /api/msp/:mspId/customers/:customerId/subscription/discount
 *   POST /api/msp/:mspId/customers/:customerId/subscription/free-month
 *
 * This is the tenant-scoped `tenant_subscriptions` axis (Git #2847) — a
 * completely different axis from `invoices-api.ts`'s `usersTable`-keyed
 * client-portal invoices. See that file's own header for why they don't
 * share a picker.
 *
 * No fixture module, no fabricated row — every value here is a real server
 * response or an honest loading/empty/error state.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export interface TenantSubscriptionSummary {
  id: number;
  status: string;
  planName: string | null;
  billingParty: string;
  source: string;
  unitAmountCents: number | null;
  currency: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  endedAt: string | null;
}

export interface CustomerBillingCreditSummary {
  id: number;
  status: string;
  discountType: "fixed" | "percentage";
  discountValue: string;
  durationMonths: number | null;
  currency: string;
  failureReason: string | null;
  issuedAt: string | null;
  appliedAt: string | null;
  appliedAmountCents: number | null;
  source: string;
  createdAt: string;
}

export interface SubscriptionBillingSnapshot {
  customerId: number;
  customerName: string;
  subscription: TenantSubscriptionSummary | null;
  credits: CustomerBillingCreditSummary[];
}

export class SubscriptionBillingApiError extends Error {
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
    throw new SubscriptionBillingApiError(res.status, message);
  }
  return (await res.json()) as T;
}

const queryKey = (mspId: number, customerId: number) => ["msp", mspId, "subscription-billing", customerId];

export function useSubscriptionBilling(mspId: number, customerId: number): UseQueryResult<SubscriptionBillingSnapshot, Error> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: queryKey(mspId, customerId),
    queryFn: () =>
      requestJson<SubscriptionBillingSnapshot>(fetchWithAuth, `/api/msp/${mspId}/customers/${customerId}/subscription`),
    enabled: !isLoading && !!accessToken && Number.isFinite(mspId) && Number.isFinite(customerId),
    staleTime: 10_000,
  });
}

export function useCancelSubscription(mspId: number, customerId: number) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { atPeriodEnd: boolean; reason?: string }) =>
      requestJson<{ subscription: TenantSubscriptionSummary }>(
        fetchWithAuth,
        `/api/msp/${mspId}/customers/${customerId}/subscription/cancel`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) },
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKey(mspId, customerId) }),
  });
}

export function useApplyDiscount(mspId: number, customerId: number) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { discountType: "fixed" | "percentage"; discountValue: number; durationMonths?: number | null; reason?: string }) =>
      requestJson<{ credit: CustomerBillingCreditSummary }>(
        fetchWithAuth,
        `/api/msp/${mspId}/customers/${customerId}/subscription/discount`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) },
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKey(mspId, customerId) }),
  });
}

export function useApplyFreeMonth(mspId: number, customerId: number) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { months: number; reason?: string }) =>
      requestJson<{ credit: CustomerBillingCreditSummary }>(
        fetchWithAuth,
        `/api/msp/${mspId}/customers/${customerId}/subscription/free-month`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) },
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKey(mspId, customerId) }),
  });
}
