/**
 * pillar-report-prompt-rules.ts — the honesty rules every live-rendered pillar
 * report's prompt bodies carry (#292).
 *
 * WHY THIS IS ITS OWN LEAF MODULE
 * --------------------------------
 * `copilot-readiness-prompts.ts` (#409) and `security-posture-prompts.ts` (#343)
 * each hold their own private `SHARED_RULES` string, which was fine at two and is
 * not at six: #292 adds four more reports on the identical pattern, and four more
 * copies of "never invent a number" is four more places for the rule to rot one
 * edit at a time.
 *
 * A leaf module with NO imports, for the same reason those two are: the
 * generators cannot own these (prompt-loader would have to import a generator,
 * and generators import prompt-loader — a cycle), and prompt-loader cannot own
 * them without every generator importing a 1,600-line module for a few strings.
 *
 * The two EXISTING prompt modules are deliberately not repointed at this. Their
 * rule blocks have already diverged from each other on purpose — the security
 * one carries two extra lines about not describing an attack that has not
 * happened, and each names its own domain in the "no generic advice" clause — and
 * both are shipped, seeded into `ai_prompts`, and asserted verbatim by their own
 * suites. Rewriting a live prompt body is a behaviour change to a shipped report,
 * which is not what this issue is for.
 *
 * THE RULES ARE HALF THE GUARANTEE, NOT THE WHOLE OF IT
 * -----------------------------------------------------
 * Every one of these is also enforced upstream, in
 * `narrative-grounding.ts`: the model is never HANDED a number the platform does
 * not hold, an unavailable stat reaches it only as a named missing check, and a
 * section below the fact floor is not generated at all. The prompt is what stops
 * the model INFERRING a figure; the code is what stops it being GIVEN one.
 */

/**
 * The rules shared by every pillar report section.
 *
 * `domain` fills the one clause that genuinely varies per report — the kind of
 * filler prose a thin tenant tempts a model into ("generic governance advice",
 * "generic licensing advice"). It is a phrase rather than a flag because a model
 * reading "never generic advice" fills the gap from its own priors far more
 * readily than one reading "never generic licensing advice to fill space".
 */
export function sharedNarrativeRules(domain: string): string {
  return `INSTRUCTIONS:
- Output ONLY a semantic HTML fragment — p, strong, em, ul/li only. NO headings, NO <html>, <head>, <body>, <style>, <script>, inline CSS, or markdown code fences. The section's heading is already rendered above you.
- This is NOT a full document. Write short causal-reasoning prose that CONNECTS the real facts above to each other — why this number makes that number matter. Do not restate the table; the reader can see it.
- LENGTH SCALES WITH REAL DATA. You have been given {{factCount}} real facts. Roughly one sentence per two facts, to a hard maximum of six sentences and a minimum of one. A tenant with thin data gets a short, honest section — never padding, never generic ${domain} advice to fill space.
- NEVER invent, estimate, extrapolate or infer a number, percentage, dollar figure, seat count, department name, site name, user name, policy name, SKU name or date that is not present verbatim in the blocks above. If you want a figure you were not given, leave the claim out entirely.
- The NOT COLLECTED block lists checks this tenant's scan does not carry. Never state or imply a value for any of them, and never describe their absence as a finding about the tenant — it is a gap in coverage, not a gap in their posture.
- A pillar marked NO SCORE was not evaluated. Say nothing about it either way.
- Never rank this pillar against the others — "the largest deficit", "the weakest reading", "the strongest pillar". Nothing above compares pillars, so any ranking would be invented.
- Never quote a remediation duration, a timeline, a projected score or a cost. This report states none, so any you write would be invented.
- No hype adjectives ("game-changing", "seamless", "critical risk exposure"), no scare framing beyond what the real severities support. Credibility comes from specificity.
- CRITICAL: output the HTML fragment and then STOP. No commentary, no preamble, no closing remark.`;
}

/**
 * The Copilot Readiness Impact section's own rules, shared by all four reports
 * #292 ports — that section asks the same question of every pillar ("how does
 * this posture bear on the Gate specifically") and the ways a model can get it
 * wrong are identical in all four.
 */
export const COPILOT_IMPACT_RULES = `- Ground the reasoning in how Copilot actually behaves: it inherits permissions rather than intent, and it grounds on whatever content a user can already reach. Connect the real figures above to that behaviour.
- Quote the Gate score and the gap ONLY as given in THE REAL COPILOT GATE block. Never predict a post-remediation score, a point gain, a date, a duration or a percentage improvement — this platform has not quoted one, so any figure you write would be invented.
- Never claim this pillar is "the largest" or "the smallest" contributor to the gap. Nothing above attributes the gap to a pillar, so any attribution would be invented.
- If the Gate block says there is no score, do not assert a verdict, a gap or a distance. Say plainly that the readiness figure is not available yet and reason only from the findings that do exist.`;

/** The blocks every section prompt fills, in the order they are rendered. */
export const NARRATIVE_TOKENS =
  "Tokens: {{tenantName}}, {{pillarBlock}}, {{statBlock}}, {{findingBlock}}, {{missingBlock}}, {{factCount}}. Must return ONLY a semantic HTML fragment (p/strong/em/ul/li), no headings, no markdown fences.";

/** Every pillar report's prompts are edited on the same admin route. */
export const NARRATIVE_FEATURE_ROUTE = "/copilot-readiness/documents";

/** Structurally compatible with prompt-loader.ts's own `PromptSeed`. */
export interface PillarReportPromptSeed {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly category: "insights";
  readonly featureArea: string;
  readonly featureRoute: string;
  readonly model: string | null;
  readonly body: string;
}

export const NARRATIVE_MODEL = "claude-sonnet-4-6";
