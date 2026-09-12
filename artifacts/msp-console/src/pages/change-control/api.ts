/**
 * Change Control (#2579) — every real endpoint the module's seven tabs read
 * and write, per `github.md`'s screen map: `msp-changes.ts`,
 * `msp-evidence-attachments.ts`, `msp-change-catalog.ts`,
 * `msp-change-control-cab.ts`, `msp-change-freeze-windows.ts`,
 * `msp-change-maintenance-windows.ts`, `msp-change-dependencies.ts`,
 * `msp-change-executions.ts`, `msp-change-pir.ts`.
 *
 * Nothing here is tenant-scoped server-side except the two per-CR routes
 * (timeline, dependencies-by-id) and the evidence uploads — the rest return
 * this MSP's WHOLE book and are filtered to the selected tenant client-side,
 * the same "arrives whole, filtered client-side" discipline the Tenant
 * Overview roll-up already documents for the risk register (`github.md`,
 * "Last sync"). `filterByTenant` below is that filter, applied consistently.
 *
 * The Standard Catalog and the Change Advisory Board are deliberately NOT
 * tenant-filtered: a catalog item is an MSP-wide "approve once, execute many"
 * authorization, and a CAB meeting is one board whose agenda can carry items
 * from several tenants in the same sitting (see the design's own CAB screen).
 * Filtering either to "this tenant only" would misrepresent what they are.
 */
import { useMutation, useQuery, useQueryClient, useQueries, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import type { DirectoryCustomer } from "@/api/console-api";

// ── Fetch helpers ────────────────────────────────────────────────────────────

type FetchWithAuth = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    let details: unknown;
    try {
      const body = await res.json();
      details = body;
      if (typeof body?.error === "string") message = body.error;
    } catch { /* non-JSON error body */ }
    throw new ApiError(res.status, message, details);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function getJson<T>(fw: FetchWithAuth, url: string, signal?: AbortSignal): Promise<T> {
  return unwrap<T>(await fw(url, { method: "GET", signal }));
}
async function postJson<T>(fw: FetchWithAuth, url: string, body?: unknown): Promise<T> {
  return unwrap<T>(await fw(url, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }));
}
async function patchJson<T>(fw: FetchWithAuth, url: string, body?: unknown): Promise<T> {
  return unwrap<T>(await fw(url, { method: "PATCH", body: body === undefined ? undefined : JSON.stringify(body) }));
}
async function deleteReq(fw: FetchWithAuth, url: string): Promise<void> {
  await unwrap<void>(await fw(url, { method: "DELETE" }));
}

/** True once auth is resolved and there is a token to attach — the shared `enabled` gate every hook below uses. */
function useReady(): boolean {
  const { isLoading, accessToken } = useAuth();
  return !isLoading && !!accessToken;
}

/** The M365 tenant identifier a `DirectoryCustomer` carries — what every wire row below is filtered against. */
export function tenantKeyOf(customer: DirectoryCustomer | undefined): string | null {
  return customer?.tenantId ?? null;
}

export function filterByTenant<T extends { tenantId: string }>(rows: readonly T[], tenantKey: string | null): T[] {
  if (tenantKey === null) return [];
  return rows.filter((r) => r.tenantId === tenantKey);
}

// ── Approvals (shared shape, #1496) ──────────────────────────────────────────

export type CrApprovalDecision = "pending" | "approved" | "rejected" | "superseded";
export type CrApproverRole = "customer" | "msp" | "catalog_inherited" | "microsoft_forced";

export interface WireApprovalRecord {
  readonly stage: number;
  readonly decision: CrApprovalDecision;
  readonly approverRole: CrApproverRole;
  readonly approverName: string | null;
  readonly approverPersonId: string | null;
  readonly onBehalfOfPersonId: string | null;
  readonly reason: string | null;
  readonly decidedAt: string | null;
  readonly dueAt: string | null;
  readonly breached: boolean;
  readonly escalatedAt: string | null;
}

// ── Register (`msp-changes.ts`) ──────────────────────────────────────────────

export type ChangeClass = "standard" | "normal" | "emergency";
export type RiskLevel = "critical" | "high" | "medium" | "low";
export type ChangeCategory = "ConditionalAccess" | "Exchange" | "Identity" | "Intune" | "Defender" | "SharePoint" | "Purview" | "Teams";
export type ChangeStatus = "pending_approval" | "scheduled" | "in_progress" | "completed" | "rolled_back" | "rejected";

export interface WireChangeRequest {
  readonly id: string; // formatted CR-2026-XXX
  readonly mspId: number;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly primaryDomain: string;
  readonly title: string;
  readonly description: string;
  readonly changeClass: ChangeClass;
  readonly riskLevel: RiskLevel;
  readonly category: ChangeCategory;
  readonly targetResource: string;
  readonly psaTicketId: string;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly scheduledFor: string;
  readonly scheduledStart: string | null;
  readonly scheduledEnd: string | null;
  readonly impactedUsersCount: number;
  readonly status: ChangeStatus;
  readonly backupVerified: boolean;
  readonly authorizedTargetKey: string | null;
  readonly linkedFinding: string | null;
  readonly executedAt: string | null;
  readonly approvedBy: string | null;
  readonly createdAt: string;
  readonly approvals: WireApprovalRecord[];
}

function numericIdOf(code: string): number {
  const m = code.match(/^CR-2026-(\d+)$/);
  return m ? parseInt(m[1], 10) - 100 : NaN;
}

export function useChangeRequests(): UseQueryResult<WireChangeRequest[], Error> {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: ["msp", "change-requests"],
    queryFn: ({ signal }) => getJson<WireChangeRequest[]>(fetchWithAuth, "/api/msp/change-requests", signal),
    enabled: useReady(),
    staleTime: 15_000,
  });
}

export interface CreateChangeRequestInput {
  tenantId: string;
  tenantName: string;
  primaryDomain: string;
  title: string;
  description: string;
  changeClass: ChangeClass;
  riskLevel: RiskLevel;
  category: ChangeCategory;
  targetResource: string;
  psaTicketId: string;
  scheduledFor: string;
  impactedUsersCount: number;
  preChangeSnapshot: Record<string, unknown>;
  proposedPayload: Record<string, unknown>;
  rollbackScriptSnippet: string;
  freezeException?: { justification: string };
}

export function useCreateChangeRequest() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateChangeRequestInput) =>
      postJson<{ id: string; message: string; freezeException: boolean }>(fetchWithAuth, "/api/msp/change-requests", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["msp", "change-requests"] }),
  });
}

export function usePatchChangeRequest() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, reason }: { id: string; status: ChangeStatus; reason?: string }) =>
      patchJson<{ id: string; message: string }>(fetchWithAuth, `/api/msp/change-requests/${id}`, { status, reason }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["msp", "change-requests"] });
      qc.invalidateQueries({ queryKey: ["msp", "change-requests", vars.id, "timeline"] });
    },
  });
}

export interface WireCrTimeline {
  readonly id: string;
  readonly events: {
    eventType: string; fromValue: string | null; toValue: string; stage: number | null;
    actorRole: string; actorName: string | null; reason: string | null; occurredAt: string;
  }[];
  readonly comments: { authorRole: string; authorName: string; body: string; createdAt: string }[];
  readonly attachments: {
    kind: string; label: string; externalUrl: string | null; mimeType: string | null;
    sizeBytes: number | null; uploadedByRole: string; uploadedByName: string; createdAt: string;
  }[];
}

export function useCrTimeline(id: string | null) {
  const { fetchWithAuth } = useAuth();
  const ready = useReady();
  return useQuery({
    queryKey: ["msp", "change-requests", id, "timeline"],
    queryFn: ({ signal }) => getJson<WireCrTimeline>(fetchWithAuth, `/api/msp/change-requests/${id}/timeline`, signal),
    enabled: ready && id !== null,
    staleTime: 10_000,
  });
}

export function usePostCrComment() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      postJson(fetchWithAuth, `/api/msp/change-requests/${id}/comments`, { body }),
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["msp", "change-requests", vars.id, "timeline"] }),
  });
}

// ── Standard Catalog (`msp-change-catalog.ts`) ───────────────────────────────

export type CatalogItemStatus = "draft" | "approved" | "revoked";

export interface WireChangeCatalogItem {
  readonly id: number;
  readonly packKey: string;
  readonly packLabel: string;
  readonly packStatus: string;
  readonly title: string;
  readonly description: string;
  readonly category: ChangeCategory;
  readonly riskLevel: RiskLevel;
  readonly status: CatalogItemStatus;
  readonly approvedByName: string | null;
  readonly approvedAt: string | null;
  readonly revokedByName: string | null;
  readonly revokedAt: string | null;
  readonly revokedReason: string | null;
  readonly createdByName: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function useChangeCatalog() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: ["msp", "change-catalog"],
    queryFn: ({ signal }) => getJson<{ items: WireChangeCatalogItem[] }>(fetchWithAuth, "/api/msp/change-catalog", signal),
    enabled: useReady(),
    staleTime: 15_000,
  });
}

export function useApproveCatalogItem() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => postJson<{ }>(fetchWithAuth, `/api/msp/change-catalog/${id}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["msp", "change-catalog"] }),
  });
}

export function useRevokeCatalogItem() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      postJson(fetchWithAuth, `/api/msp/change-catalog/${id}/revoke`, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["msp", "change-catalog"] }),
  });
}

// ── CAB (`msp-change-control-cab.ts`) ────────────────────────────────────────

export type CabMeetingType = "cab" | "ecab";
export type CabMeetingStatus = "scheduled" | "in_progress" | "completed" | "cancelled";
export type CabAgendaRecommendation = "approve" | "reject" | "defer";
export type CabMemberRole = "chair" | "voting" | "advisory" | "secretary";
export type CabMemberSide = "msp" | "customer";

export interface AgendaSummary {
  readonly total: number; readonly approved: number; readonly rejected: number;
  readonly deferred: number; readonly undecided: number; readonly retroactive: number;
}

export interface WireCabMeeting {
  readonly id: number;
  readonly meetingType: CabMeetingType;
  readonly status: CabMeetingStatus;
  readonly scheduledFor: string;
  readonly heldAt: string | null;
  readonly closedAt: string | null;
  readonly chairPersonId: string | null;
  readonly chairName: string;
  readonly location: string;
  readonly notes: string;
  readonly minutes: string;
  readonly agendaSummary: AgendaSummary;
}

export interface WireCabAgendaItem {
  readonly id: number;
  readonly changeRequestId: number;
  readonly changeCode: string;
  readonly changeTitle: string;
  readonly tenantId: string;
  readonly ordinal: number;
  readonly presenterName: string;
  readonly discussionNotes: string;
  readonly recommendation: CabAgendaRecommendation | null;
  readonly decidedAt: string | null;
  readonly crApprovalId: number | null;
  readonly isRetroactive: boolean;
  readonly deferredToMeetingId: number | null;
}

export interface WireCabMember {
  readonly id: number;
  readonly personId: string;
  readonly name: string;
  readonly email: string;
  readonly role: CabMemberRole;
  readonly side: CabMemberSide;
  readonly tenantId: string | null;
  readonly isEcab: boolean;
  readonly active: boolean;
  readonly addedAt: string;
  readonly removedAt: string | null;
}

export function useCabMeetings() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: ["msp", "cab", "meetings"],
    queryFn: ({ signal }) => getJson<{ meetings: WireCabMeeting[] }>(fetchWithAuth, "/api/msp/change-control/cab/meetings", signal),
    enabled: useReady(),
    staleTime: 10_000,
  });
}

export interface WireCabMeetingDetail {
  meeting: WireCabMeeting;
  agenda: WireCabAgendaItem[];
}

/** One detail fetch per open (scheduled/in_progress) meeting — the list route above has no agenda, only its summary. */
export function useCabMeetingDetails(meetingIds: number[]) {
  const { fetchWithAuth } = useAuth();
  const ready = useReady();
  return useQueries({
    queries: meetingIds.map((id) => ({
      queryKey: ["msp", "cab", "meeting", id],
      queryFn: () => getJson<WireCabMeetingDetail>(fetchWithAuth, `/api/msp/change-control/cab/meetings/${id}`),
      enabled: ready,
      staleTime: 10_000,
    })),
  });
}

export function useCabMembers() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: ["msp", "cab", "members"],
    queryFn: ({ signal }) => getJson<{ members: WireCabMember[] }>(fetchWithAuth, "/api/msp/change-control/cab/members", signal),
    enabled: useReady(),
    staleTime: 30_000,
  });
}

function useCabInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["msp", "cab"] });
    qc.invalidateQueries({ queryKey: ["msp", "change-requests"] });
  };
}

export function useCabDecision() {
  const { fetchWithAuth } = useAuth();
  const invalidate = useCabInvalidate();
  return useMutation({
    mutationFn: ({ agendaItemId, decision, note }: { agendaItemId: number; decision: "approve" | "reject"; note?: string }) =>
      postJson<{ item: WireCabAgendaItem; complete: boolean }>(
        fetchWithAuth, `/api/msp/change-control/cab/agenda/${agendaItemId}/decision`, { decision, note: note ?? "" },
      ),
    onSuccess: invalidate,
  });
}

export function useCabDefer() {
  const { fetchWithAuth } = useAuth();
  const invalidate = useCabInvalidate();
  return useMutation({
    mutationFn: ({ agendaItemId, deferredToMeetingId }: { agendaItemId: number; deferredToMeetingId: number | null }) =>
      postJson(fetchWithAuth, `/api/msp/change-control/cab/agenda/${agendaItemId}/defer`, { deferredToMeetingId }),
    onSuccess: invalidate,
  });
}

export function useCloseCabMeeting() {
  const { fetchWithAuth } = useAuth();
  const invalidate = useCabInvalidate();
  return useMutation({
    mutationFn: (meetingId: number) => postJson(fetchWithAuth, `/api/msp/change-control/cab/meetings/${meetingId}/close`),
    onSuccess: invalidate,
  });
}

export function useStartCabMeeting() {
  const { fetchWithAuth } = useAuth();
  const invalidate = useCabInvalidate();
  return useMutation({
    mutationFn: (meetingId: number) => postJson(fetchWithAuth, `/api/msp/change-control/cab/meetings/${meetingId}/start`),
    onSuccess: invalidate,
  });
}

// ── Freeze / maintenance windows ─────────────────────────────────────────────

export type WindowScope = "global" | "tenant" | "workload";
export type WindowRecurrence = "none" | "weekly" | "monthly" | "quarterly" | "annually";

export interface WireWindow {
  readonly id: number;
  readonly scope: WindowScope;
  readonly tenantId: string | null;
  readonly workload: string | null;
  readonly name: string;
  readonly reason: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly recurrence: WindowRecurrence;
  readonly recurrenceUntil: string | null;
  readonly active: boolean;
  readonly createdBy: string | null;
  readonly createdAt: string;
}

export function useFreezeWindows() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: ["msp", "freeze-windows"],
    queryFn: ({ signal }) => getJson<{ windows: WireWindow[] }>(fetchWithAuth, "/api/msp/change-freeze-windows", signal),
    enabled: useReady(),
    staleTime: 30_000,
  });
}

export function useMaintenanceWindows() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: ["msp", "maintenance-windows"],
    queryFn: ({ signal }) => getJson<{ windows: WireWindow[] }>(fetchWithAuth, "/api/msp/change-maintenance-windows", signal),
    enabled: useReady(),
    staleTime: 30_000,
  });
}

/** A window belongs on a tenant's page when it is global, workload-wide, or scoped to this exact tenant. */
export function windowAppliesToTenant(w: WireWindow, tenantKey: string | null): boolean {
  if (w.scope !== "tenant") return true;
  return w.tenantId === tenantKey;
}

export function useRetireFreezeWindow() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => patchJson(fetchWithAuth, `/api/msp/change-freeze-windows/${id}`, { active: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["msp", "freeze-windows"] }),
  });
}

export function useRetireMaintenanceWindow() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => patchJson(fetchWithAuth, `/api/msp/change-maintenance-windows/${id}`, { active: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["msp", "maintenance-windows"] }),
  });
}

// ── Dependencies (`msp-change-dependencies.ts`) ──────────────────────────────

export interface WireDependency {
  readonly id: number;
  readonly blockedChangeRequestId: number;
  readonly blockedChangeCode: string;
  readonly blockedTitle: string;
  readonly blockerChangeRequestId: number;
  readonly blockerChangeCode: string;
  readonly blockerTitle: string;
  readonly blockerStatus: string;
  readonly note: string | null;
  readonly createdBy: string | null;
  readonly createdAt: string;
}

export function useDependencies(tenantKey: string | null) {
  const { fetchWithAuth } = useAuth();
  const ready = useReady();
  return useQuery({
    queryKey: ["msp", "change-control", "dependencies", tenantKey],
    queryFn: ({ signal }) => {
      const qs = tenantKey ? `?tenantId=${encodeURIComponent(tenantKey)}` : "";
      return getJson<{ dependencies: WireDependency[] }>(fetchWithAuth, `/api/msp/change-control/dependencies${qs}`, signal);
    },
    enabled: ready && tenantKey !== null,
    staleTime: 15_000,
  });
}

export function useRemoveDependency() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ blockedChangeCode, dependencyId }: { blockedChangeCode: string; dependencyId: number }) =>
      deleteReq(fetchWithAuth, `/api/msp/change-requests/${blockedChangeCode}/dependencies/${dependencyId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["msp", "change-control", "dependencies"] }),
  });
}

// ── Executions (`msp-change-executions.ts`, `msp-evidence-attachments.ts`) ──

export type CrExecutorKind = "runbook_run" | "write_action" | "human_action";
export type CrExecutionOutcome = "pending" | "succeeded" | "failed";
export type CrRollbackOutcome = "pending" | "verified" | "failed";
export type ChangeRequestImplementer = "microsoft" | "customer" | "msp";

export interface WireCrExecution {
  readonly id: number;
  readonly changeRequestId: number;
  readonly changeCode: string;
  readonly tenantId: string;
  readonly executorKind: CrExecutorKind;
  readonly wfRunId: number | null;
  readonly packKey: string | null;
  readonly implementer: ChangeRequestImplementer | null;
  readonly outcome: CrExecutionOutcome;
  readonly confirmed: boolean;
  readonly plannedPlan: unknown;
  readonly actualOutcome: unknown;
  readonly planMatched: boolean | null;
  readonly planDiff: unknown;
  readonly crRef: string | null;
  readonly writtenBackAt: string | null;
  readonly attestedBy: string | null;
  readonly attestedByPersonId: string | null;
  readonly attestedAt: string | null;
  readonly attestationNote: string | null;
  readonly rollbackVerifiedAt: string | null;
  readonly rollbackOutcome: CrRollbackOutcome | null;
  readonly executedAt: string | null;
  readonly createdAt: string;
}

export function useExecutions() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: ["msp", "change-control", "executions"],
    queryFn: ({ signal }) => getJson<{ executions: WireCrExecution[] }>(fetchWithAuth, "/api/msp/change-control/executions", signal),
    enabled: useReady(),
    staleTime: 15_000,
  });
}

function useExecutionsInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["msp", "change-control", "executions"] });
    qc.invalidateQueries({ queryKey: ["msp", "change-requests"] });
  };
}

export function useAttestExecution() {
  const { fetchWithAuth } = useAuth();
  const invalidate = useExecutionsInvalidate();
  return useMutation({
    mutationFn: ({ id, attestationNote }: { id: number; attestationNote?: string }) =>
      postJson<{ execution: WireCrExecution }>(fetchWithAuth, `/api/msp/change-control/executions/${id}/attest`, { attestationNote }),
    onSuccess: invalidate,
  });
}

export function useRaiseRollback() {
  const { fetchWithAuth } = useAuth();
  const invalidate = useExecutionsInvalidate();
  return useMutation({
    mutationFn: (changeRequestId: number) =>
      postJson<{ inverseChangeRequestId: number; inverseChangeCode: string }>(
        fetchWithAuth, `/api/msp/change-control/change-requests/${changeRequestId}/rollback`,
      ),
    onSuccess: invalidate,
  });
}

export interface WireEvidenceAttachment {
  readonly id: number;
  readonly source: "remediation_tracker" | "change_control";
  readonly sourceRefId: number;
  readonly url: string;
  readonly originalFilename: string | null;
  readonly contentType: string | null;
  readonly fileSizeBytes: number | null;
  readonly caption: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly capturedAt: string;
  readonly uploadedByPersonId: string | null;
  readonly createdAt: string;
}

/** One evidence-list fetch per visible execution — bounded (a tenant's own execution history), same pattern as `useCabMeetingDetails`. */
export function useExecutionsEvidence(executionIds: number[]) {
  const { fetchWithAuth } = useAuth();
  const ready = useReady();
  return useQueries({
    queries: executionIds.map((id) => ({
      queryKey: ["msp", "change-control", "executions", id, "evidence"],
      queryFn: () => getJson<{ attachments: WireEvidenceAttachment[] }>(fetchWithAuth, `/api/msp/change-control/executions/${id}/evidence`),
      enabled: ready,
      staleTime: 15_000,
    })),
  });
}

export function useExecutionEvidence(executionId: number | null) {
  const { fetchWithAuth } = useAuth();
  const ready = useReady();
  return useQuery({
    queryKey: ["msp", "change-control", "executions", executionId, "evidence"],
    queryFn: ({ signal }) =>
      getJson<{ attachments: WireEvidenceAttachment[] }>(fetchWithAuth, `/api/msp/change-control/executions/${executionId}/evidence`, signal),
    enabled: ready && executionId !== null,
    staleTime: 15_000,
  });
}

export function useCaptureExecutionEvidence() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ executionId, file, caption }: { executionId: number; file: File; caption?: string }) => {
      const form = new FormData();
      form.append("file", file);
      if (caption) form.append("caption", caption);
      return unwrap<{ attachment: WireEvidenceAttachment }>(
        await fetchWithAuth(`/api/msp/change-control/executions/${executionId}/evidence`, { method: "POST", body: form }),
      );
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["msp", "change-control", "executions", vars.executionId, "evidence"] }),
  });
}

// ── PIRs (`msp-change-pir.ts`) ────────────────────────────────────────────────

export type CrPirCloseCode = "successful" | "successful_with_issues" | "failed" | "rolled_back";
export type CrPirDriftRescanStatus = "not_applicable" | "ran" | "error";

export interface WireCrPir {
  readonly id: number;
  readonly executionId: number;
  readonly changeRequestId: number;
  readonly changeCode: string;
  readonly tenantId: string;
  readonly closeCode: CrPirCloseCode;
  readonly summary: string;
  readonly issuesNoted: string | null;
  readonly reviewedBy: string;
  readonly reviewedByPersonId: string | null;
  readonly reviewedAt: string;
  readonly driftRescan: {
    applicable: boolean; domainKey: string | null; checkKey: string | null; status: CrPirDriftRescanStatus;
    eventsInsertedCount: number | null; attributedCount: number | null; otherOpenDriftCount: number | null;
    note: string | null; ranAt: string | null;
  };
  readonly createdAt: string;
}

export function usePirs() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: ["msp", "change-control", "pirs"],
    queryFn: ({ signal }) => getJson<{ pirs: WireCrPir[] }>(fetchWithAuth, "/api/msp/change-control/pirs", signal),
    enabled: useReady(),
    staleTime: 15_000,
  });
}

export function useRecordPir() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ executionId, closeCode, summary, issuesNoted }: {
      executionId: number; closeCode: CrPirCloseCode; summary: string; issuesNoted?: string;
    }) =>
      postJson<{ pir: WireCrPir }>(fetchWithAuth, `/api/msp/change-control/executions/${executionId}/pir`, { closeCode, summary, issuesNoted }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["msp", "change-control", "pirs"] });
      qc.invalidateQueries({ queryKey: ["msp", "change-control", "executions"] });
    },
  });
}

export { numericIdOf };
