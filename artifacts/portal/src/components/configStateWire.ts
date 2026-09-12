/**
 * configStateWire.ts — wire shapes and pure formatting/grouping helpers behind
 * the Configuration State page (Git #3004, part of #3002/#1485).
 *
 * Real endpoints, `artifacts/api-server/src/routes/portal-config-state.ts`:
 *   GET /api/portal/config-state/snapshots
 *   GET /api/portal/config-state/snapshots/current
 *   GET /api/portal/config-state/snapshots/:id
 *   GET /api/portal/config-state/changes
 *   GET /api/portal/config-state/changes/:diffId
 *
 * Shapes here are the subset of `config-state-views.ts` / `config-change-attribution.ts`'s
 * real response fields this page actually renders — see
 * `docs/portal/configuration-state-contract-pack.md` §5 for the full contracts. Pure
 * functions only (no React), so they're unit-testable directly; the fetching lives in
 * `configStateLive.ts`.
 */

// ── Wire shapes ──────────────────────────────────────────────────────────────

export interface WireCompleteness {
  readonly isComplete: boolean;
  readonly status: string;
  readonly capturedAt: string;
  readonly resourceTypesTargeted: number;
  readonly resourceTypesCollected: number;
  readonly resourceTypesEmpty: number;
  readonly resourceTypesPartial: number;
  readonly resourceTypesSkipped: number;
  readonly resourceTypesFailed: number;
  readonly objectCount: number;
  readonly readableFraction: number | null;
  readonly collectorVersion: string | null;
  readonly error: string | null;
}

export interface WireWorkloadRollup {
  readonly workload: string;
  readonly resourceTypes: number;
  readonly objectCount: number;
  readonly totals: {
    readonly collected: number;
    readonly empty: number;
    readonly partial: number;
    readonly skipped: number;
    readonly failed: number;
  };
}

export interface WireSnapshotHeader {
  readonly id: number;
  readonly snapshotId: string;
  readonly tenantId: number;
  readonly capturedAt: string;
  readonly status: string;
  readonly trigger: string;
}

export interface WireSnapshotSummary extends WireSnapshotHeader {
  readonly tenantName: string | null;
  readonly completeness: WireCompleteness;
}

export interface WireSnapshotResourceRow {
  readonly resourceKey: string;
  readonly displayName: string;
  readonly workload: string;
  readonly status: string;
  readonly skipReason: string | null;
  readonly errorCode: string | null;
  readonly httpStatus: number | null;
  readonly objectCount: number;
}

export interface CurrentSnapshotResponse {
  readonly snapshot: WireSnapshotHeader | null;
  readonly collected: boolean;
  readonly reason?: string;
  readonly detail?: string;
  readonly completeness?: WireCompleteness;
  readonly workloads?: readonly WireWorkloadRollup[];
}

export interface SnapshotDocumentResponse {
  readonly snapshot: WireSnapshotHeader;
  readonly completeness: WireCompleteness;
  readonly workloads: readonly WireWorkloadRollup[];
  readonly resources: readonly WireSnapshotResourceRow[];
}

export interface SnapshotsListResponse {
  readonly snapshots: readonly WireSnapshotSummary[];
  readonly paging: { readonly total: number; readonly limit: number; readonly offset: number; readonly hasMore: boolean };
}

export interface WireDiffCompleteness {
  readonly isComplete: boolean;
  readonly resourceTypesCompared: number;
  readonly resourceTypesPartial: number;
  readonly resourceTypesNotComparable: number;
  readonly comparableFraction: number | null;
  readonly changesTotal: number;
  readonly changesSignificant: number;
  readonly changesIgnored: number;
}

export interface WireDiffResourceStatus {
  readonly resourceKey: string;
  readonly displayName: string;
  readonly workload: string;
  readonly comparability: string;
  readonly notComparableReason: string | null;
  readonly baseStatus: string | null;
  readonly baseSkipReason: string | null;
  readonly headStatus: string | null;
  readonly headSkipReason: string | null;
  readonly objectsAdded: number;
  readonly objectsRemoved: number;
  readonly objectsIndeterminate: number;
  readonly changesTotal: number;
  readonly changesSignificant: number;
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

export interface ChangesOverviewResponse {
  readonly comparison: { readonly diffId: string; readonly diffRowId: number; readonly mode: string } | null;
  readonly available: boolean;
  readonly reason?: string;
  readonly detail?: string;
  readonly completeness?: WireDiffCompleteness;
  readonly notComparable?: { readonly count: number; readonly resources: readonly WireDiffResourceStatus[] };
  readonly attribution?: WireAttributionRollup | null;
}

export interface DiffResourcesResponse {
  readonly resources: readonly WireDiffResourceStatus[];
}

/** open | resolved | reopened — see `config_change_lifecycle`'s own header for the
 *  resolution rule (only an OBSERVED return to the baseline value resolves a row). */
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
  readonly objectDisplayName: string | null;
  readonly changeKind: string;
  readonly propertyPath: string | null;
  readonly attribution: WireChangeAttribution | null;
  readonly lifecycle: WireChangeLifecycle | null;
}

export interface DiffChangesResponse {
  readonly changes: readonly WireChangeRow[];
  readonly byKind: readonly { readonly changeKind: string; readonly isIgnored: boolean; readonly count: number }[];
}

// ── Formatting ────────────────────────────────────────────────────────────────

export function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

/** "4 Sep 2026 · 19:21" */
export function fmtSnapDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  return `${day} · ${time}`;
}

/** "4 Sep · 19:21" — the compact form the history list uses. */
export function fmtSnapWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" });
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  return `${day} · ${time}`;
}

export function pctLine(fraction: number | null): string {
  if (fraction === null) return "Nothing was targeted, so there is nothing to read a percentage from.";
  const pct = (fraction * 100).toFixed(1);
  return `${pct}% of the model was readable — a measure of our reach, not of your configuration.`;
}

// ── Status colors (design system, hand-tuned — see docs/design-system.md) ──────

export const STATUS_COLOR = {
  collected: "#34d399",
  empty: "#60a5fa",
  partial: "#c2a63d",
  skipped: "#475569",
  failed: "#8494ab",
} as const;

export type SnapshotStatusKey = keyof typeof STATUS_COLOR;

export interface Segment {
  readonly width: string;
  readonly bg: string;
}

/** Proportional health-bar segments — a non-zero count always shows a sliver, even
 *  at a tiny fraction, so a real-but-small count is never visually indistinguishable
 *  from zero. */
export function buildSegments(totals: Record<SnapshotStatusKey, number>, total: number): readonly Segment[] {
  const order: readonly SnapshotStatusKey[] = ["collected", "empty", "partial", "skipped", "failed"];
  return order.map((k) => {
    const n = totals[k];
    const width = total > 0 ? Math.max((n / total) * 100, n > 0 ? 0.4 : 0) : 0;
    return { width: `${width}%`, bg: STATUS_COLOR[k] };
  });
}

export interface LegendEntry {
  readonly key: SnapshotStatusKey;
  readonly label: string;
  readonly value: string;
  readonly dot: string;
  readonly ink: string;
  readonly tip: string;
}

const LEGEND_TIPS: Record<SnapshotStatusKey, string> = {
  collected: "We read it and there are objects",
  empty: "We read it and the tenant genuinely has zero of these",
  partial: "Real objects, but the set was truncated — absences are unknown",
  skipped: "We could not read it — never rendered as zero",
  failed: "The read failed — evidence kept on every row",
};

export function buildLegend(totals: Record<SnapshotStatusKey, number>): readonly LegendEntry[] {
  const order: readonly SnapshotStatusKey[] = ["collected", "empty", "partial", "skipped", "failed"];
  return order.map((k) => ({
    key: k,
    label: k,
    value: fmt(totals[k]),
    dot: STATUS_COLOR[k],
    ink: k === "collected" || k === "empty" || k === "partial" ? "#94a3b8" : "#64748b",
    tip: LEGEND_TIPS[k],
  }));
}

export function completenessTotals(c: WireCompleteness): Record<SnapshotStatusKey, number> {
  return {
    collected: c.resourceTypesCollected,
    empty: c.resourceTypesEmpty,
    partial: c.resourceTypesPartial,
    skipped: c.resourceTypesSkipped,
    failed: c.resourceTypesFailed,
  };
}

// ── Resource-key display ────────────────────────────────────────────────────────

/** "graph:v1.0:/security/secureScores" -> "/security/secureScores" — drop the
 *  transport:version prefix for display; the full key is kept for API calls. */
export function shortResourceKey(resourceKey: string): string {
  const idx = resourceKey.lastIndexOf(":");
  return idx >= 0 ? resourceKey.slice(idx + 1) : resourceKey;
}

// ── Change groups (per resourceKey, from GET /changes/:diffId?view=resources) ──

export interface ChangeGroup {
  readonly resourceKey: string;
  readonly shortKey: string;
  readonly n: number;
  readonly partial: boolean;
  readonly workload: string;
}

/** The resources that actually carry a real change, ranked by volume — the
 *  design's own "changeGroups" list, built from real per-resource counts rather
 *  than a fixture. */
export function buildChangeGroups(resources: readonly WireDiffResourceStatus[], limit = 12): readonly ChangeGroup[] {
  return resources
    .filter((r) => r.changesSignificant > 0)
    .sort((a, b) => b.changesSignificant - a.changesSignificant)
    .slice(0, limit)
    .map((r) => ({
      resourceKey: r.resourceKey,
      shortKey: shortResourceKey(r.resourceKey),
      n: r.changesSignificant,
      partial: r.comparability === "partially_comparable",
      workload: r.workload,
    }));
}

/** "The largest single resource type is X with N of Total changes (P%)." — a real,
 *  generic fact instead of the design's hand-picked "a third of these are one
 *  telemetry resource" commentary, which does not generalize across tenants/diffs. */
export function largestGroupLine(groups: readonly ChangeGroup[], changesSignificant: number): string | null {
  const top = groups[0];
  if (!top || changesSignificant <= 0) return null;
  const pct = Math.round((top.n / changesSignificant) * 100);
  return `The largest single resource type is ${top.shortKey} with ${fmt(top.n)} of ${fmt(changesSignificant)} changes (${pct}%).`;
}

export interface KindChip {
  readonly kind: string;
  readonly n: number;
}

export function buildKindChips(byKind: readonly { changeKind: string; isIgnored: boolean; count: number }[]): readonly KindChip[] {
  const totals = new Map<string, number>();
  for (const row of byKind) {
    if (row.isIgnored) continue;
    totals.set(row.changeKind, (totals.get(row.changeKind) ?? 0) + row.count);
  }
  return Array.from(totals.entries())
    .map(([kind, n]) => ({ kind, n }))
    .sort((a, b) => b.n - a.n);
}

// ── Attribution pills ────────────────────────────────────────────────────────

export const ATTR_INK: Record<ConfigChangeVerdict, string> = {
  attributed_change: "#34d399",
  accepted_risk: "#60a5fa",
  contested: "#c2a63d",
  unattributed: "#64748b",
  ignored: "#475569",
};

export const ATTR_LABEL: Record<ConfigChangeVerdict, string> = {
  attributed_change: "CHANGE REQUEST",
  accepted_risk: "ACCEPTED RISK",
  contested: "CONTESTED",
  unattributed: "UNATTRIBUTED",
  ignored: "IGNORED",
};

export const ATTR_TIP: Record<ConfigChangeVerdict, string> = {
  attributed_change: "Covered by a real, executed Change Request.",
  accepted_risk: "Covered by a real, active accepted-risk decision.",
  contested:
    "Both a Change Request and an accepted risk cover this row — kept as its own state for a human to resolve, never auto-picked.",
  unattributed: "Neither a Change Request nor an accepted risk explains this row yet.",
  ignored: "Suppressed by a noise rule — kept as its own verdict, not folded into unattributed.",
};

export interface AttrPill {
  readonly verdict: ConfigChangeVerdict;
  readonly n: string;
  readonly label: string;
  readonly ink: string;
  readonly tip: string;
}

const VERDICT_ORDER: readonly ConfigChangeVerdict[] = [
  "attributed_change",
  "accepted_risk",
  "contested",
  "unattributed",
  "ignored",
];

export function buildAttrPills(counts: Readonly<Record<ConfigChangeVerdict, number>>): readonly AttrPill[] {
  return VERDICT_ORDER.map((v) => ({
    verdict: v,
    n: fmt(counts[v]),
    label: ATTR_LABEL[v],
    ink: ATTR_INK[v],
    tip: ATTR_TIP[v],
  }));
}

// ── Group-by helpers for drill-down panels (real data, no invented prose) ──────

export interface CountRow {
  readonly k: string;
  readonly v: string;
}

/** Groups a list of not-comparable resources by their real, stored reason — the
 *  honest answer to "why couldn't this be compared", never a guess. */
export function groupByNotComparableReason(resources: readonly WireDiffResourceStatus[]): readonly CountRow[] {
  const counts = new Map<string, number>();
  for (const r of resources) {
    const reason = r.notComparableReason ?? "reason not recorded";
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => ({ k: `${reason} · ${n}`, v: "Resource types with this reason" }));
}

const LIFECYCLE_LABEL: Record<ConfigChangeLifecycleStatus, string> = {
  open: "open",
  resolved: "resolved",
  reopened: "reopened",
};

/** One real row's real attribution verdict + real CR/risk-decision ref + real
 *  lifecycle status (#2820) — the per-change detail #2759's endpoints already
 *  return but nothing rendered. `null` attribution means the pass has not run
 *  over this diff yet, which reads differently from `unattributed` and must
 *  never be flattened into it (same rule `readDiffVerdictRollup` documents). */
export function describeChangeAttribution(a: WireChangeAttribution | null): string {
  if (!a) return "Not attributed yet";
  const ref = a.crRef ?? a.rbdRef;
  const label = ATTR_LABEL[a.verdict];
  const withRef = ref ? `${label} · ${ref}` : label;
  return a.matchScope ? `${withRef} (matched at ${a.matchScope} level)` : withRef;
}

export function describeChangeLifecycle(l: WireChangeLifecycle | null): string | null {
  if (!l) return null;
  const base = LIFECYCLE_LABEL[l.status];
  return l.reopenCount > 0 ? `${base} · reopened ${l.reopenCount}×` : base;
}

/** Per-change detail rows for the change-group drill-down panel — real identity,
 *  real verdict/CR-or-risk-ref, real lifecycle status on every row, capped the same
 *  way `buildChangeGroups` caps its own list (a panel is a drill-down, not a dump). */
export function buildChangeDetailRows(changes: readonly WireChangeRow[], limit = 50): readonly CountRow[] {
  return changes.slice(0, limit).map((c) => {
    const label = c.objectDisplayName ?? shortResourceKey(c.resourceKey);
    const k = c.propertyPath ? `${label} · ${c.propertyPath}` : `${label} · ${c.changeKind}`;
    const lifecycle = describeChangeLifecycle(c.lifecycle);
    const v = lifecycle ? `${describeChangeAttribution(c.attribution)} · ${lifecycle}` : describeChangeAttribution(c.attribution);
    return { k, v };
  });
}

/** The most common skip/fail reason among a workload's real resource rows — the
 *  same "most common wire evidence" style the contract pack itself reports (§4.2),
 *  computed live instead of hardcoded per workload. */
export function mostCommonUnreadReason(resources: readonly WireSnapshotResourceRow[]): string | null {
  const unread = resources.filter((r) => r.status === "skipped" || r.status === "failed");
  if (unread.length === 0) return null;
  const counts = new Map<string, number>();
  for (const r of unread) {
    const reason = r.skipReason ?? r.errorCode ?? "unknown_error";
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  const [topReason, topCount] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]!;
  return `Most common reason: ${topReason} (${topCount} of ${unread.length} unread rows).`;
}
