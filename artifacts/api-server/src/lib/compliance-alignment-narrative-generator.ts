/**
 * compliance-alignment-narrative-generator.ts
 *
 * The three AI-written prose sections of the Microsoft 365 Compliance &
 * Regulatory Alignment Report (#292) — the Compliance Posture Summary's opening
 * paragraph, the Data Lifecycle & Records Management section, and the Copilot
 * Readiness Impact section's connection to the Gate score.
 *
 * SAME PATTERN AS ITS PREDECESSORS, DELIBERATELY. The loop is
 * `pillar-report-narrative.ts` and the never-fabricate machinery under it is
 * `narrative-grounding.ts`; what is declared HERE is only what makes this the
 * Compliance report.
 *
 * NO METRIC IS RESOLVED ON THE SIDE. Every figure this report shows is already
 * on the `/portal/pillars` wire — the compliance card's four stats (missing
 * sensitivity labels, retention policy drift, weak DLP policies, guest users)
 * are the whole of it.
 *
 * THOSE FOUR ARE LIVE, NOT STALE
 * ------------------------------
 * Worth stating, because three of them read like checks that were quietly
 * abandoned. As of 2026-08-06 `compliance:weak-dlp-policies`,
 * `compliance:dlp-incidents`, `compliance:missing-labels` and
 * `compliance:label-errors` are re-linked to the `assess:copilot-readiness`
 * package and newly wired into `signal_derivation_rules` with real (if
 * provisional) compliance and governance impact weights. A tenant scanned before
 * that carries `not_in_scan_package` — the honest "this never ran" rather than
 * the ambiguous `no_data` — which is exactly the distinction #341 exists to
 * draw, and it reaches the reader intact.
 *
 * WHAT THIS REPORT DROPS, AND WHY
 * -------------------------------
 * The design's "Regulatory Alignment Assessment" — a GDPR / SOX / HIPAA / FINRA
 * grid with a verdict per framework — is absent, and so is the Summary's
 * "Regulatory coverage" row. This platform has NO framework check of any kind:
 * nothing in `monitor_checks` maps a control to a requirement, nothing
 * classifies content as personal, health or financial data, and nothing reads
 * audit-log retention. Every verdict in that section would be written rather
 * than read. It is declared to the reader in words instead — see
 * `pillarComplianceAlignment.ts`'s `REGULATORY_FRAMEWORK_GAP` — and the prompts
 * below carry an explicit prohibition on naming a regulation, so the prose and
 * the disclosure cannot contradict each other.
 *
 * "Compliance Drift & Violations" is absent on the standing reasoning: drift is
 * a diff against a recorded baseline and there is none on a first scan.
 * `compliance:retention-drift` is NOT that — it is a real point-in-time count of
 * coverage gaps, and the prompts below say so explicitly so the model cannot
 * narrate it as movement over time.
 */

import {
  COMPLIANCE_ALIGNMENT_COPILOT_IMPACT_PROMPT,
  COMPLIANCE_ALIGNMENT_LIFECYCLE_PROMPT,
  COMPLIANCE_ALIGNMENT_SUMMARY_PROMPT,
} from "./compliance-alignment-prompts.ts";
import {
  generatePillarReportNarrative,
  type PillarReportAttribution,
  type PillarReportNarrativeResult,
  type PillarReportSpec,
} from "./pillar-report-narrative.ts";

/** The three prose sections, in the order the report renders them. */
export const COMPLIANCE_ALIGNMENT_NARRATIVE_SECTIONS = ["summary", "lifecycle", "copilotImpact"] as const;
export type ComplianceAlignmentSectionKey = (typeof COMPLIANCE_ALIGNMENT_NARRATIVE_SECTIONS)[number];

/**
 * Which pillars ground which section, and the rest of what makes this report
 * itself.
 *
 * `lifecycle` reads governance alongside compliance because staleness is a
 * governance fact with a compliance consequence: the sites and channels an
 * over-sharing figure counts are the same containers a retention gap leaves
 * un-disposed, and Copilot returns content from both as current.
 *
 * `copilotImpact` is the only section given the Gate, because it is the only one
 * whose prompt body carries `{{gateBlock}}`.
 */
export const COMPLIANCE_ALIGNMENT_SPEC: PillarReportSpec = {
  feature: "compliance_alignment",
  logName: "compliance-alignment-narrative",
  sections: [
    {
      key: "summary",
      heading: "Compliance Posture Summary",
      pillars: ["compliance"],
      promptKey: "assessment-compliance-alignment-summary",
      promptBody: COMPLIANCE_ALIGNMENT_SUMMARY_PROMPT,
    },
    {
      key: "lifecycle",
      heading: "Data Lifecycle & Records Management",
      pillars: ["compliance", "governance"],
      promptKey: "assessment-compliance-alignment-lifecycle",
      promptBody: COMPLIANCE_ALIGNMENT_LIFECYCLE_PROMPT,
    },
    {
      key: "copilotImpact",
      heading: "Copilot Readiness Impact",
      pillars: ["compliance", "copilot"],
      promptKey: "assessment-compliance-alignment-copilot-impact",
      promptBody: COMPLIANCE_ALIGNMENT_COPILOT_IMPACT_PROMPT,
      withGate: true,
    },
  ],
};

export type ComplianceAlignmentNarrativeResult = PillarReportNarrativeResult;

/**
 * Generate all three prose sections for one real customer.
 *
 * Never throws for a thin or empty tenant: that is a real state with a real,
 * honest rendering. It throws only if the underlying real data cannot be read at
 * all, which the route surfaces as an error rather than an empty report.
 */
export function generateComplianceAlignmentNarrative(params: {
  readonly customerId: number;
  readonly tenantName: string;
  readonly attribution: PillarReportAttribution;
}): Promise<ComplianceAlignmentNarrativeResult> {
  return generatePillarReportNarrative(COMPLIANCE_ALIGNMENT_SPEC, params);
}

/** Exported for tests — the section specs ARE the grounding contract. */
export const __testables = { COMPLIANCE_ALIGNMENT_SPEC };
