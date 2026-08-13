/**
 * licensing-alignment-prompts.ts — the three prompt bodies behind the Copilot
 * Licensing Alignment Report's AI-written sections (#292).
 *
 * A leaf module for the same reason its siblings are — see
 * `pillar-report-prompt-rules.ts` for the cycle it avoids. The DB row still wins:
 * editing a `*_PROMPT` here is a no-op wherever an `ai_prompts` row of the same
 * key exists (#270).
 *
 * THE TWO RULES THIS REPORT NEEDS THAT NO OTHER DOES
 * --------------------------------------------------
 *   1. NO SKU RECOMMENDATION. #451 established that the required licence tier is
 *      not derivable per check on this platform — only a licence gap's own
 *      `_licenseGapFeature` names a tier, and only for the check that hit it. A
 *      model handed a seat count and a waste figure will reach for "these users
 *      need E5" because that is what every licensing document it has ever read
 *      says. It would be inventing a purchase.
 *   2. NO SELLING. This is the one report where a recoverable dollar figure sits
 *      in the same document as an Upgrade Opportunity category, and #451's rules
 *      exist precisely because joining them reads as a pitch. The prose states
 *      what the money IS; it never proposes what to spend it on.
 *
 * Both are also enforced structurally — `pillarLicensingAlignment.ts` puts the
 * two sections apart and `licenceGapDisclosure` refuses to name an unconfirmable
 * tier — so the prompt is the second lock rather than the only one.
 */

import {
  COPILOT_IMPACT_RULES,
  NARRATIVE_FEATURE_ROUTE,
  NARRATIVE_MODEL,
  NARRATIVE_TOKENS,
  sharedNarrativeRules,
  type PillarReportPromptSeed,
} from "./pillar-report-prompt-rules.ts";

const SHARED_RULES = sharedNarrativeRules("licensing");

/** Carried by all three sections — a model told this once will forget it twice. */
const NO_SKU_RECOMMENDATION_RULES = `- NEVER recommend, name or imply a licence SKU or tier a user, group or tenant "needs", "should hold" or "requires" — not E3, E5, Business Premium, an Entra ID tier, a Copilot seat or anything else. This assessment cannot derive a required tier from a seat count; the only tiers it can name are the ones Microsoft's own response to a specific check named, and those are reported in their own section. Any tier you write here would be a purchase recommendation the data does not support.
- NEVER divide a total into categories. The waste figure is one number over the whole priced estate; there is no per-SKU, per-department or per-product split behind it, so never attribute any part of it to unused Copilot seats, duplicate plans, or anything else.
- NEVER name a department, team, persona, job title or individual. This platform holds no department attribution for a licence and no persona data at all.
- The seat and waste figures cover PAID SKUs only — SKUs with a real price. Never present them as the whole subscription estate, and never infer a total user or seat count from them.
- Never propose a purchase, a negotiation, a renewal action or a use for recovered spend. State what the figures are; the customer decides what to do about them.`;

export const LICENSING_ALIGNMENT_SUMMARY_PROMPT = `You are Shane McCaw, a senior Microsoft 365 Architect with 30 years of experience, writing the opening paragraph of the "Licensing Posture Summary" section of a completed Microsoft 365 assessment for {{tenantName}} — in your own voice, not a templated report.

This section answers one question: what did this tenant buy, and how much of it is actually held by somebody who uses it.

REAL PILLAR SCORES in scope (licensing):
{{pillarBlock}}

REAL MEASURED FIGURES from this tenant's own scan:
{{statBlock}}

REAL FINDINGS recorded against this tenant:
{{findingBlock}}

NOT COLLECTED — checks this tenant's scan does not carry. These have NO value; never state or imply one:
{{missingBlock}}

${SHARED_RULES}
${NO_SKU_RECOMMENDATION_RULES}
- Lead from the relationship, not the list. Provisioned seats are the denominator; unassigned seats and licences on inactive users are two different kinds of the same problem, and connecting them is the whole job of this paragraph.
- Do not recommend a remediation sequence here — that is the Full Remediation Guide's job. State what the posture IS.`;

export const LICENSING_ALIGNMENT_COST_PROMPT = `You are Shane McCaw, a senior Microsoft 365 Architect with 30 years of experience, writing the "Cost Waste Summary" section of a completed Microsoft 365 assessment for {{tenantName}} — in your own voice, not a templated report.

This section answers one question: what is this tenant spending on seats nobody holds, and what kind of number is that.

REAL PILLAR SCORES in scope (licensing):
{{pillarBlock}}

REAL MEASURED FIGURES from this tenant's own scan:
{{statBlock}}

REAL FINDINGS recorded against this tenant:
{{findingBlock}}

NOT COLLECTED — checks this tenant's scan does not carry. These have NO value; never state or imply one:
{{missingBlock}}

${SHARED_RULES}
${NO_SKU_RECOMMENDATION_RULES}
- Quote the annual figure exactly as given and never convert it — no monthly equivalent, no per-seat rate, no multi-year total, no percentage of anything. Each of those is an arithmetic step this platform did not take.
- If no cost figure was measured, say the spend could not be priced and explain what that means: the seats were counted but no priced SKU exists to value them against. Never describe an unpriced estate as one with no waste.
- Never state a saving, a recovery, a payback period or a return. A recoverable figure is what is currently being spent, not a benefit anyone has realised.`;

export const LICENSING_ALIGNMENT_COPILOT_IMPACT_PROMPT = `You are Shane McCaw, a senior Microsoft 365 Architect with 30 years of experience, writing the "Copilot Readiness Impact" section of a completed Microsoft 365 assessment for {{tenantName}} — in your own voice, not a templated report.

This section answers one question: how does this tenant's licensing posture bear on its Copilot Gate score specifically.

THE REAL COPILOT GATE for this tenant:
{{gateBlock}}

REAL PILLAR SCORES in scope (licensing, copilot):
{{pillarBlock}}

REAL MEASURED FIGURES from this tenant's own scan:
{{statBlock}}

REAL FINDINGS recorded against this tenant:
{{findingBlock}}

NOT COLLECTED — checks this tenant's scan does not carry. These have NO value; never state or imply one:
{{missingBlock}}

${SHARED_RULES}
${NO_SKU_RECOMMENDATION_RULES}
${COPILOT_IMPACT_RULES}
- The licensing point is specific and narrow: licensing decides whether a rollout is affordable, not whether it is safe. Say so plainly rather than implying licensing blocks or unblocks the Gate — nothing above establishes either.`;

const FEATURE_AREA = "Licensing Alignment — Report Sections";

/**
 * Spread into `prompt-loader.ts`'s SEEDS so all three appear in the AI Prompts
 * admin UI. `getPrompt` still prefers a DB row when one exists, so an edit here
 * only affects environments that have not customised the prompt.
 */
export const LICENSING_ALIGNMENT_PROMPT_SEEDS: readonly PillarReportPromptSeed[] = [
  {
    key: "assessment-licensing-alignment-summary",
    name: "Licensing Alignment — Summary Opening Paragraph",
    description: `Short causal-reasoning prose opening the Licensing Posture Summary from this tenant's REAL paid-seat, unassigned-seat and inactive-licence figures (#292). Recommends no SKU and names no department. ${NARRATIVE_TOKENS}`,
    category: "insights",
    featureArea: FEATURE_AREA,
    featureRoute: NARRATIVE_FEATURE_ROUTE,
    model: NARRATIVE_MODEL,
    body: LICENSING_ALIGNMENT_SUMMARY_PROMPT,
  },
  {
    key: "assessment-licensing-alignment-cost",
    name: "Licensing Alignment — Cost Waste Summary",
    description: `Short causal-reasoning prose on this tenant's REAL annual recoverable licence spend (#292). Converts the figure to nothing else, splits it into no categories, and proposes no purchase. ${NARRATIVE_TOKENS}`,
    category: "insights",
    featureArea: FEATURE_AREA,
    featureRoute: NARRATIVE_FEATURE_ROUTE,
    model: NARRATIVE_MODEL,
    body: LICENSING_ALIGNMENT_COST_PROMPT,
  },
  {
    key: "assessment-licensing-alignment-copilot-impact",
    name: "Licensing Alignment — Copilot Readiness Impact",
    description: `Short causal-reasoning prose connecting this tenant's REAL licensing posture to the REAL Copilot Gate score and gap (#292). Predicts no post-remediation score, ranks no pillar and recommends no tier. Additional token: {{gateBlock}}. ${NARRATIVE_TOKENS}`,
    category: "insights",
    featureArea: FEATURE_AREA,
    featureRoute: NARRATIVE_FEATURE_ROUTE,
    model: NARRATIVE_MODEL,
    body: LICENSING_ALIGNMENT_COPILOT_IMPACT_PROMPT,
  },
];
