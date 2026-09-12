/**
 * Live data for the Executive View (Operations, MSP-wide — Git #2659). Built
 * against `Design/MSP_Console/design_handoff_msp_console/Executive View.dc.html`
 * (README screen 26, "25-33. MSP-wide pages") and the real routes in
 * `artifacts/api-server/src/routes/msp-executive.ts`:
 *
 *   GET  /api/msp/executive              — top-risk + top-opportunity tenants, book rollup
 *   GET  /api/msp/executive/qbr          — current quarter's cached Partner QBR (never generates)
 *   POST /api/msp/executive/qbr/generate — generate/regenerate the current quarter's QBR
 *
 * The opportunity list was the prototype's own documented "showing nothing,
 * wrongly" state (`opportunityData: "broken"` by default) — that was the
 * `sales_offers.customerId` FK bridging to `users.id` instead of `tenants.id`
 * (Git #2722, fixed in commit b1462a8ec / #2730). The route now filters
 * `sales_offers` directly against the book's own tenant ids, so this page reads
 * the fixed, non-empty path unconditionally — there is no "broken" toggle here.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

async function apiFetch<T>(
  fetchWithAuth: (i: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetchWithAuth(url, init);
  if (!res.ok) {
    let body: unknown;
    try { body = await res.json(); } catch { /* not json */ }
    const message = (body as { error?: string } | undefined)?.error ?? `Request failed: ${res.status}`;
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

// ── GET /api/msp/executive ───────────────────────────────────────────────────

export interface RiskTenant {
  customerId: number;
  name: string;
  healthScore: number;
  goodnessPercent: number;
  capturedAt: string | null;
}

export interface OpportunityTenant {
  customerId: number;
  name: string;
  openOfferCount: number;
  totalValueCents: number;
  topOfferTitle: string | null;
  topScore: number;
}

export interface ExecutiveBook {
  mspId: number;
  customerCount: number;
  topRisks: RiskTenant[];
  topOpportunities: OpportunityTenant[];
  rollup: {
    avgGoodnessPercent: number | null;
    atRiskCount: number;
    totalOpenOpportunityCents: number;
    openOfferCount: number;
  };
}

export function useExecutiveBook(): UseQueryResult<ExecutiveBook, Error> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["msp", "executive", "book"],
    queryFn: () => apiFetch<ExecutiveBook>(fetchWithAuth, "/api/msp/executive"),
    enabled: !isLoading && !!accessToken,
    staleTime: 30_000,
  });
}

// ── Partner QBR ───────────────────────────────────────────────────────────────

export interface PartnerQbr {
  status: "generating" | "ready" | "failed";
  quarterKey: string;
  title: string;
  htmlContent: string;
  model: string | null;
  generatedAt: string | null;
  errorMessage: string | null;
}

export interface QbrResponse {
  quarterKey: string;
  qbr: PartnerQbr | null;
}

export function useCurrentQbr(): UseQueryResult<QbrResponse, Error> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["msp", "executive", "qbr"],
    queryFn: () => apiFetch<QbrResponse>(fetchWithAuth, "/api/msp/executive/qbr"),
    enabled: !isLoading && !!accessToken,
    staleTime: 30_000,
  });
}

export function useGenerateQbr() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { force: boolean }) =>
      apiFetch<{ qbr: PartnerQbr }>(fetchWithAuth, "/api/msp/executive/qbr/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: input.force }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["msp", "executive", "qbr"] });
    },
  });
}
