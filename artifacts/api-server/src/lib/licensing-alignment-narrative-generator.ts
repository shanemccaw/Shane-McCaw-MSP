/**
 * licensing-alignment-narrative-generator.ts
 *
 * The three AI-written prose sections of the Copilot Licensing Alignment Report
 * (#292) — the Licensing Posture Summary's opening paragraph, the Cost Waste
 * Summary's explanation of what the recoverable figure is, and the Copilot
 * Readiness Impact section's connection to the Gate score.
 *
 * SAME PATTERN AS ITS PREDECESSORS, DELIBERATELY. The loop is
 * `pillar-report-narrative.ts` and the never-fabricate machinery under it is
 * `narrative-grounding.ts`; what is declared HERE is only what makes this the
 * Licensing report.
 *
 * NO METRIC IS RESOLVED ON THE SIDE. Every figure this report shows is already
 * on the `/portal/pillars` wire — the licensing card's four stats. Three of
 * them come from the real `/subscribedSkus` arithmetic
 * (`resolvePaidSeatFigures` + `computeSkuCostBreakdown`) and the fourth from
 * `licensing:inactive-user-licenses`.
 *
 * THE FIGURES ARE PAID-ESTATE ONLY, AND THAT IS LOAD-BEARING
 * -----------------------------------------------------------
 * `resolvePaidSeatFigures` restricts both counts to SKUs with a real price in
 * `sku_price_reference`, which is what keeps Microsoft's free and viral SKUs out
 * of them. #333 is the record of what happens otherwise: a five-user tenant
 * rendering "1,020,000 seats provisioned" because Graph reports a sentinel
 * capacity for POWER_BI_STANDARD. The prompts below therefore forbid the model
 * from presenting these as the whole subscription estate or inferring a user
 * count from them — the arithmetic that produced them cannot support either.
 *
 * WHAT THIS REPORT DROPS, AND WHY
 * -------------------------------
 * Every department-level and persona-level claim in the design is absent —
 * "Operations: 31 seats above its role pattern", "84 users in high-value
 * personas", "Finance Analyst, Legal Counsel and Bid Manager". `/subscribedSkus`
 * is a per-SKU capacity endpoint; nothing in the scan path joins a licence to a
 * department, a job title or a role template, and this platform holds no persona
 * data for a tenant at all (the same reason `copilotReadinessReport.ts` dropped
 * "Personas ready today").
 *
 * So is every SKU recommendation — "96 Copilot-eligible users lack the required
 * base licence", "19 on E5 who need E3". #451 established that the required tier
 * is not derivable per check on this platform: only a licence gap's own
 * `_licenseGapFeature` names one, and only for the check that hit it. The
 * prompts below carry an explicit prohibition, because a model handed a seat
 * count and a waste figure will otherwise reach for E5 — that is what every
 * licensing document it has ever read says.
 *
 * And so is the per-category waste chart. #292's own data-requirement comment
 * says why: it "needs a structured breakdown by category or department, not just
 * the single total waste figure", and the single total is what
 * `computeSkuCostBreakdown` produces.
 */

import {
  LICENSING_ALIGNMENT_COPILOT_IMPACT_PROMPT,
  LICENSING_ALIGNMENT_COST_PROMPT,
  LICENSING_ALIGNMENT_SUMMARY_PROMPT,
} from "./licensing-alignment-prompts.ts";
import {
  generatePillarReportNarrative,
  type PillarReportAttribution,
  type PillarReportNarrativeResult,
  type PillarReportSpec,
} from "./pillar-report-narrative.ts";

/** The three prose sections, in the order the report renders them. */
export const LICENSING_ALIGNMENT_NARRATIVE_SECTIONS = ["summary", "cost", "copilotImpact"] as const;
export type LicensingAlignmentSectionKey = (typeof LICENSING_ALIGNMENT_NARRATIVE_SECTIONS)[number];

/**
 * Which pillars ground which section, and the rest of what makes this report
 * itself.
 *
 * Both the Summary and the Cost section are scoped to `licensing` ALONE, and
 * that narrowness is the point rather than an oversight: every other report in
 * this set widens a section's scope so the prose can explain one figure with
 * another, but the failure mode here runs the other way. A licensing paragraph
 * handed a governance or compliance figure will connect the two into a
 * recommendation — "close the exposure by moving these users to a tier that
 * carries the controls" — which is precisely the purchase claim #451 forbids and
 * which no data above supports. The section that IS allowed to reason across
 * pillars is `copilotImpact`, and only as far as the Gate.
 *
 * `copilotImpact` is also the only section given the Gate, because it is the
 * only one whose prompt body carries `{{gateBlock}}`.
 */
export const LICENSING_ALIGNMENT_SPEC: PillarReportSpec = {
  feature: "licensing_alignment",
  logName: "licensing-alignment-narrative",
  sections: [
    {
      key: "summary",
      heading: "Licensing Posture Summary",
      pillars: ["licensing"],
      promptKey: "assessment-licensing-alignment-summary",
      promptBody: LICENSING_ALIGNMENT_SUMMARY_PROMPT,
    },
    {
      key: "cost",
      heading: "Cost Waste Summary",
      pillars: ["licensing"],
      promptKey: "assessment-licensing-alignment-cost",
      promptBody: LICENSING_ALIGNMENT_COST_PROMPT,
    },
    {
      key: "copilotImpact",
      heading: "Copilot Readiness Impact",
      pillars: ["licensing", "copilot"],
      promptKey: "assessment-licensing-alignment-copilot-impact",
      promptBody: LICENSING_ALIGNMENT_COPILOT_IMPACT_PROMPT,
      withGate: true,
    },
  ],
};

export type LicensingAlignmentNarrativeResult = PillarReportNarrativeResult;

/**
 * Generate all three prose sections for one real customer.
 *
 * Never throws for a thin or empty tenant: that is a real state with a real,
 * honest rendering. It throws only if the underlying real data cannot be read at
 * all, which the route surfaces as an error rather than an empty report.
 */
export function generateLicensingAlignmentNarrative(params: {
  readonly customerId: number;
  readonly tenantName: string;
  readonly attribution: PillarReportAttribution;
}): Promise<LicensingAlignmentNarrativeResult> {
  return generatePillarReportNarrative(LICENSING_ALIGNMENT_SPEC, params);
}

/** Exported for tests — the section specs ARE the grounding contract. */
export const __testables = { LICENSING_ALIGNMENT_SPEC };
