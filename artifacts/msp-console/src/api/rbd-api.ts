/**
 * Risk-Based Decisions — the Risk Register module's own data (Git #2582).
 *
 * Backed by three real route files, all `requireCapability`-gated and scoped to
 * the caller's own MSP via `resolveMspIdStrict` (server-side, never a client
 * param):
 *
 *   - `msp-rbd.ts`          — the container: list, create, sign, revoke
 *   - `msp-rbd-instances.ts` — a container's line items (the affected objects)
 *   - `msp-rbd-versions.ts`  — the container's document-supersession chain
 *
 * `GET /api/msp/rbd` returns every RBD for the whole MSP — there is no
 * per-tenant query param — so the register page filters the live list down to
 * the selected tenant client-side by matching `tenantId` (the real M365 tenant
 * GUID `GET /api/msp/customers` already carries on `DirectoryCustomer`), the
 * same `scoped = scopeName ? rbds.filter(...) : rbds` shape the design's own
 * logic class uses.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

async function getJson<T>(
  fetchWithAuth: (i: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  url: string,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetchWithAuth(url, { method: "GET", signal });
  if (!res.ok) {
    const err = new Error(`Request failed: ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

async function sendJson<T>(
  fetchWithAuth: (i: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  method: "POST" | "PATCH",
  url: string,
  body?: unknown,
): Promise<T> {
  const res = await fetchWithAuth(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string; message?: string };
      message = data.error || data.message || message;
    } catch { /* body wasn't JSON — keep the status-based message */ }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

// ── The container (msp-rbd.ts) ──────────────────────────────────────────────

export type RawRiskLevel = "critical" | "high" | "medium";
export type ResidualRiskLevel = "high" | "medium" | "low";
export type RiskAcceptanceStatus = "pending_signature" | "active" | "revoked" | "converted_to_poam";
export type RiskReviewState = "on_track" | "due" | "overdue";
export type CompensatingControlType = "technical" | "administrative" | "operational";

export interface CompensatingControl {
  type: CompensatingControlType;
  description: string;
}

export interface MspAssessor {
  name: string;
  upn: string;
  timestamp: string;
}

export interface ClientApprover {
  name: string;
  title: string;
  email: string;
  signedAt: string | null;
  ipAddress: string | null;
  signatureHash: string | null;
}

/** One row exactly as `GET /api/msp/rbd` returns it — the raw table row. */
export interface RbdRow {
  id: number;
  rbdId: string;
  tenantId: string;
  tenantName: string;
  primaryDomain: string;
  title: string;
  controlViolated: string;
  framework: string;
  checkKey: string | null;
  rawRiskLevel: RawRiskLevel;
  residualRiskLevel: ResidualRiskLevel;
  rawRiskScore: number;
  residualRiskScore: number;
  liabilityValueUsd: number;
  hazardDescription: string;
  graphEndpoint: string;
  compensatingControls: CompensatingControl[];
  mspAssessor: MspAssessor;
  clientApprover: ClientApprover;
  expirationDate: string;
  status: RiskAcceptanceStatus;
  reviewDate: string | null;
  reviewDueAt: string | null;
  reviewState: RiskReviewState | null;
  registerRef: string | null;
  obligation: string | null;
  obligationId: number | null;
  createdAt: string;
  updatedAt: string;
}

export function useRbdList(): UseQueryResult<RbdRow[], Error> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["msp", "rbd", "list"],
    queryFn: ({ signal }) => getJson<RbdRow[]>(fetchWithAuth, "/api/msp/rbd", signal),
    enabled: !isLoading && !!accessToken,
    staleTime: 15_000,
  });
}

export interface CreateRbdInput {
  rbdId: string;
  tenantId: string;
  tenantName: string;
  primaryDomain: string;
  title: string;
  controlViolated: string;
  framework: string;
  rawRiskLevel: RawRiskLevel;
  residualRiskLevel: ResidualRiskLevel;
  rawRiskScore: number;
  residualRiskScore: number;
  liabilityValueUsd: number;
  hazardDescription: string;
  graphEndpoint: string;
  compensatingControls: CompensatingControl[];
  clientApprover: { name: string; title: string; email: string };
  expirationDate: string;
  status: RiskAcceptanceStatus;
  checkKey?: string | null;
  obligationId?: number | null;
}

export interface CreateRbdResult {
  id: number;
  rbdId: string;
  registerRef: string;
  message: string;
}

export function useCreateRbd() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRbdInput) =>
      sendJson<CreateRbdResult>(fetchWithAuth, "POST", "/api/msp/rbd", input),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["msp", "rbd"] }); },
  });
}

export interface SignRbdInput {
  name: string;
  title: string;
  email: string;
  ipAddress: string;
  signatureHash: string;
}

export function useSignRbd() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rbdId, ...body }: SignRbdInput & { rbdId: string }) =>
      sendJson<{ rbdId: string; message: string }>(
        fetchWithAuth, "PATCH", `/api/msp/rbd/${encodeURIComponent(rbdId)}/sign`, body,
      ),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["msp", "rbd"] }); },
  });
}

export function useRevokeRbd() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rbdId: string) =>
      sendJson<{ rbdId: string; message: string }>(
        fetchWithAuth, "PATCH", `/api/msp/rbd/${encodeURIComponent(rbdId)}/revoke`,
      ),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["msp", "rbd"] }); },
  });
}

// ── Available checks / obligations (linked-check and cited-authority pickers) ─

export interface AvailableCheck {
  key: string;
  label: string;
  description: string;
}

export function useAvailableChecks(): UseQueryResult<AvailableCheck[], Error> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["msp", "rbd", "available-checks"],
    queryFn: ({ signal }) => getJson<AvailableCheck[]>(fetchWithAuth, "/api/msp/rbd/available-checks", signal),
    enabled: !isLoading && !!accessToken,
    staleTime: 60_000,
  });
}

export interface AvailableObligation {
  obligationId: number;
  citation: string;
  requires: string;
  frameworkName: string;
  authorityType: string;
  tenantId: string | null;
}

export function useAvailableObligations(): UseQueryResult<AvailableObligation[], Error> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["msp", "rbd", "available-obligations"],
    queryFn: ({ signal }) => getJson<AvailableObligation[]>(fetchWithAuth, "/api/msp/rbd/available-obligations", signal),
    enabled: !isLoading && !!accessToken,
    staleTime: 60_000,
  });
}

// ── Line items (msp-rbd-instances.ts) ───────────────────────────────────────

export type RiskInstanceStatus = "active" | "remediated" | "object_removed";
export type RiskInstanceExitReason = "remediated" | "object_removed";

export interface RiskInstance {
  id: number;
  rbdId: string;
  label: string;
  objectId: string | null;
  foundAt: string;
  acceptedAt: string | null;
  status: RiskInstanceStatus;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

export function useRbdInstances(rbdId: string | null): UseQueryResult<RiskInstance[], Error> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["msp", "rbd", rbdId, "instances"],
    queryFn: ({ signal }) =>
      getJson<{ rbdId: string; instances: RiskInstance[] }>(
        fetchWithAuth, `/api/msp/rbd/${encodeURIComponent(rbdId as string)}/instances`, signal,
      ).then((r) => r.instances),
    enabled: !isLoading && !!accessToken && !!rbdId,
    staleTime: 15_000,
  });
}

export function useAddRiskInstance() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rbdId, label, objectId }: { rbdId: string; label: string; objectId?: string | null }) =>
      sendJson<{ instance: RiskInstance }>(
        fetchWithAuth, "POST", `/api/msp/rbd/${encodeURIComponent(rbdId)}/instances`,
        { label, objectId: objectId ?? null },
      ).then((r) => r.instance),
    onSuccess: (_data, vars) => { void qc.invalidateQueries({ queryKey: ["msp", "rbd", vars.rbdId, "instances"] }); },
  });
}

export function useAcceptRiskInstance() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rbdId, instanceId }: { rbdId: string; instanceId: number }) =>
      sendJson<{ instance: RiskInstance }>(
        fetchWithAuth, "PATCH", `/api/msp/rbd/${encodeURIComponent(rbdId)}/instances/${instanceId}/accept`,
      ).then((r) => r.instance),
    onSuccess: (_data, vars) => { void qc.invalidateQueries({ queryKey: ["msp", "rbd", vars.rbdId, "instances"] }); },
  });
}

export function useResolveRiskInstance() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rbdId, instanceId, reason, note }: {
      rbdId: string; instanceId: number; reason: RiskInstanceExitReason; note?: string | null;
    }) =>
      sendJson<{ instance: RiskInstance }>(
        fetchWithAuth, "PATCH", `/api/msp/rbd/${encodeURIComponent(rbdId)}/instances/${instanceId}/resolve`,
        { reason, note: note ?? null },
      ).then((r) => r.instance),
    onSuccess: (_data, vars) => { void qc.invalidateQueries({ queryKey: ["msp", "rbd", vars.rbdId, "instances"] }); },
  });
}

// ── Document versions (msp-rbd-versions.ts) ─────────────────────────────────

export interface RbdVersion {
  versionUid: string;
  rbdId: string;
  versionNumber: number;
  content: unknown;
  createdBy: MspAssessor;
  createdAt: string;
  signed: boolean;
  signedBy: unknown;
  signedAt: string | null;
  isCurrent: boolean;
  scopeInstanceIds: number[];
  scopeAddedInstanceIds: number[];
  scopeRemovedInstanceIds: number[];
  requiresSignature: boolean;
  signatureInherited: boolean;
  signatureInheritedFromVersionUid: string | null;
  narrativeSnapshot: unknown;
  /** Set client-side after a successful `useShareVersion` call in this session
   * — the API returns the token once and does not echo it back on later reads. */
  shareToken?: string;
  shareTokenExpiresAt?: string | null;
}

export function useRbdVersions(rbdId: string | null): UseQueryResult<RbdVersion[], Error> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["msp", "rbd", rbdId, "versions"],
    queryFn: ({ signal }) =>
      getJson<{ rbdId: string; versions: RbdVersion[] }>(
        fetchWithAuth, `/api/msp/rbd/${encodeURIComponent(rbdId as string)}/versions`, signal,
      ).then((r) => r.versions),
    enabled: !isLoading && !!accessToken && !!rbdId,
    staleTime: 15_000,
  });
}

export function useCaptureRbdVersion() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rbdId, tenantId, tenantName, content }: {
      rbdId: string; tenantId: string; tenantName: string; content?: unknown;
    }) =>
      sendJson<{ version: RbdVersion }>(
        fetchWithAuth, "POST", `/api/msp/rbd/${encodeURIComponent(rbdId)}/versions`,
        { tenantId, tenantName, content: content ?? null },
      ).then((r) => r.version),
    onSuccess: (_data, vars) => { void qc.invalidateQueries({ queryKey: ["msp", "rbd", vars.rbdId, "versions"] }); },
  });
}

export function useShareRbdVersion() {
  const { fetchWithAuth } = useAuth();
  return useMutation({
    mutationFn: ({ rbdId, versionUid }: { rbdId: string; versionUid: string }) =>
      sendJson<{ shareToken: string; shareTokenExpiresAt: string | null }>(
        fetchWithAuth, "POST",
        `/api/msp/rbd/${encodeURIComponent(rbdId)}/versions/${encodeURIComponent(versionUid)}/share`,
      ),
  });
}

export interface NarrativeAuditRow {
  fromVersionUid: string | null;
  toVersionUid: string;
  changedFields: Record<string, { from: unknown; to: unknown }>;
  createdAt: string;
}

export function useRbdNarrativeAudit(rbdId: string | null): UseQueryResult<NarrativeAuditRow[], Error> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["msp", "rbd", rbdId, "narrative-audit"],
    queryFn: ({ signal }) =>
      getJson<{ rbdId: string; audit: NarrativeAuditRow[] }>(
        fetchWithAuth, `/api/msp/rbd/${encodeURIComponent(rbdId as string)}/versions/narrative-audit`, signal,
      ).then((r) => r.audit),
    enabled: !isLoading && !!accessToken && !!rbdId,
    staleTime: 15_000,
  });
}
