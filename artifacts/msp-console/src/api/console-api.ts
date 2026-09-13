/**
 * Live data the shell itself needs. The shell holds no module data (README:
 * "The shell's only state is the selection plus which nodes are expanded"), but
 * three things are genuinely part of the chrome and each reads a real endpoint:
 *
 *   - the tenant tree            → GET /api/msp/customers   (#3666)
 *   - the header break-glass pill → GET /api/msp/break-glass
 *   - the header signal feed      → GET /api/msp/alerts
 *
 * All three are gated `requireCapability("ladder.msp-operator")` server-side and
 * scoped to the caller's own MSP. Every field rendered comes from these
 * responses — no fixtures.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useListMspCustomers } from "@workspace/api-client-react";

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

// ── Directory (#3666) ────────────────────────────────────────────────────────

export interface DirectoryCustomer {
  id: number;
  name: string;
  domain: string | null;
  status: string;
  tenantId: string | null;
  mspId: number;
  createdAt: string;
  /** Additive directory metrics (Git #3666); null when never collected. */
  seats: number | null;
  people: number | null;
  lastScanAt: string | null;
  openSignals: number;
  /** The subset of `openSignals` whose signal definition is severity "critical" (Git #3746). */
  criticalSignals: number;
}

export interface DirectoryResponse {
  customers: DirectoryCustomer[];
  total: number;
  page: number;
  pageSize: number;
}

// Git #3745 — this used to hand-roll its own fetch against `/api/msp/customers`
// with a locally-declared response type, bypassing the generated MSP api-client
// entirely (the generated `MspCustomer`/`MspCustomerList` types were stale —
// `companyName`/`limit` vs. the route's real `name`/`pageSize`, and missing the
// #3666/#3746 directory metrics fields outright — so there was nothing usable to
// bypass around). Now that the openapi spec and generated types are regenerated
// to match the real route response, this reads through `useListMspCustomers`
// like any other MSP-scoped query. `DirectoryCustomer`/`DirectoryResponse` stay
// as the console's own type aliases (structurally identical to the generated
// `MspCustomerListItem`/`MspCustomerList`) since they're threaded through most
// of the console's modules by name.
export function useDirectory(): UseQueryResult<DirectoryResponse, Error> {
  const { isLoading, accessToken } = useAuth();
  // A high limit so the whole book renders in the tree (the console is a
  // desktop operator tool; the endpoint caps at 100 per page).
  return useListMspCustomers(
    { limit: 100 },
    {
      query: {
        queryKey: ["msp", "customers", "directory"],
        enabled: !isLoading && !!accessToken,
        staleTime: 30_000,
      },
    },
  ) as UseQueryResult<DirectoryResponse, Error>;
}

// ── Break-glass pending (header pill) ────────────────────────────────────────

export interface BreakGlassPending {
  pendingSecretId: number;
  runId: number | null;
  customerId: number;
  customerName: string | null;
  status: string;
  createdAt: string;
  liveInviteCount: number;
  totalInviteCount: number;
}

export interface BreakGlassResponse {
  pending: BreakGlassPending[];
}

export function useBreakGlass(): UseQueryResult<BreakGlassResponse, Error> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["msp", "break-glass"],
    queryFn: ({ signal }) =>
      getJson<BreakGlassResponse>(fetchWithAuth, "/api/msp/break-glass", signal),
    enabled: !isLoading && !!accessToken,
    staleTime: 30_000,
  });
}

// ── Signal feed (header notifications) ───────────────────────────────────────

export type AlertSeverity = "info" | "warning" | "critical";

export interface MspAlert {
  id: string;
  severity: AlertSeverity;
  category: string;
  title: string;
  customerName: string | null;
  occurredAt: string;
}

export interface AlertsResponse {
  alerts: MspAlert[];
  total: number;
  limit: number;
  offset: number;
}

export function useAlerts(): UseQueryResult<AlertsResponse, Error> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["msp", "alerts", "feed"],
    queryFn: ({ signal }) =>
      getJson<AlertsResponse>(fetchWithAuth, "/api/msp/alerts?limit=8", signal),
    enabled: !isLoading && !!accessToken,
    staleTime: 30_000,
  });
}
