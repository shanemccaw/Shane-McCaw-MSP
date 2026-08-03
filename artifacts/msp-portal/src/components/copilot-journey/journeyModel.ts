/**
 * journeyModel.ts — the view model the four Copilot Readiness screens render,
 * and the pure mapping that builds it from the platform's real payloads.
 *
 * The handoff's data contract is blunt about this: "Every number and fact on
 * screen is real, live, and specific to the tenant that just completed the scan.
 * Nothing is a template value." So this file's job is to translate what the
 * platform genuinely produces into what the design needs, and — just as
 * importantly — to say `null` everywhere it cannot, so a screen renders an
 * honest unavailable state rather than a plausible invention.
 *
 * Real sources, all already on the wire:
 *   • `GET /api/portal/assessment/war-room-pillars` → per-pillar score (0-100,
 *     higher = healthier, null when no evaluable rule feeds it) plus the real
 *     `msp_diagnostic_findings` rows for that pillar.
 *   • `GET /api/portal/assessment/status` → `copilotReadiness.overall.score`
 *     (the only real overall readiness figure the platform produces),
 *     `documents{items,expected,ready,generating,total}` for generation state,
 *     and `radar.pillars` as a coverage-gated cross-check.
 *   • `useScanStatus()` + `GET /api/portal/scan-plan` → live scan progress.
 *   • `GET /api/portal/assessment/sow` + `.../sow/payment-options` → the scope
 *     and its pricing.
 */

import { PILLAR_KEYS, PILLARS, type PillarKey } from "./journeyTokens.ts";

/* ------------------------------------------------------------------ *
 * Wire shapes — the subset of each payload this journey reads.
 * Declared structurally rather than imported so a change on either side shows
 * up here as a type error instead of silently reshaping the screens.
 * ------------------------------------------------------------------ */

export interface WirePillarFinding {
  readonly severity: "critical" | "warning";
  readonly checkKey: string;
  readonly title: string;
}

export interface WirePillarStat {
  readonly id: string;
  readonly label: string;
  readonly unit: "count" | "percent" | "currency";
  readonly value: number | null;
  readonly unavailableReason?: string;
  readonly checkKey: string | null;
}

export interface WirePillarCard {
  readonly pillar: string;
  readonly score: number | null;
  readonly stats?: readonly WirePillarStat[];
  readonly findings?: readonly WirePillarFinding[];
  readonly findingCounts?: { readonly critical: number; readonly warning: number };
  /**
   * Real `tenant_monitor_profiles` history, replayed through the same
   * per-check → pillar-impact resolution the score above uses
   * (api-server's pillar-trend.ts, #356). Absent/null below the server's own
   * minimum-data floor — never a synthesised shape.
   */
  readonly trend?: { readonly series: readonly number[]; readonly window: string } | null;
}

export interface WirePillarStatsPayload {
  readonly pillars: readonly WirePillarCard[];
  readonly findingsRunId?: string | null;
  readonly generatedAt?: string;
}

export interface WireDocumentItem {
  readonly id: number;
  readonly docType: string;
  readonly title: string;
  readonly status: string;
}

export interface WireAssessmentStatus {
  readonly documents?: {
    readonly items?: readonly WireDocumentItem[];
    readonly expected?: readonly { readonly docType: string; readonly title: string }[];
    readonly total?: number;
    readonly generating?: number;
    readonly ready?: number;
    readonly failed?: number;
    readonly allReady?: boolean;
  };
  readonly copilotReadiness?: {
    readonly overall?: { readonly score: number | null };
  } | null;
  readonly radar?: {
    readonly pillars?: readonly { readonly pillar: string; readonly score: number }[];
  };
}

/* ------------------------------------------------------------------ *
 * View model
 * ------------------------------------------------------------------ */

export interface JourneyTenant {
  readonly name: string;
  readonly seatCount: number | null;
  /** Already formatted for display — "3 August 2026" — or null if never scanned. */
  readonly scannedOn: string | null;
}

export interface JourneyPillarView {
  readonly key: PillarKey;
  readonly label: string;
  readonly primary: string;
  readonly accent: string;
  /** 0-100, higher = healthier. `null` means no evaluable rule fed it. */
  readonly score: number | null;
  /** The one finding this pillar leads with, verbatim from the scan. */
  readonly headline: string | null;
  /** Short findings used as radar chips — every one reappears in the pillar scene. */
  readonly chips: readonly string[];
  /** The satellite line on Scene 1: a specific finding, never a score. */
  readonly satelliteFinding: string | null;
  /**
   * Real time-series for this pillar, or `null`. Populated only where the
   * platform genuinely stores per-pillar history — see `pillarTrend()`.
   */
  readonly trend: { readonly series: readonly number[]; readonly window: string } | null;
  readonly criticalCount: number;
  readonly warningCount: number;
}

export interface JourneyDocumentView {
  readonly title: string;
  /**
   * The catalogue key. Load-bearing: it is what joins an expected entry to its
   * generated row, and what lets a caller tell the Executive Summary from
   * whatever happens to sort first.
   */
  readonly docType: string;
  /** Present once the platform has a row for it; null while it is still expected. */
  readonly id: number | null;
  readonly status: "ready" | "generating" | "failed" | "pending";
}

export interface JourneyGeneration {
  readonly ready: number;
  readonly total: number;
  readonly allReady: boolean;
  readonly documents: readonly JourneyDocumentView[];
}

export interface JourneyView {
  readonly tenant: JourneyTenant;
  /** The headline number. `null` when the platform has no covered indicator. */
  readonly readinessScore: number | null;
  /** Mean of the six post-remediation pillar scores, or null. */
  readonly remediatedScore: number | null;
  readonly pillars: readonly JourneyPillarView[];
  readonly generation: JourneyGeneration;
  /** True when this view is the labelled design preview rather than live data. */
  readonly isPreview: boolean;
}

/* ------------------------------------------------------------------ *
 * Mapping
 * ------------------------------------------------------------------ */

const READY_STATUSES = new Set(["approved", "delivered"]);

function isPillarKey(v: string): v is PillarKey {
  return (PILLAR_KEYS as readonly string[]).includes(v);
}

/**
 * Per-pillar score history, straight off the wire card's own `trend` field
 * (api-server's `pillar-trend.ts`, #356 — real `tenant_monitor_profiles`
 * history replayed through the same per-check → pillar-impact resolution the
 * pillar's live `score` already uses).
 *
 * This used to be a hardcoded `null` for every pillar: history was stored only
 * in `tenant_engine_snapshots`, keyed by ENGINE (health/security/drift) rather
 * than by any of these six pillars, and `resolveMetricHistory` hard-rejected
 * every key outside `SNAPSHOT_ENGINE_KEYS`. That gap is now closed server-side —
 * see pillar-trend.ts for the aggregation and its documented minimum-data floor.
 *
 * Still deliberately re-checked here rather than trusted blind: `series.length`
 * is re-verified against the floor so a malformed or truncated payload degrades
 * to "no sparkline" rather than a two-dot line pretending to be a trend.
 */
const MIN_RENDERABLE_TREND_POINTS = 5;

export function pillarTrend(card: WirePillarCard | undefined): JourneyPillarView["trend"] {
  const trend = card?.trend;
  if (!trend || trend.series.length < MIN_RENDERABLE_TREND_POINTS) return null;
  return trend;
}

function chipText(stat: WirePillarStat): string | null {
  if (stat.value === null || stat.unavailableReason) return null;
  if (stat.unit === "percent") return `${stat.label} ${Math.round(stat.value)}%`;
  if (stat.unit === "currency") {
    return `${stat.label} $${Math.round(stat.value / 100).toLocaleString("en-US")}`;
  }
  return `${Math.round(stat.value).toLocaleString("en-US")} ${stat.label.toLowerCase()}`;
}

export function buildPillarViews(
  payload: WirePillarStatsPayload | null | undefined,
): JourneyPillarView[] {
  const byKey = new Map<string, WirePillarCard>();
  (payload?.pillars ?? []).forEach((p) => byKey.set(p.pillar, p));

  return PILLAR_KEYS.map((key) => {
    const id = PILLARS[key];
    const card = byKey.get(key);
    const findings = card?.findings ?? [];
    // Criticals lead. Within a severity the scan's own order is kept — it is
    // already ranked by the check catalogue, so re-sorting would lose that.
    const ordered = [
      ...findings.filter((f) => f.severity === "critical"),
      ...findings.filter((f) => f.severity !== "critical"),
    ];
    const statChips = (card?.stats ?? [])
      .map(chipText)
      .filter((t): t is string => t !== null)
      .slice(0, 3);

    return {
      key,
      label: id.label,
      primary: id.primary,
      accent: id.accent,
      score: typeof card?.score === "number" ? card.score : null,
      headline: ordered[0]?.title ?? null,
      // Prefer real stat readouts as chips — they are the numbers the pillar
      // scene will show again. Fall back to finding titles so a pillar whose
      // stats are all unavailable still populates its wedge.
      chips: statChips.length ? statChips : ordered.slice(0, 3).map((f) => f.title),
      satelliteFinding: ordered[0]?.title ?? null,
      trend: pillarTrend(card),
      criticalCount: card?.findingCounts?.critical ?? 0,
      warningCount: card?.findingCounts?.warning ?? 0,
    };
  });
}

export function buildGeneration(status: WireAssessmentStatus | null | undefined): JourneyGeneration {
  const docs = status?.documents;
  const items = docs?.items ?? [];
  const expected = docs?.expected ?? [];

  // The expected set is the spine — a tenant mid-generation has fewer rows than
  // titles, and rendering only the rows would make the list grow as it runs,
  // which reads as the scope changing rather than the work progressing.
  //
  // There is deliberately NO fallback list. `expected` is empty on a status
  // fetch failure and on any tenant without an assessment service row, which is
  // precisely when a hardcoded list of nine would print deliverable names this
  // platform cannot generate. An empty set is honest; the screens render their
  // unavailable state from `total === 0`.
  //
  // Rows are joined to the expected set on `docType`, NOT on title. The two
  // titles come from different columns — `expected[].title` is admin free text
  // on the service's `associated_documents`, `items[].title` is
  // `document_types.label` — so any divergence in a title would leave every
  // document stuck on "pending" and the Executive Summary CTA would never appear.
  const spine: { docType: string; title: string }[] = expected.length
    ? expected.map((e) => ({ docType: e.docType, title: e.title }))
    : items.map((i) => ({ docType: i.docType, title: i.title }));

  const byDocType = new Map<string, WireDocumentItem>();
  items.forEach((it) => byDocType.set(it.docType, it));

  const documents: JourneyDocumentView[] = spine.map(({ docType, title }) => {
    const row = byDocType.get(docType);
    // Prefer the generated row's own title once it exists: it is the catalogue
    // label the report itself is headed with, so the switcher and the report
    // header cannot disagree.
    const shown = row?.title ?? title;
    if (!row) return { title: shown, docType, id: null, status: "pending" };
    if (READY_STATUSES.has(row.status)) return { title: shown, docType, id: row.id, status: "ready" };
    if (row.status === "failed") return { title: shown, docType, id: row.id, status: "failed" };
    return { title: shown, docType, id: row.id, status: "generating" };
  });

  const ready = documents.filter((d) => d.status === "ready").length;
  return {
    ready,
    total: documents.length,
    allReady: documents.length > 0 && ready === documents.length,
    documents,
  };
}

/**
 * The remediated figure: the mean of the six pillars' projected scores.
 *
 * Only pillars with a real current score contribute — a pillar the scan could
 * not evaluate is excluded from the mean rather than counted as zero, which
 * would drag the headline down by an amount that means nothing.
 */
export function remediatedScore(
  pillars: readonly JourneyPillarView[],
  projectedByPillar: Readonly<Partial<Record<PillarKey, number>>>,
): number | null {
  const values = pillars
    .filter((p) => p.score !== null)
    .map((p) => projectedByPillar[p.key] ?? (p.score as number));
  if (!values.length) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

export function buildJourneyView(input: {
  readonly tenant: JourneyTenant;
  readonly pillarStats: WirePillarStatsPayload | null | undefined;
  readonly status: WireAssessmentStatus | null | undefined;
  readonly projectedByPillar?: Readonly<Partial<Record<PillarKey, number>>>;
  readonly isPreview?: boolean;
}): JourneyView {
  const pillars = buildPillarViews(input.pillarStats);
  const overall = input.status?.copilotReadiness?.overall?.score;

  return {
    tenant: input.tenant,
    readinessScore: typeof overall === "number" ? overall : null,
    remediatedScore: remediatedScore(pillars, input.projectedByPillar ?? {}),
    pillars,
    generation: buildGeneration(input.status),
    isPreview: input.isPreview === true,
  };
}

/* ------------------------------------------------------------------ *
 * Copy that depends on the numbers
 * ------------------------------------------------------------------ */

/** "NOT FLIGHT-READY" / "CLEARED FOR ROLLOUT" — never shown when score is null. */
export function verdictLabel(score: number): string {
  return score >= 60 ? "Cleared for rollout" : "Not flight-ready";
}

export function verdictSentence(tenantName: string, score: number): string {
  return score >= 60
    ? `${tenantName} is cleared for Copilot rollout. Here is what still needs watching — and what keeps the score there.`
    : `${tenantName} is not flight-ready for Copilot. Here is exactly why — and what it takes to get there.`;
}

/**
 * Scene 9's closing headline — "N findings, one number. {tenant} is 27 points
 * from flight-ready".
 *
 * `scoredPillars` is what makes the first half true. The design's copy reads
 * "Six findings, one number", which is right for its six-pillar stand-in and
 * wrong for any tenant whose scan could not evaluate all six — the sentence's
 * whole rhetorical job is that the number in front of you is those findings
 * added up, so quoting six when four contributed breaks the one claim the scene
 * exists to make.
 *
 * Null when either end of the gap is unknown, so nothing is asserted about a
 * tenant we have not finished measuring.
 */
export function gapSentence(
  tenantName: string,
  score: number | null,
  remediated: number | null,
  scoredPillars: number,
): string | null {
  if (score === null || remediated === null) return null;
  const lead = scoredPillars > 0 ? `${numberWord(scoredPillars)} findings, one number. ` : "";
  const gap = remediated - score;
  if (gap <= 0) return `${lead}${tenantName} is already at ${score}.`;
  return `${lead}${tenantName} is ${gap} points from flight-ready — and every point is a known, fixable gap.`;
}

/** Small counts read better as words in a headline; anything larger stays numeric. */
function numberWord(n: number): string {
  const words = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
  return words[n] ?? String(n);
}

/** How many pillars this scan actually scored — the numerator in `gapSentence`. */
export function scoredPillarCount(pillars: readonly JourneyPillarView[]): number {
  return pillars.filter((p) => p.score !== null).length;
}

/** UK-style long date, matching the handoff's "3 August 2026". */
export function formatJourneyDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/** "Halden Materials · 1,240 seats", degrading cleanly when seats are unknown. */
export function tenantStrip(tenant: JourneyTenant): string {
  if (tenant.seatCount === null) return tenant.name;
  return `${tenant.name} · ${tenant.seatCount.toLocaleString("en-US")} seats`;
}
