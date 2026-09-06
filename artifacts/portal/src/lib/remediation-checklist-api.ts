/**
 * React Query hooks for the findings-derived Remediation Tracking checklist,
 * its fix-route dimension, the CR-gated script reveal, and the observational
 * bypass-resolutions read (#1538/#1539/#1541/#1543, Feature #1489, #3038).
 *
 * Wired to the real, live endpoints documented in
 * `docs/remediation-tracking-contract-pack.md` §1b-1e:
 *   GET  /api/portal/remediation/checklist
 *   PUT  /api/portal/remediation/checklist/:checkKey
 *   POST /api/portal/remediation/checklist/:checkKey/raise-change
 *   POST /api/portal/remediation/checklist/:checkKey/decline-to-risk
 *   GET  /api/portal/remediation/fix-routes
 *   POST /api/portal/remediation/fix-routes/:checkKey/reveal
 *   GET  /api/portal/remediation/bypass-resolutions
 *
 * No fixture module, no fallback data — every read either resolves to a real
 * server response or surfaces as a failed/loading state the page renders
 * honestly (contract pack §4e/§4f, the honest-empty contract).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import type {
  ApiErrorBody,
  BypassResolution,
  DeclineChecklistToRiskResult,
  RaiseChangeFromChecklistResult,
  RemediationChecklistItemWriteResult,
  RemediationChecklistResult,
  RemediationFixRoutesResult,
  RemediationTrackerStepStatus,
  RevealOutcome,
  WireRevealedFix,
} from "@/lib/remediation-checklist-types";

const CHECKLIST_KEY = ["portal", "remediation", "checklist"] as const;
const FIX_ROUTES_KEY = ["portal", "remediation", "fix-routes"] as const;
const BYPASS_KEY = ["portal", "remediation", "bypass-resolutions"] as const;

function errorMessage(body: ApiErrorBody, status: number): string {
  if (typeof body?.error === "string" && body.error) return body.error;
  if (body?.error && typeof body.error === "object" && body.error.message) return body.error.message;
  return `Request failed (${status})`;
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.clone().json()) as ApiErrorBody;
      message = errorMessage(body, res.status);
    } catch {
      // non-JSON error body — keep the generic message
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

export function useRemediationChecklist() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: CHECKLIST_KEY,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/remediation/checklist", undefined, { silent: true });
      return parseJsonOrThrow<RemediationChecklistResult>(res);
    },
  });
}

export function useUpdateChecklistItem() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ checkKey, status }: { checkKey: string; status: RemediationTrackerStepStatus }) => {
      const res = await fetchWithAuth(
        `/api/portal/remediation/checklist/${encodeURIComponent(checkKey)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      return parseJsonOrThrow<{ item: RemediationChecklistItemWriteResult }>(res);
    },
    onSettled: () => {
      // A write resets verification server-side; refetch rather than patch so
      // the badge never shows a verdict about a claim that just changed.
      void queryClient.invalidateQueries({ queryKey: CHECKLIST_KEY });
    },
  });
}

export function useRaiseChangeFromChecklistItem() {
  const { fetchWithAuth } = useAuth();
  return useMutation({
    mutationFn: async (checkKey: string) => {
      const res = await fetchWithAuth(
        `/api/portal/remediation/checklist/${encodeURIComponent(checkKey)}/raise-change`,
        { method: "POST" },
      );
      return parseJsonOrThrow<RaiseChangeFromChecklistResult>(res);
    },
  });
}

export interface DeclineChecklistToRiskBody {
  readonly fullName: string;
  readonly confirmed: true;
  readonly statement: string;
}

export function useDeclineChecklistItemToRisk() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ checkKey, body }: { checkKey: string; body: DeclineChecklistToRiskBody }) => {
      const res = await fetchWithAuth(
        `/api/portal/remediation/checklist/${encodeURIComponent(checkKey)}/decline-to-risk`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      return parseJsonOrThrow<DeclineChecklistToRiskResult>(res);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: CHECKLIST_KEY });
    },
  });
}

export function useRemediationFixRoutes(options?: { readonly enabled?: boolean }) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: FIX_ROUTES_KEY,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/remediation/fix-routes", undefined, { silent: true });
      return parseJsonOrThrow<RemediationFixRoutesResult>(res);
    },
    enabled: options?.enabled ?? true,
  });
}

/**
 * The reveal gate (#1541) — 403 (no/pending CR), 404 (approved, no content)
 * and 409 (no connected tenant) are real, expected outcomes on this route,
 * not exceptions; only a genuine network/5xx failure throws.
 */
export function useRevealFix() {
  const { fetchWithAuth } = useAuth();
  return useMutation({
    mutationFn: async (checkKey: string): Promise<RevealOutcome> => {
      const res = await fetchWithAuth(
        `/api/portal/remediation/fix-routes/${encodeURIComponent(checkKey)}/reveal`,
        { method: "POST" },
        { silent: true },
      );
      if (res.status === 403 || res.status === 404 || res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
        return { status: res.status, error: errorMessage(body, res.status) };
      }
      const data = await parseJsonOrThrow<WireRevealedFix>(res);
      return { status: 200, data };
    },
  });
}

export function useBypassResolutions() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: BYPASS_KEY,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/remediation/bypass-resolutions", undefined, { silent: true });
      const data = await parseJsonOrThrow<{ items: BypassResolution[] }>(res);
      return data.items;
    },
  });
}
