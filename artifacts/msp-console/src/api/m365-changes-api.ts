/**
 * m365-changes-api.ts — the data seam for the MSP Console's Microsoft Changes
 * module (Git #2600, part of Feature #1688). Wires the real, already-shipped
 * interpret -> resolve -> route pipeline (`artifacts/api-server/src/routes/
 * admin-m365-interpretations.ts`, #1532/#1533/#1534/#1701) — no backend work
 * was needed for this build: all 12 routes already exist and are already
 * gated to `requireCapability("ladder.msp-operator")` (admits MSPOperator,
 * MSPAdmin, PlatformAdmin per #4086), so this module calls them directly.
 *
 * #1688's 2026-09-12 decision: interpretation authoring lives in the MSP
 * Console, not AdminV2 — this overrides #1678's own closing recommendation.
 * Scope carried over from that decision: author the interpretation once per
 * announcement (applied to every tenant), review the resolution's
 * affected-object counts, review/override the routing decision, and handle
 * the propose branch where the gate did not auto-create.
 *
 *   GET    /api/admin/m365/interpretations             — the library (+ counts)
 *   GET    /api/admin/m365/interpretations/candidates   — un-interpreted sources
 *   POST   /api/admin/m365/interpretations/propose      — AI proposes (unsaved)
 *   POST   /api/admin/m365/interpretations              — create (default 'proposed')
 *   PATCH  /api/admin/m365/interpretations/:id          — edit fields
 *   POST   /api/admin/m365/interpretations/:id/confirm  — 'proposed' -> 'confirmed'
 *   POST   /api/admin/m365/interpretations/:id/reject   — 'proposed' -> 'rejected'
 *   DELETE /api/admin/m365/interpretations/:id          — remove one
 *   POST   /api/admin/m365/interpretations/:id/resolve  — run the count per tenant
 *   GET    /api/admin/m365/interpretations/:id/resolutions — stored per-tenant counts
 *   POST   /api/admin/m365/interpretations/:id/route    — fire the routing sweep
 *   GET    /api/admin/m365/interpretations/:id/routings — stored per-tenant decisions
 *
 * No fixture module, no fabricated row — every value here comes from a real
 * server response.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export const M365_CHANGE_CLASSES = ["retirement", "default_flip", "new_feature", "breaking_change", "licensing"] as const;
export type M365ChangeClass = (typeof M365_CHANGE_CLASSES)[number];

export const M365_INTERPRETATION_STATUSES = ["proposed", "confirmed", "rejected"] as const;
export type M365InterpretationStatus = (typeof M365_INTERPRETATION_STATUSES)[number];

export const M365_ACTORS = ["microsoft", "admin"] as const;
export type M365Actor = (typeof M365_ACTORS)[number];

export const M365_CONTROLLABILITY = ["yes", "no", "unknown"] as const;
export type M365Controllability = (typeof M365_CONTROLLABILITY)[number];

export interface M365Touches {
  services: string[];
  protocols: string[];
  skus: string[];
  settings: string[];
}

export interface M365Probe {
  description: string;
  monitorCheckKey?: string | null;
  powershell?: string | null;
  graphEndpoint?: string | null;
}

/** Real shape of `toWire` in `admin-m365-interpretations.ts`. */
export interface M365Interpretation {
  readonly id: number;
  readonly mspId: number;
  readonly featureId: string | null;
  readonly graphMessageId: string | null;
  readonly sourceKind: "roadmap" | "message_center" | "manual";
  readonly title: string;
  readonly summary: string | null;
  readonly changeClass: M365ChangeClass;
  readonly touches: M365Touches;
  readonly whoActs: M365Actor;
  readonly controllable: M365Controllability;
  readonly controlMethod: string | null;
  readonly probe: M365Probe;
  readonly status: M365InterpretationStatus;
  readonly proposedBy: "ai" | "human";
  readonly aiModel: string | null;
  readonly aiRationale: string | null;
  readonly confirmedBy: string | null;
  readonly confirmedAt: string | null;
  readonly notes: string | null;
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface M365InterpretationCounts {
  proposed: number;
  confirmed: number;
  rejected: number;
  total: number;
}

export interface RoadmapCandidate {
  featureId: string;
  title: string;
  status: string | null;
  products: string[];
  cloudInstances: string[];
  msModified: string | null;
  crossedOver?: boolean;
}

export interface MessageCenterCandidate {
  graphMessageId: string;
  title: string;
  category: string | null;
  isMajorChange: boolean;
  services: string[];
  roadmapFeatureIds: string[];
  lastModifiedDateTime: string | null;
}

export interface M365ProposedReading {
  changeClass: M365ChangeClass;
  summary: string;
  touches: M365Touches;
  whoActs: M365Actor;
  controllable: M365Controllability;
  controlMethod: string | null;
  probe: M365Probe;
  aiModel?: string;
  aiRationale?: string;
}

export const M365_RESOLUTION_STATUSES = ["measured", "not_measured", "error"] as const;
export type M365ResolutionStatus = (typeof M365_RESOLUTION_STATUSES)[number];

export interface M365ResolutionRow {
  customerId: number;
  tenantName: string;
  status: M365ResolutionStatus;
  affectedCount: number | null;
  basis: "monitor_check" | "license_snapshot" | null;
  basisDetail: Record<string, unknown>;
  errorMessage: string | null;
  measuredAt: string | null;
}

export interface M365StoredResolutionRow extends M365ResolutionRow {
  id: number;
  updatedAt: string;
}

export const M365_ROUTING_DECISIONS = ["auto_created", "proposed", "declined_risk", "none"] as const;
export type M365RoutingDecision = (typeof M365_ROUTING_DECISIONS)[number];

export interface M365RoutingRow {
  id: number;
  customerId: number;
  tenantName: string;
  decision: M365RoutingDecision;
  reason: string;
  intake: string | null;
  affectedCount: number | null;
  hasStructuralDate: boolean;
  changeRequestId: number | null;
  changeRequestCode: string | null;
  riskDecisionId: number | null;
  routedAt: string | null;
  updatedAt: string;
}

/** A fetch that failed reports its real HTTP status so callers can branch on
 * 404/409/etc, same pattern as `status-reports-api.ts`'s `StatusReportsApiError`.
 * The module itself never prints `status` verbatim to the operator (#4147's
 * no-dev-chrome standard) — this is for control flow, not display. */
export class M365ChangesApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.clone().json()) as { error?: string; details?: unknown };
      if (body?.error) message = body.error;
      throw new M365ChangesApiError(res.status, message, body?.details);
    } catch (err) {
      if (err instanceof M365ChangesApiError) throw err;
      throw new M365ChangesApiError(res.status, message);
    }
  }
  return (await res.json()) as T;
}

const BASE = "/api/admin/m365/interpretations";
const listKey = ["msp", "m365-interpretations"] as const;
const candidatesKey = (cloud: string) => ["msp", "m365-interpretations", "candidates", cloud] as const;
const resolutionsKey = (id: number) => ["msp", "m365-interpretations", id, "resolutions"] as const;
const routingsKey = (id: number) => ["msp", "m365-interpretations", id, "routings"] as const;

function invalidateAll(queryClient: ReturnType<typeof useQueryClient>, id?: number) {
  void queryClient.invalidateQueries({ queryKey: listKey });
  void queryClient.invalidateQueries({ queryKey: ["msp", "m365-interpretations", "candidates"] });
  if (id !== undefined) {
    void queryClient.invalidateQueries({ queryKey: resolutionsKey(id) });
    void queryClient.invalidateQueries({ queryKey: routingsKey(id) });
  }
}

export interface InterpretationsListResponse {
  mspId: number | null;
  interpretations: M365Interpretation[];
  counts: M365InterpretationCounts;
  noMsp?: boolean;
}

export function useInterpretationsList(): UseQueryResult<InterpretationsListResponse, M365ChangesApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: listKey,
    queryFn: async () => {
      const res = await fetchWithAuth(BASE);
      return parseJsonOrThrow<InterpretationsListResponse>(res);
    },
    enabled: !isLoading && !!accessToken,
    staleTime: 10_000,
  });
}

export type CloudMode = "worldwide" | "gov" | "all";

export interface CandidatesResponse {
  roadmap: RoadmapCandidate[];
  messageCenter: MessageCenterCandidate[];
  cloudMode: string;
  noMsp?: boolean;
}

export function useCandidates(cloud: CloudMode = "worldwide"): UseQueryResult<CandidatesResponse, M365ChangesApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: candidatesKey(cloud),
    queryFn: async () => {
      const res = await fetchWithAuth(`${BASE}/candidates?cloud=${cloud}`);
      return parseJsonOrThrow<CandidatesResponse>(res);
    },
    enabled: !isLoading && !!accessToken,
    staleTime: 30_000,
  });
}

export function useProposeInterpretation() {
  const { fetchWithAuth } = useAuth();
  return useMutation({
    mutationFn: async (source: { featureId?: string; graphMessageId?: string }) => {
      const res = await fetchWithAuth(`${BASE}/propose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(source),
      });
      return parseJsonOrThrow<{
        sourceKind: "roadmap" | "message_center";
        featureId: string | null;
        graphMessageId: string | null;
        title: string;
        proposal: M365ProposedReading;
      }>(res);
    },
  });
}

export interface CreateInterpretationInput {
  featureId?: string | null;
  graphMessageId?: string | null;
  sourceKind: "roadmap" | "message_center" | "manual";
  title: string;
  summary?: string | null;
  changeClass: M365ChangeClass;
  touches?: M365Touches;
  whoActs: M365Actor;
  controllable: M365Controllability;
  controlMethod?: string | null;
  probe?: M365Probe;
  proposedBy: "ai" | "human";
  aiModel?: string | null;
  aiRationale?: string | null;
  notes?: string | null;
  status?: M365InterpretationStatus;
}

export function useCreateInterpretation() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateInterpretationInput) => {
      const res = await fetchWithAuth(BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      return parseJsonOrThrow<{ interpretation: M365Interpretation }>(res);
    },
    onSuccess: () => invalidateAll(queryClient),
  });
}

export type PatchInterpretationInput = Partial<
  Pick<CreateInterpretationInput, "title" | "summary" | "changeClass" | "touches" | "whoActs" | "controllable" | "controlMethod" | "probe" | "notes">
>;

export function usePatchInterpretation() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: number; input: PatchInterpretationInput }) => {
      const res = await fetchWithAuth(`${BASE}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      return parseJsonOrThrow<{ interpretation: M365Interpretation }>(res);
    },
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useConfirmInterpretation() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetchWithAuth(`${BASE}/${id}/confirm`, { method: "POST" });
      return parseJsonOrThrow<{ interpretation: M365Interpretation }>(res);
    },
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useRejectInterpretation() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetchWithAuth(`${BASE}/${id}/reject`, { method: "POST" });
      return parseJsonOrThrow<{ interpretation: M365Interpretation }>(res);
    },
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useDeleteInterpretation() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
      return parseJsonOrThrow<{ ok: true; id: number }>(res);
    },
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useResolveInterpretation() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, customerId, live }: { id: number; customerId?: number; live?: boolean }) => {
      const res = await fetchWithAuth(`${BASE}/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, live: live ?? true }),
      });
      return parseJsonOrThrow<{ interpretationId: number; results: M365ResolutionRow[] }>(res);
    },
    onSuccess: (_data, vars) => invalidateAll(queryClient, vars.id),
  });
}

export interface ResolutionsResponse {
  interpretationId: number;
  resolutions: M365StoredResolutionRow[];
}

export function useResolutions(id: number | null): UseQueryResult<ResolutionsResponse, M365ChangesApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: resolutionsKey(id ?? -1),
    queryFn: async () => {
      const res = await fetchWithAuth(`${BASE}/${id}/resolutions`);
      return parseJsonOrThrow<ResolutionsResponse>(res);
    },
    enabled: !isLoading && !!accessToken && id !== null,
    staleTime: 10_000,
  });
}

export function useRouteInterpretation() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetchWithAuth(`${BASE}/${id}/route`, { method: "POST" });
      return parseJsonOrThrow<{ interpretationId: number; runId: string; status: "queued" }>(res);
    },
    onSuccess: (_data, id) => invalidateAll(queryClient, id),
  });
}

export interface RoutingsResponse {
  interpretationId: number;
  routings: M365RoutingRow[];
}

export function useRoutings(id: number | null): UseQueryResult<RoutingsResponse, M365ChangesApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: routingsKey(id ?? -1),
    queryFn: async () => {
      const res = await fetchWithAuth(`${BASE}/${id}/routings`);
      return parseJsonOrThrow<RoutingsResponse>(res);
    },
    enabled: !isLoading && !!accessToken && id !== null,
    staleTime: 10_000,
  });
}
