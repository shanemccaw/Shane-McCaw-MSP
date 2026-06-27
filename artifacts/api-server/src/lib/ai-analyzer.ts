/**
 * ai-analyzer.ts
 *
 * Internal AI Analyzer service for the M365 Command Center.
 * Accepts script output + instructions and returns structured findings,
 * recommendations, score impacts, and M365 profile update suggestions.
 */

import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "./logger";

export interface AiAnalyzerInput {
  scriptOutput: string;
  aiInstructions: string;
  packageContext: string;
}

export interface AiAnalyzerResult {
  findings: string[];
  recommendations: string[];
  scoreImpact: Record<string, number>;
  profileUpdates: Record<string, unknown>;
}

const SCORE_KEYS = ["identity", "security", "collaboration", "compliance", "copilotReadiness"] as const;

function buildPrompt(input: AiAnalyzerInput): string {
  return `You are a Microsoft 365 security and governance expert analyzing PowerShell runbook output for a consulting client.

Package Context: ${input.packageContext || "General M365 analysis"}

Script-specific Instructions: ${input.aiInstructions || "Analyze the output for security, governance, and compliance findings."}

=== SCRIPT OUTPUT ===
${input.scriptOutput.slice(0, 8000)}
=== END OUTPUT ===

Analyze the script output and return a JSON object with exactly these fields:
{
  "findings": ["specific finding from the output — reference actual values, users, policies, or errors"],
  "recommendations": ["actionable recommendation based on what was found"],
  "scoreImpact": {
    "identity": <integer -20 to +20, 0 if not applicable>,
    "security": <integer -20 to +20, 0 if not applicable>,
    "collaboration": <integer -20 to +20, 0 if not applicable>,
    "compliance": <integer -20 to +20, 0 if not applicable>,
    "copilotReadiness": <integer -20 to +20, 0 if not applicable>
  },
  "profileUpdates": {
    "<profileFieldName>": <value — only include fields you can directly infer from the output>
  }
}

Rules:
- findings: 2–6 specific, evidence-backed observations from the output
- recommendations: 2–5 actionable next steps for the M365 administrator
- scoreImpact: use positive values for good findings, negative for risks; 0 for unrelated categories
- profileUpdates: JSONB key/value pairs to merge into the client's M365 profile (e.g. mfaEnabled, conditionalAccessPoliciesCount, guestUserCount); omit if nothing can be inferred
- Return ONLY the JSON object — no markdown fences, no preamble, no trailing text`;
}

export async function runAiAnalyzer(input: AiAnalyzerInput): Promise<AiAnalyzerResult> {
  const prompt = buildPrompt(input);

  let raw: string;
  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = message.content.find(b => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text response from AI model");
    }
    raw = textBlock.text.trim();
  } catch (err) {
    logger.error({ err }, "ai-analyzer: Claude call failed");
    throw err;
  }

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    logger.warn({ raw: raw.slice(0, 300) }, "ai-analyzer: response did not contain parseable JSON");
    return {
      findings: ["AI analysis could not parse structured findings from this output."],
      recommendations: ["Review the raw script output manually for insights."],
      scoreImpact: {},
      profileUpdates: {},
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
  } catch {
    logger.warn({ raw: raw.slice(0, 300) }, "ai-analyzer: JSON.parse failed");
    return {
      findings: ["AI analysis returned malformed JSON."],
      recommendations: ["Review the raw script output manually."],
      scoreImpact: {},
      profileUpdates: {},
    };
  }

  const findings = Array.isArray(parsed.findings)
    ? (parsed.findings as unknown[]).filter((f): f is string => typeof f === "string")
    : [];

  const recommendations = Array.isArray(parsed.recommendations)
    ? (parsed.recommendations as unknown[]).filter((r): r is string => typeof r === "string")
    : [];

  const rawScoreImpact = (parsed.scoreImpact && typeof parsed.scoreImpact === "object")
    ? parsed.scoreImpact as Record<string, unknown>
    : {};

  const scoreImpact: Record<string, number> = {};
  for (const key of SCORE_KEYS) {
    const val = rawScoreImpact[key];
    if (typeof val === "number" && isFinite(val)) {
      scoreImpact[key] = Math.max(-20, Math.min(20, Math.round(val)));
    }
  }

  const profileUpdates = (parsed.profileUpdates && typeof parsed.profileUpdates === "object" && !Array.isArray(parsed.profileUpdates))
    ? parsed.profileUpdates as Record<string, unknown>
    : {};

  return { findings, recommendations, scoreImpact, profileUpdates };
}
