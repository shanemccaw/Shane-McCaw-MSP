/**
 * contracts-api.ts — the data seam for the MSP Console's Tenant Contracts
 * screen (Git #3775, Feature #2568), README screen 21
 * (`Design/MSP_Console/design_handoff_msp_console/MSP Console.dc.html`,
 * tenant screen 21 "Contracts" — a placeholder skeleton with no real render
 * block; Shane authorized building this screen directly, 2026-09-15).
 * Mounts at `/tenants/:id/contracts`.
 *
 * Real v1 scope (no new unified backend, no new SLA-terms table) — a real
 * aggregation read view composed from three already-real sources:
 *   - SOW documents for this customer     — `GET /api/msp/sows?customerId=`
 *     (already wired for the MSP Console via `offers-and-sows-api.ts`'s
 *     `useSowsForCustomer`, reused here rather than duplicated).
 *   - Active subscription/tier services   — `GET /api/msp/:mspId/customers/:customerId/services`,
 *     a new read this build adds (`msp-customer-services.ts`) over the real,
 *     already-live `client_services` join table — the general, unfiltered
 *     read `msp-retainer-billing.ts` narrows to recurring-monthly retainers
 *     only for its own screen.
 *   - Scope-creep ledger for this customer — `GET /api/msp/scope-creep/violations?customerId=`
 *     and `GET /api/msp/scope-creep/detections?customerId=&status=open` (both
 *     already real, customer-scoped reads — the detections hook is reused
 *     from `scope-sla-api.ts`; the violations-for-customer hook is added here
 *     since that file only exposed the whole-book variant).
 *
 * No fixture module — every row is a real server response or an honest
 * loading/empty/error state.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import type { ScopeCreepViolation } from "./scope-sla-api";

export class ContractsApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.clone().json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new ContractsApiError(res.status, message);
  }
  return (await res.json()) as T;
}

// ── Real wire shape — column-for-column from client_services / services ───────

export type ClientServiceStatus = "active" | "completed" | "paused";

export interface CustomerService {
  readonly clientServiceId: number;
  readonly status: ClientServiceStatus;
  readonly billingInterval: string;
  readonly purchasedAt: string | null;
  readonly serviceId: number;
  readonly serviceName: string;
  readonly serviceClass: "project" | "add_on" | "subscription" | null;
  readonly deliveryType: "assessment" | "bundle_subscription" | "retainer" | "document_generation" | "none" | null;
  readonly billingType: "one_time" | "recurring_monthly";
  readonly tier: string | null;
}

function useAuthedFetch() {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return { fetchWithAuth, ready: !isLoading && !!accessToken };
}

// ── GET /msp/:mspId/customers/:customerId/services ────────────────────────────

export function useServicesForCustomer(mspId: number | null, customerId: number): UseQueryResult<{ services: CustomerService[] }, ContractsApiError> {
  const { fetchWithAuth, ready } = useAuthedFetch();
  return useQuery({
    queryKey: ["msp", "customer-services", mspId, customerId],
    queryFn: async () => parseJsonOrThrow<{ services: CustomerService[] }>(
      await fetchWithAuth(`/api/msp/${mspId}/customers/${customerId}/services`),
    ),
    enabled: ready && mspId != null,
    staleTime: 15_000,
  });
}

// ── GET /msp/scope-creep/violations?customerId= ────────────────────────────────
// The whole-book variant lives in scope-sla-api.ts (`useScopeCreepViolations`);
// the route itself already accepts a real `customerId` filter server-side
// (`msp-scope-creep.ts`) — this is that same real filter, just not previously
// exposed as its own hook.

export function useScopeCreepViolationsForCustomer(customerId: number | null): UseQueryResult<{ violations: ScopeCreepViolation[] }, ContractsApiError> {
  const { fetchWithAuth, ready } = useAuthedFetch();
  return useQuery({
    queryKey: ["msp", "scope-creep", "violations", "customer", customerId],
    queryFn: async () => parseJsonOrThrow<{ violations: ScopeCreepViolation[] }>(
      await fetchWithAuth(`/api/msp/scope-creep/violations?customerId=${customerId}`),
    ),
    enabled: ready && customerId != null,
    staleTime: 15_000,
  });
}
