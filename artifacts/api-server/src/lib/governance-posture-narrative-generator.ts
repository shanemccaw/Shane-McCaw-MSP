/**
 * governance-posture-narrative-generator.ts
 *
 * The three AI-written prose sections of the Microsoft 365 Governance Posture
 * Report (#292) — the Governance Posture Summary's opening paragraph, the
 * Exposure & Oversharing Risks section's causal explanation, and the Copilot
 * Readiness Impact section's connection to the Gate score.
 *
 * SAME PATTERN AS ITS TWO PREDECESSORS, DELIBERATELY
 * ---------------------------------------------------
 * Structured real data in, one attributed Anthropic call per section, an HTML
 * fragment out, sanitised the same way. Nothing new is invented about how the
 * platform calls Anthropic. The loop itself is `pillar-report-narrative.ts`,
 * shared with the other three reports #292 ports, and the never-fabricate
 * machinery under it is `narrative-grounding.ts`, shared with all six — so the
 * guarantee cannot drift between reports. What is declared HERE is the only
 * thing that makes this the Governance report: which pillars ground which
 * section, its headings, its prompt keys and its prompt bodies.
 *
 * NO METRIC IS RESOLVED ON THE SIDE
 * ---------------------------------
 * Unlike `security-posture-narrative-generator.ts`, which resolves Microsoft
 * Secure Score because no `WAR_ROOM_PILLAR_STAT_SPECS` entry carries it, every
 * figure this report shows is already on the `war-room-pillars` wire. The
 * governance card's four stats — sites inventoried, overshared sites, items
 * over-exposed, public channels — are the whole of it, so there is no second
 * path from a value to a sentence anywhere in this report.
 *
 * WHAT THIS REPORT DROPS, AND WHY
 * -------------------------------
 * The design's "Drift & Violations" section and the Summary's "Governance drift"
 * row are absent, on the same reasoning every report before this one used: drift
 * is a diff against a recorded baseline and there is none on a first scan. So is
 * "Governance Automation Readiness", whose five rows need an automation-
 * eligibility check, a change-control integration and a named owner column that
 * this platform has none of. And the framework SCORE — "4 of 11 controls met" —
 * is absent while the framework FRAMING is kept: see
 * `pillarGovernancePosture.ts`'s `GOVERNANCE_FRAMEWORK_GAP` for the split and
 * why it falls where it does.
 */

import {
  GOVERNANCE_POSTURE_COPILOT_IMPACT_PROMPT,
  GOVERNANCE_POSTURE_EXPOSURE_PROMPT,
  GOVERNANCE_POSTURE_SUMMARY_PROMPT,
} from "./governance-posture-prompts.ts";
import {
  generatePillarReportNarrative,
  type PillarReportAttribution,
  type PillarReportNarrativeResult,
  type PillarReportSpec,
} from "./pillar-report-narrative.ts";

/** The three prose sections, in the order the report renders them. */
export const GOVERNANCE_POSTURE_NARRATIVE_SECTIONS = ["summary", "exposure", "copilotImpact"] as const;
export type GovernancePostureSectionKey = (typeof GOVERNANCE_POSTURE_NARRATIVE_SECTIONS)[number];

/**
 * Which pillars ground which section, and the rest of what makes this report
 * itself.
 *
 * `exposure` reads compliance alongside governance because the exposure story
 * genuinely spans both: `governance.exposure` resolves
 * `copilot.overshareExposureCount`, and the labelling figure that decides
 * whether an over-exposed item carries any restriction at all is the compliance
 * card's. `summary` deliberately does NOT — it states what the governance estate
 * IS, and a compliance figure in that paragraph would be a figure the table
 * beside it does not show.
 *
 * `copilotImpact` is the only section given the Gate, because it is the only one
 * whose prompt body carries `{{gateBlock}}`.
 */
export const GOVERNANCE_POSTURE_SPEC: PillarReportSpec = {
  feature: "governance_posture",
  logName: "governance-posture-narrative",
  sections: [
    {
      key: "summary",
      heading: "Governance Posture Summary",
      pillars: ["governance"],
      promptKey: "assessment-governance-posture-summary",
      promptBody: GOVERNANCE_POSTURE_SUMMARY_PROMPT,
    },
    {
      key: "exposure",
      heading: "Exposure & Oversharing Risks",
      pillars: ["governance", "compliance"],
      promptKey: "assessment-governance-posture-exposure",
      promptBody: GOVERNANCE_POSTURE_EXPOSURE_PROMPT,
    },
    {
      key: "copilotImpact",
      heading: "Copilot Readiness Impact",
      pillars: ["governance", "copilot"],
      promptKey: "assessment-governance-posture-copilot-impact",
      promptBody: GOVERNANCE_POSTURE_COPILOT_IMPACT_PROMPT,
      withGate: true,
    },
  ],
};

export type GovernancePostureNarrativeResult = PillarReportNarrativeResult;

/**
 * Generate all three prose sections for one real customer.
 *
 * Never throws for a thin or empty tenant: that is a real state with a real,
 * honest rendering. It throws only if the underlying real data cannot be read at
 * all, which the route surfaces as an error rather than an empty report.
 */
export function generateGovernancePostureNarrative(params: {
  readonly customerId: number;
  readonly tenantName: string;
  readonly attribution: PillarReportAttribution;
}): Promise<GovernancePostureNarrativeResult> {
  return generatePillarReportNarrative(GOVERNANCE_POSTURE_SPEC, params);
}

/** Exported for tests — the section specs ARE the grounding contract. */
export const __testables = { GOVERNANCE_POSTURE_SPEC };
