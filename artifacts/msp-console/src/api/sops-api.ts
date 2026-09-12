/**
 * Live data for the SOPs Operations page (#2597). Two real tables back this
 * screen — `msp_sops` (the authored, versioned procedure library) and
 * `msp_sop_runs` (every run fired against a customer's tenant, whatever
 * invoked it) — both served by `artifacts/api-server/src/routes/msp-sops.ts`.
 * Every value rendered by the page comes from one of these responses; no
 * fixtures.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

async function apiFetch<T>(
  fetchWithAuth: (i: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetchWithAuth(url, init);
  if (!res.ok) {
    let body: unknown;
    try { body = await res.json(); } catch { /* not json */ }
    const message = (body as { error?: string } | undefined)?.error ?? `Request failed: ${res.status}`;
    const err = new Error(message) as Error & { status?: number; code?: string };
    err.status = res.status;
    err.code = (body as { code?: string } | undefined)?.code;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ── SOP definitions (library) ────────────────────────────────────────────────

export type SopAutomationType = "automated" | "hybrid" | "manual";

export interface SopStep {
  stepNumber: number;
  title: string;
  description: string;
  type: "manual" | "automated";
  actionId?: string;
  graphEndpoint?: string;
  payloadTemplate?: string;
  status?: "pending" | "running" | "success" | "failed";
  executedAt?: string;
  verifiedBy?: string;
}

export interface Sop {
  id: number;
  mspId: number;
  sopId: string;
  code: string;
  title: string;
  description: string;
  category: string;
  version: string;
  automationType: SopAutomationType;
  estimatedMinutes: number;
  complianceTags: string[];
  workloadTags: string[];
  steps: SopStep[];
  lastUpdatedBy: string;
  lastUpdatedAt: string;
  versionStatus: string;
  createdAt: string;
  updatedAt: string;
}

export function useSops(): UseQueryResult<Sop[], Error> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["msp", "sops"],
    queryFn: () => apiFetch<Sop[]>(fetchWithAuth, "/api/msp/sops"),
    enabled: !isLoading && !!accessToken,
    staleTime: 15_000,
  });
}

export interface CreateSopInput {
  sopId: string;
  code: string;
  title: string;
  description: string;
  category: string;
  version: string;
  automationType: SopAutomationType;
  estimatedMinutes: number;
  complianceTags: string[];
  workloadTags: string[];
  steps: SopStep[];
  versionStatus: string;
}

export function useCreateSop() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSopInput) =>
      apiFetch<{ id: number; sopId: string; message: string }>(fetchWithAuth, "/api/msp/sops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["msp", "sops"] }); },
  });
}

export type UpdateSopInput = Partial<Omit<CreateSopInput, "sopId">>;

export function useUpdateSop() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sopId, patch }: { sopId: string; patch: UpdateSopInput }) =>
      apiFetch<{ sopId: string; message: string }>(fetchWithAuth, `/api/msp/sops/${encodeURIComponent(sopId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["msp", "sops"] }); },
  });
}

// ── SOP runs (run history) ───────────────────────────────────────────────────

export interface SopRun {
  id: number;
  mspId: number;
  runId: string;
  sopId: string;
  sopTitle: string;
  tenantId: string;
  tenantName: string;
  targetEntity: string;
  operator: string;
  origin: "policy" | "lifecycle" | "remediation" | "manual";
  standingPolicyId: number | null;
  sopVersion: string;
  startedAt: string;
  completedAt: string | null;
  status: string;
  currentStepIndex: number;
  totalSteps: number;
  passedStepsCount: number;
  psaTicketId: string;
  logs: string[];
  wfRunId: number | null;
}

export function useSopRuns(): UseQueryResult<SopRun[], Error> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["msp", "sop-runs"],
    queryFn: () => apiFetch<SopRun[]>(fetchWithAuth, "/api/msp/sop-runs"),
    enabled: !isLoading && !!accessToken,
    staleTime: 15_000,
  });
}

// ── Run a SOP against a customer ─────────────────────────────────────────────

export interface RunSopInput {
  sopId: string;
  customerId: number;
  targetEntity?: string;
  variables?: Record<string, string>;
  changeRequestId?: number;
}

export interface RunSopResult {
  id: number;
  runId: string;
  wfRunId: number | null;
  definitionId: string | null;
  versionId: string | null;
  reusedVersion: boolean;
  sopId: string;
  customerId: number;
  automatedStepCount: number;
  totalSteps: number;
  authorizingChangeRequestId: number | null;
}

export function useRunSop() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sopId, ...body }: RunSopInput) =>
      apiFetch<RunSopResult>(fetchWithAuth, `/api/msp/sops/${encodeURIComponent(sopId)}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["msp", "sop-runs"] }); },
  });
}
