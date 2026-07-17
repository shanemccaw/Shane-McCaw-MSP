/**
 * ai-analyzer.ts
 *
 * Internal AI Analyzer service for the M365 Command Center.
 * Accepts script output + instructions and returns structured findings,
 * recommendations, score impacts, and M365 profile update suggestions.
 */

import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "./logger";
import { getPrompt } from "./prompt-loader";
import { db, mspUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { recordAiUsage, computeTokenCostCents } from "./ai-billing";

export interface AiAnalyzerInput {
  scriptOutput: string;
  aiInstructions: string;
  packageContext: string;
  mspId?: number;
  customerId?: number;
}

export interface AiAnalyzerResult {
  findings: string[];
  recommendations: string[];
  scoreImpact: Record<string, number>;
  profileUpdates: Record<string, unknown>;
}

export interface TrackAiUsageOpts {
  inputTokens: number;
  outputTokens: number;
  model: string;
  mspId?: number;
  customerId?: number;
}

export function trackAiUsage(opts: TrackAiUsageOpts): void {
  Promise.resolve().then(async () => {
    try {
      const costCents = computeTokenCostCents({
        promptTokens: opts.inputTokens,
        completionTokens: opts.outputTokens,
        model: opts.model,
      });
      const costUsd = costCents / 100;

      logger.info({
        event: "system_action:ai_usage",
        model: opts.model,
        inputTokens: opts.inputTokens,
        outputTokens: opts.outputTokens,
        estimatedCostUsd: costUsd,
        mspId: opts.mspId || null,
        customerId: opts.customerId || null,
      }, `AI usage tracked: ${opts.model} - Cost: $${costUsd.toFixed(4)}`);

      await recordAiUsage({
        mspId: opts.mspId || null,
        nodeType: "ai_analyzer",
        feature: opts.customerId ? `m365_ai_analyzer:customer:${opts.customerId}` : "m365_ai_analyzer",
        promptTokens: opts.inputTokens,
        completionTokens: opts.outputTokens,
        costCents,
        costOwner: "msp",
        model: opts.model,
      });
    } catch (err) {
      logger.error({ err }, "trackAiUsage background task failed to record telemetry");
    }
  }).catch((err) => {
    logger.error({ err }, "trackAiUsage promise error");
  });
}

const SCORE_KEYS = ["identity", "security", "collaboration", "compliance", "copilotReadiness"] as const;

const ANALYZER_TEMPLATE_DEFAULT = `You are a Microsoft 365 security and governance expert analyzing PowerShell runbook output for a consulting client.

Package Context: {{packageContext}}

Script-specific Instructions: {{aiInstructions}}

=== SCRIPT OUTPUT ===
{{scriptOutput}}
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
    "<exactFieldName>": <value>
  }
}

Rules:
- findings: 2–6 specific, evidence-backed observations from the output
- recommendations: 2–5 actionable next steps for the M365 administrator
- scoreImpact: use positive values for good findings, negative for risks; 0 for unrelated categories
- profileUpdates: Only include fields where you have direct evidence. Use EXACTLY these field names and types:
    tenantDomain (string, e.g. "contoso.onmicrosoft.com")
    activeUserPercent (number 0–100)
    securityGroupCount (number)
    licensedUserCount (number)
    sharepointSiteCount (number)
    teamCount (number)
    guestUserCount (number)
    conditionalAccessPoliciesCount (number)
    usesExchange (boolean)
    usesTeams (boolean)
    usesSharePoint (boolean)
    usesOneDrive (boolean)
    usesYammer (boolean)
    mfaEnforced (boolean)
    conditionalAccessEnabled (boolean)
    intuneEnabled (boolean)
    hasAADP1orP2 (boolean)
    hasDefender (boolean)
    hasDLP (boolean)
    usesComplianceCenter (boolean)
    sensitivityLabelsConfigured (boolean)
    hasRetentionPolicies (boolean)
    hasInsiderRisk (boolean)
    externalSharingEnabled (boolean)
    guestUsersPresent (boolean)
    isHybrid (boolean)
    hasOnPremExchange (boolean)
    usesAADConnect (boolean)
    isMicrosoftPartner (boolean)
    allUsersLicensed (boolean)
    hasCopilotLicenses (boolean)
    copilotLicenseCount (string containing the number, e.g. "25")
    licenseSKUs (string[] — use friendly names inferred from context, e.g. "Office 365 E3" for ENTERPRISEPACK, "M365 E5" for SPE_E5, "M365 Business Premium" for SPB; unknown identifiers pass through verbatim)
    authMethods (string[] — one or more of: "password", "mfa", "sso_saml", "entra_id", "conditional_access")
  Do NOT invent other field names. Do NOT return authMethod (singular) — always use authMethods (plural array).
- Return ONLY the JSON object — no markdown fences, no preamble, no trailing text`;

export async function runAiAnalyzer(input: AiAnalyzerInput): Promise<AiAnalyzerResult> {
  const template = await getPrompt("m365-ai-analyzer", ANALYZER_TEMPLATE_DEFAULT);
  const prompt = template
    .replace("{{packageContext}}", input.packageContext || "General M365 analysis")
    .replace("{{aiInstructions}}", input.aiInstructions || "Analyze the output for security, governance, and compliance findings.")
    .replace("{{scriptOutput}}", input.scriptOutput.slice(0, 8000));

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

    const inputTokens = message.usage?.input_tokens ?? 0;
    const outputTokens = message.usage?.output_tokens ?? 0;
    const modelName = message.model || "claude-haiku-4-5";

    let resolvedMspId = input.mspId;
    if (!resolvedMspId && input.customerId) {
      try {
        const [mspUser] = await db
          .select({ mspId: mspUsersTable.mspId })
          .from(mspUsersTable)
          .where(eq(mspUsersTable.userId, input.customerId))
          .limit(1);
        if (mspUser) {
          resolvedMspId = mspUser.mspId ?? undefined;
        }
      } catch (err) {
        logger.warn({ err, customerId: input.customerId }, "runAiAnalyzer: failed to resolve mspId from customerId (non-fatal)");
      }
    }

    trackAiUsage({
      inputTokens,
      outputTokens,
      model: modelName,
      mspId: resolvedMspId,
      customerId: input.customerId,
    });
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
