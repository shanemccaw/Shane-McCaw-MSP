/**
 * Partner Revenue module's own data (Git #3820, screen 48). Backed by the one
 * real route in `artifacts/api-server/src/routes/msp-partner-revenue.ts`
 * (`requireCapability("ladder.msp-admin")`, scoped to the caller's own MSP) —
 * see `docs/msp-console/partner-revenue-msp-console-contract-pack.md` for the
 * full wire contract this file is built against.
 *
 * `GET /api/msp/billing/revenue` returns two halves that must never be
 * conflated or summed (the route's own header, and the pack's §0):
 *
 *   - `wholesaleSpend` — real, Stripe-verified: what THIS MSP pays the
 *     platform. `null` (not a zeroed object) when the caller's MSP has no
 *     `msp_subscriptions` row at all.
 *   - `pricingWorksheet` — the MSP's own self-declared resale prices on their
 *     Sales Bundles. NEVER charged via this platform, NEVER reconciled
 *     against a real invoice — always carries `disclaimer` text, even when
 *     `bundles` is empty.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
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

// ── GET /api/msp/billing/revenue ─────────────────────────────────────────────

export type MspSubscriptionStatus = "trialing" | "active" | "past_due" | "canceled" | "unpaid";
export type MspBillingInterval = "month" | "year";
export type MspDunningState = "reminder_sent" | "suspended" | "access_revoked" | "archival_flagged";
export type MspSalesBundleStatus = "active";

export interface WholesaleSpend {
  tierName: string;
  status: MspSubscriptionStatus;
  dunningState: MspDunningState | null;
  billingInterval: MspBillingInterval;
  monthlyCostCents: number | null;
  annualPriceCents: number | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  activeTenantCount: number;
}

export interface WorksheetBundle {
  bundleId: string;
  name: string;
  status: MspSalesBundleStatus;
  activeAssignmentCount: number;
  resalePriceCentsPerUnit: number;
  internalCostCentsPerUnit: number;
  worksheetMonthlyResaleCents: number;
  worksheetMonthlyCostCents: number;
  worksheetMonthlyMarginCents: number;
}

export interface PricingWorksheet {
  disclaimer: string;
  bundles: WorksheetBundle[];
}

export interface PartnerRevenueResponse {
  wholesaleSpend: WholesaleSpend | null;
  pricingWorksheet: PricingWorksheet;
}

export function usePartnerRevenue(): UseQueryResult<PartnerRevenueResponse, Error> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["msp", "billing", "revenue"],
    queryFn: ({ signal }) =>
      getJson<PartnerRevenueResponse>(fetchWithAuth, "/api/msp/billing/revenue", signal),
    enabled: !isLoading && !!accessToken,
    staleTime: 15_000,
  });
}
