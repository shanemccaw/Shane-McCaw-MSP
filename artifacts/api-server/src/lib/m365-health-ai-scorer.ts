/**
 * m365-health-ai-scorer.ts
 *
 * Accepts the output of the most recent completed script run for a client and
 * calls the AI to derive category-level health scores (0–100).  Used by the
 * update_intelligence_tables workflow node.
 */

import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "./logger";

export const HEALTH_SCORE_CATEGORIES = [
  "identity",
  "security",
  "collaboration",
  "compliance",
  "copilotReadiness",
] as const;

export type HealthScoreCategory = (typeof HEALTH_SCORE_CATEGORIES)[number];
export type M365HealthScores = Record<HealthScoreCategory, number>;

export interface ScorerInput {
  scriptRunId: number;
  rawOutput: Record<string, unknown>;
  parsedFindings: string[];
  recommendations: string[];
  /** Prior score deltas from the AI script analyzer — used as calibration context. */
  scoreImpact: Record<string, number>;
}

/**
 * Robust JSON extractor — handles Claude preamble prose and markdown fences.
 * Per the ai-json-extraction memory note: never use a ^-anchored regex.
 */
function extractJson(text: string): string {
  // 1. Prefer a fenced ```json ... ``` or ``` ... ``` block anywhere in the text
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  // 2. Walk from first { or [ to its matching closer
  const start = text.search(/[{[]/);
  if (start === -1) return text;
  const open = text[start] as "{" | "[";
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close && --depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

const DEFAULT_SCORE = 60; // neutral / insufficient data

const PROMPT_TEMPLATE = `You are a Microsoft 365 security and governance expert. Based on the following script run findings for a client tenant, assign health scores (0–100) for each category.

=== SCRIPT FINDINGS ===
{{findings}}

=== RAW OUTPUT EXCERPT ===
{{rawOutput}}

=== PRIOR SCORE SIGNALS (from AI script analysis, deltas -20 to +20) ===
{{priorSignals}}

Return ONLY a JSON object with exactly these five keys and integer values 0–100:
{
  "identity": <0-100>,
  "security": <0-100>,
  "collaboration": <0-100>,
  "compliance": <0-100>,
  "copilotReadiness": <0-100>
}

Scoring guide:
- 80–100: excellent, no significant issues found in this area
- 60–79: good, only minor issues detected
- 40–59: moderate risk or configuration gaps
- 0–39: significant problems identified
- If the script did not produce evidence about a category, default to ${DEFAULT_SCORE}
- Use prior score signals to calibrate: a +10 in "security" from the script analyzer suggests the security posture is above average
- No markdown fences, no preamble, no trailing text`;

export async function scoreHealthFromScriptRun(input: ScorerInput): Promise<M365HealthScores> {
  const findingLines = [
    ...input.parsedFindings.slice(0, 10),
    ...input.recommendations.slice(0, 5),
  ].join("\n");

  const priorLines = Object.entries(input.scoreImpact)
    .filter(([, v]) => v !== 0)
    .map(([k, v]) => `  ${k}: ${v > 0 ? "+" : ""}${v}`)
    .join("\n");

  const prompt = PROMPT_TEMPLATE
    .replace("{{findings}}", findingLines || "(no structured findings available)")
    .replace("{{rawOutput}}", JSON.stringify(input.rawOutput).slice(0, 4000))
    .replace("{{priorSignals}}", priorLines || "(none)");

  let raw: string;
  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 256,
      messages: [{ role: "user", content: prompt }],
    });
    const block = message.content.find(b => b.type === "text");
    if (!block || block.type !== "text") throw new Error("No text block in AI response");
    raw = block.text.trim();
  } catch (err) {
    logger.error({ err, scriptRunId: input.scriptRunId }, "m365-health-ai-scorer: Claude call failed");
    throw err;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(extractJson(raw)) as Record<string, unknown>;
  } catch {
    logger.warn(
      { raw: raw.slice(0, 300), scriptRunId: input.scriptRunId },
      "m365-health-ai-scorer: JSON parse failed — returning neutral defaults",
    );
    return buildDefaults();
  }

  const scores = buildDefaults();
  for (const cat of HEALTH_SCORE_CATEGORIES) {
    const val = parsed[cat];
    if (typeof val === "number" && isFinite(val)) {
      scores[cat] = Math.max(0, Math.min(100, Math.round(val)));
    }
  }

  logger.info({ scriptRunId: input.scriptRunId, scores }, "m365-health-ai-scorer: scores derived");
  return scores;
}

function buildDefaults(): M365HealthScores {
  return {
    identity: DEFAULT_SCORE,
    security: DEFAULT_SCORE,
    collaboration: DEFAULT_SCORE,
    compliance: DEFAULT_SCORE,
    copilotReadiness: DEFAULT_SCORE,
  };
}
