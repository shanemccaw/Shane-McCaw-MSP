/**
 * React Query hooks for the customer-facing Remediation Tracker's s1-s30 core
 * surface (#3037, Feature #1489). Wired to the real, live endpoints documented
 * in `docs/remediation-tracking-contract-pack.md` §1a:
 *
 *   GET  /api/portal/remediation-tracker
 *   PUT  /api/portal/remediation-tracker/steps/:stepId
 *   POST /api/portal/remediation-tracker/steps/:stepId/verify
 *   GET  /api/portal/remediation-tracker/steps/:stepId/verification-guide
 *   POST /api/portal/remediation-tracker/steps/:stepId/decline-to-risk
 *
 * No fixture module, no fallback data — every read either resolves to a real
 * server response or surfaces as a failed/loading state the page renders
 * honestly, same discipline `risk-register-api.ts` established.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import type {
  ApiErrorBody,
  DeclineToRiskRequest,
  DeclineToRiskResponse,
  RemediationTrackerPayload,
  RemediationVerificationGuideResponse,
  RemediationVerifyResponse,
  RemediationTrackerStepStatus,
} from "@/lib/remediation-tracker-types";

const TRACKER_URL = "/api/portal/remediation-tracker";
export const REMEDIATION_TRACKER_QUERY_KEY = ["portal", "remediation-tracker"] as const;

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.clone().json()) as ApiErrorBody;
      if (typeof body?.error === "string") message = body.error;
      else if (body?.error?.message) message = body.error.message;
    } catch {
      // non-JSON error body — keep the generic message
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

export function useRemediationTracker() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: REMEDIATION_TRACKER_QUERY_KEY,
    queryFn: async () => {
      const res = await fetchWithAuth(TRACKER_URL, undefined, { silent: true });
      return parseJsonOrThrow<RemediationTrackerPayload>(res);
    },
  });
}

export function useSetRemediationTrackerStep() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ stepId, status }: { stepId: string; status: RemediationTrackerStepStatus }) => {
      const res = await fetchWithAuth(`${TRACKER_URL}/steps/${encodeURIComponent(stepId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      return parseJsonOrThrow<{ step: RemediationTrackerPayload["steps"][number] }>(res);
    },
    onSettled: () => {
      // The write also recomputes `pricing` server-side and resets
      // verification — refetch rather than optimistically patch so both stay
      // in lockstep with what the server actually stored.
      void queryClient.invalidateQueries({ queryKey: REMEDIATION_TRACKER_QUERY_KEY });
    },
  });
}

export function useVerifyRemediationStep() {
  const { fetchWithAuth } = useAuth();
  return useMutation({
    mutationFn: async (stepId: string) => {
      const res = await fetchWithAuth(`${TRACKER_URL}/steps/${encodeURIComponent(stepId)}/verify`, {
        method: "POST",
      });
      return parseJsonOrThrow<RemediationVerifyResponse>(res);
    },
    // Deliberately no query invalidation here: the route fires a fire-and-
    // forget workflow run (`remediation.verify_requested`) and the verdict
    // lands on the tracker row asynchronously — there is nothing new to read
    // back the instant this 202s. The caller re-polls GET on its own cadence.
  });
}

/** Lazy, on-demand — only fetches once a step's guide dialog is actually opened. */
export function useRemediationVerificationGuide(stepId: string | null) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: ["portal", "remediation-tracker", "verification-guide", stepId],
    queryFn: async () => {
      const res = await fetchWithAuth(
        `${TRACKER_URL}/steps/${encodeURIComponent(stepId as string)}/verification-guide`,
        undefined,
        { silent: true },
      );
      return parseJsonOrThrow<RemediationVerificationGuideResponse>(res);
    },
    enabled: stepId !== null,
  });
}

export function useDeclineRemediationStepToRisk() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ stepId, body }: { stepId: string; body: DeclineToRiskRequest }) => {
      const res = await fetchWithAuth(`${TRACKER_URL}/steps/${encodeURIComponent(stepId)}/decline-to-risk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return parseJsonOrThrow<DeclineToRiskResponse>(res);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: REMEDIATION_TRACKER_QUERY_KEY });
    },
  });
}
