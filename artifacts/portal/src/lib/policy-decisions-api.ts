/**
 * React Query hooks for the customer-facing Policy Decisions own-table
 * register (#1724, Feature #1490).
 *
 * Wired to the real, live endpoints documented in
 * `docs/portal/policy-decisions-contract-pack.md` §1/§3:
 *   GET   /api/portal/policy-register                        — this tenant's own-table decisions
 *   POST  /api/portal/policy-register                         — record + sign a new decision
 *   PATCH /api/portal/policy-register/:id/clearance/resolve   — manual dependency clearance
 *   GET   /api/portal/compliance-obligations                  — the obligations catalogue
 *
 * No fixture module, no fallback data — every read either resolves to a real
 * server response or surfaces as a failed/loading/tier-gated state the page
 * itself renders honestly, and every write below is a real request against
 * the tables `portal-policy-decisions.ts`'s own header documents.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import type {
  ApiErrorBody,
  CreatePolicyDecisionBody,
  ResolveClearanceBody,
  WireObligation,
  WirePolicyRegisterEntry,
} from "@/lib/policy-decisions-types";

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let code: string | undefined;
    try {
      const body = (await res.clone().json()) as ApiErrorBody;
      const err = body?.error;
      if (typeof err === "string") message = err;
      else if (err?.message) message = err.message;
      code = body?.code;
    } catch {
      // non-JSON error body — keep the generic message
    }
    // `requireTierFeature` (portal-tier-features.ts) answers 402 with
    // code: "TIER_UPGRADE_REQUIRED" when this customer's plan doesn't bundle
    // Policy Decisions — a distinct, honest state from a failed read, not a
    // generic error (contract pack §1.2's requireTierFeature gate). Creation
    // (POST) is never gated (#1168) — only this GET is.
    const httpErr = new Error(message) as Error & { status?: number; code?: string };
    httpErr.status = res.status;
    httpErr.code = code;
    throw httpErr;
  }
  return (await res.json()) as T;
}

const POLICY_REGISTER_QUERY_KEY = ["portal", "policy-register"] as const;
const COMPLIANCE_OBLIGATIONS_QUERY_KEY = ["portal", "compliance-obligations"] as const;

export function usePolicyRegister() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: POLICY_REGISTER_QUERY_KEY,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/policy-register", undefined, { silent: true });
      const data = await parseJsonOrThrow<{ decisions: WirePolicyRegisterEntry[] }>(res);
      return data.decisions;
    },
  });
}

/** Record and sign a new decision (§1.3). Recording and signing are one act — there is no draft. */
export function useCreatePolicyDecision() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreatePolicyDecisionBody) => {
      const res = await fetchWithAuth("/api/portal/policy-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return parseJsonOrThrow<{ decision: WirePolicyRegisterEntry }>(res);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: POLICY_REGISTER_QUERY_KEY }),
  });
}

/** Manual mark-resolved for a dependency-based decision (§1.4) — only ever
 * valid for `clearanceTriggerType === "manual"`; a `license_sku` row 409s and
 * can only clear itself. */
export function useResolveClearance() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, note }: { id: string } & ResolveClearanceBody) => {
      const res = await fetchWithAuth(`/api/portal/policy-register/${encodeURIComponent(id)}/clearance/resolve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      return parseJsonOrThrow<{ decision: WirePolicyRegisterEntry }>(res);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: POLICY_REGISTER_QUERY_KEY }),
  });
}

/** The obligations catalogue (§3) — "what you are measured against". Lower
 * `Assessment` role floor than the register above; not tier-gated. */
export function useComplianceObligations() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: COMPLIANCE_OBLIGATIONS_QUERY_KEY,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/compliance-obligations", undefined, { silent: true });
      const data = await parseJsonOrThrow<{ obligations: WireObligation[] }>(res);
      return data.obligations;
    },
  });
}
