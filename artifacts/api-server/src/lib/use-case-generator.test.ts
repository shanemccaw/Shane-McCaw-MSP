/**
 * use-case-generator.test.ts
 *
 * #187, sub-issue of #183 (Copilot Assessment epic). Drives
 * generateUseCasesForPersona() against a manually-constructed QuizProfile +
 * PersonaContext fixture (per #187's instructions — #186's real Persona
 * Generation Engine had not landed anywhere in this working tree as of this
 * phase, so this cannot be tested against real persona output yet). Mocks
 * withAiDevResponseCache itself (not the underlying metering module) since
 * this file's own concern is prompt construction, JSON parsing/validation,
 * and the id/personaId/blocked derivation logic — not the cache module's own
 * hit/miss behavior, which is #185's concern.
 *
 * Run: pnpm --filter @workspace/api-server run test -- use-case-generator
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let capturedRequest: { feature: string; requestContext: unknown } | null = null;
let capturedAttribution: Record<string, unknown> | null = null;
let anthropicCalls: unknown[] = [];
let nextResponseText = "";
let nextStopReason: string | undefined;

vi.mock("./ai-dev-response-cache", () => ({
  withAiDevResponseCache: async (
    request: { feature: string; requestContext: unknown },
    attribution: Record<string, unknown>,
    fn: () => Promise<unknown>,
  ) => {
    capturedRequest = request;
    capturedAttribution = attribution;
    return fn();
  },
}));

vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: {
    messages: {
      create: async (params: unknown) => {
        anthropicCalls.push(params);
        return {
          content: [{ type: "text", text: nextResponseText }],
          stop_reason: nextStopReason ?? "end_turn",
        };
      },
    },
  },
}));

vi.mock("./prompt-loader", () => ({
  getPrompt: async (_key: string, fallback: string) => fallback,
}));

vi.mock("./logger", () => {
  const stub = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});

import { generateUseCasesForPersona, type QuizProfile, type PersonaContext } from "./use-case-generator.ts";

const QUIZ_PROFILE: QuizProfile = {
  role: "Corporate Counsel",
  department: "Legal Affairs",
  industry: "Legal Services",
  collaboration: ["external"],
  sensitivity: ["PII", "CUI"],
  workflowStyle: "structured",
  outcomePriorities: ["risk reduction"],
  draftingLoad: 0.8,
  researchLoad: 0.6,
  communicationLoad: 0.3,
  repetitiveLoad: 0.2,
  toolUsage: ["Word", "Outlook"],
  aiComfort: "medium",
};

const PERSONA: PersonaContext = {
  id: "legal",
  name: "Legal & Compliance Counsel",
  role: "Corporate Counsel",
  department: "Legal Affairs",
  useCaseCluster: "Contract Redline & Compliance Synthesis",
  sensitivitySet: ["PII", "CUI"],
  collaborationPattern: ["Outlook", "SharePoint Legal Site"],
  outcomePriorities: ["risk reduction"],
  riskScore: 58,
  feasibilityScore: 74,
  adoptionFriction: 40,
  sensitivityExposure: [{ label: "Client-privileged contract data", severity: "High" }],
  collaborationFriction: [{ label: "External counsel document exchange", severity: "Medium" }],
  valuePotential: {
    hoursSavedPerWeek: 4.5,
    annualValuePerSeat: "$19,800 / seat",
    roiMultiplier: "2.1x ROI",
    primaryBenefit: "Accelerated contract reviews with strict provenance",
  },
  shortStorySummary: "Legal counsel handles complex contract comparisons and regulatory updates.",
};

const ATTRIBUTION = { mspId: 7, customerId: 42, triggerSource: "use-case-generator-test" };

beforeEach(() => {
  capturedRequest = null;
  capturedAttribution = null;
  anthropicCalls = [];
  nextStopReason = undefined;
});

describe("generateUseCasesForPersona()", () => {
  it("parses a valid AI response into UseCaseTile[] with derived id/personaId/blocked", async () => {
    nextResponseText = JSON.stringify([
      {
        name: "Contract Redline & Audit Synthesis",
        category: "Legal & Governance",
        feasibilityScore: 74,
        blockers: ["Requires DLP Strict Enforcement for external-facing redlines"],
        expectedRoi: "$19,200 / seat / yr",
        recommended: false,
        summary: "Automated clause risk analysis and compliance delta highlighting.",
      },
      {
        name: "Internal Policy Q&A Grounding",
        category: "Productivity",
        feasibilityScore: 92,
        blockers: [],
        expectedRoi: "$12,000 / seat / yr",
        recommended: true,
        summary: "Grounding Copilot in internal policy docs for fast lookup.",
      },
    ]);

    const tiles = await generateUseCasesForPersona(QUIZ_PROFILE, PERSONA, ATTRIBUTION);

    expect(tiles).toHaveLength(2);
    expect(tiles[0]).toMatchObject({
      id: "legal-uc1",
      personaId: "legal",
      name: "Contract Redline & Audit Synthesis",
      blocked: true,
    });
    expect(tiles[1]).toMatchObject({
      id: "legal-uc2",
      personaId: "legal",
      name: "Internal Policy Q&A Grounding",
      blocked: false,
    });
  });

  it("routes through withAiDevResponseCache with the persona/quiz-scoped feature and request context", async () => {
    nextResponseText = "[]";

    await generateUseCasesForPersona(QUIZ_PROFILE, PERSONA, ATTRIBUTION);

    expect(capturedRequest?.feature).toBe("use_case_generation");
    expect(capturedRequest?.requestContext).toEqual({ quizProfile: QUIZ_PROFILE, persona: PERSONA });
    expect(capturedAttribution).toMatchObject({
      mspId: 7,
      costOwner: "msp",
      nodeType: "use_case_generation",
      feature: "use_case_generation",
      customerId: 42,
      triggerSource: "use-case-generator-test",
    });
    expect(anthropicCalls).toHaveLength(1);
  });

  it("strips a markdown fence around the JSON array", async () => {
    nextResponseText = "```json\n[{\"name\":\"X\",\"category\":\"Y\",\"feasibilityScore\":50,\"blockers\":[],\"expectedRoi\":\"$1 / seat / yr\",\"recommended\":true,\"summary\":\"z\"}]\n```";

    const tiles = await generateUseCasesForPersona(QUIZ_PROFILE, PERSONA, ATTRIBUTION);

    expect(tiles).toHaveLength(1);
    expect(tiles[0].name).toBe("X");
  });

  it("drops entries that fail schema validation instead of throwing", async () => {
    nextResponseText = JSON.stringify([
      { name: "Valid one", category: "Productivity", feasibilityScore: 80, blockers: [], expectedRoi: "$1 / seat / yr", recommended: true, summary: "ok" },
      { name: "Missing fields" },
    ]);

    const tiles = await generateUseCasesForPersona(QUIZ_PROFILE, PERSONA, ATTRIBUTION);

    expect(tiles).toHaveLength(1);
    expect(tiles[0].name).toBe("Valid one");
  });

  it("returns an empty array (never throws) when the AI response is not valid JSON", async () => {
    nextResponseText = "not json at all";

    const tiles = await generateUseCasesForPersona(QUIZ_PROFILE, PERSONA, ATTRIBUTION);

    expect(tiles).toEqual([]);
  });

  it("returns an empty array when the AI response is a JSON object instead of an array", async () => {
    nextResponseText = JSON.stringify({ oops: "not an array" });

    const tiles = await generateUseCasesForPersona(QUIZ_PROFILE, PERSONA, ATTRIBUTION);

    expect(tiles).toEqual([]);
  });
});
