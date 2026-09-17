/**
 * MSP Console — Conditional Access promotion API client (Git #4522).
 *
 * Shane's #4518 decision: CA policies are report-only (monitor-first) by default,
 * and a report-only policy is promoted to enforced only after its real sign-in
 * impact has been verified. Wired against
 * `artifacts/api-server/src/routes/msp-ca-policy-promotion.ts`:
 *
 *   GET  /api/msp/:mspId/customers/:customerId/ca-policies
 *   GET  /api/msp/:mspId/customers/:customerId/ca-policies/:policyId/impact
 *   POST /api/msp/:mspId/customers/:customerId/ca-policies/:policyId/promote
 *
 * Every count comes from the tenant's real sign-in logs, evaluated on the server;
 * the promote call re-derives it and refuses when it no longer matches what was
 * reviewed. No fixture module, no fabricated row.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export type TenantReadStatus = "ok" | "entra_premium_required" | "consent_revoked" | "policy_not_found" | "graph_error";

export interface CaPolicy {
  id: string;
  displayName: string | null;
  state: string | null;
  createdDateTime: string | null;
  modifiedDateTime: string | null;
  reportOnly: boolean;
  daysInCurrentState: number | null;
}

export interface CaPromotionRow {
  id: number;
  policyId: string;
  policyDisplayName: string | null;
  previousState: string | null;
  newState: string;
  outcome: "executing" | "succeeded" | "failed" | "refused";
  outcomeReason: string | null;
  impactAcknowledged: boolean;
  operatorNote: string | null;
  actorName: string | null;
  changeRequestId: number | null;
  createdAt: string;
  completedAt: string | null;
  impactSnapshot: { summary?: { wouldBlock?: number; wouldInterrupt?: number; affectedUserCount?: number; evaluated?: number } | null } | null;
}

export interface CaPoliciesResponse {
  customer: { id: number; name: string; isTestbed: boolean };
  promotionWritesAvailable: boolean;
  status: TenantReadStatus;
  detail: string | null;
  policies: CaPolicy[];
  promotions: CaPromotionRow[];
}

export interface AffectedUser {
  userId: string | null;
  userPrincipalName: string | null;
  userDisplayName: string | null;
  wouldBlock: number;
  wouldInterrupt: number;
  lastImpactAt: string | null;
}

export interface ImpactEvent {
  createdDateTime: string | null;
  userPrincipalName: string | null;
  userDisplayName: string | null;
  appDisplayName: string | null;
  ipAddress: string | null;
  clientAppUsed: string | null;
  outcome: "would_block" | "would_interrupt";
  enforcedGrantControls: string[];
}

export interface CaPolicyImpact {
  status: TenantReadStatus;
  detail: string | null;
  evaluatedAt: string;
  policy: Pick<CaPolicy, "id" | "displayName" | "state" | "createdDateTime" | "modifiedDateTime"> | null;
  window: { from: string; to: string; reportOnlySince: string | null; reportOnlyDays: number | null; clampedToRetention: boolean } | null;
  complete: boolean;
  pagesRead: number;
  oldestSignInRead: string | null;
  summary: {
    signInsScanned: number;
    evaluated: number;
    wouldBlock: number;
    wouldInterrupt: number;
    wouldSatisfy: number;
    notApplied: number;
    affectedUserCount: number;
    affectedUsers: AffectedUser[];
    impactEvents: ImpactEvent[];
  } | null;
  readiness: { eligible: boolean; ineligibleReason: string | null; requiresAcknowledgement: boolean; acknowledgementReasons: string[] } | null;
  fingerprint: string | null;
  coverageNote: string;
  promotionWritesAvailable: boolean;
}

export interface PromoteResponse {
  outcome: "succeeded" | "failed";
  promotionId: number;
  changeRequest: { id: number; code: string };
  status: number;
  errorType: string | null;
  message: string | null;
}

export type CaPromotionError = Error & { status?: number; code?: string; impact?: CaPolicyImpact | null };

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T;
  let message = `Request failed (${res.status})`;
  let code: string | undefined;
  let impact: CaPolicyImpact | null | undefined;
  try {
    const body = (await res.clone().json()) as { error?: string; code?: string; impact?: CaPolicyImpact | null; message?: string };
    message = body?.error ?? body?.message ?? message;
    code = body?.code;
    impact = body?.impact;
  } catch {
    // non-JSON error body — keep the generic message
  }
  const err = new Error(message) as CaPromotionError;
  err.status = res.status;
  err.code = code;
  err.impact = impact;
  throw err;
}

const base = (mspId: number, customerId: number) => `/api/msp/${mspId}/customers/${customerId}/ca-policies`;
const policiesKey = (mspId: number, customerId: number) => ["msp", "ca-promotion", mspId, customerId, "policies"] as const;
const impactKey = (mspId: number, customerId: number, policyId: string) =>
  ["msp", "ca-promotion", mspId, customerId, "impact", policyId] as const;

export function useCaPolicies(mspId: number, customerId: number, enabled: boolean) {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery<CaPoliciesResponse, CaPromotionError>({
    queryKey: policiesKey(mspId, customerId),
    queryFn: async () => parseJsonOrThrow<CaPoliciesResponse>(await fetchWithAuth(base(mspId, customerId))),
    enabled: enabled && !isLoading && !!accessToken,
  });
}

export function useCaPolicyImpact(mspId: number, customerId: number, policyId: string | null) {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery<CaPolicyImpact, CaPromotionError>({
    queryKey: impactKey(mspId, customerId, policyId ?? ""),
    queryFn: async () =>
      parseJsonOrThrow<CaPolicyImpact>(await fetchWithAuth(`${base(mspId, customerId)}/${policyId}/impact`)),
    enabled: !!policyId && !isLoading && !!accessToken,
    // Impact is evidence for an enforcement decision — never serve a stale copy.
    staleTime: 0,
    gcTime: 0,
  });
}

export function usePromoteCaPolicy(mspId: number, customerId: number) {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation<
    PromoteResponse,
    CaPromotionError,
    { policyId: string; reviewedFingerprint: string; acknowledgeImpact: boolean; note: string }
  >({
    mutationFn: async ({ policyId, reviewedFingerprint, acknowledgeImpact, note }) => {
      const res = await fetchWithAuth(`${base(mspId, customerId)}/${policyId}/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewedFingerprint,
          acknowledgeImpact,
          confirm: true,
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      return parseJsonOrThrow<PromoteResponse>(res);
    },
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: policiesKey(mspId, customerId) });
      void qc.invalidateQueries({ queryKey: impactKey(mspId, customerId, vars.policyId) });
      void qc.invalidateQueries({ queryKey: ["msp", "launch-control", mspId, customerId, "history"] });
    },
  });
}
