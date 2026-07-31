/**
 * use-case-generator.ts
 *
 * Copilot Assessment epic (#183), Phase 4 — #187, sub-issue of #183. Third of
 * the platform's real Anthropic call sites to land (Persona Generation #186,
 * Use Case Generation — this file), modeled directly on
 * cio-narrative-generator.ts's existing pattern: structured data in, one
 * attributed Anthropic call, validated structured data out. Routed through
 * withAiDevResponseCache() (#185) rather than a bare withAiAttribution call,
 * per #183's hard requirement that all three call sites exist behind the dev
 * response cache from day one.
 *
 * Generates 3-5 UseCaseTile objects for ONE persona at a time, grounded in
 * that persona plus the quiz-taker's real QuizProfile (#184's frozen shape).
 * Mapping logic per Shane's blueprint (confirmed in #183/#187):
 *   - high draftingLoad     -> drafting/content use cases
 *   - high researchLoad     -> research/synthesis use cases
 *   - high communicationLoad -> communication use cases
 *   - high repetitiveLoad   -> automation use cases
 *   - sensitivity set       -> governance constraints (blockers)
 *   - collaboration pattern -> external/internal constraints (blockers)
 *
 * Concurrency note: #186 (Persona Generation Engine) was landing concurrently
 * in a separate session on this SAME shared working tree while this phase was
 * built. Its `persona-generation-engine.ts` / `PersonaStoryResult` had not
 * been committed yet (still mid-session, #186 issue open) when this file was
 * written, so `PersonaContext` below is a deliberate LOCAL mirror of that
 * real shape (audited directly from the concurrent session's in-progress
 * `persona-generation-engine.ts` and `types.ts`, not a stale placeholder) —
 * duplicated rather than imported so this phase stays independently buildable
 * and never breaks if #186's session is abandoned, fails, or its shape shifts
 * again before it actually lands. Same convention #186 itself already
 * established for QuizProfile (a local mirror of msp-portal's contract, not a
 * cross-app import — api-server and msp-portal share no component mechanism
 * other than lib/* packages). Real integration testing against #186's actual
 * committed output is a follow-up once both phases have landed on main.
 *
 * Not yet wired into any route or caller — same deliberate scope boundary as
 * omg-card-generator-v2.ts ("not yet wired ... that wiring is separate
 * follow-up work"). This phase is the generation engine only; wiring a real
 * customer/quiz-taker's QuizProfile + generated personas through a portal
 * route is out of scope here.
 */

import { z } from "zod";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { withAiDevResponseCache } from "./ai-dev-response-cache";
import { getPrompt } from "./prompt-loader";
import { logger } from "./logger";

const log = logger.child({ channel: "engine.dashboard" });

// ── Input shapes (backend-local mirrors of the real frozen contracts) ──────

export type CollaborationPattern = "internal" | "cross-team" | "external";
export type WorkflowStyle = "structured" | "unstructured";
export type AiComfortLevel = "low" | "medium" | "high";

/** Mirrors QuizProfile in artifacts/msp-portal/src/components/copilot-assessment/types.ts (#184's frozen contract). */
export interface QuizProfile {
  role: string;
  department: string;
  industry: string;
  collaboration: CollaborationPattern[];
  sensitivity: string[];
  workflowStyle: WorkflowStyle;
  outcomePriorities: string[];
  draftingLoad: number; // 0-1
  researchLoad: number; // 0-1
  communicationLoad: number; // 0-1
  repetitiveLoad: number; // 0-1
  /** Real Tool Usage step selections (#270) — substituted into {{toolUsage}} below. */
  toolUsage: string[];
  aiComfort: AiComfortLevel;
  // #270 — collected by the quiz, previously dropped. Optional: a profile
  // restored from a pre-#270 row has none of them.
  personaClusters?: string[];
  targetPersonas?: string[];
  useCaseClusters?: string[];
  adoptionSpeed?: string | null;
  changeManagement?: string | null;
}

export type PersonaSeverity = "High" | "Medium" | "Low";

/**
 * Mirrors #186's real `PersonaStoryResult` (persona-generation-engine.ts) —
 * the subset of fields most useful for grounding use-case generation.
 * `useCaseCluster` in particular is the persona generator's own explicit
 * "this persona's primary Copilot use-case cluster" signal, so it drives the
 * prompt directly rather than being re-derived from scratch.
 */
export interface PersonaContext {
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
  sensitivityExposure: { label: string; severity: PersonaSeverity }[];
  collaborationFriction: { label: string; severity: PersonaSeverity }[];
  valuePotential: {
    hoursSavedPerWeek: number;
    annualValuePerSeat: string;
    roiMultiplier: string;
    primaryBenefit: string;
  };
  shortStorySummary: string;
}

export interface UseCaseGenerationAttribution {
  mspId: number | null;
  customerId: number | null;
  triggerSource: string;
}

// ── Output shape ────────────────────────────────────────────────────────────

const GeneratedUseCaseSchema = z.object({
  name: z.string().min(1).max(120),
  category: z.string().min(1).max(60),
  feasibilityScore: z.number().min(0).max(100),
  blockers: z.array(z.string().min(1).max(200)).max(10),
  expectedRoi: z.string().min(1).max(60),
  recommended: z.boolean(),
  summary: z.string().min(1).max(400),
});

/** Matches UseCaseTile in artifacts/msp-portal/src/components/copilot-assessment/types.ts, plus the id/personaId/blocked fields this module assigns itself rather than trusting the model to get them right. */
export interface UseCaseTile {
  id: string;
  personaId: string;
  name: string;
  category: string;
  feasibilityScore: number;
  blockers: string[];
  expectedRoi: string;
  recommended: boolean;
  blocked: boolean;
  summary: string;
}

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 2000;

const USE_CASE_PROMPT_FALLBACK = `You are a Microsoft Copilot adoption strategist. Generate 3-5 realistic Copilot use cases for ONE specific persona at one organization, grounded ONLY in the real profile and persona data below — never generic, never invented beyond what this data supports.

QUIZ-TAKER'S ORGANIZATION PROFILE:
- Role: {{role}} / Department: {{department}} / Industry: {{industry}}
- Collaboration pattern(s): {{collaboration}}
- Data sensitivity in scope: {{sensitivity}}
- Workflow style: {{workflowStyle}}
- Outcome priorities: {{outcomePriorities}}
- Workload loads (0-1 scale, higher = more of this persona's week): drafting {{draftingLoad}}, research {{researchLoad}}, communication {{communicationLoad}}, repetitive/automatable tasks {{repetitiveLoad}}
- Tools in use: {{toolUsage}}
- AI comfort level: {{aiComfort}}

PERSONA THIS USE-CASE SET IS FOR:
- Name: {{personaName}} ({{personaRole}}, {{personaDepartment}})
- Primary Copilot use-case cluster (from persona generation): {{personaUseCaseCluster}}
- Persona-specific sensitivity set: {{personaSensitivitySet}}
- Persona-specific collaboration surfaces: {{personaCollaborationPattern}}
- Persona outcome priorities: {{personaOutcomePriorities}}
- Risk score: {{personaRiskScore}}/100, Feasibility score: {{personaFeasibilityScore}}/100, Adoption friction: {{personaAdoptionFriction}}/100
- Sensitivity exposure points: {{personaSensitivityExposure}}
- Collaboration friction points: {{personaCollaborationFriction}}
- Value potential: {{personaHoursSavedPerWeek}} hrs/week, {{personaAnnualValuePerSeat}}, primary benefit: {{personaPrimaryBenefit}}
- Story: {{personaShortStorySummary}}

MAPPING LOGIC — use this to decide which use cases to generate and how to score/gate them:
- High draftingLoad -> drafting/content-generation use cases (memos, briefs, proposals, documents).
- High researchLoad -> research/synthesis use cases (summarizing large document sets, cross-referencing sources, meeting synthesis).
- High communicationLoad -> communication use cases (email/Teams drafting, meeting recaps, stakeholder updates).
- High repetitiveLoad -> automation use cases (repetitive/templated task automation, agent-assisted workflows).
- A load near 0 should NOT drive a use case for this persona — do not force a category the data doesn't support.
- The persona's own useCaseCluster is a strong signal — at least one use case should sit squarely inside it.
- Every value in "Persona-specific sensitivity set" / "Sensitivity exposure points" must produce a real governance blocker/constraint on any use case it plausibly touches (e.g. PHI/HIPAA -> a blocker naming the specific compliance boundary). If sensitivity data is empty, blockers must not invent a sensitivity constraint.
- "external" in the collaboration pattern, or a High-severity collaboration friction point, must produce blockers/constraints around external data sharing and DLP for use cases that plausibly involve external parties; "internal"-only collaboration should produce fewer/no such blockers.
- feasibilityScore should be lower when blockers are present, higher when the use case is unblocked and well-supported by the loads/persona data above.

For each use case, return exactly:
- name: short use-case title (e.g. "Automated RFP & Proposal Drafting")
- category: short category label (e.g. "Productivity", "Sales Velocity", "Legal & Governance", "Automation", "Research & Synthesis")
- feasibilityScore: integer 0-100
- blockers: array of specific blocker strings grounded in the sensitivity/collaboration data above (empty array if genuinely none)
- expectedRoi: short string in the form "$X,XXX / seat / yr" — a plausible estimate, not a fabricated precise figure
- recommended: boolean — true if this is a strong near-term rollout candidate for this persona
- summary: one-sentence description of the use case

Return ONLY a JSON array, no markdown fences, no preamble, no trailing commentary. Shape:
[
  { "name": "...", "category": "...", "feasibilityScore": 90, "blockers": [], "expectedRoi": "$18,500 / seat / yr", "recommended": true, "summary": "..." }
]`;

/** Mirrors extractJson() in omg-card-generator-v2.ts / admin-marketing.ts — Claude sometimes wraps JSON in prose/fences; never use a ^-anchored regex. */
function extractJson(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();

  const arrStart = text.indexOf("[");
  if (arrStart === -1) return text.trim();
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = arrStart; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "[") depth++;
    else if (ch === "]") { depth--; if (depth === 0) return text.slice(arrStart, i + 1); }
  }
  return text.slice(arrStart).trim();
}

function formatSeverityList(items: { label: string; severity: PersonaSeverity }[]): string {
  return items.length > 0 ? items.map((i) => `${i.label} (${i.severity})`).join(", ") : "none specified";
}

/**
 * Generate 3-5 UseCaseTile objects for one persona, grounded in that
 * persona and the quiz-taker's real QuizProfile. Routed through
 * withAiDevResponseCache so repeated identical (quizProfile, persona) pairs
 * never re-hit the real Anthropic API while iterating in dev.
 */
export async function generateUseCasesForPersona(
  quizProfile: QuizProfile,
  persona: PersonaContext,
  attribution: UseCaseGenerationAttribution,
): Promise<UseCaseTile[]> {
  const rawTemplate = await getPrompt("assessment-use-case-generation", USE_CASE_PROMPT_FALLBACK);
  const prompt = rawTemplate
    .replace(/\{\{role\}\}/g, quizProfile.role)
    .replace(/\{\{department\}\}/g, quizProfile.department)
    .replace(/\{\{industry\}\}/g, quizProfile.industry)
    .replace(/\{\{collaboration\}\}/g, quizProfile.collaboration.join(", ") || "none specified")
    .replace(/\{\{sensitivity\}\}/g, quizProfile.sensitivity.join(", ") || "none specified")
    .replace(/\{\{workflowStyle\}\}/g, quizProfile.workflowStyle)
    .replace(/\{\{outcomePriorities\}\}/g, quizProfile.outcomePriorities.join(", ") || "none specified")
    .replace(/\{\{draftingLoad\}\}/g, String(quizProfile.draftingLoad))
    .replace(/\{\{researchLoad\}\}/g, String(quizProfile.researchLoad))
    .replace(/\{\{communicationLoad\}\}/g, String(quizProfile.communicationLoad))
    .replace(/\{\{repetitiveLoad\}\}/g, String(quizProfile.repetitiveLoad))
    .replace(/\{\{toolUsage\}\}/g, quizProfile.toolUsage.join(", ") || "none specified")
    .replace(/\{\{aiComfort\}\}/g, quizProfile.aiComfort)
    .replace(/\{\{personaName\}\}/g, persona.name)
    .replace(/\{\{personaRole\}\}/g, persona.role)
    .replace(/\{\{personaDepartment\}\}/g, persona.department)
    .replace(/\{\{personaUseCaseCluster\}\}/g, persona.useCaseCluster)
    .replace(/\{\{personaSensitivitySet\}\}/g, persona.sensitivitySet.join(", ") || "none specified")
    .replace(/\{\{personaCollaborationPattern\}\}/g, persona.collaborationPattern.join(", ") || "none specified")
    .replace(/\{\{personaOutcomePriorities\}\}/g, persona.outcomePriorities.join(", ") || "none specified")
    .replace(/\{\{personaRiskScore\}\}/g, String(persona.riskScore))
    .replace(/\{\{personaFeasibilityScore\}\}/g, String(persona.feasibilityScore))
    .replace(/\{\{personaAdoptionFriction\}\}/g, String(persona.adoptionFriction))
    .replace(/\{\{personaSensitivityExposure\}\}/g, formatSeverityList(persona.sensitivityExposure))
    .replace(/\{\{personaCollaborationFriction\}\}/g, formatSeverityList(persona.collaborationFriction))
    .replace(/\{\{personaHoursSavedPerWeek\}\}/g, String(persona.valuePotential.hoursSavedPerWeek))
    .replace(/\{\{personaAnnualValuePerSeat\}\}/g, persona.valuePotential.annualValuePerSeat)
    .replace(/\{\{personaPrimaryBenefit\}\}/g, persona.valuePotential.primaryBenefit)
    .replace(/\{\{personaShortStorySummary\}\}/g, persona.shortStorySummary);

  const aiResponse = await withAiDevResponseCache(
    {
      feature: "use_case_generation",
      requestContext: { quizProfile, persona },
    },
    {
      mspId: attribution.mspId,
      costOwner: "msp",
      nodeType: "use_case_generation",
      feature: "use_case_generation",
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
    log.warn({ personaId: persona.id }, "use-case-generator: output hit max_tokens — use case set may be truncated");
  }

  const textBlock = aiResponse.content.find((b) => b.type === "text");
  const rawText = textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";

  let tiles: UseCaseTile[] = [];
  try {
    const parsed: unknown = JSON.parse(extractJson(rawText));
    if (!Array.isArray(parsed)) {
      log.warn({ personaId: persona.id }, "use-case-generator: AI response was not a JSON array — returning no use cases");
    } else {
      tiles = parsed
        .map((item) => GeneratedUseCaseSchema.safeParse(item))
        .filter((result): result is { success: true; data: z.infer<typeof GeneratedUseCaseSchema> } => result.success)
        .map((result, index) => {
          const generated = result.data;
          return {
            id: `${persona.id}-uc${index + 1}`,
            personaId: persona.id,
            name: generated.name,
            category: generated.category,
            feasibilityScore: generated.feasibilityScore,
            blockers: generated.blockers,
            expectedRoi: generated.expectedRoi,
            recommended: generated.recommended,
            // Derived, never trusted from the model directly — a use case
            // with real blockers is blocked by definition, regardless of
            // what the model's own `recommended`/implied-blocked flags say.
            blocked: generated.blockers.length > 0,
            summary: generated.summary,
          };
        });
    }
  } catch (err) {
    log.warn({ err, personaId: persona.id }, "use-case-generator: failed to parse AI response — returning no use cases");
  }

  log.info({ personaId: persona.id, count: tiles.length }, "use-case-generator: use cases generated for persona");
  return tiles;
}
