/**
 * Wire types for `GET /api/portal/message-center` (surface A, contract pack
 * §1a) — kept as a straight mirror of the route's own `WirePost` /
 * `WireAnalysis` / `WireRouting` / `WireDateUnclearPost` shapes in
 * `artifacts/api-server/src/routes/portal-message-center.ts` so a drift
 * between the two is a compile error, not a silent runtime mismatch.
 *
 * `WireRouting` is new: the route had no field connecting a post to its
 * routed Change Request until this build (#1744) added the join — see that
 * file's own header comment on `WireRouting` for why.
 */

export interface Bucket {
  readonly label: string;
  readonly sub: string;
  readonly wave: string;
  readonly from: string;
  readonly to: string;
}

/** The tenant's own reading of a post (#1532/#1533) — null until an interpretation is confirmed. */
export interface WireAnalysis {
  readonly summary: string | null;
  readonly changeClass: string;
  readonly whoActs: string;
  readonly controllable: string;
  readonly controlMethod: string | null;
  readonly measured: boolean;
  readonly affectedCount: number | null;
  readonly measuredAt: string | null;
  readonly basis: string | null;
  readonly noise: boolean;
}

/** What the routing engine (#1534) decided this post becomes for this customer — null until a decision is taken. */
export interface WireRouting {
  readonly decision: "auto_created" | "proposed" | "declined_risk" | string;
  readonly reason: string;
  readonly intake: "informed" | "approval" | "advisory" | null;
  readonly changeRequestCode: string | null;
  readonly changeRequestStatus: string | null;
  readonly declined: boolean;
}

export interface WirePost {
  readonly id: string;
  readonly title: string;
  readonly wl: string;
  readonly workload: string;
  readonly kind: string;
  readonly hard: boolean;
  readonly month: number;
  readonly when: string;
  readonly countdown: string;
  readonly score: number;
  readonly impact: string;
  readonly bucket: number;
  readonly ms: string;
  readonly plain: string;
  readonly msSays: string;
  readonly services: readonly string[];
  readonly tags: readonly string[];
  readonly publishedAt: string;
  readonly lastModifiedAt: string;
  readonly actionRequiredBy: string | null;
  readonly advisoryDateText: string | null;
  readonly dateConfidence: "dated";
  readonly analysis: WireAnalysis | null;
  readonly routing: WireRouting | null;
}

/** #1536 — a post with no structural date at all. Deliberately narrower than `WirePost`. */
export interface WireDateUnclearPost {
  readonly id: string;
  readonly title: string;
  readonly wl: string;
  readonly workload: string;
  readonly kind: string;
  readonly ms: string;
  readonly services: readonly string[];
  readonly tags: readonly string[];
  readonly lastUpdated: string;
  readonly advisoryDateText: string | null;
  readonly dateConfidence: "unclear";
}

export interface DensityRow {
  readonly wl: string;
  readonly name: string;
  readonly cells: ReadonlyArray<readonly [number, number, number, number]>;
}

export interface StatDef {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly sub: string;
  readonly tone: string;
}

export interface WorkloadFound {
  readonly wl: string;
  readonly name: string;
  readonly found: string;
}

export interface Provenance {
  readonly source: string;
  readonly impactBasis: string;
  readonly scoreBasis: string;
  readonly notReadAgainstTenant: string;
  readonly measuredCounts: string;
  readonly advisoryDates: string;
}

export interface MessageCenterScopedFalse {
  readonly scoped: false;
  readonly itemCount: 0;
  readonly posts: readonly [];
  readonly density: readonly [];
  readonly buckets: readonly Bucket[];
  readonly stats: readonly [];
  readonly workloads: readonly [];
  readonly dateUnclearCount: 0;
  readonly dateUnclearPosts: readonly [];
}

export interface MessageCenterScopedTrue {
  readonly scoped: true;
  readonly itemCount: number;
  readonly onAxisCount: number;
  readonly postsTruncated: boolean;
  readonly lastSyncedAt: string | null;
  readonly scanAt: string | null;
  readonly buckets: readonly Bucket[];
  readonly waveShort: Readonly<Record<string, string>>;
  readonly posts: readonly WirePost[];
  readonly density: readonly DensityRow[];
  readonly stats: readonly StatDef[];
  readonly workloads: readonly WorkloadFound[];
  readonly dateUnclearCount: number;
  readonly dateUnclearPosts: readonly WireDateUnclearPost[];
  readonly provenance: Provenance;
}

export type MessageCenterResponse = MessageCenterScopedFalse | MessageCenterScopedTrue;
