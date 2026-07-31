/**
 * remediation-detail-generator.ts
 *
 * Copilot Assessment epic (#183), Phase 11 — #195, sub-issue of #183. Fourth
 * of the platform's real Anthropic call sites, modeled directly on
 * cio-narrative-generator.ts's pattern (structured data in, one attributed
 * call, validated structured data out) and routed through
 * withAiDevResponseCache() (#185), same as persona-generation-engine.ts
 * (#186) and use-case-generator.ts (#187).
 *
 * Generates real "what this means" detail text + a 2-4 step remediation
 * checklist for ONE finding at a time (the exact label/category/severity a
 * user clicked in UseCaseIssueModal.tsx). Per #195's own correction comment,
 * this is real value delivered to PAID Assessment customers, not a separate
 * "Copilot Remediation" product — see #195 comment thread.
 *
 * REAL-DATA AUDIT (per #195's explicit ask, done before writing this file):
 * the ONLY real inputs available at the point this call fires are the
 * finding itself (label/category/severity, exactly what UseCaseIssueModal
 * already received before this phase) plus, when the caller is
 * PersonasScreen, the real QuizProfile (#184) and the real AI-generated
 * PersonaStory (#186) that finding came from. Two things this file
 * deliberately does NOT pretend to have:
 *   1. No real per-tenant telemetry exists yet for Copilot Assessment —
 *      Governance/Security Scoring (#183 Phases 5/6) are unbuilt, and #186's
 *      own persona output is itself explicit archetypal pattern text, not a
 *      confirmed live tenant scan (see persona-generation-engine.ts's
 *      HONESTY RULE). The prompt below never asks the model to claim it
 *      scanned anything real.
 *   2. UseCasesScreen.tsx still renders entirely from its own local
 *      EXTENDED_USE_CASES mock array (confirmed by direct read — it never
 *      consumes its own `useCases` prop), so an issue clicked from that
 *      screen carries no real grounding beyond label/category/severity.
 *      This module accepts an OPTIONAL context bag precisely so callers with
 *      real grounding (PersonasScreen) can supply it while callers without
 *      any (UseCasesScreen, until it's wired to real generated tiles) can
 *      omit it rather than fabricate a persona/company profile that isn't
 *      real. See PersonasScreen.tsx / UseCasesScreen.tsx for what each
 *      passes.
 *
 * PowerShell/Graph commands in the output are copy-paste guidance text only
 * — no live execution, per #195's explicit scope boundary (#180 is the
 * separate native execution epic).
 */

import { z } from "zod";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { withAiDevResponseCache } from "./ai-dev-response-cache";
import { getPrompt } from "./prompt-loader";
import { logger } from "./logger";

const log = logger.child({ channel: "engine.dashboard" });

// ── Input shapes ────────────────────────────────────────────────────────────

export type IssueCategory = "blocker" | "sensitivity" | "friction";
export type IssueSeverity = "High" | "Medium" | "Low";

export interface RemediationIssueInput {
  label: string;
  category: IssueCategory;
  severity: IssueSeverity;
}

/**
 * Optional real grounding context. Every field is optional because not
 * every caller has real data to supply (see the audit note above) — the
 * prompt is written to degrade gracefully to generic-but-real guidance for
 * the finding alone when this is entirely omitted.
 */
export interface RemediationContextInput {
  role?: string;
  department?: string;
  industry?: string;
  personaName?: string;
  personaRole?: string;
  useCaseCluster?: string;
  collaborationPattern?: string[];
  sensitivitySet?: string[];
}

export interface RemediationGenerationAttribution {
  mspId: number | null;
  customerId: number | null;
  triggerSource: string;
}

// ── Output shape ────────────────────────────────────────────────────────────

const RemediationStepSchema = z.object({
  text: z.string().min(1).max(400),
  code: z.string().min(1).max(1000).optional(),
});

const RemediationResultSchema = z.object({
  detail: z.string().min(1).max(800),
  steps: z.array(RemediationStepSchema).min(1).max(4),
});

export interface RemediationStep {
  text: string;
  code?: string;
}

export interface RemediationDetailResult {
  detail: string;
  steps: RemediationStep[];
}

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1200;

const REMEDIATION_PROMPT_FALLBACK = `You are a Microsoft 365 / Copilot governance consultant writing real, actionable quick-fix guidance for a PAYING assessment customer. They clicked on one specific finding from their Copilot readiness assessment and expect a genuinely useful explanation and fix — not a generic disclaimer, not a sales pitch.

FINDING CLICKED:
- Label: {{label}}
- Category: {{category}} (blocker = governance/security blocker, sensitivity = data sensitivity exposure, friction = collaboration friction)
- Severity: {{severity}}

ORGANIZATION CONTEXT (may be partial or entirely absent — use only what is given, never invent specifics beyond it):
{{contextBlock}}

HONESTY RULE: You do not have access to this tenant's live scan data, object names, exact counts, or timestamps. Do not claim to have detected a specific real object, count, date, or user. Write general, expert, actionable guidance for a finding of this exact label/category/severity, informed by whatever organization context is given above — not a fabricated tenant-specific incident report.

Return ONLY a JSON object, no markdown fences, no preamble, no trailing commentary, matching this EXACT shape:
{
  "detail": "2-4 sentence plain-English explanation of what this finding means and why it matters, written directly to the customer",
  "steps": [
    { "text": "short imperative remediation step" },
    { "text": "short imperative remediation step, e.g. verify current exposure before changing anything", "code": "a real, generic PowerShell/Microsoft Graph command a Microsoft 365 admin could copy-paste to check or fix this — use angle-bracket placeholders like <SiteUrl> for anything tenant-specific, never a fabricated real value" }
  ]
}

Generate 2-4 steps total. Only include "code" on a step when a real PowerShell/Graph command is genuinely useful for verifying or applying that step — do not force code onto every step.`;

/** Mirrors extractJson() in use-case-generator.ts / omg-card-generator-v2.ts — Claude sometimes wraps JSON in prose/fences; never use a ^-anchored regex. */
function extractJson(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();

  const objStart = text.indexOf("{");
  if (objStart === -1) return text.trim();
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = objStart; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return text.slice(objStart, i + 1); }
  }
  return text.slice(objStart).trim();
}

function formatContextBlock(context: RemediationContextInput | undefined): string {
  if (!context) return "None supplied — write generic expert guidance for this finding label/category/severity alone.";
  const lines: string[] = [];
  if (context.role) lines.push(`- Quiz-taker role: ${context.role}`);
  if (context.department) lines.push(`- Department: ${context.department}`);
  if (context.industry) lines.push(`- Industry: ${context.industry}`);
  if (context.personaName) lines.push(`- Persona this finding belongs to: ${context.personaName}${context.personaRole ? ` (${context.personaRole})` : ""}`);
  if (context.useCaseCluster) lines.push(`- Persona's primary Copilot use-case cluster: ${context.useCaseCluster}`);
  if (context.collaborationPattern?.length) lines.push(`- Collaboration surfaces: ${context.collaborationPattern.join(", ")}`);
  if (context.sensitivitySet?.length) lines.push(`- Sensitivity categories in scope: ${context.sensitivitySet.join(", ")}`);
  return lines.length > 0 ? lines.join("\n") : "None supplied — write generic expert guidance for this finding label/category/severity alone.";
}

/**
 * Generate real remediation detail + steps for one finding. Routed through
 * withAiDevResponseCache so repeated identical (issue, context) pairs never
 * re-hit the real Anthropic API while iterating in dev.
 */
export async function generateRemediationDetail(
  issue: RemediationIssueInput,
  context: RemediationContextInput | undefined,
  attribution: RemediationGenerationAttribution,
): Promise<RemediationDetailResult> {
  const rawTemplate = await getPrompt("assessment-remediation-detail-generation", REMEDIATION_PROMPT_FALLBACK);
  const prompt = rawTemplate
    .replace(/\{\{label\}\}/g, issue.label)
    .replace(/\{\{category\}\}/g, issue.category)
    .replace(/\{\{severity\}\}/g, issue.severity)
    .replace(/\{\{contextBlock\}\}/g, formatContextBlock(context));

  const aiResponse = await withAiDevResponseCache(
    {
      feature: "remediation_detail_generation",
      requestContext: { issue, context: context ?? null },
    },
    {
      mspId: attribution.mspId,
      costOwner: "msp",
      nodeType: "remediation_detail_generation",
      feature: "remediation_detail_generation",
      customerId: attribution.customerId,
      triggerSource: attribution.triggerSource,
    },
    () =>
      anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: "user", content: prompt }],
      }),
  );

  if (aiResponse.stop_reason === "max_tokens") {
    log.warn({ label: issue.label }, "remediation-detail-generator: output hit max_tokens — response may be truncated");
  }

  const textBlock = aiResponse.content.find((b) => b.type === "text");
  const rawText = textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";

  const parsed: unknown = JSON.parse(extractJson(rawText));
  const result = RemediationResultSchema.parse(parsed);

  log.info({ label: issue.label, stepCount: result.steps.length }, "remediation-detail-generator: remediation detail generated");
  return result;
}
