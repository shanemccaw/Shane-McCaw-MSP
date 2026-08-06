/**
 * pillarGovernancePosture.ts — the real Microsoft 365 Governance Posture
 * Report, as data (#292).
 *
 * The third document ported onto the pattern #409 established and #343
 * generalised: the live counterpart to `previewDocumentBodies.ts`'s
 * `GOVERNANCE_POSTURE`, built from one real tenant's own `war-room-pillars`
 * payload plus `/portal/assessment/governance-posture-narrative` instead of from
 * Halden Materials' worked example.
 *
 * A pure `.ts` and not inlined into the renderer for the same two reasons its
 * siblings are: `node --test` cannot load `.tsx`, so the rules below are
 * testable; and the platform's no-hardcoding rule keeps counts and figures out
 * of `.tsx`. Every number here arrives from the wire; none is written down.
 *
 * The honesty machinery — what may be quoted, how an absence is declared, which
 * absences are our own wiring fault and must never reach the reader, and the
 * Upgrade Opportunity category — is `liveReportBlocks.ts`, shared verbatim with
 * every other live-rendered report. Nothing about it is re-decided here.
 *
 * ── THE FOUR REAL FIGURES THIS REPORT HAS ────────────────────────────────────
 * `WAR_ROOM_PILLAR_STAT_SPECS.governance` is four stats, all with a real check:
 * sites inventoried (`compliance:sharepoint-sites`), overshared sites
 * (`compliance:overshared-sites`), items over-exposed
 * (`copilot:overshare-exposure`) and public channels
 * (`compliance:public-channels`). Everything below is built from those, the
 * governance pillar's real score, and its real `msp_diagnostic_findings` rows.
 *
 * ── WHAT THIS REPORT DROPS FROM THE DESIGN, AND WHY ──────────────────────────
 *   1. "Drift & Violations" is DROPPED entirely, and so is the "Governance
 *      drift" row inside the Summary. Same reasoning as the two reports before
 *      it: drift is a diff against a recorded baseline and there is none on a
 *      first scan. The design's copy for that section names two sharing-scope
 *      changes, "label and DLP compliance drift on 148 sites", a policy
 *      exclusion dated "14 June", "148 inactive sites, 19 orphaned channels" and
 *      "340 naming convention violations" — no check produces any of them, and
 *      the registry's drift metrics are not among the stats this report
 *      resolves. There is nothing real to put there.
 *   2. "Governance Automation Readiness" is DROPPED. Its five rows are an
 *      automation-eligibility list, a change-control list, "SIA dependencies",
 *      an expired "Risk-Based Decision" and a named governance owner. This
 *      platform collects none of those — there is no automation-eligibility
 *      check, no change-control integration, and no owner column anywhere in the
 *      scan path. Every row would have to be written rather than read.
 *   3. "Self-Resolution Actions" is DROPPED, on #343's precedent: its six
 *      bullets are remediation instructions keyed to Halden's specific numbers
 *      ("reduce 11 standing Global Administrators to 2"), and remediation is the
 *      Full Remediation Guide's job in this journey, not this report's.
 *   4. The `exposureHeatmap` FIGURE is not drawn — see
 *      `GovernancePostureReportBody.tsx` for the full reasoning, which is #292's
 *      own: the heat map needs a real per-site or per-category structured list
 *      and the platform holds a single aggregate count.
 *
 * ── THE TWO HONEST GAPS THIS REPORT DECLARES IN WORDS ────────────────────────
 * `GOVERNANCE_FRAMEWORK_GAP` and `POLICY_COVERAGE_GAP` — see each for why it is
 * stated in prose rather than as a named check key, and (for the first)
 * precisely which half of the design's framework section survives.
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
  unavailableBlock,
  upgradeOpportunities,
  type LiveReportBlock,
  type LiveReportSection,
  type StatPick,
  type UnavailableCheck,
  type WireNarrativePayload,
  type WireNarrativeSection,
} from "./liveReportBlocks.ts";

/** This report's own three prose sections, in render order. */
export type GovernancePostureSectionKey = "summary" | "exposure" | "copilotImpact";

/**
 * The Governance Posture narrative payload.
 *
 * Plain `WireNarrativePayload`, with no `stats` extension: unlike the Security
 * Posture report's Secure Score, every figure this report shows is already one
 * of `WAR_ROOM_PILLAR_STAT_SPECS`' stats and therefore already on the
 * `war-room-pillars` wire. Nothing had to be resolved on the side, so nothing is.
 */
export type WireGovernancePosturePayload = WireNarrativePayload;

export type GovernancePostureSection = LiveReportSection;
export type GovernancePostureBlock = LiveReportBlock;

export interface GovernancePostureReport {
  readonly kicker: string;
  readonly headline: string;
  readonly standfirst: string;
  readonly verdict: { readonly eyebrow: string; readonly headline: string; readonly sub: string };
  readonly sections: readonly GovernancePostureSection[];
  readonly closing: readonly string[];
  readonly provenance: string;
}

/* ------------------------------------------------------------------ *
 * Section 1 — Governance Posture Summary
 * ------------------------------------------------------------------ */

/**
 * The Summary's real metric rows, in the order the design's own summary reasons
 * about them: the estate first, then how much of it is shared too widely, then
 * what that reaches.
 *
 * The design's fifth row, "Governance drift", is deliberately absent — see the
 * header.
 */
const SUMMARY_PICKS: readonly StatPick[] = [
  { statId: "governance.sites", pillar: "governance", label: "Sites in scope", caption: "SharePoint sites inventoried by this scan" },
  { statId: "governance.overshared", pillar: "governance", label: "Overshared sites", caption: "sites shared more widely than their content warrants" },
  { statId: "governance.publicChannels", pillar: "governance", label: "Open collaboration surface", caption: "Teams channels open to everyone in the tenant" },
];

/**
 * The design's "Policy coverage" and "Admin role discipline" rows, declared in
 * words because no check answers either question.
 *
 * ── WHY IT IS PROSE AND NAMES NO CHECK KEY ───────────────────────────────────
 * "Labels published, not enforced · DLP on Exchange only · retention on 3 of 9
 * workloads" needs three things the platform does not collect: whether a
 * published label is ENFORCED (as opposed to how many items carry one, which is
 * `compliance:missing-labels` and belongs to the Compliance report), which
 * WORKLOADS a DLP policy is scoped to (`compliance:weak-dlp-policies` counts
 * policies configured too weakly, not their scope), and a retention
 * denominator — `compliance:retention-drift` counts drift, and nine is not a
 * number anything in this platform produces.
 *
 * "11 Global Administrators for 1,240 seats · 4 without MFA · no PIM in use" is
 * three claims across two pillars: the admin count and the MFA count are real
 * and belong to the SECURITY pillar (`identity:global-admin-count`,
 * `identity:mfa-registration`), which is why the Security Posture & Blast Radius
 * Report states both and this one does not restate them under a governance
 * heading. The intersection — how many of the admins specifically lack MFA — is
 * not produced by either check, and no check reads PIM at all.
 *
 * So the gap is genuinely "no check this platform runs reads a policy's scope,
 * its enforcement mode, or PIM" — a fact about our coverage, not about this
 * tenant's scan, and not one that varies by customer. #441's rule is that a
 * fault of OURS must not be dressed up as a gap in the customer's data; stating
 * it plainly, in its own words, is what is left once you take that seriously.
 *
 * It renders unconditionally for exactly that reason.
 */
export const POLICY_COVERAGE_GAP =
  "Two lines a governance review would normally carry are deliberately not here. The first is policy coverage — whether your published sensitivity labels are enforced rather than merely available, which workloads your DLP policies are actually scoped to, and how many workloads retention reaches. No check this assessment runs reads a policy's scope or its enforcement mode, so none of that is stated either way. The second is administrative role discipline: your Global Administrator count and your MFA registration count are both real and are reported in the Security Posture & Blast Radius Report rather than restated here, but nothing this platform runs reads which specific administrators lack a second factor, and nothing reads Privileged Identity Management at all. Their absence is a gap in what this platform measures today, not a finding about your tenant.";

/* ------------------------------------------------------------------ *
 * Section 3 — Governance Framework Alignment
 * ------------------------------------------------------------------ */

/**
 * The design's "Governance Framework Alignment" section, reduced to the half
 * that is true.
 *
 * ── WHAT SURVIVED AND WHAT DID NOT ───────────────────────────────────────────
 * The framing survives. "The M365 governance framework Shane McCaw wrote at
 * NASA and distributed agency-wide" is a fact about the framework's provenance,
 * Shane's own to state, and the restriction on using it was lifted 2026-08-06.
 * It is branding, not a claim about this tenant.
 *
 * The SCORE does not. "4 of 11 controls met" is a claim ABOUT THE TENANT, and
 * nothing in this platform evaluates a tenant against those eleven controls —
 * there is no control catalogue in `monitor_checks`, no per-control result
 * anywhere in the scan path, and no metric that could be read as one. The same
 * is true of all five rows beneath it: "340 sites deviate" from a naming
 * convention, "five labels published", retention "Exchange and SharePoint only",
 * lifecycle policies, "11 standing Global Admins". Each is a control verdict,
 * and each would have to be written rather than read.
 *
 * This is `copilotReadinessReport.ts`'s "Personas ready today" precedent exactly:
 * a section the design wants, whose content the platform holds no producer for,
 * declared as absent rather than approximated from a near-miss metric. The
 * difference is that here the framing is worth keeping on its own, so the
 * section stays and says what it can and cannot do.
 */
export const GOVERNANCE_FRAMEWORK_GAP =
  "Shane's own Microsoft 365 governance framework — written at NASA and distributed agency-wide — is the standard this practice measures governance against, and it is what the remediation work in this engagement is shaped by. What is deliberately not here is a score against it. This assessment reads your tenant's live configuration through the Microsoft Graph API; it does not evaluate that configuration control by control against the framework's eleven controls, and no check it runs produces a per-control verdict. So no number of controls is claimed met and none is claimed missed. The figures in this report are measurements, and a framework alignment score would be a judgement — one this assessment has not made.";

/* ------------------------------------------------------------------ *
 * Section 2 — Exposure & Oversharing Risks
 * ------------------------------------------------------------------ */

/**
 * The exposure figure the design's heat map is built on, stated as a row.
 *
 * `governance.exposure` resolves the SAME metric as `security.blastRadius` —
 * `copilot.overshareExposureCount`, over `copilot:overshare-exposure` — which is
 * deliberate and already true of the Reveal's two cards. It is not repeated in
 * the Summary above: the Summary states the estate and how much of it is
 * overshared, and this section states what that oversharing actually reaches,
 * which is the one number the whole section exists to explain.
 */
const EXPOSURE_PICKS: readonly StatPick[] = [
  { statId: "governance.exposure", pillar: "governance", label: "Items over-exposed", caption: "items reachable beyond their intended audience" },
];

/* ------------------------------------------------------------------ *
 * The verdict
 * ------------------------------------------------------------------ */

/**
 * The verdict card, from the governance pillar's own real headline and score.
 *
 * The design's version states a specific worst finding ("212 sites shared with
 * everyone in your tenant") and a consequence naming four HR and finance sites.
 * The real version states the pillar's real lead finding — either a real
 * `severity_rules` label, or `CLEAN_PILLAR_HEADLINE` for a pillar genuinely
 * evaluated clean (#399), or nothing for a pillar nothing scored. It never
 * asserts a worst finding for a pillar that was not evaluated, and it never
 * names a site: the scan counts sites, it does not pass their names to this
 * report.
 */
export function buildVerdict(governance: JourneyPillarView | undefined): GovernancePostureReport["verdict"] {
  const score = governance?.score ?? null;
  if (score === null) {
    return {
      eyebrow: "Governance posture",
      headline: "No governance score yet",
      sub: "This tenant's scan has not yet evaluated a rule that feeds the Governance pillar, so there is no posture score and no worst finding to lead with. What follows is what the scan did measure.",
    };
  }
  const headline = governance?.headline;
  return {
    eyebrow: headline ? "Worst finding" : "Governance posture",
    headline: headline ?? `Governance scores ${score} of 100`,
    sub: `The Governance pillar scores ${score} of 100 on this tenant's last scan. Every figure below is read directly from your own tenant; nothing here is a benchmark or an estimate.`,
  };
}

/* ------------------------------------------------------------------ *
 * The report
 * ------------------------------------------------------------------ */

const SECTION_HEADINGS: Record<GovernancePostureSectionKey, string> = {
  summary: "Governance Posture Summary",
  exposure: "Exposure & Oversharing Risks",
  copilotImpact: "Copilot Readiness Impact",
};

const FRAMEWORK_HEADING = "Governance Framework Alignment";

/**
 * Build the whole report from real data.
 *
 * `narrative` is optional and separately fetched: the pure-data sections must
 * render the moment the pillar payload lands, without waiting on up to three
 * Anthropic calls. A null narrative means "still loading"; a narrative whose
 * section carries `html: null` means "resolved, and honestly empty".
 */
export function buildGovernancePostureReport(input: {
  readonly view: JourneyView;
  readonly narrative: WireGovernancePosturePayload | null;
  /** True once the narrative fetch has settled, success or failure. */
  readonly narrativeSettled: boolean;
  /** Real curated check count behind the provenance line. */
  readonly scannedCheckCount: number;
}): GovernancePostureReport {
  const { view, narrative, narrativeSettled, scannedCheckCount } = input;
  const pillars = view.pillars;
  const governance = pillars.find((p) => p.key === "governance");

  const narrativeByKey = new Map<string, WireNarrativeSection>(
    (narrative?.sections ?? []).map((s) => [s.key, s]),
  );
  const prose = (key: GovernancePostureSectionKey): GovernancePostureBlock[] =>
    narrativeBlocks(narrativeByKey.get(key), narrativeSettled);

  const sections: GovernancePostureSection[] = [];

  // ── Governance Posture Summary ─────────────────────────────────────────────
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
      ...declaredGapBlock(POLICY_COVERAGE_GAP),
    ],
  });

  // ── Exposure & Oversharing Risks ───────────────────────────────────────────
  //
  // The real over-exposure count, then the governance pillar's own real
  // findings. The design's heat map sits between them and is not drawn — see
  // the header.
  const exposure = buildRows(pillars, EXPOSURE_PICKS);
  sections.push({
    heading: SECTION_HEADINGS.exposure,
    blocks: [
      ...prose("exposure"),
      ...keyValuesBlock(exposure.rows),
      ...findingsBlocks(
        governance,
        "The Governance pillar was evaluated on this tenant's last scan and returned no critical or warning finding about sharing, exposure or collaboration surface. That is a real result, not an empty section.",
        "No rule that feeds the Governance pillar was evaluated on this tenant's last scan, so no oversharing or exposure finding can be reported either way.",
      ),
      ...unavailableBlock(
        "Exposure figures this tenant's scan does not carry:",
        exposure.missing,
      ),
    ],
  });

  // ── Governance Framework Alignment ─────────────────────────────────────────
  //
  // The framing, and an explicit statement that no score against it is claimed.
  // Declared unconditionally: it is a fact about what this assessment does, not
  // about this tenant's scan.
  sections.push({
    heading: FRAMEWORK_HEADING,
    blocks: declaredGapBlock(GOVERNANCE_FRAMEWORK_GAP),
  });

  // ── Upgrade Opportunities (#451) ───────────────────────────────────────────
  //
  // ONE section for the whole document, on the same reasoning as its sibling
  // reports': `copilot:overshare-exposure` backs a stat here AND grounds the
  // narrative, so per-section blocks would print one licence fact twice, and a
  // category the reader is meant to tell apart from the severity ladder is
  // easier to tell apart when it is one place they can point at.
  const licenceGaps = upgradeOpportunities([
    ...summary.missing,
    ...exposure.missing,
    ...(narrative?.sections ?? []).flatMap((s) => s.missingChecks ?? []),
  ] as readonly UnavailableCheck[]);
  if (licenceGaps.length) {
    sections.push({
      heading: UPGRADE_OPPORTUNITY_HEADING,
      blocks: [
        { kind: "upgradeOpportunity", detail: UPGRADE_OPPORTUNITY_DETAIL, items: licenceGaps },
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
  // write it from. Neither predicts a post-remediation figure and neither
  // quotes a timeline: this journey states none on this path, so the design's
  // "three weeks of owner attestation" and "212 becomes 260 next quarter" are
  // both claims about Halden that cannot be inherited.
  const closing: string[] = [
    "Your governance posture is the backbone of your Microsoft 365 environment. It determines how safely Copilot can operate, how predictably your data behaves, and how effectively your security and compliance controls function — because Copilot grounds on whatever a user is already permitted to reach, not on what anyone intended them to reach.",
  ];
  if (typeof governance?.score === "number") {
    closing.push(
      `${view.tenant.name}'s Governance pillar scores ${governance.score} of 100 on this scan. Each finding above is a specific, named result from a specific check — there is nothing in this report that is not read from your own tenant.`,
    );
  }

  return {
    kicker: "Governance posture",
    headline:
      typeof governance?.score === "number"
        ? `Oversharing stops being a filing problem at ${view.tenant.name}`
        : `Governance posture for ${view.tenant.name}`,
    standfirst:
      "This report defines your tenant's governance posture, identifies every governance gap blocking Copilot readiness, and traces each finding to telemetry already surfaced in your own assessment. Every number here is read from your tenant; where a figure is absent, this report says so rather than estimating it.",
    verdict: buildVerdict(governance),
    sections,
    closing,
    provenance: buildProvenance(view.tenant.scannedOn, scannedCheckCount),
  };
}

/** Exported for tests — the picks are the contract with `war-room-pillar-stats.ts`. */
export const __testables = {
  SUMMARY_PICKS,
  EXPOSURE_PICKS,
  SECTION_HEADINGS,
  FRAMEWORK_HEADING,
};
