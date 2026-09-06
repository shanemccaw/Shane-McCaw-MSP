/**
 * React Query hook for the customer-facing Remediation Tracker's pillar
 * scores (§1f, `docs/remediation-tracking-contract-pack.md`):
 *
 *   GET /api/portal/remediation-tracker/pillar-scores
 *
 * Real numbers only — a pillar with no snapshot arrives with all-null fields
 * (`status: "insufficient_data"`), never a fabricated zero. No fixture, no
 * fallback data on an empty/failed read; the page renders the honest state.
 */
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import type { ApiErrorBody } from "@/lib/risk-register-types";
import type { PillarScoresResponse } from "@/lib/remediation-tracker-scores-types";

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.clone().json()) as ApiErrorBody;
      if (body?.error?.message) message = body.error.message;
    } catch {
      // non-JSON error body — keep the generic message
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

export function useRemediationPillarScores() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: ["portal", "remediation-tracker", "pillar-scores"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/remediation-tracker/pillar-scores", undefined, {
        silent: true,
      });
      return parseJsonOrThrow<PillarScoresResponse>(res);
    },
  });
}
