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
  /** Short findings used as radar chips — every one reappears in the pillar scene. */
  readonly chips: readonly string[];
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

/**
 * #399: the headline/satellite text for a pillar the scan genuinely evaluated
 * (it has a real score) with zero critical/warning findings. A real, positive
 * result — not the same as "no data collected" — so it earns its own honest
 * copy rather than the bare `null` a pillar with no data gets. Kept as one
 * named constant so the Reveal's several render sites and this file's tests
 * can never drift onto slightly different wording.
 */
export const CLEAN_PILLAR_HEADLINE = "No critical or warning findings.";

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

    // #399: `ordered` only ever holds critical/warning findings — the wire
    // never sends "ok" ones — so an empty `ordered` is ambiguous by itself: it
    // means either "this pillar was never evaluated" or "it was evaluated and
    // came back clean". `score` is the platform's own signal for which: it is
    // `null` precisely when no evaluable rule fed this pillar (see the field's
    // doc above), so a real score plus zero findings is a genuine clean
    // result, not a gap. Only THAT combination gets the honest positive
    // headline; a pillar with no score keeps the `null` that renders the
    // scenes' existing "no finding was recorded" unavailable state.
    const wasEvaluated = typeof card?.score === "number";
    const leadTitle = ordered[0]?.title ?? (wasEvaluated ? CLEAN_PILLAR_HEADLINE : null);

    return {
      key,
      label: id.label,
      primary: id.primary,
      accent: id.accent,
      score: typeof card?.score === "number" ? card.score : null,
      headline: leadTitle,
      // Prefer real stat readouts as chips — they are the numbers the pillar
      // scene will show again. Fall back to finding titles so a pillar whose
      // stats are all unavailable still populates its wedge.
      chips: statChips.length ? statChips : ordered.slice(0, 3).map((f) => f.title),
      stats: card?.stats ?? [],
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
}): JourneyView {
  const pillars = buildPillarViews(input.pillarStats);
  // `copilotGate.score` is the canonical headline: the engine's Copilot pillar.
  // `copilotReadiness.overall.score` now carries the identical number, but it is
  // null whenever the last completed run has no tenantId (the sub-indicators
  // need one; the engine, keyed by customerId, does not), so reading the gate
  // first is what keeps a real score from being dropped on the floor.
  const gateScore = input.status?.copilotGate?.score;
  const overall =
    typeof gateScore === "number" ? gateScore : input.status?.copilotReadiness?.overall?.score;

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
