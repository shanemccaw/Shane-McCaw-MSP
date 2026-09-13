/**
 * MSP Console — Policy Decisions + Policy Engine (Git #2591, Feature #1685).
 * Mounts at `/ops/policy`
 * (`Design/MSP_Console/design_handoff_msp_console/Policy Engine.dc.html`,
 * README screen 50). Wired against the real, live-and-mounted backend named
 * in the contract pack (`docs/msp-console/policy-decisions-msp-console-contract-pack.md`):
 *
 *   GET   /api/msp/policy-decisions/:customerId
 *   PATCH /api/msp/policy-decisions/:customerId/:id/clearance/resolve
 *   GET   /api/msp/standing-policies
 *   POST  /api/msp/standing-policies
 *   PATCH /api/msp/standing-policies/:id                       (#3034)
 *   POST  /api/msp/standing-policies/:id/evaluate
 *   GET   /api/msp/standing-policies/:id/enactment?customerId=
 *   GET   /api/msp/standing-policies/:id/evaluations
 *   GET   /api/msp/tenants/:tenantId/policy-engine
 *   PATCH /api/msp/tenants/:tenantId/policy-engine
 *   GET   /api/msp/rbd/available-obligations                   (#1525's real obligation register)
 *   GET   /api/msp/active-directory/ous?customerId=             (new this build, #2591 — see
 *         msp-active-directory.ts's own header: nothing under /api/msp/* listed OUs before this,
 *         and the standing-policy author/edit form genuinely needs one)
 *
 * Real, load-bearing design note (this issue's own dispatch): a customer-signed
 * policy decision and an MSP standing policy are two different real things
 * that can both resolve to the identical enactment ROUTE — every component
 * below renders `route` and `reason` as two separate values, never folded
 * into one label.
 *
 * No fixture module — every row is a real server response or an honest
 * loading/empty/error state.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.clone().json()) as { error?: { message?: string } | string };
      const err = body?.error;
      if (typeof err === "string") message = err;
      else if (err?.message) message = err.message;
    } catch {
      // non-JSON error body — keep the generic message
    }
    const wrapped = new Error(message) as Error & { status?: number };
    wrapped.status = res.status;
    throw wrapped;
  }
  return (await res.json()) as T;
}

function jsonBody(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

// ── Policy Decisions ──────────────────────────────────────────────────────────

export interface PolicyRegisterEntry {
  id: string;
  state: string;
  pillar: string | null;
  title: string;
  obligation: string;
  obligationId: string | null;
  obligationType: string | null;
  owner: string;
  ownerId: string | null;
  reviewCadence: string | null;
  reviewDueAt: string | null;
  reviewState: string | null;
  compensatingControl: string;
  signedBy: string;
  signedAt: string;
  statement: string;
  clearanceCondition: string | null;
  clearanceTriggerType: string | null;
  clearanceTriggerSkuPartNumber: string | null;
  clearanceResolvedAt: string | null;
  clearanceResolvedNote: string | null;
  isCleared: boolean;
}

const decisionsKey = (customerId: number) => ["msp", "policy-decisions", customerId] as const;

export function usePolicyDecisions(customerId: number | null) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: decisionsKey(customerId ?? -1),
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/msp/policy-decisions/${customerId}`);
      return parseJsonOrThrow<{ customerId: number; decisions: PolicyRegisterEntry[] }>(res);
    },
    enabled: customerId != null,
  });
}

export function useResolvePolicyDecisionClearance(customerId: number | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      const res = await fetchWithAuth(
        `/api/msp/policy-decisions/${customerId}/${id}/clearance/resolve`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }) },
      );
      return parseJsonOrThrow<{ decision: PolicyRegisterEntry }>(res);
    },
    onSuccess: () => customerId != null && void queryClient.invalidateQueries({ queryKey: decisionsKey(customerId) }),
  });
}

// ── Obligation register (#1525) — platform-seeded + this MSP's own rows, one catalog ──

export interface ObligationRegisterEntry {
  obligationId: number;
  citation: string;
  requires: string;
  frameworkName: string;
  authorityType: string;
  /** Null = platform-seeded (global). Set = authored by this MSP for that tenant. */
  tenantId: number | null;
}

export function useObligationRegister() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: ["msp", "rbd", "available-obligations"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/msp/rbd/available-obligations");
      return parseJsonOrThrow<ObligationRegisterEntry[]>(res);
    },
    staleTime: 60_000,
  });
}

// ── Standing policies ─────────────────────────────────────────────────────────

export type StandingPolicyTargetKind = "mailbox_attribute" | "group_membership" | "service_policy";

export interface StandingPolicy {
  id: number;
  ouId: number;
  title: string;
  description: string;
  targetKind: StandingPolicyTargetKind;
  targetState: unknown;
  catalogItemId: number | null;
  sopId: string | null;
  isActive: boolean;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StandingPolicyInput {
  ouId: number;
  title: string;
  description?: string;
  targetKind: StandingPolicyTargetKind;
  targetState?: Record<string, unknown>;
  catalogItemId?: number | null;
  sopId?: string | null;
  isActive?: boolean;
}

const policiesKey = ["msp", "standing-policies"] as const;

export function useStandingPolicies() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: policiesKey,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/msp/standing-policies");
      return parseJsonOrThrow<{ policies: StandingPolicy[] }>(res);
    },
  });
}

export function useCreateStandingPolicy() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: StandingPolicyInput) => {
      const res = await fetchWithAuth("/api/msp/standing-policies", jsonBody(input));
      return parseJsonOrThrow<StandingPolicy>(res);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: policiesKey }),
  });
}

export function useUpdateStandingPolicy() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<StandingPolicyInput> & { id: number }) => {
      const res = await fetchWithAuth(`/api/msp/standing-policies/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
      });
      return parseJsonOrThrow<StandingPolicy>(res);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: policiesKey }),
  });
}

export interface PolicyEvaluationSummary {
  runId: string | null;
  membersObserved: number;
  compliant: number;
  nonCompliant: number;
  findingsCreated: readonly string[];
  notEvaluableReason: string | null;
}

export function useEvaluateStandingPolicy(policyId: number | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (customerId: number) => {
      const res = await fetchWithAuth(`/api/msp/standing-policies/${policyId}/evaluate`, jsonBody({ customerId }));
      return parseJsonOrThrow<PolicyEvaluationSummary>(res);
    },
    onSuccess: () => {
      if (policyId != null) void queryClient.invalidateQueries({ queryKey: ["msp", "standing-policies", policyId, "evaluations"] });
    },
  });
}

export type PolicyEnactmentRoute = "engine_enacts" | "checklist_item" | "not_evaluated";
export type PolicyEnactmentReason = "policy_inactive" | "tenant_not_opted_in" | "write_consent_granted" | "write_consent_denied";

export interface PolicyEnactmentPreview {
  policyId: number;
  customerId: number;
  targetKind: StandingPolicyTargetKind;
  sopId: string | null;
  catalogItemId: number | null;
  route: PolicyEnactmentRoute;
  reason: PolicyEnactmentReason;
}

export function useStandingPolicyEnactment(policyId: number | null, customerId: number | null) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: ["msp", "standing-policies", policyId, "enactment", customerId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/msp/standing-policies/${policyId}/enactment?customerId=${customerId}`);
      return parseJsonOrThrow<PolicyEnactmentPreview>(res);
    },
    enabled: policyId != null && customerId != null,
  });
}

export type PolicyEvaluationOutcome = "compliant" | "divergent" | "not_evaluable" | "skipped_not_opted_in" | "error";

export interface PolicyEvaluationRun {
  id: number;
  tenantId: number | null;
  triggerKind: "event" | "schedule";
  triggerEventType: string | null;
  outcome: PolicyEvaluationOutcome;
  detail: string | null;
  evaluatedAt: string;
}

export function useStandingPolicyEvaluations(policyId: number | null) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: ["msp", "standing-policies", policyId, "evaluations"],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/msp/standing-policies/${policyId}/evaluations`);
      return parseJsonOrThrow<{ evaluations: PolicyEvaluationRun[] }>(res);
    },
    enabled: policyId != null,
  });
}

// ── Per-tenant Policy Engine opt-in ───────────────────────────────────────────

export function usePolicyEngineOptIn(tenantId: number | null) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: ["msp", "tenants", tenantId, "policy-engine"],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/msp/tenants/${tenantId}/policy-engine`);
      return parseJsonOrThrow<{ tenantId: number; policyEngineOptIn: boolean }>(res);
    },
    enabled: tenantId != null,
  });
}

export function useSetPolicyEngineOptIn(tenantId: number | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (optIn: boolean) => {
      const res = await fetchWithAuth(`/api/msp/tenants/${tenantId}/policy-engine`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ optIn }),
      });
      return parseJsonOrThrow<{ tenantId: number; policyEngineOptIn: boolean }>(res);
    },
    onSuccess: () => tenantId != null && void queryClient.invalidateQueries({ queryKey: ["msp", "tenants", tenantId, "policy-engine"] }),
  });
}

// ── OU picker (new #2591 endpoint) ────────────────────────────────────────────

export interface CustomerOu {
  id: number;
  name: string;
}

export function useCustomerOus(customerId: number | null) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: ["msp", "active-directory", "ous", customerId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/msp/active-directory/ous?customerId=${customerId}`);
      return parseJsonOrThrow<{ ous: CustomerOu[] }>(res);
    },
    enabled: customerId != null,
  });
}

// ── SOPs and change-catalog pickers (already-real routes, reused here) ───────

export interface MspSopRow {
  sopId: string;
  title: string;
}

export function useMspSopsForPicker() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: ["msp", "sops", "picker"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/msp/sops");
      return parseJsonOrThrow<MspSopRow[]>(res);
    },
    staleTime: 60_000,
  });
}

export interface ChangeCatalogItemForPicker {
  id: number;
  title: string;
  status: string;
}

export function useChangeCatalogForPicker() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: ["msp", "change-catalog", "picker"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/msp/change-catalog");
      return parseJsonOrThrow<{ items: ChangeCatalogItemForPicker[] }>(res);
    },
    staleTime: 60_000,
  });
}
