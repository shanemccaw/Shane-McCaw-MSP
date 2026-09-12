/**
 * scope-sla-api.ts — the data seam for the MSP Console's Scope & SLA module page
 * (Git #2656, Feature #2572). Mounts at `/ops/sla`
 * (`Design/MSP_Console/design_handoff_msp_console/Scope and SLA.dc.html`, README
 * screen 30), wiring the real, live, previously-unwired 26-route operator surface
 * documented in full at
 * `docs/msp-console/scope-and-sla-msp-console-contract-pack.md` (regenerated
 * against the current code post #2726/#2728/#2811/#2812/#2898 — do not build
 * against the buggy behavior any earlier, now-closed issue described):
 *
 *   `artifacts/api-server/src/routes/msp-scope-creep.ts` — 12 routes
 *   `artifacts/api-server/src/routes/msp-sla.ts`          — 14 routes
 *
 * This module wires the routes the design's own screen actually surfaces — the
 * five tabs (queue/timers/scope/policies/compliance) plus the score-a-customer and
 * task-detail drawers. Two real, live routes in this pack have no UI element in
 * the design at all (`GET /msp/scope-creep/escalations`, `GET /msp/sla/escalations`
 * — a raw escalations feed the design never renders as its own list) and are left
 * unwired here, same as the design leaves them; `GET /msp/sla/events/stream` is
 * also real but — per the contract pack's own §7 — has no live emitter anywhere in
 * the codebase, which is exactly why the design's own "Live updates idle" chip
 * never has a live variant either. This module does not fabricate one.
 *
 * Honest, documented departures from the design's fixture-driven mock:
 *   - The design's queue-task detail drawer always offers "Stop the clock" for an
 *     `sla`-sourced task. The real `GET /msp/operator-tasks` row for an SLA breach
 *     carries the breach's own id, not the underlying timer's id
 *     (`msp-sla.ts:506-519`), and `POST /msp/sla/timers/:timerId/resolve` only
 *     accepts a timer id — there is no route that resolves a breach or its timer
 *     from a breach id alone. The real, live action this backend actually gives an
 *     operator for that task is the `deepLink` the route itself returns
 *     (`/admin-panel/#/sla`); this module's task drawer opens that real link for an
 *     `sla_breach` task instead of pretending to stop a clock it cannot address.
 *   - "Score the clocks across the book" (`POST /msp/sla/evaluate`) is genuinely
 *     portfolio-wide with no customer scoping — the contract pack's own §5 records
 *     this as a real, intentional asymmetry with the scope-creep side, not a bug.
 *   - "Score a customer" (scope side, `POST /msp/scope-creep/evaluate`) requires a
 *     real `customerId` (#2726) — this module's picker lists the MSP's real
 *     directory customers (the same `useDirectory()` the shell's own tree reads),
 *     never the design's fixture tenant names ("Halcyon Health" etc, which do not
 *     exist as real rows).
 *   - The design's "escalated" annotation on a violation row is ephemeral local
 *     state after a manual escalate click, not a persisted field this module reads
 *     back from the server — there is no GET this screen wires that would tell it
 *     a violation already has an escalation on file (see the unwired-escalations
 *     note above), so a page reload honestly loses that annotation rather than
 *     fabricating a status the response never carries.
 *   - Every list route here is honest-empty (`{ <plural>: [] }`) when the MSP has
 *     no rows — the contract pack's §0 confirms every one of these tables is
 *     genuinely empty in the local environment today. No fixture, no fabricated
 *     row.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

// ── Shared error + fetch helper (same pattern as data-rights-api.ts) ──────────

export class ScopeSlaApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.clone().json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new ScopeSlaApiError(res.status, message);
  }
  return (await res.json()) as T;
}

// ── Real wire shapes (column-for-column from msp-sla.ts / msp-scope-creep.ts) ─

export type SlaTimerStatus = "running" | "warning" | "breached" | "stopped" | "paused";
export type ScopeCreepDetectionStatus = "open" | "acknowledged" | "resolved";
export type ScopeCreepSeverity = "low" | "medium" | "high" | "critical";

export interface SlaSummary {
  readonly activeTimers: number;
  readonly warningTimers: number;
  readonly breachedTimers: number;
  readonly openBreaches: number;
  readonly avgCompliancePct: number | null;
}

export interface OperatorTask {
  readonly id: string;
  readonly type: "sla_breach" | "scope_creep_violation";
  readonly category: string;
  readonly timerId: string | null;
  readonly customerId: number | null;
  readonly customerName: string | null;
  readonly description: string;
  readonly severity: string;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
  readonly deepLink: string;
}

export interface OperatorTasksResponse {
  readonly tasks: OperatorTask[];
  readonly total: number;
}

export interface SlaTimer {
  readonly id: number;
  readonly timerId: string;
  readonly mspId: number;
  readonly customerId: number;
  readonly policyId: number;
  readonly ticketRef: string | null;
  readonly ticketType: string;
  readonly status: SlaTimerStatus;
  readonly phase: "response" | "resolution";
  readonly startedAt: string;
  readonly warningFiredAt: string | null;
  readonly breachedAt: string | null;
  readonly stoppedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ScopeCreepDetection {
  readonly id: number;
  readonly detectionId: string;
  readonly mspId: number;
  readonly customerId: number;
  readonly policyId: number | null;
  readonly detectionType: "drift" | "expansion" | "timeline_slip";
  readonly ref: string | null;
  readonly baselineValue: number | null;
  readonly currentValue: number | null;
  readonly changePct: number | null;
  readonly status: ScopeCreepDetectionStatus;
  readonly detectedAt: string;
  readonly resolvedAt: string | null;
}

export interface ScopeCreepViolation {
  readonly id: number;
  readonly violationId: string;
  readonly mspId: number;
  readonly customerId: number;
  readonly policyId: number;
  readonly detectionId: string | null;
  readonly severity: ScopeCreepSeverity;
  readonly compositeScore: number;
  readonly threshold: number;
  readonly resolvedAt: string | null;
  readonly resolutionNotes: string | null;
  readonly createdAt: string;
}

export interface SlaPolicy {
  readonly id: number;
  readonly mspId: number | null;
  readonly name: string;
  readonly description: string | null;
  readonly responseTimeMinutes: number;
  readonly warningThresholdPct: number;
  readonly resolutionTimeMinutes: number;
  readonly resolutionWarningThresholdPct: number;
  readonly priority: string;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ScopeCreepPolicy {
  readonly id: number;
  readonly mspId: number | null;
  readonly name: string;
  readonly description: string | null;
  readonly driftThresholdPct: number;
  readonly expansionThresholdPct: number;
  readonly timelineSlipDays: number;
  readonly violationScoreThreshold: number;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SlaComplianceRecord {
  readonly id: number;
  readonly recordId: string;
  readonly mspId: number;
  readonly customerId: number;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly totalTickets: number;
  readonly breachedTickets: number;
  readonly compliancePct: number;
  readonly notes: string | null;
  readonly createdAt: string;
}

export interface ScopeCreepComplianceRecord {
  readonly id: number;
  readonly recordId: string;
  readonly mspId: number;
  readonly customerId: number;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly totalDetections: number;
  readonly violationCount: number;
  readonly compliancePct: number;
  readonly avgCompositeScore: number | null;
  readonly notes: string | null;
  readonly createdAt: string;
}

/** `POST /msp/sla/evaluate` response — `sla-engine.ts`'s `SlaEngineOutput`. */
export interface SlaEngineOutput {
  readonly engine: "sla";
  readonly score: number;
  readonly slaSignalScore: number;
  readonly slaTimerScore: number;
  readonly compliancePct: number;
  readonly runningTimers: number;
  readonly activeBreaches: number;
  readonly warningTimers: number;
  readonly rawSignals: string[];
  readonly timestamp: string;
}

/** `POST /msp/scope-creep/evaluate` response — `scope-creep-engine.ts`'s `ScopeCreepEngineOutput` + the route's own `autoFired`. */
export interface ScopeCreepEngineOutput {
  readonly engine: "scope_creep";
  readonly score: {
    readonly compositeScore: number;
    readonly driftScore: number;
    readonly expansionScore: number;
    readonly timelineSlipScore: number;
    readonly openDetections: number;
    readonly openViolations: number;
    readonly compliancePct: number;
  };
  readonly rawSignals: string[];
  readonly timestamp: string;
  readonly autoFired?: Array<{
    readonly policyId: number;
    readonly violationId: string | null;
    readonly severity: string | null;
    readonly belowThreshold: boolean;
  }>;
}

// ── Query keys ──────────────────────────────────────────────────────────────

const K = {
  summary: ["msp", "sla", "summary"] as const,
  operatorTasks: ["msp", "operator-tasks"] as const,
  timers: ["msp", "sla", "timers"] as const,
  slaPolicies: ["msp", "sla", "policies"] as const,
  slaCompliance: ["msp", "sla", "compliance"] as const,
  detections: ["msp", "scope-creep", "detections"] as const,
  violations: ["msp", "scope-creep", "violations"] as const,
  scopePolicies: ["msp", "scope-creep", "policies"] as const,
  scopeCompliance: ["msp", "scope-creep", "compliance"] as const,
};

function useAuthedFetch() {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return { fetchWithAuth, ready: !isLoading && !!accessToken };
}

// ── GET /msp/sla/summary ──────────────────────────────────────────────────────

export function useSlaSummary(): UseQueryResult<SlaSummary, ScopeSlaApiError> {
  const { fetchWithAuth, ready } = useAuthedFetch();
  return useQuery({
    queryKey: K.summary,
    queryFn: async () => parseJsonOrThrow<SlaSummary>(await fetchWithAuth("/api/msp/sla/summary")),
    enabled: ready,
    staleTime: 15_000,
  });
}

// ── GET /msp/operator-tasks ────────────────────────────────────────────────────

export function useOperatorTasks(): UseQueryResult<OperatorTasksResponse, ScopeSlaApiError> {
  const { fetchWithAuth, ready } = useAuthedFetch();
  return useQuery({
    queryKey: K.operatorTasks,
    queryFn: async () => parseJsonOrThrow<OperatorTasksResponse>(await fetchWithAuth("/api/msp/operator-tasks")),
    enabled: ready,
    staleTime: 15_000,
  });
}

// ── GET /msp/sla/timers ────────────────────────────────────────────────────────

export function useSlaTimers(): UseQueryResult<{ timers: SlaTimer[] }, ScopeSlaApiError> {
  const { fetchWithAuth, ready } = useAuthedFetch();
  return useQuery({
    queryKey: K.timers,
    queryFn: async () => parseJsonOrThrow<{ timers: SlaTimer[] }>(await fetchWithAuth("/api/msp/sla/timers")),
    enabled: ready,
    staleTime: 15_000,
  });
}

// ── GET /msp/scope-creep/detections — merged across the three real statuses ───
// The route only ever filters by ONE status at a time (default "open"); there is
// no "all" value it understands server-side. The "Everything" filter in the
// design's own Scope tab is therefore three real parallel GETs merged
// client-side, not a fabricated fourth status.

export function useScopeCreepDetections(): UseQueryResult<ScopeCreepDetection[], ScopeSlaApiError> {
  const { fetchWithAuth, ready } = useAuthedFetch();
  return useQuery({
    queryKey: K.detections,
    queryFn: async () => {
      const statuses: ScopeCreepDetectionStatus[] = ["open", "acknowledged", "resolved"];
      const results = await Promise.all(
        statuses.map(async (status) => {
          const res = await fetchWithAuth(`/api/msp/scope-creep/detections?status=${status}`);
          const body = await parseJsonOrThrow<{ detections: ScopeCreepDetection[] }>(res);
          return body.detections;
        }),
      );
      return results.flat();
    },
    enabled: ready,
    staleTime: 15_000,
  });
}

// ── GET /msp/scope-creep/violations ───────────────────────────────────────────

export function useScopeCreepViolations(): UseQueryResult<{ violations: ScopeCreepViolation[] }, ScopeSlaApiError> {
  const { fetchWithAuth, ready } = useAuthedFetch();
  return useQuery({
    queryKey: K.violations,
    queryFn: async () => parseJsonOrThrow<{ violations: ScopeCreepViolation[] }>(await fetchWithAuth("/api/msp/scope-creep/violations")),
    enabled: ready,
    staleTime: 15_000,
  });
}

// ── GET /msp/sla/policies + /msp/scope-creep/policies ─────────────────────────

export function useSlaPolicies(): UseQueryResult<{ policies: SlaPolicy[] }, ScopeSlaApiError> {
  const { fetchWithAuth, ready } = useAuthedFetch();
  return useQuery({
    queryKey: K.slaPolicies,
    queryFn: async () => parseJsonOrThrow<{ policies: SlaPolicy[] }>(await fetchWithAuth("/api/msp/sla/policies")),
    enabled: ready,
    staleTime: 30_000,
  });
}

export function useScopeCreepPolicies(): UseQueryResult<{ policies: ScopeCreepPolicy[] }, ScopeSlaApiError> {
  const { fetchWithAuth, ready } = useAuthedFetch();
  return useQuery({
    queryKey: K.scopePolicies,
    queryFn: async () => parseJsonOrThrow<{ policies: ScopeCreepPolicy[] }>(await fetchWithAuth("/api/msp/scope-creep/policies")),
    enabled: ready,
    staleTime: 30_000,
  });
}

// ── GET /msp/sla/compliance + /msp/scope-creep/compliance ─────────────────────

export function useSlaCompliance(): UseQueryResult<{ records: SlaComplianceRecord[] }, ScopeSlaApiError> {
  const { fetchWithAuth, ready } = useAuthedFetch();
  return useQuery({
    queryKey: K.slaCompliance,
    queryFn: async () => parseJsonOrThrow<{ records: SlaComplianceRecord[] }>(await fetchWithAuth("/api/msp/sla/compliance")),
    enabled: ready,
    staleTime: 30_000,
  });
}

export function useScopeCreepCompliance(): UseQueryResult<{ records: ScopeCreepComplianceRecord[] }, ScopeSlaApiError> {
  const { fetchWithAuth, ready } = useAuthedFetch();
  return useQuery({
    queryKey: K.scopeCompliance,
    queryFn: async () => parseJsonOrThrow<{ records: ScopeCreepComplianceRecord[] }>(await fetchWithAuth("/api/msp/scope-creep/compliance")),
    enabled: ready,
    staleTime: 30_000,
  });
}

// ── Mutations ──────────────────────────────────────────────────────────────────

export function useResolveSlaTimer() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ timerId, notes }: { timerId: string; notes?: string }) => {
      const res = await fetchWithAuth(`/api/msp/sla/timers/${timerId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      return parseJsonOrThrow<{ resolved: boolean }>(res);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: K.timers });
      void qc.invalidateQueries({ queryKey: K.summary });
      void qc.invalidateQueries({ queryKey: K.operatorTasks });
    },
  });
}

export function useResolveScopeCreepViolation() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ violationId, notes }: { violationId: string; notes?: string }) => {
      const res = await fetchWithAuth(`/api/msp/scope-creep/violations/${violationId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      return parseJsonOrThrow<{ resolved: boolean }>(res);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: K.violations });
      void qc.invalidateQueries({ queryKey: K.operatorTasks });
    },
  });
}

export function useEscalateScopeCreepViolation() {
  const { fetchWithAuth } = useAuth();
  return useMutation({
    mutationFn: async ({ violationId, customerId }: { violationId: string; customerId: number }) => {
      const res = await fetchWithAuth("/api/msp/scope-creep/escalations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ violationId, customerId, level: 1, escalationType: "operator_task" }),
      });
      return parseJsonOrThrow<{ escalationId: string; alreadyExisted: boolean }>(res);
    },
  });
}

/** Portfolio-wide, real asymmetry vs. the scope-creep side — see this file's header note. */
export function useEvaluateSlaForMsp() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => parseJsonOrThrow<SlaEngineOutput>(await fetchWithAuth("/api/msp/sla/evaluate", { method: "POST" })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: K.summary }),
  });
}

export function useEvaluateScopeCreepForCustomer() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ customerId, autoFireViolations }: { customerId: number; autoFireViolations: boolean }) => {
      const res = await fetchWithAuth("/api/msp/scope-creep/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, autoFireViolations }),
      });
      return parseJsonOrThrow<ScopeCreepEngineOutput>(res);
    },
    onSuccess: (data) => {
      if (data.autoFired && data.autoFired.length > 0) {
        void qc.invalidateQueries({ queryKey: K.violations });
        void qc.invalidateQueries({ queryKey: K.operatorTasks });
      }
    },
  });
}

/**
 * Policy copy-on-write. A global (`mspId === null`) policy's PATCH/DELETE always
 * INSERTs a new MSP-owned row rather than mutating the shared default
 * (`msp-scope-creep.ts:129-206`, `msp-sla.ts:127-192`) — see this file's header
 * for why "Edit" and "Make my copy" share one real handler here: the design's own
 * state model has no field-level policy-edit form, only this copy-on-write
 * click, so this module wires exactly that real contract rather than inventing an
 * edit UI the design never specified.
 */
export function usePatchSlaPolicy() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: number; body?: Record<string, unknown> }) => {
      const res = await fetchWithAuth(`/api/msp/sla/policies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      return parseJsonOrThrow<{ ok?: true; id?: number; override?: boolean }>(res);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: K.slaPolicies }),
  });
}

export function useDeactivateSlaPolicy() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetchWithAuth(`/api/msp/sla/policies/${id}`, { method: "DELETE" });
      return parseJsonOrThrow<{ ok?: true; id?: number; override?: boolean }>(res);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: K.slaPolicies }),
  });
}

export function usePatchScopeCreepPolicy() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: number; body?: Record<string, unknown> }) => {
      const res = await fetchWithAuth(`/api/msp/scope-creep/policies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      return parseJsonOrThrow<{ ok?: true; id?: number; override?: boolean }>(res);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: K.scopePolicies }),
  });
}

export function useDeactivateScopeCreepPolicy() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetchWithAuth(`/api/msp/scope-creep/policies/${id}`, { method: "DELETE" });
      return parseJsonOrThrow<{ ok?: true; id?: number; override?: boolean }>(res);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: K.scopePolicies }),
  });
}
