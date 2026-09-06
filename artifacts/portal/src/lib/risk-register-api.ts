/**
 * React Query hooks for the customer-facing Risk Register (#2993).
 *
 * Wired to the real, live endpoints documented in
 * `docs/risk-register-contract-pack.md`:
 *   GET  /api/portal/risk-register
 *   GET  /api/portal/policy-decisions
 *   POST /api/portal/risk-register/:rbdId/accept
 *   GET  /api/portal/risk-register/rbd/:rbdId/versions
 *
 * No fixture module, no fallback data — every read either resolves to a real
 * server response or surfaces as a failed/loading state the page itself
 * renders honestly (contract pack §8, the honest-empty contract).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import type {
  AcceptRiskRequest,
  AcceptRiskResponse,
  ApiErrorBody,
  WirePolicyDecision,
  WireRbdVersionSummary,
  WireRisk,
} from "@/lib/risk-register-types";

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.clone().json()) as ApiErrorBody;
      if (body?.error?.message) message = body.error.message;
    } catch {
      // non-JSON error body — keep the generic message
    }
    const err = new Error(message) as Error & { status?: number; body?: unknown };
    err.status = res.status;
    try {
      err.body = await res.clone().json();
    } catch {
      // no JSON body to attach
    }
    throw err;
  }
  return (await res.json()) as T;
}

export function useRiskRegister() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: ["portal", "risk-register"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/risk-register", undefined, { silent: true });
      const data = await parseJsonOrThrow<{ risks: WireRisk[] }>(res);
      return data.risks;
    },
  });
}

export function usePolicyDecisionsFromRiskRegister() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: ["portal", "policy-decisions"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/policy-decisions", undefined, { silent: true });
      const data = await parseJsonOrThrow<{ decisions: WirePolicyDecision[] }>(res);
      return data.decisions;
    },
  });
}

export function useRbdVersions(rbdId: string, enabled: boolean) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: ["portal", "risk-register", "rbd-versions", rbdId],
    queryFn: async () => {
      const res = await fetchWithAuth(
        `/api/portal/risk-register/rbd/${encodeURIComponent(rbdId)}/versions`,
        undefined,
        { silent: true },
      );
      const data = await parseJsonOrThrow<{ rbdId: string; versions: WireRbdVersionSummary[] }>(res);
      return data.versions;
    },
    enabled,
  });
}

export function useAcceptRisk() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ rbdId, body }: { rbdId: string; body: AcceptRiskRequest }) => {
      const res = await fetchWithAuth(`/api/portal/risk-register/${encodeURIComponent(rbdId)}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return parseJsonOrThrow<AcceptRiskResponse>(res);
    },
    onSettled: () => {
      // Whatever happened — signed, already-accepted-by-another-tab, authority
      // changed underneath us — the register is the source of truth. Refetch
      // rather than optimistically patch, since a 409/403 means our local view
      // of isAccepted/authority was stale.
      void queryClient.invalidateQueries({ queryKey: ["portal", "risk-register"] });
    },
  });
}
