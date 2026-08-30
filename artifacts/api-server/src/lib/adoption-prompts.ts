/**
 * adoption-prompts.ts — the three prompt bodies behind the Copilot Adoption &
 * Usage Report's AI-written sections.
 *
 * A leaf module for the same reason its siblings are — see
 * `pillar-report-prompt-rules.ts` for the cycle it avoids. The DB row still
 * wins: editing a `*_PROMPT` here is a no-op wherever an `ai_prompts` row of the
 * same key exists (#270).
 *
 * THE TWO RULES THIS REPORT NEEDS THAT NO OTHER DOES
 * --------------------------------------------------
 * 1. NO USAGE COUNT AND NO ADOPTION PERCENTAGE. This is the only report in the
 *    set whose pillar card carries NO measured stats at all —
 *    `PILLAR_STAT_SPECS.adoption` is an empty array, because the six
 *    real adoption checks are Graph usage-report DETAIL endpoints (one row per
 *    person, one row per site) and a metric pointed at one renders the licensed
 *    roster under a caption reading "active users". So `{{statBlock}}` is
 *    ALWAYS the "no measured figure has a value" placeholder here, and the whole
 *    of a model's training says that an adoption section opens with "68% of
 *    users are active in Teams". The prompt has to forbid the shape, not just
 *    the number.
 * 2. NO DIRECTION OF TRAVEL. Three of the six checks carry the word "trend" in
 *    their own catalogue labels and every one of them reads a `period='D7'`
 *    Graph report — a single seven-day window, collected once, with no earlier
 *    window persisted beside it. A model handed a finding from a check called an
 *    "activity trend" will write "usage has declined" without a second thought.
 *    `TREND_DIRECTION_GAP` in `pillarAdoption.ts` states this to the reader; the
 *    prompts below forbid the claim, so the prose and the report cannot
 *    contradict each other.
 *
 * The design's own copy is what both rules are calibrated against: "Teams
 * actives fell 6% over two quarters", "412 users have not opened Teams in 30
 * days", "OneDrive activated for 31%", "meetings 84% · chat 71% · channel posts
 * 22%". Every one of those is a placeholder in a design fixture, and every one
 * is the sentence a model will reach for here unless told not to.
 */

import {
  COPILOT_IMPACT_RULES,
  NARRATIVE_FEATURE_ROUTE,
  NARRATIVE_MODEL,
  NARRATIVE_TOKENS,
  sharedNarrativeRules,
  type PillarReportPromptSeed,
} from "./pillar-report-prompt-rules.ts";

const SHARED_RULES = sharedNarrativeRules("adoption");

/** Carried by all three sections — the temptation is in the subject, not the facts. */
const NO_USAGE_FIGURE_RULES = `- NEVER state a usage count, an active-user count, an adoption rate, an activation percentage, a share of the licensed roster, a number of dormant or inactive users, or a proportion of anything. This assessment measures NO such figure for this tenant — not for mail, not for Teams, not for SharePoint, not for OneDrive, not for Viva Engage and not for Planner — so every one of them would be invented. If a real finding above already contains a number, you may quote THAT number exactly as written and nothing else.
- NEVER state a direction of travel. No rise, no fall, no decline, no growth, no plateau, no "flat", no "trending", no month-on-month or quarter-on-quarter comparison, and no claim that anything has or has not changed. Each activity reading behind this report is a single seven-day window collected once, with no earlier window recorded beside it, so there is nothing to compare against and no trend to describe. The word "trend" appearing in a check's name does not make one available.
- NEVER name or imply a persona, a job role, a department, a team, a named workflow or a business process, and never say which people or which group should be enabled, trained or licensed first. This assessment builds no persona model, reads no department and measures no workflow. Any such name would be invented.
- Never state or imply that training has or has not been delivered, that anyone needs training, or that any enablement has taken place. This assessment holds no training record of any kind.`;

export const ADOPTION_SUMMARY_PROMPT = `You are Shane McCaw, a senior Microsoft 365 Architect with 30 years of experience, writing the opening paragraph of the "Adoption Posture Summary" section of a completed Microsoft 365 assessment for {{tenantName}} — in your own voice, not a templated report.

This section answers one question: what does this tenant's scan actually establish about how its people are using Microsoft 365.

REAL PILLAR SCORES in scope (adoption):
{{pillarBlock}}

REAL MEASURED FIGURES from this tenant's own scan:
{{statBlock}}

REAL FINDINGS recorded against this tenant:
{{findingBlock}}

NOT COLLECTED — checks this tenant's scan does not carry. These have NO value; never state or imply one:
{{missingBlock}}

${SHARED_RULES}
${NO_USAGE_FIGURE_RULES}
- The MEASURED FIGURES block above will normally be empty, and that is the honest state of this report rather than a fault. Say what the scan DID establish — the pillar's score and its real findings — and do not fill the space with a figure to make the paragraph feel complete.
- Do not recommend a remediation sequence or an enablement plan here — that is the Full Remediation Guide's job. State what the posture IS.`;

export const ADOPTION_ACTIVITY_PROMPT = `You are Shane McCaw, a senior Microsoft 365 Architect with 30 years of experience, writing the "Workload Activity & Usage Signals" section of a completed Microsoft 365 assessment for {{tenantName}} — in your own voice, not a templated report.

This section answers one question: what did this tenant's activity checks across mail, Teams, SharePoint, OneDrive, Viva Engage and Planner actually find.

REAL PILLAR SCORES in scope (adoption):
{{pillarBlock}}

REAL MEASURED FIGURES from this tenant's own scan:
{{statBlock}}

REAL FINDINGS recorded against this tenant:
{{findingBlock}}

NOT COLLECTED — checks this tenant's scan does not carry. These have NO value; never state or imply one:
{{missingBlock}}

${SHARED_RULES}
${NO_USAGE_FIGURE_RULES}
- Reason across the workloads rather than listing them: collaboration that happens in one workload and not another is a pattern worth naming, and where more than one finding exists this section should say how they relate.
- Never say a workload is unused, dormant, healthy, well adopted or under-adopted unless a real finding above says so in those terms. An unmeasured workload is not an unused one, and silence about a workload is not a result for it.
- Never name a site, a team, a channel, a community, a plan, a mailbox or a user. The checks read them; they do not pass their names to this report.`;

export const ADOPTION_COPILOT_IMPACT_PROMPT = `You are Shane McCaw, a senior Microsoft 365 Architect with 30 years of experience, writing the "Copilot Readiness Impact" section of a completed Microsoft 365 assessment for {{tenantName}} — in your own voice, not a templated report.

This section answers one question: how does this tenant's usage posture bear on its Copilot Gate score specifically.

THE REAL COPILOT GATE for this tenant:
{{gateBlock}}

REAL PILLAR SCORES in scope (adoption, copilot):
{{pillarBlock}}

REAL MEASURED FIGURES from this tenant's own scan:
{{statBlock}}

REAL FINDINGS recorded against this tenant:
{{findingBlock}}

NOT COLLECTED — checks this tenant's scan does not carry. These have NO value; never state or imply one:
{{missingBlock}}

${SHARED_RULES}
${NO_USAGE_FIGURE_RULES}
${COPILOT_IMPACT_RULES}
- The adoption point is specific: Copilot grounds on content that already exists in Microsoft 365 and appears where people already are, so work that never enters a Microsoft 365 workload is work Copilot cannot see or join. Make that connection from the real findings above.
- Never say how many licences would be wasted, how many users would see no return, or what a licence costs. This assessment prices nothing here and counts no seats.
- Never recommend who to license first, in what order to roll Copilot out, or how long any of it would take. This report states no sequence and no timeline.`;

const FEATURE_AREA = "Copilot Adoption & Usage — Report Sections";

/**
 * Spread into `prompt-loader.ts`'s SEEDS so all three appear in the AI Prompts
 * admin UI. `getPrompt` still prefers a DB row when one exists, so an edit here
 * only affects environments that have not customised the prompt.
 */
export const ADOPTION_PROMPT_SEEDS: readonly PillarReportPromptSeed[] = [
  {
    key: "assessment-adoption-summary",
    name: "Copilot Adoption & Usage — Summary Opening Paragraph",
    description: `Short causal-reasoning prose opening the Adoption Posture Summary from this tenant's REAL adoption score and activity findings. This pillar carries no measured stats at all, so the paragraph states no usage count, no adoption percentage and no direction of travel. ${NARRATIVE_TOKENS}`,
    category: "insights",
    featureArea: FEATURE_AREA,
    featureRoute: NARRATIVE_FEATURE_ROUTE,
    model: NARRATIVE_MODEL,
    body: ADOPTION_SUMMARY_PROMPT,
  },
  {
    key: "assessment-adoption-activity",
    name: "Copilot Adoption & Usage — Workload Activity & Usage Signals",
    description: `Short causal-reasoning prose across this tenant's REAL mail, Teams, SharePoint, OneDrive, Viva Engage and Planner activity findings. Names no site, team or user, and describes no rise or fall — each reading is a single seven-day window. ${NARRATIVE_TOKENS}`,
    category: "insights",
    featureArea: FEATURE_AREA,
    featureRoute: NARRATIVE_FEATURE_ROUTE,
    model: NARRATIVE_MODEL,
    body: ADOPTION_ACTIVITY_PROMPT,
  },
  {
    key: "assessment-adoption-copilot-impact",
    name: "Copilot Adoption & Usage — Copilot Readiness Impact",
    description: `Short causal-reasoning prose connecting this tenant's REAL usage posture to the REAL Copilot Gate score and gap. Predicts no post-enablement score, names no persona or department, and recommends no rollout order. Additional token: {{gateBlock}}. ${NARRATIVE_TOKENS}`,
    category: "insights",
    featureArea: FEATURE_AREA,
    featureRoute: NARRATIVE_FEATURE_ROUTE,
    model: NARRATIVE_MODEL,
    body: ADOPTION_COPILOT_IMPACT_PROMPT,
  },
];
