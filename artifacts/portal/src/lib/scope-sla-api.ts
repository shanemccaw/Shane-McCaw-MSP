/**
 * React Query hooks for the customer-facing Scope and SLA page (#4000).
 *
 * Wired to the real, live endpoints documented in
 * `Design/portal/design_handoff_full_site/docs/scope-and-sla-contract-pack.md`:
 *   GET /api/portal/customer/sla-status
 *   GET /api/portal/customer/scope-status
 *
 * Both engines compute live on every call (contract pack §3) — carried
 * forward from the archived pages, both queries poll every 30s so the page
 * reflects a fresh evaluation without a manual refresh. No fixture module,
 * no fallback data — every read either resolves to a real server response or
 * surfaces as a failed/loading state the page itself renders honestly.
 */
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import type { ScopeSlaApiErrorBody, ScopeStatus, SlaStatus } from "@/lib/scope-sla-types";

const POLL_INTERVAL_MS = 30_000;

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.clone().json()) as ScopeSlaApiErrorBody;
      if (body?.error) message = body.error;
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export function useSlaStatus() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: ["portal", "sla-status"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/customer/sla-status", undefined, { silent: true });
      return parseJsonOrThrow<SlaStatus>(res);
    },
    refetchInterval: POLL_INTERVAL_MS,
  });
}

export function useScopeStatus() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: ["portal", "scope-status"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/customer/scope-status", undefined, { silent: true });
      return parseJsonOrThrow<ScopeStatus>(res);
    },
    refetchInterval: POLL_INTERVAL_MS,
  });
}
