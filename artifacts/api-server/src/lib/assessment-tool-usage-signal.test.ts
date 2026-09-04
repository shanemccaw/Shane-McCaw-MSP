/**
 * assessment-tool-usage-signal.test.ts — #270 (Copilot Assessment epic #183).
 *
 * Until #270 the quiz never asked which Microsoft 365 apps a customer works in,
 * so QuizProfile.toolUsage was an always-empty array — and all three assessment
 * generators read it. This file confirms the other half: that a REAL toolUsage
 * answer (and the five cluster/persona/use-case/rollout answers the wizard used
 * to drop) actually reach the model, in each generator's own assembled prompt.
 *
 * It asserts on the prompt handed to the Anthropic client, not on model output —
 * what a model then does with the tool list is not something a test can pin, but
 * "the answer is in the prompt at all" is exactly what regressed before.
 *
 * The third generator, use-case-generator.ts, is covered in its own existing
 * test file (use-case-generator.test.ts).
 *
 * Run: pnpm --filter @workspace/api-server vitest run assessment-tool-usage-signal
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

let anthropicPrompts: string[] = [];
let nextResponses: string[] = [];

/**
 * Minimal stand-in for the SDK's `MessageStream` (mirrors
 * document-engine-cost.test.ts's `fakeMessageStream`): `on()` registers
 * listeners without consuming, `finalMessage()` resolves to the complete
 * Message. persona-generation-engine.ts's #283 streaming conversion calls
 * `anthropic.messages.stream(...).finalMessage()`, not `.create()`.
 */
function fakeMessageStream(message: Record<string, unknown>): Record<string, unknown> {
  const stream: Record<string, unknown> = {
    on: () => stream,
    finalMessage: async () => message,
  };
  return stream;
}

vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: {
    messages: {
      create: async (params: { messages: { content: string }[] }) => {
        anthropicPrompts.push(params.messages[0].content);
        const text = nextResponses.shift() ?? "";
        return { content: [{ type: "text", text }], stop_reason: "end_turn" };
      },
      stream: (params: { messages: { content: string }[] }) => {
        anthropicPrompts.push(params.messages[0].content);
        const text = nextResponses.shift() ?? "";
        return fakeMessageStream({ content: [{ type: "text", text }], stop_reason: "end_turn" });
      },
    },
  },
}));

vi.mock("./ai-dev-response-cache.ts", () => ({
  withAiDevResponseCache: async (_ctx: unknown, _attr: unknown, call: () => Promise<unknown>) => call(),
}));

// Returning the fallback is the real behaviour in any environment with no
// ai_prompts row for the key — and for the seeded final-report row, the manual
// SQL alongside this change adds the same {{toolUsage}} line to the stored body.
vi.mock("./prompt-loader.ts", () => ({
  getPrompt: async (_key: string, fallback: string) => fallback,
}));

vi.mock("./logger.ts", () => {
  const stub = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});

import { generatePersonaStories, type PersonaGenerationQuizProfile } from "./persona-generation-engine.ts";
import {
  generateFinalReportNarrative,
  type FinalReportQuizProfile,
  type FinalReportPersona,
} from "./final-report-narrative-generator.ts";

// The real answer set a browser produced by walking all 14 quiz steps (#270) —
// the legal/litigation run. Trimmed to each generator's own mirror interface.
const REAL_TOOLS = ["Word", "Outlook", "Teams"];

const QUIZ_PROFILE = {
  role: "Senior Litigation Counsel",
  department: "Litigation",
  industry: "legal",
  collaboration: ["internal", "external"],
  sensitivity: ["Privileged / Work Product"],
  workflowStyle: "unstructured",
  outcomePriorities: ["Productivity & Time Saved", "Quality & Error Reduction"],
  draftingLoad: 0.71,
  researchLoad: 0.85,
  communicationLoad: 0.27,
  repetitiveLoad: 0.4,
  toolUsage: REAL_TOOLS,
  aiComfort: "high",
  personaClusters: ["Litigation", "Compliance & Regulatory"],
  targetPersonas: ["Litigator", "Litigation Paralegal"],
  useCaseClusters: ["Brief Drafting", "Discovery Review Summaries"],
  adoptionSpeed: "fast_follower",
  changeManagement: "moderate",
};

const PERSONA: FinalReportPersona = {
  id: "litigator",
  name: "Litigation Lead",
  role: "Litigator",
  department: "Litigation",
  useCaseCluster: "Brief Drafting",
  sensitivitySet: ["Privileged / Work Product"],
  collaborationPattern: ["Teams matter channels"],
  outcomePriorities: ["Quality & Error Reduction"],
  riskScore: 60,
  feasibilityScore: 80,
  adoptionFriction: 40,
  sensitivityExposure: [{ label: "Privileged material in shared sites", severity: "High" }],
  collaborationFriction: [{ label: "Opposing counsel exchanges", severity: "Medium" }],
  valuePotential: {
    hoursSavedPerWeek: 5,
    annualValuePerSeat: "$16,000 / seat",
    roiMultiplier: "3.2x ROI",
    primaryBenefit: "Faster brief turnaround",
  },
  shortStory: { summary: "Drafts briefs from case law research.", telemetryCheck: "n/a", copilotUnlock: "n/a" },
};

const USE_CASE_JSON = JSON.stringify([
  {
    name: "Brief Drafting Acceleration",
    category: "Legal & Governance",
    feasibilityScore: 80,
    blockers: [],
    expectedRoi: "$16,000 / seat / yr",
    recommended: true,
    summary: "Draft briefs from prior filings.",
  },
]);

beforeEach(() => {
  anthropicPrompts = [];
  nextResponses = [];
});

describe("persona-generation-engine receives real toolUsage (#270)", () => {
  it("puts the real tool answers, and the five recovered answers, into the prompt", async () => {
    nextResponses = [JSON.stringify([])]; // generation result is irrelevant here
    await generatePersonaStories({
      quizProfile: QUIZ_PROFILE as PersonaGenerationQuizProfile,
      mspId: 7,
      customerId: 42,
    }).catch(() => undefined); // an empty persona array is a legitimate failure; the prompt is what matters

    expect(anthropicPrompts).toHaveLength(1);
    const prompt = anthropicPrompts[0];

    // The whole profile is serialized into {{quizProfileJson}}, so every real
    // answer reaches the model — including the ones that used to be dropped.
    REAL_TOOLS.forEach((tool) => expect(prompt).toContain(tool));
    expect(prompt).toContain("toolUsage");
    expect(prompt).toContain("personaClusters");
    expect(prompt).toContain("Litigation Paralegal");
    expect(prompt).toContain("fast_follower");
    expect(prompt).toContain("Discovery Review Summaries");
    // And the inferred loads, no longer 0.5 for everyone.
    expect(prompt).toContain("0.85");
    expect(prompt).not.toContain('"draftingLoad": 0.5');
  });
});

describe("final-report-narrative-generator receives real toolUsage (#270)", () => {
  it("substitutes the real tool answers into the narrative prompt", async () => {
    // First call is the per-persona use-case generation, second is the narrative.
    nextResponses = [USE_CASE_JSON, "<h3>Executive Summary</h3><p>Real narrative.</p>"];

    const result = await generateFinalReportNarrative({
      quizProfile: QUIZ_PROFILE as unknown as FinalReportQuizProfile,
      personas: [PERSONA],
      governance: { ca01: true, pim: false, sensitivityLabels: true, dlp: "moderate" },
      attribution: { mspId: 7, customerId: 42, triggerSource: "test" },
    });

    expect(result.narrativeHtml).toContain("Executive Summary");
    expect(anthropicPrompts).toHaveLength(2);

    const useCasePrompt = anthropicPrompts[0];
    const narrativePrompt = anthropicPrompts[1];

    // The use-case generator's own {{toolUsage}} token (pre-existing).
    expect(useCasePrompt).toContain("Tools in use: Word, Outlook, Teams");
    // The narrative's own token — added by #270; before it, the tool answers
    // reached use-case generation but never the executive narrative itself.
    expect(narrativePrompt).toContain("Word, Outlook, Teams");
    expect(narrativePrompt).not.toContain("{{toolUsage}}");
  });

  it("says 'none specified' rather than leaving the token raw when a legacy profile has no tools", async () => {
    nextResponses = [USE_CASE_JSON, "<h3>Executive Summary</h3><p>Real narrative.</p>"];

    await generateFinalReportNarrative({
      quizProfile: { ...QUIZ_PROFILE, toolUsage: [] } as unknown as FinalReportQuizProfile,
      personas: [PERSONA],
      governance: { ca01: false, pim: false, sensitivityLabels: false, dlp: "off" },
      attribution: { mspId: 7, customerId: 42, triggerSource: "test" },
    });

    const narrativePrompt = anthropicPrompts[1];
    expect(narrativePrompt).toContain("none specified");
    expect(narrativePrompt).not.toContain("{{toolUsage}}");
  });

  it("the deterministic ROI score now moves with the inferred loads", () => {
    // Same weights final-report-narrative-generator applies (mirroring #190).
    const roi = (p: { draftingLoad: number; researchLoad: number; communicationLoad: number; repetitiveLoad: number }) =>
      Math.round((0.3 * p.draftingLoad + 0.25 * p.researchLoad + 0.2 * p.communicationLoad + 0.15 * p.repetitiveLoad) * 100);

    const legacyFlat = roi({ draftingLoad: 0.5, researchLoad: 0.5, communicationLoad: 0.5, repetitiveLoad: 0.5 });
    const real = roi(QUIZ_PROFILE);

    expect(legacyFlat).toBe(45); // what EVERY customer scored before #270
    expect(real).not.toBe(legacyFlat);
  });
});
