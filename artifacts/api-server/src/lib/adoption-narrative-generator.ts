/**
 * adoption-narrative-generator.ts
 *
 * The three AI-written prose sections of the Copilot Adoption & Usage Report —
 * the Adoption Posture Summary's opening paragraph, the Workload Activity &
 * Usage Signals section, and the Copilot Readiness Impact section's connection
 * to the Gate score.
 *
 * SAME PATTERN AS ITS SIX PREDECESSORS, DELIBERATELY. The loop is
 * `pillar-report-narrative.ts` and the never-fabricate machinery under it is
 * `narrative-grounding.ts`; what is declared HERE is only what makes this the
 * Adoption report.
 *
 * NO METRIC IS RESOLVED ON THE SIDE, and in this report's case there is not one
 * to resolve. `PILLAR_STAT_SPECS.adoption` is an EMPTY ARRAY, so
 * `collectFactsForPillars` produces no stat lines for this pillar and
 * `{{statBlock}}` is always the "no measured figure has a value" placeholder.
 * That is a documented state rather than a wiring miss — the card's four old
 * "active <workload> users" stats named `usage:*` keys that #441 established
 * are not a check-key domain in this catalog, and the real `adoption:*` checks
 * are Graph usage-report DETAIL endpoints whose `_itemCount` fallback would
 * render the licensed roster under a caption reading "active users".
 *
 * ── WHAT IS ACTUALLY ON THE WIRE FOR THIS REPORT ─────────────────────────────
 * Three real things, and the fact floor is reached from the first two:
 *
 *   the pillar score       `computePillarDisplayScore` over the signals that
 *                          fired — one fact.
 *   the pillar's findings  real `msp_diagnostic_findings` rows, grouped onto
 *                          this card by `signal_derivation_rules.pillar` (#469,
 *                          #521) — one fact each. Six `adoption:*` checks feed
 *                          it, plus `teams:inactive-teams`, whose key sits in
 *                          the `teams` category but whose signal's pillar is
 *                          `adoption`. That is exactly why the grounding scope
 *                          below is a PILLAR and not a list of check keys.
 *   the Copilot Gate       `computeCopilotGate`, on the `copilotImpact` section
 *                          only, because it is the only one whose prompt body
 *                          carries `{{gateBlock}}`.
 *
 * A tenant whose scan ran none of these reaches neither the floor nor a
 * fabricated paragraph: the section is omitted with a machine reason and the
 * viewer renders an honest unavailable state.
 *
 * ── THE TWO CLAIMS THIS REPORT'S PROMPTS EXIST TO STOP ───────────────────────
 * A usage COUNT, and a DIRECTION of travel. Both are forbidden in
 * `adoption-prompts.ts` and both are declared to the reader in words by
 * `USAGE_FIGURE_GAP` and `TREND_DIRECTION_GAP` in msp-portal's
 * `pillarAdoption.ts`, so the prose and the report around it cannot contradict
 * each other. The second is the one specific to this report: three of the six
 * checks carry the word "trend" in their catalogue labels while every one of
 * them reads a `period='D7'` window collected once, with no earlier window
 * persisted beside it to diff against.
 *
 * WHAT ELSE THIS REPORT DROPS, AND WHY
 * ------------------------------------
 * The design's "Persona Readiness Analysis", "Workflow Alignment Assessment"
 * and "Training & Enablement Gaps" are absent because this platform produces no
 * persona model, no workflow measurement and no training record — the one
 * `workflow:*` signal in the catalog is an example row seeded for the rule
 * builder, with confidence 0 and every impact 0. Its projected score
 * ("enablement alone moves Adoption from 46 to an estimated 61") and its point
 * attribution ("Adoption contributes 22 points of available gain") are absent
 * on the standing rule the other six already follow, which `COPILOT_IMPACT_RULES`
 * carries in prompt form.
 */

import {
  ADOPTION_ACTIVITY_PROMPT,
  ADOPTION_COPILOT_IMPACT_PROMPT,
  ADOPTION_SUMMARY_PROMPT,
} from "./adoption-prompts.ts";
import {
  generatePillarReportNarrative,
  type PillarReportAttribution,
  type PillarReportNarrativeResult,
  type PillarReportSpec,
} from "./pillar-report-narrative.ts";

/** The three prose sections, in the order the report renders them. */
export const ADOPTION_NARRATIVE_SECTIONS = ["summary", "activity", "copilotImpact"] as const;
export type AdoptionSectionKey = (typeof ADOPTION_NARRATIVE_SECTIONS)[number];

/**
 * Which pillars ground which section, and the rest of what makes this report
 * itself.
 *
 * `summary` and `activity` share the same single-pillar scope, which is the
 * `licensing_alignment` spec's shape rather than the `governance_posture` one,
 * and for the same reason: the two sections ask different questions of the same
 * card. Neither is given a second pillar, deliberately — this report shows no
 * measured figure at all, so a figure borrowed from another card would be the
 * only number in a document whose whole argument is that it has none.
 *
 * `copilotImpact` is the only section given the Gate, because it is the only one
 * whose prompt body carries `{{gateBlock}}`.
 */
export const ADOPTION_SPEC: PillarReportSpec = {
  feature: "adoption",
  logName: "adoption-narrative",
  sections: [
    {
      key: "summary",
      heading: "Adoption Posture Summary",
      pillars: ["adoption"],
      promptKey: "assessment-adoption-summary",
      promptBody: ADOPTION_SUMMARY_PROMPT,
    },
    {
      key: "activity",
      heading: "Workload Activity & Usage Signals",
      pillars: ["adoption"],
      promptKey: "assessment-adoption-activity",
      promptBody: ADOPTION_ACTIVITY_PROMPT,
    },
    {
      key: "copilotImpact",
      heading: "Copilot Readiness Impact",
      pillars: ["adoption", "copilot"],
      promptKey: "assessment-adoption-copilot-impact",
      promptBody: ADOPTION_COPILOT_IMPACT_PROMPT,
      withGate: true,
    },
  ],
};

export type AdoptionNarrativeResult = PillarReportNarrativeResult;

/**
 * Generate all three prose sections for one real customer.
 *
 * Never throws for a thin or empty tenant: that is a real state with a real,
 * honest rendering. It throws only if the underlying real data cannot be read at
 * all, which the route surfaces as an error rather than an empty report.
 */
export function generateAdoptionNarrative(params: {
  readonly customerId: number;
  readonly tenantName: string;
  readonly attribution: PillarReportAttribution;
}): Promise<AdoptionNarrativeResult> {
  return generatePillarReportNarrative(ADOPTION_SPEC, params);
}

/** Exported for tests — the section specs ARE the grounding contract. */
export const __testables = { ADOPTION_SPEC };
