/**
 * persona-generation-engine.ts
 *
 * Copilot Assessment epic (#183), Phase 3 / #186 — the platform's second real
 * Anthropic call site, modeled directly on cio-narrative-generator.ts's shape
 * (structured data in, one attributed Anthropic call, structured data out).
 *
 * Single-input model, confirmed in #183/#186: this is NOT real multi-employee
 * survey clustering. One quiz-taker's full structured QuizProfile (role,
 * department, industry, collaboration pattern, sensitivity set, workflow
 * style, outcome priorities, the four workload sliders, tool usage, AI
 * comfort) becomes the entire prompt context, and the model generates ~5
 * plausible ARCHETYPAL personas fresh from it every call — distinct roles
 * that would plausibly exist at an organization matching this profile, not
 * five restatements of the single quiz-taker. Industry/sensitivity/role
 * naturally shape tone (healthcare -> HIPAA-aware, legal -> privilege-aware)
 * purely through the prompt, never a hardcoded per-industry content map.
 *
 * Deliberate non-goal: the "telemetry" language in each persona's narrative
 * fields is illustrative of COMMON patterns for that archetype/profile, not a
 * claim about this tenant's real scan data — Copilot Assessment's real
 * telemetry-scoring phases (Governance/Security Scoring, #183 Phases 5/6) are
 * separate, later phases that don't exist yet. The prompt is written to keep
 * this framing honest ("commonly seen in organizations like this" rather than
 * "we detected"), consistent with the platform's no-fabrication convention
 * elsewhere (see cio-narrative-generator.ts's own findings-only-if-real rule).
 *
 * Routed through withAiDevResponseCache (#185) rather than a raw
 * withAiAttribution call, so dev-time iteration on this prompt/UI doesn't
 * burn real API cost — a cache MISS still bills through the identical
 * withAiAttribution path every other call site uses.
 */

import { anthropic } from "@workspace/integrations-anthropic-ai";
import { withAiDevResponseCache } from "./ai-dev-response-cache.ts";
import { getPrompt } from "./prompt-loader.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "engine.dashboard" });

// ── Wire contract mirrors ────────────────────────────────────────────────────
// Duplicated from msp-portal's types.ts (frozen QuizProfile contract, #184) —
// api-server and the msp-portal app are independent Vite/Node apps with no
// shared-component mechanism other than lib/* packages, and this is a request
// DTO boundary, not shared business logic, so a local mirror is the correct
// (and existing-convention) shape here rather than a new lib/* package.

export interface PersonaGenerationQuizProfile {
  role: string;
  department: string;
  industry: string;
  collaboration: string[];
  sensitivity: string[];
  workflowStyle: string;
  outcomePriorities: string[];
  draftingLoad: number;
  researchLoad: number;
  communicationLoad: number;
  repetitiveLoad: number;
  toolUsage: string[];
  aiComfort: string;
}

type Severity = "High" | "Medium" | "Low";
type BgAnimationType = "engineer" | "security" | "pm" | "writer" | "researcher";

const BG_ANIMATION_TYPES: BgAnimationType[] = ["engineer", "security", "pm", "writer", "researcher"];
const SEVERITIES: Severity[] = ["High", "Medium", "Low"];

/** Mirrors msp-portal's real consumed PersonaStory shape (types.ts, audited against PersonasScreen.tsx's actual field reads for #186). */
export interface PersonaStoryResult {
  id: string;
  name: string;
  role: string;
  department: string;
  avatar: string;
  bgAnimationType: BgAnimationType;
  collaborationPattern: string[];
  sensitivitySet: string[];
  useCaseCluster: string;
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
  shortStory: {
    summary: string;
    telemetryCheck: string;
    copilotUnlock: string;
  };
  expandedNarrative: {
    identityContext: string;
    collaborationSensitivity: string;
    telemetryRealityCheck: string;
    workflowFriction: string;
    feasibilityReadiness: string;
    copilotValueStory: string;
    roiBreakdown: string;
  };
  insightRibbonText: string;
}

export interface GeneratePersonaStoriesParams {
  quizProfile: PersonaGenerationQuizProfile;
  mspId: number | null;
  customerId: number | null;
}

const PERSONA_COUNT = 5;
const MIN_VALID_PERSONAS = 3;

const PERSONA_GENERATION_PROMPT_FALLBACK = `You are a Microsoft 365 Copilot adoption strategist. A prospective client just completed a short intake quiz describing their own role and organization. From THIS SINGLE QUIZ-TAKER'S CONTEXT ONLY, generate ${PERSONA_COUNT} plausible, distinct ARCHETYPAL personas — other roles/departments that would realistically exist at an organization matching this profile, spanning a genuine spread of functions (e.g. technical, security/compliance, program/product, documentation/legal, executive) rather than five variations on the quiz-taker's own role.

QUIZ-TAKER CONTEXT (JSON):
{{quizProfileJson}}

IMPORTANT — industry/sensitivity/role context must naturally shape persona content (e.g. a healthcare industry value should produce HIPAA/PHI-aware personas; legal/CUI sensitivity should produce privilege-aware personas) purely through your own reasoning — there is no fixed per-industry template to follow, and you must never hardcode or copy boilerplate industry language that ignores what this specific quiz context says.

HONESTY RULE: This organization has not been scanned yet — you have no real telemetry, no real findings. Every "telemetry"/"reality check" style field below must be written as a COMMON PATTERN typical of this persona archetype and quiz context ("commonly seen in organizations with this profile...", "organizations like this typically show..."), never phrased as if you personally detected or scanned anything. Never claim a specific real finding actually exists in this tenant.

Return ONLY a JSON array of exactly ${PERSONA_COUNT} objects, no markdown fences, no preamble, no trailing text, matching this EXACT shape:
[
  {
    "id": "short-kebab-case-slug",
    "name": "Persona display name, e.g. Engineering & Dev Lead",
    "role": "Specific job title",
    "department": "Department name",
    "avatar": "single emoji",
    "bgAnimationType": "one of: engineer | security | pm | writer | researcher — pick whichever best fits this persona's function",
    "collaborationPattern": ["3-5 real M365/tool surfaces this persona lives in, e.g. Teams Dev Channel"],
    "sensitivitySet": ["2-4 categories of sensitive data this persona regularly handles"],
    "useCaseCluster": "Short phrase naming this persona's primary Copilot use-case cluster",
    "outcomePriorities": ["2-3 short outcome priority phrases, e.g. Engineering Velocity (+35%)"],
    "riskScore": <integer 0-100>,
    "feasibilityScore": <integer 0-100>,
    "adoptionFriction": <integer 0-100>,
    "sensitivityExposure": [{"label": "short common-pattern label", "severity": "High|Medium|Low"}, ...2-3 entries],
    "collaborationFriction": [{"label": "short common-pattern label", "severity": "High|Medium|Low"}, ...1-2 entries],
    "valuePotential": {
      "hoursSavedPerWeek": <number, one decimal, 3-8 range>,
      "annualValuePerSeat": "$X,XXX / seat",
      "roiMultiplier": "X.Xx ROI",
      "primaryBenefit": "short phrase"
    },
    "shortStory": {
      "summary": "2-3 sentence narrative summary in third person",
      "telemetryCheck": "1 sentence, common-pattern framing per the HONESTY RULE above",
      "copilotUnlock": "1-2 sentences on how M365 Copilot addresses this persona's workflow"
    },
    "expandedNarrative": {
      "identityContext": "1-2 sentences on this persona's role and daily responsibilities",
      "collaborationSensitivity": "1-2 sentences on their collaboration surfaces and the sensitive data they touch",
      "telemetryRealityCheck": "1-2 sentences, common-pattern framing per the HONESTY RULE above",
      "workflowFriction": "1-2 sentences on a concrete daily friction point",
      "feasibilityReadiness": "1-2 sentences on adoption readiness, referencing the feasibilityScore",
      "copilotValueStory": "1-2 sentences on the specific Copilot capability that helps most",
      "roiBreakdown": "1-2 sentences tying valuePotential's numbers to this persona's work"
    },
    "insightRibbonText": "One punchy sentence with an emoji prefix summarizing this persona's headline pattern + Copilot unlock"
  }
]

Ground riskScore/feasibilityScore/adoptionFriction and valuePotential.hoursSavedPerWeek loosely in the quiz-taker's own draftingLoad/researchLoad/communicationLoad/repetitiveLoad values where the persona's function plausibly correlates — but these are illustrative, not a precise formula.`;

/**
 * Robust JSON array extractor — handles Claude preamble prose and markdown
 * fences. Never uses a ^-anchored regex (per the platform's ai-json-extraction
 * convention — see m365-health-ai-scorer.ts's identical helper).
 */
function extractJsonArray(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1].trim() : text;
  const start = candidate.indexOf("[");
  if (start === -1) return candidate;
  let depth = 0;
  for (let i = start; i < candidate.length; i++) {
    if (candidate[i] === "[") depth++;
    else if (candidate[i] === "]" && --depth === 0) return candidate.slice(start, i + 1);
  }
  return candidate.slice(start);
}

function clampScore(value: unknown, fallback: number): number {
  const n = typeof value === "number" && isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const strs = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  return strs.length > 0 ? strs : null;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "persona";
}

function normalizeSeverityList(
  value: unknown,
): { label: string; severity: Severity }[] | null {
  if (!Array.isArray(value)) return null;
  const items = value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const label = (entry as Record<string, unknown>).label;
      const severityRaw = (entry as Record<string, unknown>).severity;
      if (typeof label !== "string" || !label.trim()) return null;
      const severity = SEVERITIES.includes(severityRaw as Severity) ? (severityRaw as Severity) : "Medium";
      return { label, severity };
    })
    .filter((v): v is { label: string; severity: Severity } => v !== null);
  return items.length > 0 ? items : null;
}

/**
 * Validate + normalize one raw model-emitted persona object. Returns null
 * (and logs why) rather than silently filling in fabricated content for a
 * structurally broken entry — a dropped persona is honest; a fabricated one
 * is not.
 */
function normalizePersona(raw: unknown, usedIds: Set<string>): PersonaStoryResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const name = typeof r.name === "string" && r.name.trim() ? r.name.trim() : null;
  const role = typeof r.role === "string" && r.role.trim() ? r.role.trim() : null;
  const department = typeof r.department === "string" && r.department.trim() ? r.department.trim() : null;
  if (!name || !role || !department) return null;

  const collaborationPattern = asStringArray(r.collaborationPattern);
  const sensitivitySet = asStringArray(r.sensitivitySet);
  const outcomePriorities = asStringArray(r.outcomePriorities);
  const useCaseCluster = typeof r.useCaseCluster === "string" && r.useCaseCluster.trim() ? r.useCaseCluster.trim() : null;
  const sensitivityExposure = normalizeSeverityList(r.sensitivityExposure);
  const collaborationFriction = normalizeSeverityList(r.collaborationFriction);
  if (!collaborationPattern || !sensitivitySet || !outcomePriorities || !useCaseCluster || !sensitivityExposure || !collaborationFriction) {
    return null;
  }

  const vp = r.valuePotential as Record<string, unknown> | undefined;
  const hoursSavedPerWeek = typeof vp?.hoursSavedPerWeek === "number" && isFinite(vp.hoursSavedPerWeek) ? vp.hoursSavedPerWeek : null;
  const annualValuePerSeat = typeof vp?.annualValuePerSeat === "string" && vp.annualValuePerSeat.trim() ? vp.annualValuePerSeat.trim() : null;
  const roiMultiplier = typeof vp?.roiMultiplier === "string" && vp.roiMultiplier.trim() ? vp.roiMultiplier.trim() : null;
  const primaryBenefit = typeof vp?.primaryBenefit === "string" && vp.primaryBenefit.trim() ? vp.primaryBenefit.trim() : null;
  if (hoursSavedPerWeek === null || !annualValuePerSeat || !roiMultiplier || !primaryBenefit) return null;

  const ss = r.shortStory as Record<string, unknown> | undefined;
  const summary = typeof ss?.summary === "string" && ss.summary.trim() ? ss.summary.trim() : null;
  const telemetryCheck = typeof ss?.telemetryCheck === "string" && ss.telemetryCheck.trim() ? ss.telemetryCheck.trim() : null;
  const copilotUnlock = typeof ss?.copilotUnlock === "string" && ss.copilotUnlock.trim() ? ss.copilotUnlock.trim() : null;
  if (!summary || !telemetryCheck || !copilotUnlock) return null;

  const en = r.expandedNarrative as Record<string, unknown> | undefined;
  const narrativeFields = [
    "identityContext",
    "collaborationSensitivity",
    "telemetryRealityCheck",
    "workflowFriction",
    "feasibilityReadiness",
    "copilotValueStory",
    "roiBreakdown",
  ] as const;
  const expandedNarrative: Record<string, string> = {};
  for (const field of narrativeFields) {
    const v = en?.[field];
    if (typeof v !== "string" || !v.trim()) return null;
    expandedNarrative[field] = v.trim();
  }

  const insightRibbonText = typeof r.insightRibbonText === "string" && r.insightRibbonText.trim() ? r.insightRibbonText.trim() : `✨ ${name}: ${primaryBenefit}.`;
  const avatar = typeof r.avatar === "string" && r.avatar.trim() ? r.avatar.trim() : "💼";
  const bgAnimationType = BG_ANIMATION_TYPES.includes(r.bgAnimationType as BgAnimationType)
    ? (r.bgAnimationType as BgAnimationType)
    : BG_ANIMATION_TYPES[usedIds.size % BG_ANIMATION_TYPES.length];

  let id = slugify(typeof r.id === "string" && r.id.trim() ? r.id : name);
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${slugify(typeof r.id === "string" && r.id.trim() ? r.id : name)}-${suffix++}`;
  }
  usedIds.add(id);

  return {
    id,
    name,
    role,
    department,
    avatar,
    bgAnimationType,
    collaborationPattern,
    sensitivitySet,
    useCaseCluster,
    outcomePriorities,
    riskScore: clampScore(r.riskScore, 50),
    feasibilityScore: clampScore(r.feasibilityScore, 50),
    adoptionFriction: clampScore(r.adoptionFriction, 30),
    sensitivityExposure,
    collaborationFriction,
    valuePotential: {
      hoursSavedPerWeek: Math.max(0, Math.round(hoursSavedPerWeek * 10) / 10),
      annualValuePerSeat,
      roiMultiplier,
      primaryBenefit,
    },
    shortStory: { summary, telemetryCheck, copilotUnlock },
    expandedNarrative: expandedNarrative as PersonaStoryResult["expandedNarrative"],
    insightRibbonText,
  };
}

/**
 * Generate ~5 archetypal personas from a single quiz-taker's QuizProfile.
 * Throws if fewer than MIN_VALID_PERSONAS survive validation — callers should
 * surface this as a real error state, never silently substitute fabricated
 * fallback content (matches the platform's honest-empty convention).
 */
export async function generatePersonaStories(
  params: GeneratePersonaStoriesParams,
): Promise<PersonaStoryResult[]> {
  const { quizProfile, mspId, customerId } = params;

  const rawTemplate = await getPrompt("assessment-persona-generation", PERSONA_GENERATION_PROMPT_FALLBACK);
  const prompt = rawTemplate.replace(/\{\{quizProfileJson\}\}/g, JSON.stringify(quizProfile, null, 2));

  const aiResponse = await withAiDevResponseCache(
    {
      feature: "persona_generation",
      requestContext: { quizProfile },
    },
    {
      mspId,
      costOwner: "msp",
      nodeType: "persona_generation",
      feature: "persona_generation",
      customerId,
      triggerSource: "persona-generation-engine",
    },
    () =>
      anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 8000,
        messages: [{ role: "user", content: prompt }],
      }),
  );

  if (aiResponse.stop_reason === "max_tokens") {
    log.warn({ customerId }, "persona-generation-engine: output hit max_tokens — response may be truncated/unparseable");
  }

  const block = aiResponse.content.find((b) => b.type === "text");
  const rawText = block && block.type === "text" ? block.text : "";

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonArray(rawText));
  } catch (err) {
    log.error({ err, customerId, raw: rawText.slice(0, 500) }, "persona-generation-engine: JSON parse failed");
    throw new Error("persona-generation-engine: model did not return parseable JSON");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("persona-generation-engine: model response was not a JSON array");
  }

  const usedIds = new Set<string>();
  const personas = parsed
    .slice(0, PERSONA_COUNT + 2)
    .map((entry) => normalizePersona(entry, usedIds))
    .filter((p): p is PersonaStoryResult => p !== null)
    .slice(0, PERSONA_COUNT);

  if (personas.length < MIN_VALID_PERSONAS) {
    log.error(
      { customerId, rawCount: parsed.length, validCount: personas.length },
      "persona-generation-engine: too few valid personas survived normalization",
    );
    throw new Error("persona-generation-engine: model returned too few valid personas");
  }

  log.info({ customerId, count: personas.length }, "persona-generation-engine: personas generated");
  return personas;
}
