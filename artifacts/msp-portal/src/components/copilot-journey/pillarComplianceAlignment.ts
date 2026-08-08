/**
 * pillarComplianceAlignment.ts — the real Microsoft 365 Compliance & Regulatory
 * Alignment Report, as data (#292).
 *
 * The live counterpart to `previewDocumentBodies.ts`'s `COMPLIANCE_ALIGNMENT`,
 * built from one real tenant's own `war-room-pillars` payload plus
 * `/portal/assessment/compliance-alignment-narrative` instead of from Halden
 * Materials' worked example.
 *
 * A pure `.ts` for the same two reasons as its siblings: `node --test` cannot
 * load `.tsx`, so the rules below are testable; and the platform's
 * no-hardcoding rule keeps counts and figures out of `.tsx`. Every number here
 * arrives from the wire; none is written down. The honesty machinery is
 * `liveReportBlocks.ts`, shared verbatim, and nothing about it is re-decided here.
 *
 * ── THE FOUR REAL FIGURES THIS REPORT HAS ────────────────────────────────────
 * `WAR_ROOM_PILLAR_STAT_SPECS.compliance` is four stats, all with a real check:
 * missing sensitivity labels (`compliance:missing-labels`), retention policy
 * drift (`compliance:retention-drift`), weak DLP policies
 * (`compliance:weak-dlp-policies`) and guest users
 * (`compliance:guest-users`).
 *
 * Those four are genuinely live rather than historically stale: as of
 * 2026-08-06 `compliance:weak-dlp-policies`, `compliance:dlp-incidents`,
 * `compliance:missing-labels` and `compliance:label-errors` are re-linked to the
 * `assess:copilot-readiness` package and newly wired into
 * `signal_derivation_rules` with real (if provisional) compliance/governance
 * impact weights. A tenant scanned before that carries the honest
 * `not_in_scan_package` reason rather than a fabricated figure, which is exactly
 * what the unavailable blocks below are for.
 *
 * ── WHAT THIS REPORT DROPS FROM THE DESIGN, AND WHY ──────────────────────────
 *   1. "Regulatory Alignment Assessment" is DROPPED as a scored section, and so
 *      is the Summary's "Regulatory coverage" row. Its six rows grade this
 *      tenant against GDPR, SOX, HIPAA and FINRA ("GDPR partial · SOX partial ·
 *      HIPAA not addressed · FINRA not applicable", "84 items with health data
 *      carry no label", "90-day retention only, below every framework
 *      requirement"). This platform has NO regulatory-framework check of any
 *      kind: nothing in `monitor_checks` maps a control to a framework, nothing
 *      classifies content as PHI or as financial, and nothing reads audit-log
 *      retention. Every one of those verdicts would be written rather than read.
 *      What survives is `REGULATORY_FRAMEWORK_GAP`, which says so plainly —
 *      the same treatment `copilotReadinessReport.ts` gave "Personas ready
 *      today".
 *   2. "Compliance Drift & Violations" is DROPPED entirely, and so is the
 *      Summary's "Compliance drift" row. Drift is a diff against a recorded
 *      baseline and there is none on a first scan — the same reasoning as the
 *      two reports before this one. `compliance:retention-drift` is NOT that: it
 *      is a real point-in-time count of retention coverage gaps, and it is
 *      stated below under its own honest label rather than as evidence of
 *      movement over time.
 *   3. "Sensitivity & Labeling Compliance" is DROPPED as a section. Its one real
 *      claim is the unlabelled-content figure, which is `compliance:missing-
 *      labels` and leads the Summary; the other four rows need a per-category
 *      split ("58% of HR and health content · 71% of financial"), a per-library
 *      inheritance check, and a label-drift baseline, none of which exists.
 *   4. "Self-Resolution Actions" is DROPPED, on #343's precedent: remediation is
 *      the Full Remediation Guide's job in this journey, not this report's.
 */

import type { JourneyPillarView, JourneyView } from "./journeyModel.ts";
import {
  UPGRADE_OPPORTUNITY_DETAIL,
  UPGRADE_OPPORTUNITY_HEADING,
  buildProvenance,
  buildRows,
  declaredGapBlock,
  findingsBlocks,
  gateRow,
  keyValuesBlock,
  narrativeBlocks,
  pillarVerdictSeverity,
  unavailableBlock,
  upgradeOpportunities,
  upgradeOpportunityCallToAction,
  verdictEyebrow,
  type LiveReportBlock,
  type LiveReportSection,
  type LiveReportVerdict,
  type StatPick,
  type UnavailableCheck,
  type WireNarrativePayload,
  type WireNarrativeSection,
} from "./liveReportBlocks.ts";

/** This report's own three prose sections, in render order. */
export type ComplianceAlignmentSectionKey = "summary" | "lifecycle" | "copilotImpact";

/**
 * The Compliance Alignment narrative payload. Plain `WireNarrativePayload`:
 * every figure this report shows is already on the `war-room-pillars` wire, so
 * unlike the Security Posture report there is nothing for the route to resolve
 * on the side.
 */
export type WireComplianceAlignmentPayload = WireNarrativePayload;

export type ComplianceAlignmentSection = LiveReportSection;
export type ComplianceAlignmentBlock = LiveReportBlock;

export interface ComplianceAlignmentReport {
  readonly kicker: string;
  readonly headline: string;
  readonly standfirst: string;
  readonly verdict: LiveReportVerdict;
  readonly sections: readonly ComplianceAlignmentSection[];
  readonly closing: readonly string[];
  readonly provenance: string;
}

/* ------------------------------------------------------------------ *
 * Section 1 — Compliance Posture Summary
 * ------------------------------------------------------------------ */

/**
 * The Summary's real metric rows, in the order the design's own summary reasons
 * about them: what is unlabelled, what is unprotected, what has drifted, and who
 * from outside can reach any of it.
 *
 * All four of the compliance card's stats are here rather than split across two
 * sections. The design splits them, but each of its later sections leans on a
 * per-category or per-workload breakdown that does not exist (see the header),
 * so splitting the four real figures to fill those headings would leave two
 * one-row sections and three empty ones. One honest table reads better and
 * claims less.
 */
const SUMMARY_PICKS: readonly StatPick[] = [
  { statId: "compliance.missingLabels", pillar: "compliance", label: "Unlabelled content", caption: "items carrying no sensitivity label" },
  { statId: "compliance.weakDlp", pillar: "compliance", label: "Data Loss Prevention", caption: "DLP policies configured too weakly to stop the leak they were written to stop" },
  { statId: "compliance.retentionDrift", pillar: "compliance", label: "Retention coverage", caption: "places retention has drifted from the policy meant to apply" },
  { statId: "compliance.guests", pillar: "compliance", label: "External access", caption: "guest accounts holding standing access to your tenant" },
];

/**
 * The design's regulatory-framework grading, declared in words because this
 * platform has no framework check of any kind.
 *
 * ── WHY IT IS PROSE AND NAMES NO CHECK KEY ───────────────────────────────────
 * The obvious move is an `unavailable` block naming a check. There is no honest
 * key to name, and unlike the Security Posture report's Conditional Access gap
 * there is not even a near-miss to rule out: nothing in `monitor_checks` carries
 * a regulatory framework, a control identifier, or a content classification.
 * `compliance:missing-labels` counts items with no label — it does not say which
 * of them hold personal data, health data or financial records, and inferring
 * "84 PHI items" from an unlabelled total is precisely the approximation this
 * report exists to refuse.
 *
 * It renders unconditionally: it is a fact about our coverage, not about this
 * tenant's scan, so there is no tenant for whom it becomes untrue.
 *
 * The last sentence matters as much as the rest. A reader who has just been told
 * their labelling is thin will read a missing GDPR verdict as a bad one unless
 * the report says otherwise, and an assessment that has not looked must not be
 * read as one that looked and disapproved.
 */
export const REGULATORY_FRAMEWORK_GAP =
  "This report does not grade your tenant against GDPR, SOX, HIPAA, FINRA or any other regulatory framework, and the section a compliance review would normally use to do that is deliberately absent. No check this assessment runs maps a Microsoft 365 control to a regulatory requirement, classifies your content as personal, health or financial data, or reads your audit-log retention period. The figures below are measurements of your tenant's configuration; a framework alignment verdict would be a legal judgement, and this assessment has not made one. Nothing here should be read as saying your obligations under any framework are met, or that they are not — only that this scan did not evaluate them.";

/* ------------------------------------------------------------------ *
 * The verdict
 * ------------------------------------------------------------------ */

/**
 * The verdict card, from the compliance pillar's own real headline and score.
 *
 * The design's version states a specific worst finding ("0 DLP policies cover
 * Teams chat") and a consequence about regulated data moving through chat. The
 * real version states the pillar's real lead finding — a real `severity_rules`
 * label, `CLEAN_PILLAR_HEADLINE` for a pillar genuinely evaluated clean (#399),
 * or nothing for a pillar nothing scored. It never asserts a worst finding for a
 * pillar that was not evaluated, and it never names a workload the scan does not
 * separately report on.
 */
export function buildVerdict(compliance: JourneyPillarView | undefined): ComplianceAlignmentReport["verdict"] {
  const score = compliance?.score ?? null;
  if (score === null) {
    return {
      eyebrow: "Compliance posture",
      headline: "No compliance score yet",
      sub: "This tenant's scan has not yet evaluated a rule that feeds the Compliance pillar, so there is no posture score and no worst finding to lead with. What follows is what the scan did measure.",
      severity: "unmeasured",
    };
  }
  const headline = compliance?.headline;
  return {
    eyebrow: verdictEyebrow("Compliance posture", headline),
    headline: headline ?? `Compliance scores ${score} of 100`,
    sub: `The Compliance pillar scores ${score} of 100 on this tenant's last scan. Every figure below is read directly from your own tenant; nothing here is a benchmark, an estimate or a regulatory verdict.`,
    severity: pillarVerdictSeverity(compliance),
  };
}

/* ------------------------------------------------------------------ *
 * The report
 * ------------------------------------------------------------------ */

const SECTION_HEADINGS: Record<ComplianceAlignmentSectionKey, string> = {
  summary: "Compliance Posture Summary",
  lifecycle: "Data Lifecycle & Records Management",
  copilotImpact: "Copilot Readiness Impact",
};

/**
 * Build the whole report from real data.
 *
 * `narrative` is optional and separately fetched: the pure-data sections must
 * render the moment the pillar payload lands, without waiting on up to three
 * Anthropic calls. A null narrative means "still loading"; a narrative whose
 * section carries `html: null` means "resolved, and honestly empty".
 */
export function buildComplianceAlignmentReport(input: {
  readonly view: JourneyView;
  readonly narrative: WireComplianceAlignmentPayload | null;
  /** True once the narrative fetch has settled, success or failure. */
  readonly narrativeSettled: boolean;
  /** Real curated check count behind the provenance line. */
  readonly scannedCheckCount: number;
}): ComplianceAlignmentReport {
  const { view, narrative, narrativeSettled, scannedCheckCount } = input;
  const pillars = view.pillars;
  const compliance = pillars.find((p) => p.key === "compliance");

  const narrativeByKey = new Map<string, WireNarrativeSection>(
    (narrative?.sections ?? []).map((s) => [s.key, s]),
  );
  const prose = (key: ComplianceAlignmentSectionKey): ComplianceAlignmentBlock[] =>
    narrativeBlocks(narrativeByKey.get(key), narrativeSettled);

  const sections: ComplianceAlignmentSection[] = [];

  // ── Compliance Posture Summary ─────────────────────────────────────────────
  const summary = buildRows(pillars, SUMMARY_PICKS);
  sections.push({
    heading: SECTION_HEADINGS.summary,
    blocks: [
      ...prose("summary"),
      ...keyValuesBlock(summary.rows),
      ...unavailableBlock(
        "Figures behind this summary that this tenant's scan does not carry:",
        summary.missing,
      ),
      ...declaredGapBlock(REGULATORY_FRAMEWORK_GAP),
    ],
  });

  // ── Data Lifecycle & Records Management ────────────────────────────────────
  //
  // Prose plus the compliance pillar's own real findings. No metric row: all
  // four of this pillar's real figures lead the Summary, and the same number
  // under two headings reads as two findings.
  sections.push({
    heading: SECTION_HEADINGS.lifecycle,
    blocks: [
      ...prose("lifecycle"),
      ...findingsBlocks(
        compliance,
        "The Compliance pillar was evaluated on this tenant's last scan and returned no critical or warning finding about labelling, retention, data protection or external access. That is a real result, not an empty section.",
        "No rule that feeds the Compliance pillar was evaluated on this tenant's last scan, so no labelling, retention or data-protection finding can be reported either way.",
      ),
    ],
  });

  // ── Upgrade Opportunities (#451) ───────────────────────────────────────────
  //
  // ONE section for the whole document, on the same reasoning as its sibling
  // reports'. It matters more here than anywhere else in the set: the Purview
  // checks behind three of this report's four figures are the ones most often
  // gated behind a licence tier, and `licenceGapDisclosure` refuses to name a
  // Purview SKU precisely because a `cmdlet_unavailable` cannot separate a
  // licensing gap from a missing role group.
  const licenceGaps = upgradeOpportunities([
    ...summary.missing,
    ...(narrative?.sections ?? []).flatMap((s) => s.missingChecks ?? []),
  ] as readonly UnavailableCheck[], view.licenseGapPurchase);
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

  // ── Copilot Readiness Impact ───────────────────────────────────────────────
  sections.push({
    heading: SECTION_HEADINGS.copilotImpact,
    blocks: [...prose("copilotImpact"), ...keyValuesBlock(gateRow(view))],
  });

  // ── Closing ────────────────────────────────────────────────────────────────
  //
  // Two sentences at most, and the second only when there is a real score to
  // write it from. The design's second paragraph asserts Compliance is "the
  // lowest reading in the assessment" and that the work "requires no new
  // licensing beyond the E5 uplift already identified" — a ranking and a
  // procurement claim, neither of which this report is in a position to make.
  const closing: string[] = [
    "A sensitivity label is the only instruction Copilot obeys. It grounds on whatever a user can already reach and summarises it without knowing what it is, so labelling, retention and data-loss controls are not filing questions — they are the only mechanism that tells Copilot which of your content it may quote.",
  ];
  if (typeof compliance?.score === "number") {
    closing.push(
      `${view.tenant.name}'s Compliance pillar scores ${compliance.score} of 100 on this scan. Each finding above is a specific, named result from a specific check — there is nothing in this report that is not read from your own tenant, and nothing in it is a regulatory verdict.`,
    );
  }

  return {
    kicker: "Compliance & regulatory alignment",
    headline:
      typeof compliance?.score === "number"
        ? `Labels are the only instruction Copilot obeys at ${view.tenant.name}`
        : `Compliance posture for ${view.tenant.name}`,
    standfirst:
      "This report evaluates your tenant's compliance posture across sensitivity labelling, retention, data-loss prevention and external access. Every finding traces to compliance telemetry surfaced in your own assessment. It does not grade your tenant against any regulatory framework — see the summary below for why that section is deliberately absent.",
    verdict: buildVerdict(compliance),
    sections,
    closing,
    provenance: buildProvenance(view.tenant.scannedOn, scannedCheckCount),
  };
}

/** Exported for tests — the picks are the contract with `war-room-pillar-stats.ts`. */
export const __testables = {
  SUMMARY_PICKS,
  SECTION_HEADINGS,
};
