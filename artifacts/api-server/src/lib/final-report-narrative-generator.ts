/**
 * final-report-narrative-generator.ts
 *
 * Copilot Assessment epic (#183), Phase 8 / #191 — the platform's third real
 * Anthropic call site, same shape as cio-narrative-generator.ts /
 * persona-generation-engine.ts: structured data in, one attributed Anthropic
 * call (routed through withAiDevResponseCache, #185), narrative text out.
 *
 * Real audit before writing this (per #191's own ask): FinalReportScreen.tsx's
 * "6-8 Sentence Executive Narrative" block was 100% hardcoded prose citing
 * invented numbers (500 seats, $226k, 14 use cases, etc) never sourced from
 * any real state anywhere in the wizard. copilot-assessment.tsx's wizard
 * state already carries real personas (#186, wired via fetchPersonaStories)
 * and a real GovernanceState the user configures on the Security/Governance
 * screens — those are the only two genuinely real inputs already flowing
 * into the Final Report step. This module grounds the narrative in those,
 * plus:
 *
 *   - Real use-case stories: generateUseCasesForPersona() (#187) is a real,
 *     tested engine that was never wired to any route — UseCasesScreen.tsx
 *     still renders the static USE_CASE_TILES mock, unrelated to whichever
 *     personas were actually generated for this quiz-taker. Rather than
 *     reuse that mock (which would put fabricated content in a "real
 *     synthesis" prompt) or drop use cases from the narrative entirely, this
 *     module calls the real engine directly for a capped subset of personas
 *     (top 3 by feasibilityScore) to ground the narrative in genuinely
 *     generated, persona-specific use-case content. Capped to bound AI call
 *     count/latency for a single report-screen load; a call that fails or
 *     returns no valid tiles for one persona just yields fewer use cases,
 *     never a fabricated fallback.
 *
 *   - Real ROI score: roiScoringEngine.ts's calculateRoiScore() (#190) is a
 *     pure deterministic function over the quiz's own four workload values,
 *     but it lives in msp-portal (frontend-only) and was never actually
 *     wired into RoiScreen.tsx either — that screen runs its own independent
 *     hardcoded-500-seat slider simulator. Mirrored here rather than
 *     imported, matching this file's sibling call sites' existing convention
 *     of locally mirroring msp-portal contracts (api-server and msp-portal
 *     share no component mechanism other than lib/* packages — see
 *     use-case-generator.ts's identical QuizProfile mirror comment) — so the
 *     narrative can cite the real per-quiz-taker score instead of
 *     RoiScreen's simulated tenant-wide one. IMPORTANT: this score is a
 *     per-quiz-taker workload estimate — the quiz collects no seat count, so
 *     there is no real input to scale it into a tenant-wide dollar figure
 *     the way the old hardcoded narrative did ("$226k/yr").
 *
 *   - Governance/security: #183 Phases 5/6 (Governance/Security Scoring
 *     Engines) have not landed — no real weighted governance or security
 *     score exists anywhere in this codebase yet (persona-generation-
 *     engine.ts flags this identical gap in its own doc comment). This
 *     module never invents one. It passes the real GovernanceState toggle
 *     facts (CA01 / PIM / sensitivity labels / DLP posture) the user
 *     actually selected on the Security/Governance screens as configuration
 *     context, explicitly instructing the model never to present them as a
 *     scored/telemetry-derived finding.
 */

import { anthropic } from "@workspace/integrations-anthropic-ai";
import { withAiDevResponseCache } from "./ai-dev-response-cache.ts";
import { getPrompt } from "./prompt-loader.ts";
import { logger } from "./logger.ts";
import { generateUseCasesForPersona, type PersonaContext, type UseCaseTile } from "./use-case-generator.ts";

const log = logger.child({ channel: "engine.dashboard" });

// ── Wire contract mirrors (see doc comment above for why these are local) ──

export interface FinalReportQuizProfile {
  role: string;
  department: string;
  industry: string;
  collaboration: ("internal" | "cross-team" | "external")[];
  sensitivity: string[];
  workflowStyle: "structured" | "unstructured";
  outcomePriorities: string[];
  draftingLoad: number;
  researchLoad: number;
  communicationLoad: number;
  repetitiveLoad: number;
  toolUsage: string[];
  aiComfort: "low" | "medium" | "high";
}

type Severity = "High" | "Medium" | "Low";

/** Mirrors msp-portal's real PersonaStory (types.ts) — only the fields this narrative and use-case regeneration need. */
export interface FinalReportPersona {
  id: string;
  name: string;
  role: string;
  department: string;
  useCaseCluster: string;
  sensitivitySet: string[];
  collaborationPattern: string[];
  outcomePriorities: string[];
  riskScore: number;
  feasibilityScore: number;
  adoptionFriction: number;
  sensitivityExposure: { label: string; severity: Severity }[];
  collaborationFriction: { label: string; severity: Severity }[];
  valuePotential: {
    hoursSavedPerWeek: number;
    annualValuePerSeat: string;
    roiMultiplier: string;
    primaryBenefit: string;
  };
  shortStory: { summary: string; telemetryCheck: string; copilotUnlock: string };
}

/** Mirrors msp-portal's real GovernanceState (types.ts) — a user-configured toggle snapshot, never a score. */
export interface FinalReportGovernance {
  ca01: boolean;
  pim: boolean;
  sensitivityLabels: boolean;
  dlp: "off" | "moderate" | "strict";
}

export interface FinalReportAttribution {
  mspId: number | null;
  customerId: number | null;
  triggerSource: string;
}

export interface RoiScoreResult {
  score: number;
  timeSavedHoursPerWeek: number;
  costSavedPerYear: number;
  efficiencyGainPct: number;
}

export interface GenerateFinalReportParams {
  quizProfile: FinalReportQuizProfile;
  personas: FinalReportPersona[];
  governance: FinalReportGovernance;
  attribution: FinalReportAttribution;
}

export interface FinalReportResult {
  narrativeHtml: string;
  roiScore: RoiScoreResult;
  useCasesConsidered: number;
}

// ── ROI scoring mirror (roiScoringEngine.ts, #190) ──────────────────────────
// Pure function, no AI/DB — duplicated rather than imported per this file's
// own cross-app-boundary convention above. Kept byte-for-byte equivalent to
// the real #190 formula (including the dead licenseWasteReduction weight,
// still flagged unresolved there) so this narrative's score matches what
// #190's engine would actually produce for the same quiz answers.
const ROI_SCORE_WEIGHTS = {
  draftingLoad: 0.3,
  researchLoad: 0.25,
  communicationLoad: 0.2,
  repetitiveLoad: 0.15,
  licenseWasteReduction: 0.1,
} as const;

const ROI_SCORE_ASSUMPTIONS = {
  maxWeeklyHoursSavedAtScore100: 15,
  blendedHourlyRateUsd: 65,
  weeksPerYear: 52,
} as const;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function calculateRoiScore(quizProfile: FinalReportQuizProfile): RoiScoreResult {
  const weightedLoad =
    clamp01(quizProfile.draftingLoad) * ROI_SCORE_WEIGHTS.draftingLoad +
    clamp01(quizProfile.researchLoad) * ROI_SCORE_WEIGHTS.researchLoad +
    clamp01(quizProfile.communicationLoad) * ROI_SCORE_WEIGHTS.communicationLoad +
    clamp01(quizProfile.repetitiveLoad) * ROI_SCORE_WEIGHTS.repetitiveLoad;
  // licenseWasteReduction has no real source in QuizProfile (same unresolved
  // gap #190 flagged) — always 0 here, matching roiScoringEngine.ts's default.

  const score = Math.round(weightedLoad * 100);
  const timeSavedHoursPerWeek =
    Math.round((score / 100) * ROI_SCORE_ASSUMPTIONS.maxWeeklyHoursSavedAtScore100 * 10) / 10;
  const costSavedPerYear = Math.round(
    timeSavedHoursPerWeek * ROI_SCORE_ASSUMPTIONS.weeksPerYear * ROI_SCORE_ASSUMPTIONS.blendedHourlyRateUsd,
  );

  return { score, timeSavedHoursPerWeek, costSavedPerYear, efficiencyGainPct: score };
}

// ── Prompt blocks ────────────────────────────────────────────────────────────

function formatSeverityList(items: { label: string; severity: Severity }[]): string {
  return items.length > 0 ? items.map((i) => `${i.label} (${i.severity})`).join(", ") : "none specified";
}

function personasToBlock(personas: FinalReportPersona[]): string {
  return personas
    .map(
      (p) =>
        `- ${p.name} (${p.role}, ${p.department}) — use-case cluster "${p.useCaseCluster}"; risk ${p.riskScore}/100, feasibility ${p.feasibilityScore}/100, adoption friction ${p.adoptionFriction}/100; sensitivity exposure: ${formatSeverityList(p.sensitivityExposure)}; value potential: ${p.valuePotential.hoursSavedPerWeek} hrs/week, ${p.valuePotential.annualValuePerSeat}, primary benefit: ${p.valuePotential.primaryBenefit}. ${p.shortStory.summary}`,
    )
    .join("\n");
}

function useCasesToBlock(tiles: { persona: FinalReportPersona; tile: UseCaseTile }[]): string {
  if (tiles.length === 0) {
    return "No use cases were successfully generated for this run — do not describe any specific use case in the narrative.";
  }
  return tiles
    .map(
      ({ persona, tile }) =>
        `- "${tile.name}" (${tile.category}) for ${persona.name} — feasibility ${tile.feasibilityScore}/100, expected ROI ${tile.expectedRoi}${
          tile.blocked ? `, BLOCKED by: ${tile.blockers.join("; ")}` : ", unblocked"
        }. ${tile.summary}`,
    )
    .join("\n");
}

function governanceToBlock(governance: FinalReportGovernance): string {
  return [
    `Entra ID CA01 Conditional Access: ${governance.ca01 ? "enabled" : "not enabled"}`,
    `Privileged Identity Management (PIM) just-in-time admin access: ${governance.pim ? "enabled" : "not enabled"}`,
    `Microsoft Purview sensitivity auto-labeling: ${governance.sensitivityLabels ? "enabled" : "not enabled"}`,
    `Data Loss Prevention (DLP) posture: ${governance.dlp}`,
  ].join("\n");
}

function roiToBlock(roiScore: RoiScoreResult): string {
  return `Score: ${roiScore.score}/100 (deterministic, from this quiz-taker's own drafting/research/communication/repetitive workload answers). Estimated time saved: ${roiScore.timeSavedHoursPerWeek} hrs/week for this quiz-taker, worth roughly $${roiScore.costSavedPerYear.toLocaleString()}/year in reclaimed time at a blended hourly rate. This is a PER-USER estimate, not a tenant-wide total — no seat count was collected, so never multiply this by an invented headcount.`;
}

const FINAL_REPORT_PROMPT_FALLBACK = `You are Shane McCaw, a senior Microsoft 365 Architect with 30 years of experience, delivering the executive summary of a completed Copilot Assessment directly to this prospect's leadership — in your own voice, not a templated report.

QUIZ-TAKER'S ORGANIZATION PROFILE:
- Role: {{role}} / Department: {{department}} / Industry: {{industry}}
- Collaboration pattern(s): {{collaboration}}
- Data sensitivity in scope: {{sensitivity}}
- Outcome priorities: {{outcomePriorities}}

REAL GENERATED PERSONAS this assessment surfaced for this organization ({{personaCount}} total):
{{personasBlock}}

REAL GENERATED USE CASES, grounded in the personas above ({{useCaseCount}} total):
{{useCasesBlock}}

REAL GOVERNANCE CONFIGURATION selected during this assessment — a configuration snapshot only, NOT a scored or telemetry-derived finding (no live tenant scan has run yet):
{{governanceBlock}}

REAL ROI SCORE — deterministic, computed from this quiz-taker's own workload answers:
{{roiBlock}}

INSTRUCTIONS:
- Output ONLY a semantic HTML fragment — h3/h4 headings, p, strong, em, ul/li only. NO <html>, <head>, <body>, <style>, <script>, inline CSS, or markdown code fences. This must be ready to inject directly into an already-styled page.
- Write 6-8 sentences total, Microsoft-native tone: short, high-impact sentences, no hype adjectives ("game-changing", "revolutionary", "seamless", "cutting-edge"), credibility from specificity — cite the real names/numbers above, never invented ones.
- Cover, in order: (1) what this assessment evaluated, (2) the strongest real opportunity from the personas/use cases above, (3) the real governance configuration and what it means for rollout readiness, (4) the real ROI score and what it implies, (5) a recommended deployment path, (6) a recommended next step.
- Never state or imply a security or governance SCORE of any kind — no telemetry-based governance or security scoring exists yet for this assessment. Describe the real configuration values above as facts only, never as a weighted score or letter grade.
- Never invent a dollar figure, seat count, or percentage that is not directly present in the blocks above. Never scale the ROI score's per-user figures into a tenant-wide total.
- If REAL GENERATED USE CASES says none were generated, do not describe any specific use case — speak to the personas and their opportunity in general terms instead.
- CRITICAL: output the HTML fragment and then STOP. No commentary before or after.`;

/** Mirrors sanitizeNarrativeHtml/stripFence in cio-narrative-generator.ts — same defense-in-depth, this HTML is injected directly into the wizard. */
function sanitizeNarrativeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<(iframe|object|embed|link|meta)[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "");
}

function stripFence(text: string): string {
  return text.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

const USE_CASE_PERSONA_CAP = 3;

/**
 * Generate the Final Report's 6-8 sentence executive narrative, grounded in
 * real personas (#186), real freshly-generated use cases for a capped
 * top-feasibility subset of those personas (#187), the real user-configured
 * GovernanceState, and a real deterministic ROI score mirrored from #190.
 *
 * Throws if no personas are provided — the caller (route) should surface
 * that as a real error state, never silently substitute fabricated content.
 */
export async function generateFinalReportNarrative(
  params: GenerateFinalReportParams,
): Promise<FinalReportResult> {
  const { quizProfile, personas, governance, attribution } = params;

  if (personas.length === 0) {
    throw new Error("final-report-narrative-generator: at least one persona is required");
  }

  const roiScore = calculateRoiScore(quizProfile);

  const useCasePersonas = [...personas]
    .sort((a, b) => b.feasibilityScore - a.feasibilityScore)
    .slice(0, USE_CASE_PERSONA_CAP);

  const useCaseResults = await Promise.all(
    useCasePersonas.map(async (persona) => {
      const personaContext: PersonaContext = {
        id: persona.id,
        name: persona.name,
        role: persona.role,
        department: persona.department,
        useCaseCluster: persona.useCaseCluster,
        sensitivitySet: persona.sensitivitySet,
        collaborationPattern: persona.collaborationPattern,
        outcomePriorities: persona.outcomePriorities,
        riskScore: persona.riskScore,
        feasibilityScore: persona.feasibilityScore,
        adoptionFriction: persona.adoptionFriction,
        sensitivityExposure: persona.sensitivityExposure,
        collaborationFriction: persona.collaborationFriction,
        valuePotential: persona.valuePotential,
        shortStorySummary: persona.shortStory.summary,
      };
      try {
        const tiles = await generateUseCasesForPersona(quizProfile, personaContext, attribution);
        return tiles.map((tile) => ({ persona, tile }));
      } catch (err) {
        log.warn({ err, personaId: persona.id }, "final-report-narrative-generator: use-case generation failed for persona, continuing without it");
        return [];
      }
    }),
  );
  const useCaseTiles = useCaseResults.flat();

  const rawTemplate = await getPrompt("assessment-final-report-narrative", FINAL_REPORT_PROMPT_FALLBACK);
  const prompt = rawTemplate
    .replace(/\{\{role\}\}/g, quizProfile.role)
    .replace(/\{\{department\}\}/g, quizProfile.department)
    .replace(/\{\{industry\}\}/g, quizProfile.industry)
    .replace(/\{\{collaboration\}\}/g, quizProfile.collaboration.join(", ") || "none specified")
    .replace(/\{\{sensitivity\}\}/g, quizProfile.sensitivity.join(", ") || "none specified")
    .replace(/\{\{outcomePriorities\}\}/g, quizProfile.outcomePriorities.join(", ") || "none specified")
    .replace(/\{\{personaCount\}\}/g, String(personas.length))
    .replace(/\{\{personasBlock\}\}/g, personasToBlock(personas))
    .replace(/\{\{useCaseCount\}\}/g, String(useCaseTiles.length))
    .replace(/\{\{useCasesBlock\}\}/g, useCasesToBlock(useCaseTiles))
    .replace(/\{\{governanceBlock\}\}/g, governanceToBlock(governance))
    .replace(/\{\{roiBlock\}\}/g, roiToBlock(roiScore));

  const aiResponse = await withAiDevResponseCache(
    {
      feature: "final_report_narrative",
      requestContext: { quizProfile, personas, governance },
    },
    {
      mspId: attribution.mspId,
      costOwner: "msp",
      nodeType: "final_report_narrative",
      feature: "final_report_narrative",
      customerId: attribution.customerId,
      triggerSource: attribution.triggerSource,
    },
    () =>
      anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
  );

  if (aiResponse.stop_reason === "max_tokens") {
    log.warn({ customerId: attribution.customerId }, "final-report-narrative-generator: output hit max_tokens — narrative may be truncated");
  }

  const block = aiResponse.content.find((b) => b.type === "text");
  const rawText = block && block.type === "text" ? block.text : "";
  const narrativeHtml = sanitizeNarrativeHtml(stripFence(rawText));

  if (!narrativeHtml) {
    throw new Error("final-report-narrative-generator: model returned an empty narrative");
  }

  log.info(
    { customerId: attribution.customerId, personaCount: personas.length, useCaseCount: useCaseTiles.length },
    "final-report-narrative-generator: narrative generated",
  );

  return { narrativeHtml, roiScore, useCasesConsidered: useCaseTiles.length };
}
