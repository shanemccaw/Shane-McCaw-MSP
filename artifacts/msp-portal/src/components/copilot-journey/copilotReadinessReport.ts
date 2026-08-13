/**
 * copilotReadinessReport.ts — the real Copilot Readiness, Safety &
 * Enablement Report, as data (#409).
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
 * ── WHERE THE RULES LIVE NOW (#343) ──────────────────────────────────────────
 * The honesty machinery this report established — what counts as a quotable
 * stat, how an absent one is declared, which absences are OUR wiring fault and
 * must never reach the reader, and the Upgrade Opportunity category — has moved
 * to `liveReportBlocks.ts`, shared with every other report on this pattern. It
 * is re-exported below unchanged, so this module's contract with its renderer
 * and its tests is exactly what it was.
 *
 * What stayed here is what makes this the Copilot Readiness Report: its stat
 * picks, its section order, its verdict and its copy.
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
 */

import { COPILOT_GATE_TARGET, PILLARS } from "./journeyTokens.ts";
import type { JourneyPillarView, JourneyView } from "./journeyModel.ts";
import {
  UPGRADE_OPPORTUNITY_DETAIL,
  UPGRADE_OPPORTUNITY_HEADING,
  __testables as liveReportTestables,
  buildProvenance,
  buildRows,
  keyValuesBlock,
  narrativeBlocks,
  unavailableBlock,
  unavailableChecksForReader,
  upgradeOpportunities,
  upgradeOpportunityCallToAction,
  type BuiltRows,
  type LiveReportBlock,
  type LiveReportSection,
  type LiveReportVerdict,
  type StatPick,
  type WireNarrativePayload,
  type WireNarrativeSection,
} from "./liveReportBlocks.ts";

/* ------------------------------------------------------------------ *
 * The contract this module has always exported, unchanged (#343)
 *
 * Re-exported rather than redeclared: `CopilotReadinessReportBody.tsx` and
 * `copilotReadinessReport.test.ts` import these names from here, and moving a
 * rule into a shared module must not become a rename for every consumer.
 * ------------------------------------------------------------------ */

export {
  LICENCE_GAP_REASON,
  UPGRADE_OPPORTUNITY_DETAIL,
  UPGRADE_OPPORTUNITY_HEADING,
  WIRING_FAULT_REASONS,
  buildProvenance,
  formatStat,
  isLicenceGap,
  isRealStat,
  isWiringFault,
  licenceGapDisclosure,
  narrativeUnavailableDetail,
  splitLicenceGaps,
  unavailableChecksForReader,
  unavailableReasonText,
  upgradeOpportunities,
  upgradeOpportunityCallToAction,
} from "./liveReportBlocks.ts";

export type {
  RealStat,
  UnavailableCheck,
  UpgradeOpportunity,
  WireNarrativePayload,
  WireNarrativeSection,
} from "./liveReportBlocks.ts";

/** This report's own three prose sections. */
export type ReadinessNarrativeSectionKey = "safety" | "enablement" | "blockers";

/** Aliases kept for this report's existing consumers — see the header. */
export type ReadinessBlock = LiveReportBlock;
export type ReadinessSection = LiveReportSection;

export interface ReadinessReport {
  readonly kicker: string;
  readonly headline: string;
  readonly standfirst: string;
  readonly verdict: LiveReportVerdict;
  readonly sections: readonly ReadinessSection[];
  readonly closing: readonly string[];
  readonly provenance: string;
  /** The note beside the radar, derived from this tenant's own scores. */
  readonly radarNote: string;
}

/* ------------------------------------------------------------------ *
 * Section 1 — Copilot Readiness Summary
 * ------------------------------------------------------------------ */

/**
 * The blast-radius rows, from the stats the platform already computes.
 *
 * NOT a new computation, and NOT the design's ring diagram. `security.blastRadius`
 * ("items in blast radius") and `governance.exposure` ("items over-exposed") are
 * the SAME real metric — `copilot.overshareExposureCount`, over
 * `copilot:overshare-exposure` — deliberately shown on both cards, and it is
 * already what the Reveal's Security pillar quotes. The design's five-ring
 * figure has no real backing at all (its ring values are Halden's), so the rows
 * state the real over-exposure count and the real site counts around it rather
 * than plotting invented radii.
 *
 * #343: the Security Posture & Blast Radius Report's own Blast Radius section
 * calls THIS function rather than re-picking the same three stats. One
 * definition, so the two reports cannot quote different blast radii for the same
 * tenant on the same day.
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
 *     denominator no check provides. This note used to add that the numerator
 *     lived in the adoption section as `usage:onedrive-active`; #441 found that
 *     key names nothing in the catalog, so there is no numerator either. Both
 *     halves are missing, not just the denominator.
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
 * all — not for this tenant, but anywhere. Kept as the in-code record that it
 * was decided rather than lost.
 *
 * NOT rendered to the customer since #441, and its own reason says why:
 * `identity:ca-policy-count` is a real, active check (it is sort_order 2 in
 * `core:security-baseline`) that simply has no `DASHBOARD_METRICS` entry to
 * consume it. That is a wiring gap at our end, so it was reaching the reader as
 * "identity:ca-policy-count — not wired to a check in the catalogue" in a
 * section about gaps in THEIR assessment, which is both wrong on its face (it
 * IS a check) and not their concern. `unavailableChecksForReader` drops it on
 * the same rule as every other wiring fault.
 */
const UNPRODUCIBLE_PREREQUISITES: readonly { readonly checkKey: string; readonly reason: string }[] = [
  { checkKey: "identity:ca-policy-count", reason: "unknown_metric_key" },
];

/* ------------------------------------------------------------------ *
 * Section 3 — Adoption & licensing, the pure-data half of enablement
 * ------------------------------------------------------------------ */

/**
 * WHY THE FOUR PER-WORKLOAD ACTIVE-USER ROWS ARE GONE (#441).
 *
 * They were `adoption.teamsActive` / `sharePointActive` / `oneDriveActive` /
 * `emailActive`, and they resolved through registry metrics whose `sourceKey`s
 * named `usage:teams-activity`, `usage:sharepoint-activity`,
 * `usage:onedrive-activity` and `usage:email-activity`. `usage:` is not a
 * check-key domain in this platform's catalog — the four keys name nothing, and
 * never did. So the rows could not render for any tenant, and this section
 * instead printed all four phantom keys to the reader as figures "this tenant's
 * scan does not carry". That sentence was false: the scan was never asked for
 * them.
 *
 * The picks are removed rather than repointed, for the same reason
 * `war-room-pillar-stats.ts` emptied the adoption card instead of repointing it:
 * the nearest real checks are per-user and per-site Graph usage-report detail
 * endpoints, and a metric aimed at one of those resolves to its row count —
 * "1,631 active Teams users" that is really "1,631 licensed users". A wrong
 * number in a readiness report is worse than an absent one.
 *
 * The section keeps its AI prose (grounded in the adoption and licensing pillar
 * scores and findings, which are real) and the one workload-adjacent figure the
 * platform genuinely computes.
 */
const WORKLOAD_PICKS: readonly StatPick[] = [
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
    // #517: WHICH kind of no-score this is decides the sentence. The line below
    // used to assert one reason for all of them — "has not yet evaluated a rule
    // that feeds the Copilot pillar" — which is simply untrue of a tenant whose
    // scan evaluated some Copilot-impacting rules and merely too few of them.
    // A report that gets the reason wrong is the same failure as one that gets
    // the number wrong, and it is stated with the same confidence.
    if (view.readinessEvaluation.status === "insufficient_data") {
      return {
        eyebrow: "The verdict",
        headline: "No scan results to score",
        sub: `The Copilot Gate needs ${COPILOT_GATE_TARGET}. This tenant's scan did cover Copilot-impacting checks, but too few of them for a score to mean anything — so none is stated here, in either direction. Re-running the scan against the full package is what produces one.`,
        severity: "unmeasured",
      };
    }
    return {
      eyebrow: "The verdict",
      headline: "No readiness score yet",
      sub: `The Copilot Gate needs ${COPILOT_GATE_TARGET}. This tenant's scan has not yet evaluated a rule that feeds the Copilot pillar, so there is no score to gate on — and nothing here claims one either way.`,
      severity: "unmeasured",
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
    // Real severity for the roll-up is the Gate's own Go/No-Go (#359), not
    // `severityForScore`'s 60/50 bands — those disagree with the Gate's 82
    // threshold and could paint this card green while the headline still says
    // "not flight-ready".
    severity: gap > 0 ? "critical" : "healthy",
  };
}

/** Which AI section carries which heading, in render order. */
const NARRATIVE_ORDER: readonly ReadinessNarrativeSectionKey[] = ["safety", "enablement", "blockers"];

const NARRATIVE_HEADINGS: Record<ReadinessNarrativeSectionKey, string> = {
  safety: "Copilot Safety & Exposure",
  enablement: "Workflow Enablement & Value",
  blockers: "Gate Blockers & Remediation Path",
};

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

  const prose = (key: ReadinessNarrativeSectionKey): ReadinessBlock[] =>
    narrativeBlocks(narrativeByKey.get(key), narrativeSettled);

  sections.push({
    heading: NARRATIVE_HEADINGS.safety,
    blocks: prose("safety"),
  });

  const workloads = buildRows(pillars, WORKLOAD_PICKS);
  sections.push({
    heading: NARRATIVE_HEADINGS.enablement,
    blocks: [
      ...prose("enablement"),
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
        unavailableChecksForReader([...prerequisites.missing, ...UNPRODUCIBLE_PREREQUISITES]),
      ),
    ],
  });

  // ── Upgrade Opportunities (#451) ───────────────────────────────────────────
  //
  // ONE section for the whole document rather than a block per section, for two
  // reasons. `copilot:overshare-exposure` backs stats on three pillars and
  // several checks are quoted by both a pure-data section and the narrative's
  // grounding, so per-section blocks would repeat the same licence fact in up
  // to three places; and a category the reader is meant to tell apart from the
  // severity ladder is easier to tell apart when it is one place they can point
  // at, not a recurring aside.
  //
  // Every list the document holds is swept, including the narrative sections'
  // `missingChecks` whether or not that prose rendered — a licence gap is a real
  // fact about the tenant regardless of whether the section that wanted it had
  // enough other facts to be written.
  const licenceGaps = upgradeOpportunities([
    ...blast.missing,
    ...workloads.missing,
    ...prerequisites.missing,
    ...(narrative?.sections ?? []).flatMap((s) => s.missingChecks ?? []),
  ], view.licenseGapPurchase);
  if (licenceGaps.length) {
    sections.push({
      heading: UPGRADE_OPPORTUNITY_HEADING,
      blocks: [
        {
          kind: "upgradeOpportunity",
          detail: UPGRADE_OPPORTUNITY_DETAIL,
          items: licenceGaps,
          callToAction: upgradeOpportunityCallToAction(view.licenseGapPurchase),
        },
      ],
    });
  }

  sections.push({
    heading: NARRATIVE_HEADINGS.blockers,
    blocks: prose("blockers"),
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
  // Shared with every live-rendered report since #343, but still surfaced here:
  // this report's suite is where the never-invent-a-SKU rules are asserted, and
  // moving a rule into a shared module must not quietly drop its tests.
  LICENCE_GAP_DISCLOSURES: liveReportTestables.LICENCE_GAP_DISCLOSURES,
};
