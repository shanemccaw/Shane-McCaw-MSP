/**
 * Security Plan — MSP console authoring surface (#1689, Git #2603).
 *
 * Backed by `artifacts/api-server/src/routes/msp-security-plan.ts` (9 routes), per
 * `docs/msp-console/security-plan-msp-console-contract-pack.md` (#4082) and
 * `docs/portal/security-plan-contract-pack.md`. The fixed authoring sequence is
 * `POST .../draft/freeze` -> `PATCH .../draft/prose` (repeatable) -> `POST .../versions`
 * (seals the frozen draft, deletes the draft) -> `PATCH .../versions/:versionUid/sign`
 * (the MSP's own, independent signature — #1689/#3793 dual signature, never blocking on
 * or satisfied by the customer's own sign action in the portal).
 *
 * `:customerId` is `tenants.id` (the same numeric id `DirectoryCustomer.id` carries) —
 * NOT the M365 tenant GUID `DirectoryCustomer.tenantId` other modules (Risk Register,
 * Launch Control) key on.
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
      const data = (await res.json()) as { error?: { message?: string } | string };
      message = (typeof data.error === "string" ? data.error : data.error?.message) || message;
    } catch { /* body wasn't JSON — keep the status-based message */ }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

// ── Shared wire shapes (msp.ts / security-plan-assembly.ts) ─────────────────────────

export const SECURITY_PLAN_CONTROL_DOMAINS = ["identity", "data", "collaboration", "change", "monitoring"] as const;
export type SecurityPlanControlDomain = (typeof SECURITY_PLAN_CONTROL_DOMAINS)[number];
export const SECURITY_PLAN_CONTROL_DOMAIN_LABELS: Record<SecurityPlanControlDomain, string> = {
  identity: "Identity and access",
  data: "Data and retention",
  collaboration: "Collaboration and sharing",
  change: "Change and operations",
  monitoring: "Monitoring and response",
};

export interface SecurityPlanAssembledItem {
  readonly id: string;
  readonly title: string;
  readonly state: string | null;
  readonly detail: string | null;
  readonly pillar: string | null;
  readonly framework: string | null;
  readonly businessUnit: string | null;
  readonly controlDomain: string | null;
}

export interface SecurityPlanAssembledModule {
  readonly key: string;
  readonly label: string;
  readonly sourceIssue: string;
  readonly total: number;
  readonly excludedCount: number;
  readonly items: readonly SecurityPlanAssembledItem[];
}

export type SecurityPlanScopeDimension = "pillar" | "framework" | "businessUnit";

export interface SecurityPlanScope {
  readonly dimensions: Partial<Record<SecurityPlanScopeDimension, readonly string[]>>;
  readonly statement?: string;
}

export interface SecurityPlanModuleExclusion {
  readonly moduleKey: string;
  readonly excludedCount: number;
}

export interface SecurityPlanFilterFootprint {
  readonly scope: SecurityPlanScope & { readonly statement: string };
  readonly isHonestView: boolean;
  readonly excludedByModule: readonly SecurityPlanModuleExclusion[];
  readonly totalExcluded: number;
  readonly computedAt: string;
}

export const SECURITY_PLAN_PROSE_SECTIONS = ["scope", "methodology", "exclusions", "executiveSummary"] as const;
export type SecurityPlanProseSection = (typeof SECURITY_PLAN_PROSE_SECTIONS)[number];

export interface SecurityPlanProseSectionContent {
  readonly text: string;
  readonly editedInThisVersion: boolean;
}

export type SecurityPlanProse = Record<SecurityPlanProseSection, SecurityPlanProseSectionContent>;

/** The full assembled document — `content` on a version, or the live honest view. */
export interface SecurityPlanContent {
  readonly customerId: number;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly assembledAt: string;
  readonly modules: readonly SecurityPlanAssembledModule[];
  readonly footprint: SecurityPlanFilterFootprint;
  readonly prose: SecurityPlanProse | null;
}

export interface SecurityPlanDriftChangedItem {
  readonly id: string;
  readonly title: string;
  readonly from: { readonly state: string | null; readonly detail: string | null };
  readonly to: { readonly state: string | null; readonly detail: string | null };
}

export interface SecurityPlanModuleDrift {
  readonly moduleKey: string;
  readonly label: string;
  readonly added: readonly SecurityPlanAssembledItem[];
  readonly removed: readonly SecurityPlanAssembledItem[];
  readonly changed: readonly SecurityPlanDriftChangedItem[];
}

export interface SecurityPlanDrift {
  readonly hasLastSignedVersion: boolean;
  readonly lastSignedVersionUid: string | null;
  readonly lastSignedVersionNumber: number | null;
  readonly lastSignedAt: string | null;
  readonly modules: readonly SecurityPlanModuleDrift[];
  readonly totalAdded: number;
  readonly totalRemoved: number;
  readonly totalChanged: number;
}

/** Who sealed/signed on the MSP's own side — server-derived, never client-supplied. */
export interface MspAssessor {
  readonly name: string;
  readonly upn: string;
  readonly timestamp: string;
}

/** The customer's own signature identity — `ClientApprover` (msp.ts), server-derived
 * on the portal's own sign route; read-only here. */
export interface ClientApprover {
  readonly name: string;
  readonly title: string;
  readonly email: string;
  readonly signedAt: string | null;
  readonly ipAddress: string | null;
  readonly signatureHash: string | null;
}

/** One sealed version, exactly as `msp-security-plan.ts`'s `toWireVersion` returns it. */
export interface SecurityPlanVersion {
  readonly versionUid: string;
  readonly customerId: number;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly versionNumber: number;
  readonly content: SecurityPlanContent;
  readonly scopeStatement: string;
  readonly createdBy: MspAssessor;
  readonly createdAt: string;
  /** #1689/#3793 — dual signature: neither party's signing blocks or satisfies the other. */
  readonly customerSigned: boolean;
  readonly customerSignedBy: ClientApprover | null;
  readonly customerSignedAt: string | null;
  readonly mspSigned: boolean;
  readonly mspSignedBy: MspAssessor | null;
  readonly mspSignedAt: string | null;
  readonly fullyExecuted: boolean;
  readonly isCurrent: boolean;
}

/** The in-progress draft — the frozen state plus the prose being authored against it. */
export interface SecurityPlanDraft {
  readonly customerId: number;
  readonly frozenContent: SecurityPlanContent;
  readonly frozenAt: string;
  readonly prose: SecurityPlanProse;
  readonly updatedAt: string;
}

const BASE = (customerId: number) => `/api/msp/security-plan/${customerId}`;

// ── Live assembled view + drift ─────────────────────────────────────────────────────

export function useAssembledSecurityPlan(customerId: number | null): UseQueryResult<SecurityPlanContent, Error> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["msp", "security-plan", customerId, "assembled"],
    queryFn: ({ signal }) =>
      getJson<{ document: SecurityPlanContent }>(fetchWithAuth, `${BASE(customerId as number)}/assembled`, signal)
        .then((r) => r.document),
    enabled: !isLoading && !!accessToken && customerId !== null,
    staleTime: 15_000,
  });
}

export function useSecurityPlanDrift(customerId: number | null): UseQueryResult<{ document: SecurityPlanContent; drift: SecurityPlanDrift }, Error> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["msp", "security-plan", customerId, "drift"],
    queryFn: ({ signal }) =>
      getJson<{ document: SecurityPlanContent; drift: SecurityPlanDrift }>(fetchWithAuth, `${BASE(customerId as number)}/drift`, signal),
    enabled: !isLoading && !!accessToken && customerId !== null,
    staleTime: 15_000,
  });
}

// ── Sealed version chain ─────────────────────────────────────────────────────────────

export function useSecurityPlanVersions(customerId: number | null): UseQueryResult<SecurityPlanVersion[], Error> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["msp", "security-plan", customerId, "versions"],
    queryFn: ({ signal }) =>
      getJson<{ customerId: number; versions: SecurityPlanVersion[] }>(fetchWithAuth, `${BASE(customerId as number)}/versions`, signal)
        .then((r) => r.versions),
    enabled: !isLoading && !!accessToken && customerId !== null,
    staleTime: 15_000,
  });
}

/** 404s ("no version has been sealed yet") is a real, expected state here — the caller
 * should treat `isError` with `status === 404` as "nothing sealed," not a failed read. */
export function useCurrentSecurityPlanVersion(customerId: number | null): UseQueryResult<SecurityPlanVersion, Error> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["msp", "security-plan", customerId, "versions", "current"],
    queryFn: ({ signal }) =>
      getJson<{ version: SecurityPlanVersion }>(fetchWithAuth, `${BASE(customerId as number)}/versions/current`, signal)
        .then((r) => r.version),
    enabled: !isLoading && !!accessToken && customerId !== null,
    staleTime: 15_000,
    retry: false,
  });
}

// ── Draft holding pen (freeze -> author prose -> seal) ──────────────────────────────

export function useSecurityPlanDraft(customerId: number | null): UseQueryResult<SecurityPlanDraft, Error> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["msp", "security-plan", customerId, "draft"],
    queryFn: ({ signal }) =>
      getJson<{ draft: SecurityPlanDraft }>(fetchWithAuth, `${BASE(customerId as number)}/draft`, signal)
        .then((r) => r.draft),
    enabled: !isLoading && !!accessToken && customerId !== null,
    staleTime: 5_000,
    retry: false,
  });
}

export function useFreezeSecurityPlanDraft(customerId: number) {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scope?: SecurityPlanScope) =>
      sendJson<{ draft: SecurityPlanDraft }>(fetchWithAuth, "POST", `${BASE(customerId)}/draft/freeze`, scope ? { scope } : {})
        .then((r) => r.draft),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["msp", "security-plan", customerId, "draft"] }); },
  });
}

export function useUpdateSecurityPlanDraftProse(customerId: number) {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ section, text }: { section: SecurityPlanProseSection; text: string }) =>
      sendJson<{ draft: SecurityPlanDraft }>(fetchWithAuth, "PATCH", `${BASE(customerId)}/draft/prose`, { section, text })
        .then((r) => r.draft),
    onSuccess: (draft) => { qc.setQueryData(["msp", "security-plan", customerId, "draft"], draft); },
  });
}

/** Seals the frozen draft as a new version — deletes the draft server-side. */
export function useSealSecurityPlanVersion(customerId: number) {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      sendJson<{ version: SecurityPlanVersion }>(fetchWithAuth, "POST", `${BASE(customerId)}/versions`)
        .then((r) => r.version),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["msp", "security-plan", customerId] });
    },
  });
}

/** The MSP's own, independent signature (#1689/#3793) — requires `ladder.msp-admin`
 * server-side; never blocks on or is satisfied by the customer's own portal sign. */
export function useSignSecurityPlanVersionAsMsp(customerId: number) {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (versionUid: string) =>
      sendJson<{ version: SecurityPlanVersion }>(fetchWithAuth, "PATCH", `${BASE(customerId)}/versions/${encodeURIComponent(versionUid)}/sign`)
        .then((r) => r.version),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["msp", "security-plan", customerId] });
    },
  });
}
