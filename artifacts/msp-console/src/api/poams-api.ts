/**
 * poams-api.ts — the data seam for the MSP Console's POA&Ms module (#3897,
 * README screen 41, wiring the real MSP-staff-authored plans-of-action).
 *
 * Wraps the routes in `artifacts/api-server/src/routes/msp-poams.ts`:
 *
 *   GET    /api/msp/poams                                      — every POA&M
 *          across the whole MSP book. No filter, no search, no pagination —
 *          this route takes no `customerId` and `msp_poams.tenantId` is free
 *          text with no real FK (see that table's own schema header), so
 *          there is no reliable way to scope this list to one tenant node.
 *   POST   /api/msp/poams                                      — author one
 *   GET    /api/msp/poams/:poamId                               — one, with
 *          its milestones
 *   PATCH  /api/msp/poams/:poamId                                — edit
 *          narrative/schedule/resources, or mark `completed` — the only path
 *          to that status, at the `ladder.msp-operator` floor, with no
 *          dedicated route and no condition on open milestones (#3897, real
 *          gap the design's own notes call out). Refuses `active`, `cancelled`
 *          and `converted_to_risk_acceptance` as incoming values (#3452,
 *          #3635 — both confirmed fixed on `main`), and refuses ANY edit once
 *          the row is `cancelled`, `completed` or `converted_to_risk_acceptance`.
 *   PATCH  /api/msp/poams/:poamId/cancel                         — mark
 *          cancelled. `ladder.msp-admin`-gated, and — since #3452 — the
 *          generic edit route above can no longer be used to reach the same
 *          state at the operator floor, so this is now the ONLY door.
 *   POST   /api/msp/poams/:poamId/convert-to-risk-acceptance      — convert an
 *          `active` plan to an accepted risk (`ladder.msp-admin`). Creates a
 *          real `msp_risk_decisions` row (`RBD-<poamId>`, deterministic — a
 *          repeat call reuses it rather than creating a second one) and marks
 *          this plan `converted_to_risk_acceptance`.
 *   POST   /api/msp/poams/:poamId/milestones                     — add a
 *          milestone (always created `pending` — the server does not accept a
 *          starting status)
 *   PATCH  /api/msp/poams/:poamId/milestones/:milestoneId         — edit, or
 *          mark complete. Refuses ANY change once the milestone is already
 *          `completed` — frozen against edits.
 *   DELETE /api/msp/poams/:poamId/milestones/:milestoneId         — remove a
 *          milestone outright. NO status check at all — a completed milestone
 *          can still be deleted with no trace left on the plan. Real,
 *          load-bearing asymmetry against the PATCH guard directly above;
 *          this module must not "fix" it by hiding the button.
 *   DELETE /api/msp/poams/:poamId                                 — soft-
 *          delete the plan (`ladder.msp-admin`, reason required). Also no
 *          status check — a completed or cancelled plan remains deletable.
 *
 * Every route returns the bare database row with no derived fields — overdue
 * and signed are computed client-side in the page component, not here.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export const POAM_STATUSES = ["draft", "pending_signature", "active", "completed", "cancelled", "converted_to_risk_acceptance"] as const;
export type PoamStatus = (typeof POAM_STATUSES)[number];

export const POAM_MILESTONE_STATUSES = ["pending", "completed"] as const;
export type PoamMilestoneStatus = (typeof POAM_MILESTONE_STATUSES)[number];

export interface ClientApprover {
  readonly name: string;
  readonly title: string;
  readonly email: string;
  readonly signedAt: string | null;
  readonly ipAddress: string | null;
  readonly signatureHash: string | null;
}

export interface Poam {
  readonly id: number;
  readonly mspId: number;
  readonly poamId: string;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly primaryDomain: string;
  readonly title: string;
  readonly weaknessDescription: string;
  readonly checkKey: string | null;
  readonly additionalCheckKeys: string[] | null;
  readonly scheduledCompletionDate: string;
  readonly originalScheduledCompletionDate: string;
  readonly interimCompensatingControl: string;
  readonly resourcesRequired: string;
  readonly status: PoamStatus;
  readonly authorizingWorkloadId: string | null;
  readonly authorizingWorkloadLabel: string | null;
  readonly signedAt: string | null;
  readonly signedBy: { name: string; title: string; email: string } | null;
  readonly signedStatement: string | null;
  readonly sowId: string | null;
  readonly spawnedByRiskDecisionId: number | null;
  readonly convertedToRiskDecisionId: number | null;
  readonly conversionReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PoamMilestone {
  readonly id: number;
  readonly poamId: number;
  readonly title: string;
  readonly description: string | null;
  readonly dueDate: string;
  readonly sortOrder: number;
  readonly status: PoamMilestoneStatus;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PoamDetail extends Poam {
  readonly milestones: PoamMilestone[];
}

export interface CreatePoamInput {
  tenantId: string;
  tenantName: string;
  primaryDomain: string;
  title: string;
  weaknessDescription: string;
  checkKey?: string | null;
  scheduledCompletionDate: string;
  interimCompensatingControl: string;
  resourcesRequired: string;
  status: "draft" | "pending_signature";
  sowId?: string | null;
}

export interface UpdatePoamInput {
  title?: string;
  weaknessDescription?: string;
  scheduledCompletionDate?: string;
  interimCompensatingControl?: string;
  resourcesRequired?: string;
  /** The only status this route will ever accept from here — see header. */
  status?: "completed";
}

export interface ConvertToRiskAcceptanceInput {
  reason: string;
  controlViolated: string;
  framework: string;
  rawRiskLevel: "critical" | "high" | "medium";
  residualRiskLevel: "high" | "medium" | "low";
  rawRiskScore: number;
  residualRiskScore: number;
  liabilityValueUsd: number;
  clientApprover: { name: string; title: string; email: string };
  expirationDate: string;
}

export interface ConvertToRiskAcceptanceResult {
  readonly poamId: string;
  readonly riskDecisionId: number;
  readonly rbdId: string;
  readonly registerRef: string;
  readonly message: string;
}

/** A fetch that failed reports its real HTTP status and, when the server sent
 * one, its real error text — so the UI can show the server's own refusal
 * message (e.g. the 409 conflict text) rather than a generic failure. */
export class PoamApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function getJson<T>(
  fetchWithAuth: (i: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  url: string,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetchWithAuth(url, { method: "GET", signal });
  const parsed = await res.json().catch(() => ({}));
  if (!res.ok) throw new PoamApiError(res.status, (parsed as { error?: string }).error ?? `Request failed: ${res.status}`);
  return parsed as T;
}

async function sendJson<T>(
  fetchWithAuth: (i: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  const res = await fetchWithAuth(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const parsed = await res.json().catch(() => ({}));
  if (!res.ok) {
    const flat = (parsed as { error?: string })?.error;
    throw new PoamApiError(res.status, flat ?? `Request failed: ${res.status}`);
  }
  return parsed as T;
}

const POAMS_KEY = ["msp", "poams"] as const;

export function usePoams(): UseQueryResult<Poam[], PoamApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: POAMS_KEY,
    queryFn: ({ signal }) => getJson<Poam[]>(fetchWithAuth, "/api/msp/poams", signal),
    enabled: !isLoading && !!accessToken,
    staleTime: 10_000,
  });
}

export function usePoamDetail(poamId: string | null): UseQueryResult<PoamDetail, PoamApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: [...POAMS_KEY, poamId],
    queryFn: ({ signal }) => getJson<PoamDetail>(fetchWithAuth, `/api/msp/poams/${poamId}`, signal),
    enabled: !isLoading && !!accessToken && !!poamId,
    staleTime: 5_000,
  });
}

function useInvalidatePoams() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: POAMS_KEY });
  };
}

export function useCreatePoam() {
  const { fetchWithAuth } = useAuth();
  const invalidate = useInvalidatePoams();
  return useMutation({
    mutationFn: (input: CreatePoamInput) =>
      sendJson<{ id: number; poamId: string; message: string }>(fetchWithAuth, "/api/msp/poams", "POST", input),
    onSuccess: invalidate,
  });
}

export function useUpdatePoam() {
  const { fetchWithAuth } = useAuth();
  const invalidate = useInvalidatePoams();
  return useMutation({
    mutationFn: ({ poamId, input }: { poamId: string; input: UpdatePoamInput }) =>
      sendJson<{ poamId: string; message: string }>(fetchWithAuth, `/api/msp/poams/${poamId}`, "PATCH", input),
    onSuccess: invalidate,
  });
}

/** `ladder.msp-admin`-gated server-side — pass `isAdmin` from the caller's own
 * profile to decide whether to enable the button; a non-admin call still
 * fails server-side with a real 403 either way. */
export function useCancelPoam() {
  const { fetchWithAuth } = useAuth();
  const invalidate = useInvalidatePoams();
  return useMutation({
    mutationFn: (poamId: string) =>
      sendJson<{ poamId: string; message: string }>(fetchWithAuth, `/api/msp/poams/${poamId}/cancel`, "PATCH"),
    onSuccess: invalidate,
  });
}

/** `ladder.msp-admin`-gated server-side. */
export function useConvertToRiskAcceptance() {
  const { fetchWithAuth } = useAuth();
  const invalidate = useInvalidatePoams();
  return useMutation({
    mutationFn: ({ poamId, input }: { poamId: string; input: ConvertToRiskAcceptanceInput }) =>
      sendJson<ConvertToRiskAcceptanceResult>(fetchWithAuth, `/api/msp/poams/${poamId}/convert-to-risk-acceptance`, "POST", input),
    onSuccess: invalidate,
  });
}

/** `ladder.msp-admin`-gated server-side. Soft-delete through the platform
 * retention lifecycle — recoverable for the tenant's configured window, then
 * eligible for the #1571 accelerated-delete review queue. No status check:
 * a completed or cancelled plan remains deletable. */
export function useDeletePoam() {
  const { fetchWithAuth } = useAuth();
  const invalidate = useInvalidatePoams();
  return useMutation({
    mutationFn: ({ poamId, reason }: { poamId: string; reason: string }) =>
      sendJson<{ poamId: string; deletion: unknown; message: string }>(fetchWithAuth, `/api/msp/poams/${poamId}`, "DELETE", { reason }),
    onSuccess: invalidate,
  });
}

export function useAddMilestone() {
  const { fetchWithAuth } = useAuth();
  const invalidate = useInvalidatePoams();
  return useMutation({
    mutationFn: ({ poamId, title, dueDate, description }: { poamId: string; title: string; dueDate: string; description?: string | null }) =>
      sendJson<{ id: number; message: string }>(fetchWithAuth, `/api/msp/poams/${poamId}/milestones`, "POST", {
        title,
        dueDate,
        ...(description ? { description } : {}),
      }),
    onSuccess: invalidate,
  });
}

/** Refused server-side (409) once the milestone is already `completed` — the
 * frozen-against-edits half of the real asymmetry. */
export function useCompleteMilestone() {
  const { fetchWithAuth } = useAuth();
  const invalidate = useInvalidatePoams();
  return useMutation({
    mutationFn: ({ poamId, milestoneId }: { poamId: string; milestoneId: number }) =>
      sendJson<{ id: number; message: string }>(fetchWithAuth, `/api/msp/poams/${poamId}/milestones/${milestoneId}`, "PATCH", {
        status: "completed",
      }),
    onSuccess: invalidate,
  });
}

/** No status check server-side at all — the still-deletable half of the real
 * asymmetry. A completed milestone can be removed with no trace left behind. */
export function useDeleteMilestone() {
  const { fetchWithAuth } = useAuth();
  const invalidate = useInvalidatePoams();
  return useMutation({
    mutationFn: ({ poamId, milestoneId }: { poamId: string; milestoneId: number }) =>
      sendJson<{ id: number; message: string }>(fetchWithAuth, `/api/msp/poams/${poamId}/milestones/${milestoneId}`, "DELETE"),
    onSuccess: invalidate,
  });
}
