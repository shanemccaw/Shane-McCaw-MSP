/**
 * Retainer interval-switch PROPOSAL module's own data (#4112, part of Feature
 * #1692). Backed by `artifacts/api-server/src/routes/msp-retainer-billing.ts`
 * — a small, deliberately narrow slice of the Commercial "Billing" nav slot,
 * NOT the full invoicing/plan-management screen (Design screen 23, still
 * blocked on #2608). This surface only ever proposes a month<->year switch;
 * it never touches Stripe itself — the customer's own approve/reject route in
 * `portal-retainer-billing.ts` is what actually schedules anything.
 *
 * Distinct from `retainer-api.ts` (Retainer HOURS — a completely unrelated
 * `retainer_work_log` concept sharing only the English word "retainer").
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

async function getJson<T>(
  fetchWithAuth: (i: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  url: string,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetchWithAuth(url, { method: "GET", signal });
  if (!res.ok) {
    const err = new Error(`Request failed: ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

async function sendJson<T>(
  fetchWithAuth: (i: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  method: "POST",
  url: string,
  body?: unknown,
): Promise<T> {
  const res = await fetchWithAuth(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string; message?: string };
      message = data.error || data.message || message;
    } catch { /* body wasn't JSON — keep the status-based message */ }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

export type RetainerBillingInterval = "month" | "year";

export interface RetainerBillingRow {
  clientServiceId: number;
  serviceName: string;
  billingInterval: RetainerBillingInterval;
  hasPendingSwitch: boolean;
  pendingBillingInterval: RetainerBillingInterval | null;
  hasPendingProposal: boolean;
  proposedBillingInterval: RetainerBillingInterval | null;
  proposedAt: string | null;
}

export interface RetainerBillingListResponse {
  customerId: number;
  customerName: string;
  retainers: RetainerBillingRow[];
}

const listKey = (mspId: number, customerId: number) =>
  ["msp", mspId, "retainer-billing", "customer", customerId] as const;

export function useRetainerBillingList(
  mspId: number | null,
  customerId: number | null,
): UseQueryResult<RetainerBillingListResponse, Error> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: mspId != null && customerId != null ? listKey(mspId, customerId) : ["msp", "retainer-billing", "unscoped"],
    queryFn: ({ signal }) =>
      getJson<RetainerBillingListResponse>(fetchWithAuth, `/api/msp/${mspId}/customers/${customerId}/retainer-billing`, signal),
    enabled: !isLoading && !!accessToken && mspId != null && customerId != null,
  });
}

export function useProposeIntervalSwitch(mspId: number | null, customerId: number | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation<
    { ok: true; proposedBillingInterval: RetainerBillingInterval; proposedAt: string },
    Error,
    { clientServiceId: number; targetInterval: RetainerBillingInterval }
  >({
    mutationFn: ({ clientServiceId, targetInterval }) =>
      sendJson(
        fetchWithAuth, "POST",
        `/api/msp/${mspId}/customers/${customerId}/retainer-billing/${clientServiceId}/propose-interval-switch`,
        { targetInterval },
      ),
    onSuccess: () => {
      if (mspId != null && customerId != null) void queryClient.invalidateQueries({ queryKey: listKey(mspId, customerId) });
    },
  });
}

export function useCancelIntervalProposal(mspId: number | null, customerId: number | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation<{ ok: true }, Error, { clientServiceId: number }>({
    mutationFn: ({ clientServiceId }) =>
      sendJson(fetchWithAuth, "POST", `/api/msp/${mspId}/customers/${customerId}/retainer-billing/${clientServiceId}/cancel-proposal`),
    onSuccess: () => {
      if (mspId != null && customerId != null) void queryClient.invalidateQueries({ queryKey: listKey(mspId, customerId) });
    },
  });
}
