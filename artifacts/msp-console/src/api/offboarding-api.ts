/**
 * Live data for the Offboarding Operations page (#2636), per
 * `docs/msp-console/offboarding-msp-console-contract-pack.md`. One MSP-scoped
 * state machine, forward-only: `null → cancellation_requested → export_ready →
 * archival_flagged`. No route resets it.
 *
 * The current-state read (`offboardingState` / `offboardingRequestedAt` /
 * `exportReadyAt` / `status`) is a small slice of `GET /api/msp/dashboard`
 * (pack §1) — there is no dedicated read endpoint for this Feature, so this
 * hook selects only the fields in scope rather than exposing the whole
 * dashboard payload. The 3 write routes are `msp-portal.ts:378-681` — every
 * value rendered on the page comes from one of these responses; no fixtures.
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
    const err = new Error(message) as Error & { status?: number; offboardingState?: string | null };
    err.status = res.status;
    err.offboardingState = (body as { offboardingState?: string | null } | undefined)?.offboardingState;
    throw err;
  }
  return (await res.json()) as T;
}

export type OffboardingState = "cancellation_requested" | "export_ready" | "archival_flagged" | null;
export type MspStatus = "active" | "suspended" | "trial";

export interface OffboardingStatus {
  mspId: number | null;
  offboardingState: OffboardingState;
  offboardingRequestedAt: string | null;
  exportReadyAt: string | null;
  status: MspStatus;
}

interface DashboardResponse {
  msp: {
    id: number;
    name: string;
    status: MspStatus;
    offboardingState: OffboardingState;
    offboardingRequestedAt: string | null;
    exportReadyAt: string | null;
  } | null;
}

export const DASHBOARD_QUERY_KEY = ["msp", "dashboard"] as const;

/** Pack §1 — one field set out of a much larger dashboard response. */
export function useOffboardingStatus(): UseQueryResult<OffboardingStatus, Error> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: DASHBOARD_QUERY_KEY,
    queryFn: async () => {
      const data = await apiFetch<DashboardResponse>(fetchWithAuth, "/api/msp/dashboard");
      return {
        mspId: data.msp?.id ?? null,
        offboardingState: data.msp?.offboardingState ?? null,
        offboardingRequestedAt: data.msp?.offboardingRequestedAt ?? null,
        exportReadyAt: data.msp?.exportReadyAt ?? null,
        status: data.msp?.status ?? "active",
      };
    },
    enabled: !isLoading && !!accessToken,
    staleTime: 5_000,
  });
}

// ── §2 POST /api/msp/offboarding/request — null → cancellation_requested ───────

export interface RequestOffboardingResult {
  ok: true;
  offboardingState: "cancellation_requested";
  requestedAt: string;
}

export function useRequestOffboarding() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<RequestOffboardingResult>(fetchWithAuth, "/api/msp/offboarding/request", { method: "POST" }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY }); },
  });
}

// ── §3 POST /api/msp/offboarding/export — cancellation_requested → export_ready ─
// Idempotent by design: re-calling while already export_ready regenerates a
// real, current-data package but writes no second event/audit row.

export interface OffboardingExportCustomer {
  id: number;
  name: string;
  domain: string | null;
  industry: string | null;
  tenantId: string | null;
  status: string;
  tenantUrl: string | null;
  createdAt: string;
  eventCount: number;
}

export interface OffboardingExportPackage {
  exportedAt: string;
  exportVersion: string;
  msp: { id: number; name: string; slug: string; domain: string | null; status: string; createdAt: string };
  customers: OffboardingExportCustomer[];
  summary: { totalCustomers: number; activeCustomers: number; totalEvents: number };
  notice: string;
}

export interface GenerateExportResult {
  ok: true;
  offboardingState: "export_ready";
  export: OffboardingExportPackage;
}

export function useGenerateExport() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<GenerateExportResult>(fetchWithAuth, "/api/msp/offboarding/export", { method: "POST" }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY }); },
  });
}

// ── §4 POST /api/msp/offboarding/archive — export_ready → archival_flagged ─────
// PlatformAdmin only. Not mspId-scoped from session — the target MSP is named
// explicitly in the body (pack §4/§8.4). Genuinely idempotent: replaying against
// an already-archived MSP returns 200 { alreadyArchived: true }, not an error.

export interface ArchiveMspInput {
  mspId: number;
}

export type ArchiveMspResult =
  | { ok: true; offboardingState: "archival_flagged"; archivedAt: string; alreadyArchived?: false }
  | { ok: true; offboardingState: "archival_flagged"; alreadyArchived: true };

export function useArchiveMsp() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ArchiveMspInput) =>
      apiFetch<ArchiveMspResult>(fetchWithAuth, "/api/msp/offboarding/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY }); },
  });
}
