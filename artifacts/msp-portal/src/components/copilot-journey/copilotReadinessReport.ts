/**
 * copilotReadinessReport.ts — the real Copilot Readiness, Safety & Enablement
 * Report, as data (#409).
 *
 * This is the live counterpart to `previewDocumentBodies.ts`'s
 * `COPILOT_READINESS_REPORT`: the same ordered-block structure the design
 * approved, built from one real tenant's own `war-room-pillars` payload and the
 * three AI-written sections from `/portal/assessment/copilot-readiness-narrative`
 * instead of from Halden Materials' worked example.
 *
 * A pure `.ts` and not inlined into the renderer for two reasons — `node --test`
 * cannot load `.tsx`, so the rules below are testable; and the platform's
 * no-hardcoding rule keeps seat counts and dollar figures out of `.tsx`. Every
 * number here arrives from the wire; none is written down.
 *
 * ── TWO STRUCTURAL CHANGES SHANE APPROVED ────────────────────────────────────
 *   1. "Copilot Drift & Violations" is DROPPED entirely. The design's version
 *      cites "37 tenant configuration changes with no recorded review", a Safe
 *      Links policy disabled on a named date, and labels removed from 148 sites
 *      — none of which has a producer. The registry's drift metrics
 *      (`drift:ca-policy`, `drift:security-defaults`, …) are not among the 28
 *      stats `war-room-pillars` resolves, so there is nothing real to put in
 *      that section and it is absent rather than approximated.
 *   2. "Personas ready today" is DROPPED from the Readiness Summary. Personas
 *      are a War Room-era feature out of scope for this document, and the
 *      platform holds no per-tenant persona readiness count anyway.
 *
 * ── THE RULE EVERY PURE-DATA SECTION FOLLOWS ─────────────────────────────────
 * A row is rendered ONLY from a stat with a real, finite `value`. A stat with a
 * null value never becomes a row — not a zero, not an em dash inside a
 * severity-coloured value, not "not measured" dressed as a finding. Those are
 * collected instead into one honest `unavailable` block per section, which
 * names the real `monitor_checks` key and the resolver's own machine reason, so
 * "this check never ran" (`not_in_scan_package`) stays distinguishable from
 * "it ran and reported nothing" (`no_data`) — the distinction #341 exists to
 * draw, carried all the way to the customer's report.
 *
 * A section with no real rows AND no missing checks to name renders nothing at
 * all rather than an empty table.
 *
 * ── WHY TONE COMES FROM THE PILLAR, NOT THE NUMBER ───────────────────────────
 * `keyValues` rows carry a severity tone. Deriving one per stat would mean
 * inventing a threshold per metric ("how many legacy sign-ins is amber?"), and
 * this platform's own severity thresholds live in `severity_rules`, in the
 * database, per check — not here. So a row takes the band of the pillar it
 * belongs to via `severityForScore`, which is the platform's existing, real
 * severity for that area and the same band the reader already saw on the Reveal
 * and in the header's pillar strip. A pillar with no score yields a neutral
 * "attention" tone and says so in the row's own text.
 */

import {
  COPILOT_GATE_TARGET,
  PILLARS,
  severityForScore,
  type PillarKey,
  type Severity,
} from "./journeyTokens.ts";
import type { JourneyPillarView, JourneyView, WirePillarStat } from "./journeyModel.ts";
import type { PreviewKeyValueRow, ReportBlock, ReportSection } from "./previewDocumentBodies.ts";

/* ------------------------------------------------------------------ *
 * The narrative wire shape — mirrors the api-server route's response
 * ------------------------------------------------------------------ */

export type ReadinessNarrativeSectionKey = "safety" | "enablement" | "blockers";

export interface WireNarrativeSection {
  readonly key: ReadinessNarrativeSectionKey;
  readonly heading: string;
  readonly html: string | null;
  readonly omittedReason: string | null;
  readonly factCount: number;
  readonly missingChecks?: readonly { readonly checkKey: string; readonly reason: string }[];
}

export interface WireNarrativePayload {
  readonly sections: readonly WireNarrativeSection[];
  readonly gate?: { readonly score: number | null; readonly threshold: number; readonly status: string | null };
  readonly scannedCheckCount?: number;
  readonly scannedPackageKeys?: readonly string[];
}

/* ------------------------------------------------------------------ *
 * Blocks — the shared vocabulary plus the two this report needs
 * ------------------------------------------------------------------ */

/**
 * A block the shared `ReportBlocks.tsx` renderer does not know about, handled
 * by this report's own renderer before it delegates. Deliberately additive
 * rather than widening `ReportBlock`: widening it would force every `switch` in
 * the preview path to grow cases for shapes the design's fixtures can never
 * produce, for no benefit.
 */
export type ReadinessExtraBlock =
  /** One AI-written section's sanitised HTML fragment. */
  | { readonly kind: "narrative"; readonly html: string }
  /**
   * The honest empty state. `checks` names what the platform wanted and did
   * not get; `detail` says what that means. Never styled as a finding.
   */
  | {
      readonly kind: "unavailable";
      readonly detail: string;
      readonly checks: readonly { readonly checkKey: string; readonly reason: string }[];
    };

export type ReadinessBlock = ReportBlock | ReadinessExtraBlock;

export interface ReadinessSection {
  readonly heading: string;
  readonly blocks: readonly ReadinessBlock[];
}

export interface ReadinessReport {
  readonly kicker: string;
  readonly headline: string;
  readonly standfirst: string;
  readonly verdict: { readonly eyebrow: string; readonly headline: string; readonly sub: string };
  readonly sections: readonly ReadinessSection[];
  readonly closing: readonly string[];
  readonly provenance: string;
  /** The note beside the radar, derived from this tenant's own scores. */
  readonly radarNote: string;
}

/* ------------------------------------------------------------------ *
 * Stat helpers
 * ------------------------------------------------------------------ */

/** A real stat: one that carries a real, finite number. */
export type RealStat = WirePillarStat & { readonly value: number };

/**
 * A stat is quotable only when it carries a real, finite number.
 *
 * The predicate narrows to `RealStat` rather than to `WirePillarStat`, which
 * matters: narrowing to the whole type would make the ELSE branch `undefined`,
 * and the else branch is exactly where a stat that exists but has no value
 * lives — the one this report has to name as a missing check.
 */
export function isRealStat(stat: WirePillarStat | undefined): stat is RealStat {
  return !!stat && typeof stat.value === "number" && Number.isFinite(stat.value);
}

/**
 * Render a real stat value. No rounding or bucketing: this is the same number
 * the Reveal's chips show for the same tenant, and two surfaces disagreeing
 * about one figure is the failure the whole journey is built to avoid.
 */
export function formatStat(stat: RealStat): string {
  const value = stat.value;
  if (stat.unit === "percent") return `${Math.round(value)}%`;
  // Currency stats arrive in whole dollars from `war-room-pillar-stats.ts`'s
  // `centsToDollars` — NOT in cents like the Reveal's chip formatter assumes
  // for its own inputs. Formatted as given rather than divided again.
  if (stat.unit === "currency") return `$${Math.round(value).toLocaleString("en-US")}`;
  return Math.round(value).toLocaleString("en-US");
}

/** Human wording for the resolver's machine reason. Never invents a cause. */
export function unavailableReasonText(reason: string | undefined): string {
  switch (reason) {
    case "not_in_scan_package":
      return "not included in the scan package this tenant has run";
    case "no_data":
      return "in the scan, but reported no value";
    case "license_gap":
      return "requires a licence tier this tenant does not hold";
    case "unknown_check_key":
    case "unknown_metric_key":
      return "not wired to a check in the catalogue";
    case "no_seat_data":
      return "no subscribed-SKU data for this tenant";
    case "no_sku_prices":
      return "no priced SKU to value it against";
    case "resolver_error":
      return "failed to resolve on the last run";
    case "non_numeric_value":
      return "returned a value that is not a number";
    case "no_evaluable_rules":
      return "no evaluable rule feeds it";
    default:
      return reason ? `unavailable (${reason})` : "unavailable";
  }
}

/** The pillar's own severity band — see the header for why not the number's. */
function pillarTone(pillar: JourneyPillarView | undefined): Severity {
  return typeof pillar?.score === "number" ? severityForScore(pillar.score) : "attention";
}

interface StatPick {
  /** The stat id as `war-room-pillar-stats.ts` names it — never matched on label. */
  readonly statId: string;
  readonly pillar: PillarKey;
  /** The row label. The stat's own caption is appended as the value's unit. */
  readonly label: string;
  /** Reads better than the raw caption in a prerequisites table. */
  readonly caption: string;
}

function findStat(pillars: readonly JourneyPillarView[], pick: StatPick): WirePillarStat | undefined {
  return pillars.find((p) => p.key === pick.pillar)?.stats.find((s) => s.id === pick.statId);
}

interface BuiltRows {
  readonly rows: readonly PreviewKeyValueRow[];
  readonly missing: readonly { readonly checkKey: string; readonly reason: string }[];
}

/**
 * Turn a list of wanted stats into real rows plus a list of what was missing.
 *
 * Rows keep the order of `picks`, not of the payload, so the table reads the
 * same way for every tenant regardless of which of its checks reported.
 */
function buildRows(pillars: readonly JourneyPillarView[], picks: readonly StatPick[]): BuiltRows {
  const rows: PreviewKeyValueRow[] = [];
  const missing: { checkKey: string; reason: string }[] = [];

  for (const pick of picks) {
    const stat = findStat(pillars, pick);
    const pillar = pillars.find((p) => p.key === pick.pillar);
    if (isRealStat(stat)) {
      rows.push({
        label: pick.label,
        tone: pillarTone(pillar),
        value: `${formatStat(stat)} ${pick.caption}`,
      });
    } else if (stat?.checkKey) {
      missing.push({ checkKey: stat.checkKey, reason: stat.unavailableReason ?? "no_data" });
    }
  }

  return { rows, missing };
}

/** One `keyValues` block, or nothing when no row is real. */
function keyValuesBlock(rows: readonly PreviewKeyValueRow[]): ReadinessBlock[] {
  return rows.length ? [{ kind: "keyValues", rows }] : [];
}

/** One honest `unavailable` block, or nothing when there is nothing to declare. */
function unavailableBlock(
  detail: string,
  checks: readonly { readonly checkKey: string; readonly reason: string }[],
): ReadinessBlock[] {
  return checks.length ? [{ kind: "unavailable", detail, checks }] : [];
}

/* ------------------------------------------------------------------ *
 * Section 1 — Copilot Readiness Summary
 * ------------------------------------------------------------------ */

/**
 * The blast-radius row, from the stats the platform already computes.
 *
 * NOT a new computation, and NOT the design's ring diagram. `security.blastRadius`
 * ("items in blast radius") and `governance.exposure` ("items over-exposed") are
 * the SAME real metric — `copilot.overshareExposureCount`, over
 * `copilot:overshare-exposure` — deliberately shown on both cards, and it is
 * already what the Reveal's Security pillar quotes. The design's five-ring
 * figure has no real backing at all (its ring values are Halden's), so the row
 * states the real over-exposure count and the real site counts around it rather
 * than plotting invented radii.
 */
export function blastRadiusRows(pillars: readonly JourneyPillarView[]): BuiltRows {
  return buildRows(pillars, [
    { statId: "security.blastRadius", pillar: "security", label: "Copilot blast radius", caption: "items reachable beyond their intended audience" },
    { statId: "governance.overshared", pillar: "governance", label: "Overshared sites", caption: "sites shared more widely than their content warrants" },
    { statId: "governance.sites", pillar: "governance", label: "Sites in scope", caption: "SharePoint sites inventoried by this scan" },
  ]);
}

/**
 * The radar's note, derived from this tenant's own scores.
 *
 * Names the highest and lowest scoring pillars only when at least two pillars
 * were actually scored — with one score there is no shape to describe, and the
 * design's own sentence ("Licensing is closest to ready, Compliance furthest
 * from it") is a claim about its stand-in tenant that must never be inherited.
 */
export function buildRadarNote(view: JourneyView): string {
  const scannedClause = view.tenant.scannedOn ? `, read on ${view.tenant.scannedOn}` : "";
  const scored = view.pillars.filter((p) => typeof p.score === "number");
  if (scored.length < 2) {
    return `Readiness contribution by pillar${scannedClause}. A pillar with no score is one no evaluable rule fed — it plots at the centre and asserts nothing.`;
  }
  const sorted = [...scored].sort((a, b) => (b.score as number) - (a.score as number));
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  return `Readiness contribution by pillar${scannedClause}. The shape is the argument: ${PILLARS[best.key].label} is closest to ready at ${best.score}, ${PILLARS[worst.key].label} furthest from it at ${worst.score}.`;
}

/* ------------------------------------------------------------------ *
 * Section 2 — Technical Prerequisites & Platform Alignment
 * ------------------------------------------------------------------ */

/**
 * The prerequisites the platform genuinely measures, confirmed against the
 * registry's real `sourceKey`s rather than the design's row labels.
 *
 * WHAT THE DESIGN ASKED FOR AND WHY TWO ROWS ARE ABSENT:
 *   • "Conditional Access — no policy scoped to privileged roles" has NO real
 *     producer. `war-room-pillar-stats.ts` records this outright in its own
 *     unproducible list: "CA policies (identity:ca-policy-count has no
 *     DASHBOARD_METRICS entry)". Re-checked against `lib/dashboard-registry`
 *     for this issue — the registry holds `security:conditional-access-failures`
 *     (a failure count, not a policy count) and `drift:ca-policy` (a drift
 *     count), and neither answers "is a policy scoped to privileged roles".
 *     So the row is declared missing by name in the section's own unavailable
 *     block rather than silently dropped or filled from a near-miss metric.
 *   • "Workload stability — OneDrive activated for N% of the estate" needs a
 *     denominator no check provides; the real `usage:onedrive-active` count is
 *     an ADOPTION figure and appears in that section instead of being divided
 *     by a guess.
 */
const PREREQUISITE_PICKS: readonly StatPick[] = [
  { statId: "security.legacyAuth", pillar: "security", label: "Authentication & identity", caption: "legacy authentication sign-ins" },
  { statId: "security.mfaRegistered", pillar: "security", label: "MFA registration", caption: "users registered for multi-factor authentication" },
  { statId: "security.globalAdmins", pillar: "security", label: "Privileged accounts", caption: "global administrators" },
  { statId: "health.nonCompliantDevices", pillar: "health", label: "Device compliance", caption: "devices failing the compliance baseline" },
  { statId: "health.unencrypted", pillar: "health", label: "Device encryption", caption: "devices with no encryption reported" },
  { statId: "health.outdated", pillar: "health", label: "Operating system currency", caption: "devices on an outdated OS build" },
  { statId: "licensing.provisioned", pillar: "licensing", label: "Licensing baseline", caption: "paid seats provisioned" },
  { statId: "licensing.unassigned", pillar: "licensing", label: "Licensing headroom", caption: "paid seats provisioned but unassigned" },
  { statId: "licensing.inactive", pillar: "licensing", label: "Licence gaps", caption: "licences assigned to inactive users" },
];

/**
 * The one prerequisite the design names that this platform cannot measure at
 * all — not for this tenant, but anywhere. Stated as a coverage gap so a reader
 * comparing this report to the design's example can see it was decided rather
 * than lost.
 */
const UNPRODUCIBLE_PREREQUISITES: readonly { readonly checkKey: string; readonly reason: string }[] = [
  { checkKey: "identity:ca-policy-count", reason: "unknown_metric_key" },
];

/* ------------------------------------------------------------------ *
 * Section 3 — Adoption & licensing, the pure-data half of enablement
 * ------------------------------------------------------------------ */

const WORKLOAD_PICKS: readonly StatPick[] = [
  { statId: "adoption.teamsActive", pillar: "adoption", label: "Teams", caption: "active users" },
  { statId: "adoption.sharePointActive", pillar: "adoption", label: "SharePoint", caption: "active users" },
  { statId: "adoption.oneDriveActive", pillar: "adoption", label: "OneDrive", caption: "active users" },
  { statId: "adoption.emailActive", pillar: "adoption", label: "Exchange", caption: "active users" },
  { statId: "licensing.annualWaste", pillar: "licensing", label: "Recoverable licence spend", caption: "a year in paid, unassigned seats" },
];

/* ------------------------------------------------------------------ *
 * The report
 * ------------------------------------------------------------------ */

/**
 * The verdict card, from the real Gate score.
 *
 * Never asserts a verdict when the score is null: a tenant whose scan could not
 * evaluate a single Copilot-impacting rule has no readiness figure, and calling
 * that "not flight-ready" would state a finding the platform has not made —
 * the same rule `copilotGateStatus` follows server-side.
 */
function buildVerdict(view: JourneyView, scoredPillars: number): ReadinessReport["verdict"] {
  const score = view.readinessScore;
  if (score === null) {
    return {
      eyebrow: "The verdict",
      headline: "No readiness score yet",
      sub: `The Copilot Gate needs ${COPILOT_GATE_TARGET}. This tenant's scan has not yet evaluated a rule that feeds the Copilot pillar, so there is no score to gate on — and nothing here claims one either way.`,
    };
  }
  const gap = COPILOT_GATE_TARGET - score;
  const pillarClause =
    scoredPillars > 0
      ? `${scoredPillars} ${scoredPillars === 1 ? "pillar" : "pillars"} scored, one number. `
      : "";
  return {
    eyebrow: "The verdict",
    headline:
      gap > 0
        ? `${score} — not flight-ready for Copilot`
        : `${score} — cleared for Copilot rollout`,
    sub:
      gap > 0
        ? `${pillarClause}The Gate needs ${COPILOT_GATE_TARGET}, so the gap is ${gap} points. Every point of it maps to a named finding in the reports alongside this one.`
        : `${pillarClause}The Gate needs ${COPILOT_GATE_TARGET} and this tenant is at or above it. What follows is what still needs watching to keep it there.`,
  };
}

/**
 * The provenance line. Every clause is conditional on the platform actually
 * knowing that thing — a tenant with no scan date and no curated check count
 * gets the two sentences that are still true, not a sentence with blanks in it.
 */
export function buildProvenance(scannedOn: string | null, checkCount: number): string {
  const parts = [
    scannedOn
      ? `Read on ${scannedOn} through the Microsoft Graph API with read-only delegated permissions.`
      : "Read through the Microsoft Graph API with read-only delegated permissions.",
  ];
  if (checkCount > 0) {
    parts.push(`${checkCount.toLocaleString("en-US")} signal derivation checks across the scan packages this tenant has run.`);
  }
  parts.push("No configuration was altered during assessment.");
  return parts.join(" ");
}

/** Which AI section carries which heading, in render order. */
const NARRATIVE_ORDER: readonly ReadinessNarrativeSectionKey[] = ["safety", "enablement", "blockers"];

const NARRATIVE_HEADINGS: Record<ReadinessNarrativeSectionKey, string> = {
  safety: "Copilot Safety & Exposure",
  enablement: "Workflow Enablement & Value",
  blockers: "Gate Blockers & Remediation Path",
};

/**
 * What a prose section says when it has none. Distinct wording per reason,
 * because "your scan carries nothing to reason about here" and "we could not
 * write this just now" are different statements to a customer and only one of
 * them is about their tenant.
 */
export function narrativeUnavailableDetail(reason: string | null): string {
  switch (reason) {
    case "no_real_data":
      return "This tenant's scan carries no measured figure and no finding for the pillars behind this section, so there is nothing real to reason from. Nothing has been written in its place.";
    case "generation_failed":
      return "This section could not be written just now. That is a problem on our side, not a finding about your tenant — the rest of this report is unaffected.";
    case "empty_response":
      return "This section came back empty and has been left out rather than filled with generic content.";
    default:
      return "This section is not available.";
  }
}

/**
 * Build the whole report from real data.
 *
 * `narrative` is optional and separately fetched: the pure-data sections must
 * render the moment the pillar payload lands, without waiting on up to three
 * Anthropic calls. A null narrative means "still loading"; a narrative whose
 * section carries `html: null` means "resolved, and honestly empty".
 */
export function buildCopilotReadinessReport(input: {
  readonly view: JourneyView;
  readonly narrative: WireNarrativePayload | null;
  /** True once the narrative fetch has settled, success or failure. */
  readonly narrativeSettled: boolean;
  /** Real curated check count behind the provenance line. */
  readonly scannedCheckCount: number;
}): ReadinessReport {
  const { view, narrative, narrativeSettled, scannedCheckCount } = input;
  const pillars = view.pillars;
  const scoredPillars = pillars.filter((p) => typeof p.score === "number").length;

  const sections: ReadinessSection[] = [];

  // ── Copilot Readiness Summary ──────────────────────────────────────────────
  const blast = blastRadiusRows(pillars);
  sections.push({
    heading: "Copilot Readiness Summary",
    blocks: [
      { kind: "figure", figure: "readinessRadar" },
      { kind: "figure", figure: "scoreSummary" },
      { kind: "figure", figure: "pillarTable" },
      ...keyValuesBlock(blast.rows),
      ...unavailableBlock(
        "The exposure figures behind the blast-radius line are not available for this tenant:",
        blast.missing,
      ),
    ],
  });

  // ── Copilot Safety & Exposure (AI prose) ───────────────────────────────────
  // ── Workflow Enablement & Value (AI prose + real workload figures) ─────────
  // ── Technical Prerequisites & Platform Alignment (pure data) ───────────────
  // ── Gate Blockers & Remediation Path (AI prose) ────────────────────────────
  //
  // Order follows the design's approved structure, minus "Copilot Drift &
  // Violations" (see the header). The workload figures sit inside the
  // enablement section so the prose and the numbers it reasons about are
  // adjacent rather than a screen apart.
  const narrativeByKey = new Map<string, WireNarrativeSection>(
    (narrative?.sections ?? []).map((s) => [s.key, s]),
  );

  const narrativeBlocks = (key: ReadinessNarrativeSectionKey): ReadinessBlock[] => {
    const section = narrativeByKey.get(key);
    if (section?.html) return [{ kind: "narrative", html: section.html }];
    if (!narrativeSettled) return [];
    return [
      {
        kind: "unavailable",
        detail: narrativeUnavailableDetail(section?.omittedReason ?? null),
        checks: section?.missingChecks ?? [],
      },
    ];
  };

  sections.push({
    heading: NARRATIVE_HEADINGS.safety,
    blocks: narrativeBlocks("safety"),
  });

  const workloads = buildRows(pillars, WORKLOAD_PICKS);
  sections.push({
    heading: NARRATIVE_HEADINGS.enablement,
    blocks: [
      ...narrativeBlocks("enablement"),
      ...keyValuesBlock(workloads.rows),
      ...unavailableBlock(
        "Workload and licence figures this tenant's scan does not carry:",
        workloads.missing,
      ),
    ],
  });

  const prerequisites = buildRows(pillars, PREREQUISITE_PICKS);
  sections.push({
    heading: "Technical Prerequisites & Platform Alignment",
    blocks: [
      ...keyValuesBlock(prerequisites.rows),
      ...unavailableBlock(
        "Prerequisites this assessment could not measure. These are gaps in what was collected, not findings about this tenant:",
        [...prerequisites.missing, ...UNPRODUCIBLE_PREREQUISITES],
      ),
    ],
  });

  sections.push({
    heading: NARRATIVE_HEADINGS.blockers,
    blocks: narrativeBlocks("blockers"),
  });

  // ── Closing ────────────────────────────────────────────────────────────────
  const closing: string[] = [
    "Copilot is only safe and effective when your environment is ready. Governance, security, compliance, adoption, licensing and health all have to be aligned before Copilot can be deployed.",
  ];
  if (view.readinessScore !== null) {
    const gap = COPILOT_GATE_TARGET - view.readinessScore;
    closing.push(
      gap > 0
        ? `${view.tenant.name} scored ${view.readinessScore}, below the safe-to-deploy threshold of ${COPILOT_GATE_TARGET}. The gap is ${gap} points, and every point maps to a named finding in the reports alongside this one.`
        : `${view.tenant.name} scored ${view.readinessScore}, at or above the safe-to-deploy threshold of ${COPILOT_GATE_TARGET}. The findings that follow are what keeps it there.`,
    );
  }

  return {
    kicker: "Copilot readiness, safety & enablement",
    headline:
      view.readinessScore === null
        ? `Copilot readiness for ${view.tenant.name}`
        : view.readinessScore >= COPILOT_GATE_TARGET
          ? `It is safe to turn Copilot on at ${view.tenant.name}`
          : `It is not yet safe to turn Copilot on at ${view.tenant.name}`,
    standfirst:
      "This report evaluates your tenant's readiness to safely deploy Microsoft Copilot. It measures governance, security, compliance, adoption, licensing and health signals that directly affect Copilot's accuracy, safety and value. Every finding traces to telemetry surfaced in your own assessment and directly impacts the Copilot Gate.",
    verdict: buildVerdict(view, scoredPillars),
    sections,
    closing,
    provenance: buildProvenance(view.tenant.scannedOn, scannedCheckCount),
    radarNote: buildRadarNote(view),
  };
}

/** Exported for tests — the picks are the contract with `war-room-pillar-stats.ts`. */
export const __testables = {
  PREREQUISITE_PICKS,
  WORKLOAD_PICKS,
  UNPRODUCIBLE_PREREQUISITES,
  NARRATIVE_ORDER,
  buildRows,
};
