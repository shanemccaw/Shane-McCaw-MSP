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

import {
  COPILOT_GATE_TARGET,
  JOURNEY_LIVE_DOCUMENTS,
  PILLAR_KEYS,
  PILLARS,
  isLiveRenderedDocument,
  liveDocumentFor,
  type PillarKey,
} from "./journeyTokens.ts";

/* ------------------------------------------------------------------ *
 * Wire shapes — the subset of each payload this journey reads.
 * Declared structurally rather than imported so a change on either side shows
 * up here as a type error instead of silently reshaping the screens.
 * ------------------------------------------------------------------ */

export interface WirePillarFinding {
  readonly severity: "critical" | "warning";
  readonly checkKey: string;
  readonly title: string;
  /**
   * The real signal weight behind this finding's own check (#414) — api-server's
   * `buildFindingRankWeights` over `signal_derivation_rules`, resolved through
   * the same `getSignalHealthImpacts` map the pillar's score is computed from.
   *
   * Weighed in THIS CARD'S OWN pillar column (corrected 2026-08-06): a finding
   * on the Security card carries its `securityImpact`, one on Licensing its
   * `licensingImpact`. It stays a flat number here — the card is already
   * pillar-scoped and a finding reaches exactly one card, so the server has
   * already picked the column that applies and the other six would be dead
   * weight on the wire. The correction is invisible to this file by design:
   * only the number changes, never its meaning as "rank within this card".
   *
   * Optional because a payload from before #414 (or the design fixture) has no
   * such field; absent is read as `0`, which sorts to the same place the
   * server's own "no rule feeds this check" case does.
   */
  readonly rankWeight?: number;
}

export interface WirePillarStat {
  readonly id: string;
  readonly label: string;
  readonly unit: "count" | "percent" | "currency";
  readonly value: number | null;
  readonly unavailableReason?: string;
  /**
   * Present ONLY alongside `unavailableReason === "license_gap"`: the real
   * Microsoft 365 add-on name the tenant's own scan reported as missing, as
   * `war-room-pillar-stats.ts` passes it through from the resolver (#451).
   *
   * The Copilot Readiness Report's Upgrade Opportunity category reads this
   * rather than mapping a check key to a tier of its own, so no line of that
   * copy can name a SKU the platform did not actually observe.
   */
  readonly licenseFeature?: string;
  readonly checkKey: string | null;
}

/**
 * WHY a score is (or is not) present — api-server's `evaluatePillarDisplay`
 * verdict, carried on the wire since #517 rather than inferred here.
 *
 * `"scored"` is the only state with a number. The other two are the distinction
 * a bare `null` could never draw, and drawing it is the whole of #517: a pillar
 * nothing feeds reads differently to a customer than one where a single check
 * came back clean and the platform declined to call that a 100.
 */
export interface WirePillarEvaluation {
  readonly status: "scored" | "insufficient_data" | "not_evaluated";
  readonly evaluableSignalCount: number;
  readonly minRequiredSignals: number;
  readonly reason: string;
}

export interface WirePillarCard {
  readonly pillar: string;
  readonly score: number | null;
  /**
   * Absent on a payload from before #517 and on the design fixture. Absent is
   * read as the old `score !== null` signal, so an old payload degrades to
   * exactly today's behaviour rather than to a wrong new one.
   */
  readonly evaluation?: WirePillarEvaluation;
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

/**
 * One Microsoft SKU a licence gap points at (#489), exactly as api-server's
 * `license-gap-purchase-links.ts` computed it. Never re-derived on this side:
 * the 1/2/3 tiering rule is a fact about the whole tenant, and a client that
 * recomputed it from whatever checks its own report happened to see would count
 * one category for a tenant that is actually gapped in three.
 */
export interface WireLicenseGapRecommendation {
  readonly categoryKeys: readonly string[];
  /** The same categories' customer-facing names, resolved server-side. */
  readonly categoryLabels: readonly string[];
  readonly sku: { readonly key: string; readonly name: string; readonly url: string };
  /** THIS tenant's real gapped check keys behind the link. */
  readonly checkKeys: readonly string[];
}

export interface WireLicenseGapPurchase {
  /** How many of the three gap categories are gapped. 3 means the E7 consolidation. */
  readonly tier: 1 | 2 | 3;
  readonly gappedCategories: readonly string[];
  /** True at tier 3 only: one consolidated recommendation replaced three. */
  readonly consolidated: boolean;
  readonly recommendations: readonly WireLicenseGapRecommendation[];
  /** Where the customer's own admin completes the purchase, in words. */
  readonly adminCenterPath: string;
}

export interface WirePillarStatsPayload {
  readonly pillars: readonly WirePillarCard[];
  /**
   * The run api-server's `fetchPillarFindings` sourced `pillars[].findings`
   * from — the just-finished run, or an older one being borrowed as a
   * placeholder mid-scan (findings write in one batch at run completion, so a
   * live run's own findings do not exist yet). `null` only when NO run has
   * EVER persisted findings for this tenant — first scan ever, or scan history
   * deleted (#524) — in which case every pillar's `findings` is `[]` for
   * reasons that have nothing to do with the tenant being clean. Absent on a
   * payload that predates this field (the design fixture, older tests), read
   * the same as `null` — no evidence, not a claim there is none.
   */
  readonly findingsRunId?: string | null;
  readonly generatedAt?: string;
  /**
   * The tenant-wide licence-gap purchase recommendation (#489). Absent/null
   * when this tenant has no licence gap, or when the payload predates #489 —
   * both render as no link at all, which is the honest outcome for a tenant we
   * have nothing to recommend to.
   */
  readonly licenseGapPurchase?: WireLicenseGapPurchase | null;
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
  /**
   * The real Copilot Gate (#358/#359) — the unified health engine's own
   * `copilot` pillar display score, plus its Go/No-Go verdict at 82. This is the
   * SAME number `war-room-pillars` serves for its copilot card, computed by the
   * same `computePillarDisplayScore` call, which is the whole point: the
   * headline verdict and the six pillar scenes beside it now come from one
   * engine instead of two unreconciled ones.
   */
  readonly copilotGate?: {
    readonly score: number | null;
    readonly threshold: number;
    readonly status: "go" | "no_go" | null;
    /**
     * The explicit real-coverage status behind `score` (#517). The server never
     * sends a number it did not genuinely measure, and this says which kind of
     * nothing a null is — so Scene 1 can write honest copy instead of one
     * catch-all "no readiness score" for three different tenants.
     */
    readonly evaluation?: WirePillarEvaluation;
  } | null;
  readonly copilotReadiness?: {
    readonly overall?: {
      /** Mirrors `copilotGate.score` — the engine's Copilot pillar. */
      readonly score: number | null;
      /**
       * The superseded narrow rollup: a 50/30/20 weighted mean of three
       * Compliance-adjacent sub-indicators, with no Security, Licensing,
       * Adoption, Health or Governance-ownership signal in it. Kept on the wire
       * as real detail about a real narrower thing, and deliberately NOT read
       * here — it is what the Reveal's headline used to show while its pillar
       * scenes showed the engine, which is the bug #358 exists to close.
       */
      readonly indicatorScore?: number | null;
    };
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
  /**
   * The one finding this pillar leads with, verbatim from the scan.
   *
   * `null` means this pillar genuinely has no data — no evaluable rule fed a
   * score for it, so nothing can be claimed either way (#399). It does NOT
   * mean "nothing to report": a pillar the scan actually evaluated with zero
   * critical/warning findings gets `CLEAN_PILLAR_HEADLINE` instead — a real,
   * positive result, not the absence of one.
   */
  readonly headline: string | null;
  /**
   * WHY this pillar has (or has not) a score — normalised from the wire, never
   * a `null` this file has to reinterpret at each render site (#517).
   */
  readonly evaluation: WirePillarEvaluation;
  /**
   * Short chips used on the radar wedge — up to three real finding titles,
   * worst-first, followed by up to three real stat readouts.
   *
   * NEVER EMPTY (#503). It used to be: `statChips.length ? statChips :
   * ordered.slice(0,3).map(f => f.title)` had no third branch, so a pillar whose
   * stats were all unavailable AND which had zero critical/warning findings
   * rendered a wedge with a label and nothing under it — visually identical to
   * "this thing is broken", whether the pillar was genuinely clean, genuinely
   * unmeasured, or genuinely below the coverage floor. `headline` has told those
   * apart since #399; this now gets the same treatment from the same signal, so
   * the wedge always says something true about itself.
   *
   * #520: findings used to be dropped entirely whenever any stat resolved — a
   * pillar with 6 real findings (5 critical) rendered only its one "14 global
   * administrators" stat chip, none of the findings. A stat is a number; a
   * finding is a problem, and a problem must never be hidden by a number that
   * happens to also be available. Findings now always lead this array when any
   * exist, with stats filling the remaining slots — both kinds render, neither
   * masks the other.
   *
   * `chipsAreReal` is what tells a caller which kind it is holding — see below.
   */
  readonly chips: readonly string[];
  /**
   * Whether `chips` holds real measured readouts or the honest explanatory
   * fallback above.
   *
   * Load-bearing, not decorative: the journey page decides whether ANY pillar
   * data landed by asking whether the pillars have content, and a `chips` array
   * that is never empty would make that question answer "yes" for a payload that
   * never arrived — turning a real error state into a screen full of polite
   * "not enough data" notes. Callers testing for real content must read this.
   */
  readonly chipsAreReal: boolean;
  /**
   * This pillar's real stat callouts, verbatim off the wire (#409).
   *
   * `chips` above is a *presentation* projection of these — the top three that
   * happen to have a value, formatted for a radar wedge — so it deliberately
   * drops both the ones with no value and the machine reason WHY. The Copilot
   * Readiness report needs all of it: which figure is real, which check is
   * behind it, and which kind of nothing an absent one is (`no_data` vs
   * `not_in_scan_package` vs `license_gap`, the distinction #341 exists to
   * draw). So the raw rows are carried through rather than re-fetched.
   *
   * Empty for a pillar the payload has no card for — never a synthesised row.
   */
  readonly stats: readonly WirePillarStat[];
  /**
   * This pillar's real `msp_diagnostic_findings` rows, verbatim off the wire,
   * criticals first (#343).
   *
   * `headline` and `chips` above are *presentation* projections of these — one
   * title, or three — so both drop the severity and the check key behind each
   * one. The Security Posture report's Identity & Access Risks and Device &
   * Endpoint Compliance sections need all three fields per row, so the rows are
   * carried through rather than re-fetched.
   *
   * Every real critical/warning finding, worst-first — no cap, here or
   * server-side. A tenant with a large real gap surfaces its full extent
   * rather than an arbitrary head of it.
   *
   * Empty for a pillar the payload has no card for, AND for a pillar that was
   * genuinely evaluated clean — the two are told apart by `score`, which is
   * null only in the first case (#399). Never a synthesised row.
   */
  readonly findings: readonly WirePillarFinding[];
  /**
   * The satellite line on Scene 1: a specific finding, or `CLEAN_PILLAR_HEADLINE`
   * when the pillar was evaluated and came back clean. Same `null`-means-no-data
   * rule as `headline`.
   */
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
  /**
   * WHY `readinessScore` is (or is not) a number (#517).
   *
   * Scene 1's verdict is the single most load-bearing claim in the whole
   * journey — a number, a "CLEARED FOR ROLLOUT"/"NOT FLIGHT-READY" label, and a
   * sentence built on both. None of that may be rendered from a figure the
   * platform did not genuinely measure, and this is how the scene knows which
   * of the three no-score states it is in so it can say so plainly.
   */
  readonly readinessEvaluation: WirePillarEvaluation;
  /** Mean of the six post-remediation pillar scores, or null. */
  readonly remediatedScore: number | null;
  readonly pillars: readonly JourneyPillarView[];
  readonly generation: JourneyGeneration;
  /**
   * The tenant-wide licence-gap purchase recommendation (#489), carried through
   * from the pillar-stats payload untouched. Null when nothing is gapped.
   *
   * It lives on the view rather than being threaded into each report separately
   * because all six reports render the same Upgrade Opportunity category and
   * must show the same tier — a report that reached a different tier from its
   * sibling would be two contradictory recommendations about one tenant.
   */
  readonly licenseGapPurchase: WireLicenseGapPurchase | null;
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

/**
 * #399: the headline/satellite text for a pillar the scan genuinely evaluated
 * (it has a real score) with zero critical/warning findings. A real, positive
 * result — not the same as "no data collected" — so it earns its own honest
 * copy rather than the bare `null` a pillar with no data gets. Kept as one
 * named constant so the Reveal's several render sites and this file's tests
 * can never drift onto slightly different wording.
 */
export const CLEAN_PILLAR_HEADLINE = "No critical or warning findings.";

/**
 * #517 / #503: what a wedge says when the platform declined to score its pillar.
 *
 * Two constants, not one, because they are two different facts about the tenant
 * and Shane's rule is that the screen states the one that is true: "we looked
 * and there was not enough to go on" is a different sentence from "this was not
 * part of your scan". Both are preferable to the alternative these replace — a
 * silently empty wedge, or (worse) a confident 100 computed from nothing.
 *
 * Kept beside `CLEAN_PILLAR_HEADLINE` so the three states that can produce an
 * empty finding list can never drift onto slightly different wording.
 */
export const INSUFFICIENT_PILLAR_CHIP = "Not enough scan data to score this pillar.";
export const UNEVALUATED_PILLAR_CHIP = "This pillar was not evaluated in your scan.";

/**
 * #518: what `insufficient_data` means while the scan producing this pillar's
 * signals is still running, instead of `INSUFFICIENT_PILLAR_CHIP`.
 *
 * `evaluatePillarDisplay` (server-side, #517) has no notion of an in-flight
 * run — its floor is a count of evaluable signals seen so far, so a pillar
 * whose checks simply haven't executed yet reads identically to one whose
 * completed scan genuinely stayed thin. Only the client knows a run is live
 * (`scan.running`, Scene 0's own signal), so this substitution happens here,
 * not in `pillarEvaluation()` — the wire's `insufficient_data` verdict itself
 * is unchanged and still the honest fact once the run finishes.
 *
 * #524: also shown for a `"scored"` pillar with zero findings while a scan is
 * live and no run has ever persisted findings for this tenant (see
 * `WirePillarStatsPayload.findingsRunId`). A pillar's score can become
 * computable from partial live signals well before the run completes and
 * writes its findings batch — `evaluatePillarDisplay`'s floor is about
 * SCORING coverage, not about whether findings exist yet, so `"scored"` alone
 * says nothing about that. With no fallback run to borrow a result from
 * either, an empty finding list here is not evidence of anything — showing
 * `CLEAN_PILLAR_HEADLINE` for it was this issue's confirmed live bug.
 */
export const SCANNING_PILLAR_CHIP = "Still scanning this pillar — check back when the scan completes.";

/**
 * The wire's evaluation verdict, or the honest reconstruction of it for a
 * payload that predates #517 (and for the design fixture, which has none).
 *
 * The fallback is deliberately the SAME `score !== null` signal `headline` has
 * used since #399 — so an old payload behaves exactly as it does today rather
 * than acquiring a new, wrong opinion about itself. It never invents
 * `"insufficient_data"`: that state is a server measurement, and a client with
 * no counts cannot honestly claim it.
 */
export function pillarEvaluation(card: WirePillarCard | undefined): WirePillarEvaluation {
  if (card?.evaluation) return card.evaluation;
  const scored = typeof card?.score === "number";
  return {
    status: scored ? "scored" : "not_evaluated",
    evaluableSignalCount: 0,
    minRequiredSignals: 0,
    reason: scored ? "scored" : "no score was reported for this pillar",
  };
}

/**
 * The chips for one pillar: real finding titles followed by real stat
 * readouts, else an honest line saying which kind of nothing this is (#503,
 * #517, #520).
 *
 * Findings lead. #520: this used to be `statChips.length ? statChips :
 * findingChips` — a stat resolving at all suppressed every finding for that
 * pillar outright, which is how Security's 6 real findings (5 critical) ended
 * up rendering as a single "14 global administrators" stat chip. A finding is
 * a real problem the scan found; a stat is a number. Neither is allowed to
 * hide the other, so both are concatenated — worst finding first — and a
 * caller that only has room for the first few chips sees the problem before
 * the number that accompanies it.
 */
function pillarChips(
  statChips: readonly string[],
  ordered: readonly WirePillarFinding[],
  evaluation: WirePillarEvaluation,
  stillScanning: boolean,
): { chips: readonly string[]; chipsAreReal: boolean } {
  const findingChips = ordered.slice(0, 3).map((f) => f.title);
  const chips = [...findingChips, ...statChips];
  if (chips.length) return { chips, chipsAreReal: true };

  if (evaluation.status === "insufficient_data") {
    // #518: a scan in progress hasn't finished collecting this pillar's
    // signals yet — a different fact from a complete-but-thin scan, so it
    // gets its own honest line instead of `INSUFFICIENT_PILLAR_CHIP`.
    if (stillScanning) return { chips: [SCANNING_PILLAR_CHIP], chipsAreReal: false };
    return { chips: [INSUFFICIENT_PILLAR_CHIP], chipsAreReal: false };
  }
  if (evaluation.status === "not_evaluated") {
    return { chips: [UNEVALUATED_PILLAR_CHIP], chipsAreReal: false };
  }
  // Scored, with zero stat readouts and zero critical/warning findings. #524:
  // that is only a genuine positive result once there is real evidence behind
  // it — this run's own completed findings, or an older real run's — which is
  // exactly what `stillScanning` is false for here. While it's true, an empty
  // list means nothing yet, not a clean bill of health.
  if (stillScanning) return { chips: [SCANNING_PILLAR_CHIP], chipsAreReal: false };
  return { chips: [CLEAN_PILLAR_HEADLINE], chipsAreReal: false };
}

function chipText(stat: WirePillarStat): string | null {
  if (stat.value === null || stat.unavailableReason) return null;
  if (stat.unit === "percent") return `${stat.label} ${Math.round(stat.value)}%`;
  if (stat.unit === "currency") {
    return `${stat.label} $${Math.round(stat.value).toLocaleString("en-US")}`;
  }
  return `${Math.round(stat.value).toLocaleString("en-US")} ${stat.label.toLowerCase()}`;
}

/**
 * The order a pillar presents its findings in — and therefore which one becomes
 * its headline and satellite (#414).
 *
 * Criticals lead, exactly as before: this changes ordering WITHIN a severity
 * tier only, never across tiers, so a heavily-weighted warning can never
 * displace a critical.
 *
 * Within a tier, findings order by their real `rankWeight` — the weight
 * api-server resolved from `signal_derivation_rules` for that finding's own
 * check. Before this, the tier kept raw array order, which the previous comment
 * here justified as "already ranked by the check catalogue". That was not true:
 * the server's order was `checkKey.localeCompare`, i.e. alphabetical. That is
 * precisely how "No enabled break-glass account" came to outrank the tenant's
 * Conditional Access findings as Security's headline — `identity:break-glass-
 * health` sorts ahead of both `identity:ca-mfa-coverage` and
 * `identity:ca-policy-count` on `b` before `c`, and nothing else was consulted.
 *
 * Ties keep the server's own order (`sort` is stable), so a payload whose
 * weights are all equal — or one from before #414, which carries no weights at
 * all — degrades to exactly today's behaviour rather than to something
 * arbitrary. That degradation is not hypothetical: the first version of this
 * fix ranked every pillar by `copilot_impact`, which live data then showed is
 * flat at 0 outside the Copilot pillar itself, so every Security finding tied
 * and this fell through to the server's alphabetical order — the original bug,
 * intact. Ranking is per-pillar since 2026-08-06; see api-server's
 * `FINDING_RANK_IMPACT_FIELD` for the measured reason.
 *
 * Note this is a genuine second application of a rank the server already
 * applied, not the only one: every real finding survives (there is no cap,
 * here or server-side), so this decides only how the full set reads — which
 * one leads. Doing it here too is what keeps the headline honest for any
 * caller that assembles a payload itself — the design fixture, and this
 * file's tests.
 *
 * Exported for tests.
 */
export function orderPillarFindings(
  findings: readonly WirePillarFinding[],
): readonly WirePillarFinding[] {
  const severityRank = (f: WirePillarFinding) => (f.severity === "critical" ? 0 : 1);
  return [...findings].sort(
    (a, b) => severityRank(a) - severityRank(b) || (b.rankWeight ?? 0) - (a.rankWeight ?? 0),
  );
}

export function buildPillarViews(
  payload: WirePillarStatsPayload | null | undefined,
  // #518: true while a scan is genuinely running right now (Scene 0). Purely
  // additive — every existing caller (tests, the design fixture) omits it and
  // gets today's behaviour unchanged.
  scanRunning = false,
): JourneyPillarView[] {
  const byKey = new Map<string, WirePillarCard>();
  (payload?.pillars ?? []).forEach((p) => byKey.set(p.pillar, p));

  // #524: whether ANY run — this one, or an older one being borrowed as a
  // placeholder — has ever persisted findings for this tenant. See
  // `WirePillarStatsPayload.findingsRunId`. One tenant-wide fact, computed
  // once: `fetchPillarFindings` (api-server) is a single query per request, so
  // every pillar's `findings` is empty for the exact same reason when this is
  // true — there is nothing per-pillar to distinguish here.
  const noFindingsSourceRun = (payload?.findingsRunId ?? null) === null;

  return PILLAR_KEYS.map((key) => {
    const id = PILLARS[key];
    const card = byKey.get(key);
    const findings = card?.findings ?? [];
    const ordered = orderPillarFindings(findings);
    const statChips = (card?.stats ?? [])
      .map(chipText)
      .filter((t): t is string => t !== null)
      .slice(0, 3);

    // #399: `ordered` only ever holds critical/warning findings — the wire
    // never sends "ok" ones — so an empty `ordered` is ambiguous by itself: it
    // means either "this pillar was never evaluated" or "it was evaluated and
    // came back clean". `evaluation.status` is the platform's own signal for
    // which, carried explicitly since #517 (and reconstructed from the old
    // `score !== null` signal for a payload that predates it), so a scored
    // pillar with zero findings is a genuine clean result, not a gap. Only THAT
    // combination gets the honest positive headline; an unscored pillar keeps
    // the `null` that renders the scenes' "no finding was recorded" state.
    const evaluation = pillarEvaluation(card);
    const wasEvaluated = evaluation.status === "scored";
    // #518/#524: `insufficient_data` while a scan is live means "hasn't
    // finished collecting yet", not "stayed thin". A `"scored"` pillar with an
    // empty finding list while a scan is live AND no run has ever persisted
    // findings for this tenant means the same thing for a different reason —
    // the score came from partial live signals, which race ahead of the
    // findings batch write, and there is no completed prior run to borrow a
    // real result from either. Both read as "still scanning", never as clean.
    // `not_evaluated` (no evaluable rule exists at all) is a structural gap
    // unrelated to scan timing and is left alone.
    const stillScanning =
      scanRunning &&
      (evaluation.status === "insufficient_data" || (wasEvaluated && noFindingsSourceRun));
    // `stillScanning` is checked FIRST: a pillar can be `"scored"` (wasEvaluated)
    // and still have nothing real to show yet (#524), and that must win over the
    // clean headline — a live scan's honest "don't know yet" outranks a stale
    // "evaluated" flag that raced ahead of the findings it would need to prove.
    const leadTitle =
      ordered[0]?.title ??
      (stillScanning ? SCANNING_PILLAR_CHIP : wasEvaluated ? CLEAN_PILLAR_HEADLINE : null);
    const { chips, chipsAreReal } = pillarChips(statChips, ordered, evaluation, stillScanning);

    return {
      key,
      label: id.label,
      primary: id.primary,
      accent: id.accent,
      score: typeof card?.score === "number" ? card.score : null,
      headline: leadTitle,
      evaluation,
      // Real finding titles lead, real stat readouts follow — a stat must never
      // hide a real problem the scan found (#520). Falls back to an honest
      // explanatory line so a pillar with neither is never silently empty (#503).
      chips,
      chipsAreReal,
      stats: card?.stats ?? [],
      // `ordered`, not `findings`: criticals lead, and within a severity the
      // real signal weight ranks (#414) — the same ranking every other
      // projection above already reads.
      findings: ordered,
      satelliteFinding: leadTitle,
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
 * Every live-rendered document, guaranteed present in a document set (#424,
 * generalised in #343).
 *
 * WHY THIS EXISTS. Every other document in the set is a row the old async
 * generation pipeline writes: it is listed because `GET
 * /api/portal/assessment/status` said so, and it is readable because that
 * pipeline finished writing its HTML. A document on the new pattern is not one
 * of those. It is rendered live, in the browser, from the tenant's own scan data
 * — the pillar payload plus its narrative route (#409) — so its content exists
 * the moment the scan does, with nothing to generate, no row to wait for and no
 * assessment service scope to be listed by.
 *
 * `buildGeneration`'s spine is `documents.expected` (falling back to the
 * generated rows), which is exactly the wrong shape for that: a tenant with no
 * assessment service row, or one whose service does not name a deliverable,
 * gets an empty set, so the documents the platform can always render were the
 * ones that could never be resolved to render them. This closes that: they are
 * constructed here rather than looked up.
 *
 * WHAT IT DOES NOT DO. It never touches the other documents, and it never
 * invents one — a set with no rows gets exactly the entries in
 * `JOURNEY_LIVE_DOCUMENTS` and nothing else. A row the pipeline HAS generated
 * (`id !== null`) is left completely alone, so the generated HTML and its PDF
 * export keep behaving as they do today; only the "listed but never generated"
 * and "not listed at all" cases are filled in, and both get `ready` because for
 * these documents there is genuinely nothing outstanding to wait for.
 *
 * `ready`/`total` are recomputed from the resulting list so the counter and the
 * rows it counts can never disagree.
 */
export function withLiveDocuments(generation: JourneyGeneration): JourneyGeneration {
  let documents = generation.documents;
  const added: JourneyDocumentView[] = [];

  for (const live of JOURNEY_LIVE_DOCUMENTS) {
    const index = documents.findIndex((d) => liveDocumentFor(d)?.key === live.key);
    const existing = index >= 0 ? documents[index] : null;

    // A real generated row owns its own state — including a `failed` one, which
    // is a fact about the pipeline this must not paper over.
    if (existing && existing.id !== null) continue;

    if (existing) {
      documents = documents.map((d, i) => (i === index ? { ...d, status: "ready" } : d));
    } else {
      added.push({ title: live.title, docType: live.docType, id: null, status: "ready" });
    }
  }

  // Nothing to do — return the same object so a memoised caller sees no change.
  if (added.length === 0 && documents === generation.documents) return generation;

  // Added entries lead, in registry order: the roll-up is the report the others
  // expand on, and the design's own set leads with it.
  const all = added.length ? [...added, ...documents] : documents;
  const ready = all.filter((d) => d.status === "ready").length;
  return { ready, total: all.length, allReady: ready === all.length, documents: all };
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
  /** #518: true while a scan is genuinely running right now (Scene 0). */
  readonly scanRunning?: boolean;
}): JourneyView {
  const pillars = buildPillarViews(input.pillarStats, input.scanRunning === true);
  // `copilotGate.score` is the canonical headline: the engine's Copilot pillar.
  // `copilotReadiness.overall.score` now carries the identical number, but it is
  // null whenever the last completed run has no tenantId (the sub-indicators
  // need one; the engine, keyed by customerId, does not), so reading the gate
  // first is what keeps a real score from being dropped on the floor.
  const gateScore = input.status?.copilotGate?.score;
  const overall =
    typeof gateScore === "number" ? gateScore : input.status?.copilotReadiness?.overall?.score;
  const readinessScore = typeof overall === "number" ? overall : null;

  // #517: prefer the server's own verdict. The fallback keeps a pre-#517 status
  // payload behaving exactly as it does today — a number means scored, no number
  // means nothing was evaluated — and never claims `"insufficient_data"`, which
  // only the server can honestly report because only the server counts signals.
  const readinessEvaluation: WirePillarEvaluation = input.status?.copilotGate?.evaluation ?? {
    status: readinessScore === null ? "not_evaluated" : "scored",
    evaluableSignalCount: 0,
    minRequiredSignals: 0,
    reason:
      readinessScore === null
        ? "no readiness score was reported for this tenant"
        : "scored",
  };

  return {
    tenant: input.tenant,
    readinessScore,
    readinessEvaluation,
    remediatedScore: remediatedScore(pillars, input.projectedByPillar ?? {}),
    pillars,
    generation: buildGeneration(input.status),
    licenseGapPurchase: input.pillarStats?.licenseGapPurchase ?? null,
    isPreview: input.isPreview === true,
  };
}

/* ------------------------------------------------------------------ *
 * Copy that depends on the numbers
 * ------------------------------------------------------------------ */

/**
 * "NOT FLIGHT-READY" / "CLEARED FOR ROLLOUT" — never shown when score is null.
 *
 * Keyed off `COPILOT_GATE_TARGET`, the real 82 Gate (#359), NOT a separately
 * invented cutoff. The Reveal's verdict, the Document Viewer's gate chip and the
 * SOW's projected-score line are the same verdict about the same tenant, so they
 * read the same constant.
 */
export function verdictLabel(score: number): string {
  return score >= COPILOT_GATE_TARGET ? "Cleared for rollout" : "Not flight-ready";
}

export function verdictSentence(tenantName: string, score: number): string {
  return score >= COPILOT_GATE_TARGET
    ? `${tenantName} is cleared for Copilot rollout. Here is what still needs watching — and what keeps the score there.`
    : `${tenantName} is not flight-ready for Copilot. Here is exactly why — and what it takes to get there.`;
}

/**
 * Scene 9's closing headline — "N findings, one number. {tenant} is 41 points
 * from flight-ready".
 *
 * `scoredPillars` is what makes the first half true. The design's copy reads
 * "Six findings, one number", which is right for its six-pillar stand-in and
 * wrong for any tenant whose scan could not evaluate all six — the sentence's
 * whole rhetorical job is that the number in front of you is those findings
 * added up, so quoting six when four contributed breaks the one claim the scene
 * exists to make.
 *
 * "POINTS FROM FLIGHT-READY" MEANS THE DISTANCE TO THE GATE, NOT TO THE
 * PROJECTION. This used to quote `remediated − score` — the improvement the
 * remediation scope buys — and call that the distance to flight-ready. That was
 * defensible only while the gate sat at 60, close to where a typical projection
 * lands. At the real 82 (#359) it is plainly false: a tenant at 41 whose scope
 * projects 68 is 41 points from flight-ready and the scope closes 27 of them.
 * Quoting 27 on the screen that hands the customer into a $36k proposal would
 * tell them the work on offer finishes the job when it does not. So the gap is
 * measured to `COPILOT_GATE_TARGET`, and whether the scope actually clears it is
 * stated rather than implied.
 *
 * Null when either end is unknown, so nothing is asserted about a tenant we have
 * not finished measuring.
 */
export function gapSentence(
  tenantName: string,
  score: number | null,
  remediated: number | null,
  scoredPillars: number,
): string | null {
  if (score === null || remediated === null) return null;
  const lead = scoredPillars > 0 ? `${numberWord(scoredPillars)} findings, one number. ` : "";
  const toGate = COPILOT_GATE_TARGET - score;
  if (toGate <= 0) return `${lead}${tenantName} is already cleared for Copilot at ${score}.`;
  // The remediation reaches the gate: the whole gap is on the table, which is
  // the claim the original sentence wanted to make and can now make truthfully.
  if (remediated >= COPILOT_GATE_TARGET) {
    return `${lead}${tenantName} is ${toGate} points from flight-ready — and every point is a known, fixable gap.`;
  }
  const closes = remediated - score;
  // The remediation does not reach the gate. Say both numbers rather than the
  // flattering one; the shortfall is a real scope conversation, not a rounding
  // error to bury.
  if (closes <= 0) {
    return `${lead}${tenantName} is ${toGate} points from flight-ready — every point a known, fixable gap.`;
  }
  return `${lead}${tenantName} is ${toGate} points from flight-ready. This scope closes ${closes} of them.`;
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

/**
 * Which pillar a report belongs to, read off its own name.
 *
 * PRESENTATION ONLY. It picks the accent colour for the reading card's top band,
 * the ambient glow behind the pane and the highlighted badge in the header's
 * pillar strip — nothing it returns is ever stated as fact to the customer, and
 * `null` (the roll-up report, the remediation guide, or simply a title this
 * cannot read) falls back to the journey's own blue→teal rather than guessing.
 *
 * A name match rather than a catalogue lookup because there is no catalogue
 * column that carries a pillar: `document_types` keys the report, not the pillar
 * behind it. If one is ever added, this should read it instead.
 *
 * First match in `PILLAR_KEYS` order wins, so a title naming two pillars takes
 * the earlier one. That is arbitrary, and deliberately so — it is a colour.
 */
export function documentPillar(doc: { readonly title: string; readonly docType: string } | null): PillarKey | null {
  if (!doc) return null;
  const haystack = `${doc.title} ${doc.docType}`.toLowerCase();
  return PILLAR_KEYS.find((key) => haystack.includes(key)) ?? null;
}

/**
 * Whether `DocumentBody`'s "nothing to show" unavailable state should win over
 * rendering `doc` (#409, #416).
 *
 * `gen.known` tracks the OLD async document-generation pipeline's
 * expected/generated-row count. For a document ported to the new
 * prose-generation pattern that concept genuinely does not exist — structure
 * and prose render straight from the tenant's own scan data, with no run to
 * wait for — so a resolved `doc` on that pattern is real regardless of what
 * `gen.known` says. Every document still on the old pattern keeps the gate
 * exactly as it works today.
 *
 * #343: "on that pattern" is `JOURNEY_LIVE_DOCUMENTS` membership, not a named
 * report. This function therefore needs no edit when a document is ported — the
 * registry entry is the whole of it.
 */
export function isGenerationUnknown(
  doc: JourneyDocumentView | null,
  gen: { readonly known: boolean },
): boolean {
  if (!doc) return true;
  if (gen.known) return false;
  return !isLiveRenderedDocument(doc);
}

/** "Halden Materials · 1,240 seats", degrading cleanly when seats are unknown. */
export function tenantStrip(tenant: JourneyTenant): string {
  if (tenant.seatCount === null) return tenant.name;
  return `${tenant.name} · ${tenant.seatCount.toLocaleString("en-US")} seats`;
}
