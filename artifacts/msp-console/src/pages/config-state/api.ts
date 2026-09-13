/**
 * config-state/api.ts — the MSP operator's config-state DIFF surface (Git #3836,
 * a direct sibling of #2820 which wired the equivalent Portal-side read).
 *
 * Real endpoints, `artifacts/api-server/src/routes/msp-config-state-diffs.ts`:
 *   GET  /api/msp/config-state/diffs               — comparison history across the book
 *   GET  /api/msp/config-state/diffs/:diffId        — one comparison's changes, each
 *                                                      carrying its real `attribution`
 *                                                      (verdict, crRef/rbdRef, matchScope)
 *                                                      and `lifecycle` (open/resolved/
 *                                                      reopened), plus a verdict roll-up
 *                                                      for the whole diff (#2759)
 *   POST /api/msp/config-state/diffs/:diffId/attribution
 *                                                    — run/re-run the attribution pass
 *
 * Scope is deliberately narrow (#3836's own body): the diff/attribution/lifecycle READ
 * and the re-run trigger only. Snapshots, baselines, the resource registry and the
 * tenant-coverage tab that the same design file (`Configuration State.dc.html`) also
 * describes are each their own separate chunk of work and are not read here.
 *
 * No fixture data — every field below is the real wire shape `config-state-views.ts` /
 * `config-change-attribution.ts` already return; there is no `configStateData.ts`.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

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
  return (await res.json()) as T;
}

async function getJson<T>(fw: FetchWithAuth, url: string, signal?: AbortSignal): Promise<T> {
  return unwrap<T>(await fw(url, { method: "GET", signal }));
}
async function postJson<T>(fw: FetchWithAuth, url: string, body?: unknown): Promise<T> {
  return unwrap<T>(await fw(url, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }));
}

/** True once auth is resolved and there is a token to attach. */
function useReady(): boolean {
  const { isLoading, accessToken } = useAuth();
  return !isLoading && !!accessToken;
}

// ── Wire shapes ──────────────────────────────────────────────────────────────

export type ConfigDiffMode = "drift" | "baseline_assessment" | "tenant_compare" | "promotion";

export interface WireDiffCompleteness {
  readonly isComplete: boolean;
  readonly status: string;
  readonly resourceTypesCompared: number;
  readonly resourceTypesPartial: number;
  readonly resourceTypesNotComparable: number;
  readonly comparableFraction: number | null;
  readonly objectsPaired: number;
  readonly objectsAdded: number;
  readonly objectsRemoved: number;
  readonly objectsIndeterminate: number;
  readonly objectsUnpairable: number;
  readonly changesTotal: number;
  readonly changesSignificant: number;
  readonly changesIgnored: number;
  readonly differVersion: string;
  readonly rulesetFingerprint: string;
  readonly error: string | null;
}

export interface WireDiffSummary {
  readonly diffId: string;
  readonly diffRowId: number;
  readonly mode: ConfigDiffMode;
  readonly baseSnapshotRowId: number;
  readonly headSnapshotRowId: number;
  readonly baseTenantId: number;
  readonly headTenantId: number;
  readonly trigger: string;
  readonly triggerRef: string | null;
  readonly createdAt: string;
  readonly sealedAt: string | null;
  readonly durationMs: number | null;
  readonly completeness: WireDiffCompleteness;
}

export interface DiffsListResponse {
  readonly diffs: readonly WireDiffSummary[];
  readonly paging: { readonly total: number; readonly limit: number; readonly offset: number; readonly hasMore: boolean };
}

export type ConfigChangeVerdict = "attributed_change" | "accepted_risk" | "contested" | "unattributed" | "ignored";

export interface WireAttributionRollup {
  readonly attributed: boolean;
  readonly attributionVersion: string | null;
  readonly attributedAt: string | null;
  readonly counts: Readonly<Record<ConfigChangeVerdict, number>>;
  readonly changeRequests: readonly { readonly id: number; readonly ref: string | null; readonly changes: number }[];
  readonly riskDecisions: readonly { readonly id: number; readonly ref: string | null; readonly changes: number }[];
  readonly contestedCount: number;
}

/** open | resolved | reopened — an OBSERVED return to the baseline value is the only
 *  thing that resolves a row; see `config_change_lifecycle`'s own schema comment. */
export type ConfigChangeLifecycleStatus = "open" | "resolved" | "reopened";

export interface WireChangeAttribution {
  readonly verdict: ConfigChangeVerdict;
  readonly changeRequestId: number | null;
  readonly crRef: string | null;
  readonly riskDecisionId: number | null;
  readonly rbdRef: string | null;
  /** property | object | resource — how precisely the covering claim matched. */
  readonly matchScope: string | null;
  readonly matchCount: number;
  readonly attributionVersion: string | null;
  readonly attributedAt: string | null;
}

export interface WireChangeLifecycle {
  readonly status: ConfigChangeLifecycleStatus;
  readonly firstDetectedAt: string;
  readonly lastDetectedAt: string;
  readonly resolvedAt: string | null;
  readonly reopenedAt: string | null;
  readonly reopenCount: number;
}

export interface WireChangeRow {
  readonly sequence: number;
  readonly resourceKey: string;
  readonly resourceDisplayName: string;
  readonly workload: string;
  readonly objectIdentity: string | null;
  readonly objectDisplayName: string | null;
  readonly identityStrategy: string;
  readonly changeKind: string;
  readonly propertyPath: string | null;
  readonly oldValue: unknown;
  readonly newValue: unknown;
  readonly oldValuePresent: boolean;
  readonly newValuePresent: boolean;
  readonly isIgnored: boolean;
  readonly ignoredByRuleId: number | null;
  readonly attribution: WireChangeAttribution | null;
  readonly lifecycle: WireChangeLifecycle | null;
}

export interface WireSnapshotSide {
  readonly id: number;
  readonly snapshotId: string;
  readonly tenantId: number;
  readonly capturedAt: string;
  readonly completeness: unknown;
}

export interface DiffDetailResponse {
  readonly diffId: string;
  readonly diffRowId: number;
  readonly mode: ConfigDiffMode;
  readonly trigger: string;
  readonly triggerRef: string | null;
  readonly completeness: WireDiffCompleteness;
  readonly snapshots: { readonly base: WireSnapshotSide | null; readonly head: WireSnapshotSide | null };
  readonly changes: readonly WireChangeRow[];
  readonly byKind: readonly { readonly changeKind: string; readonly isIgnored: boolean; readonly count: number }[];
  readonly paging: { readonly total: number; readonly limit: number; readonly offset: number; readonly hasMore: boolean };
  readonly attribution: WireAttributionRollup;
}

export interface AttributionRunResponse {
  readonly diffId: string;
  readonly diffRowId: number;
  readonly tenantId: number;
  /** How many change rows the pass wrote a verdict for — every eligible row, every run. */
  readonly changesAttributed: number;
  readonly scopesDerived: number;
  readonly scopesEligible: number;
  readonly verdicts: Readonly<Record<ConfigChangeVerdict, number>>;
  readonly lifecycleOpened: number;
  readonly lifecycleResolved: number;
  readonly lifecycleReopened: number;
  readonly window: { readonly from: string; readonly to: string };
}

// ── Reads ────────────────────────────────────────────────────────────────────

export function useConfigDiffs(mode?: ConfigDiffMode | "all"): UseQueryResult<DiffsListResponse, Error> {
  const { fetchWithAuth } = useAuth();
  const ready = useReady();
  const modeQs = mode && mode !== "all" ? `?mode=${encodeURIComponent(mode)}` : "";
  return useQuery({
    queryKey: ["msp", "config-state", "diffs", mode ?? "all"],
    queryFn: ({ signal }) => getJson<DiffsListResponse>(fetchWithAuth, `/api/msp/config-state/diffs${modeQs}`, signal),
    enabled: ready,
    staleTime: 15_000,
  });
}

export function useConfigDiff(diffId: string | null): UseQueryResult<DiffDetailResponse, Error> {
  const { fetchWithAuth } = useAuth();
  const ready = useReady();
  return useQuery({
    queryKey: ["msp", "config-state", "diffs", "detail", diffId],
    queryFn: ({ signal }) =>
      getJson<DiffDetailResponse>(fetchWithAuth, `/api/msp/config-state/diffs/${diffId}?limit=500`, signal),
    enabled: ready && diffId !== null,
    staleTime: 5_000,
  });
}

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * Run (or re-run) the attribution pass over one sealed comparison — the design's own
 * "attribution runs lazily on read and can be forced again at any time" callout. Reads
 * Change Control and the Risk Register; writes only its own tables, never the diff.
 */
export function useRunAttribution() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (diffId: string) =>
      postJson<AttributionRunResponse>(fetchWithAuth, `/api/msp/config-state/diffs/${diffId}/attribution`),
    onSuccess: (_data, diffId) => {
      qc.invalidateQueries({ queryKey: ["msp", "config-state", "diffs", "detail", diffId] });
      qc.invalidateQueries({ queryKey: ["msp", "config-state", "diffs"] });
    },
  });
}
