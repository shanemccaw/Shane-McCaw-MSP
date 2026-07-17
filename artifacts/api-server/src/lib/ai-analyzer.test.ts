import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAiAnalyzer, trackAiUsage } from "./ai-analyzer";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { recordAiUsage } from "./ai-billing";

vi.mock("@workspace/integrations-anthropic-ai", () => {
  return {
    anthropic: {
      messages: {
        create: vi.fn(),
      },
    },
  };
});

vi.mock("./ai-billing", () => {
  return {
    recordAiUsage: vi.fn(() => Promise.resolve()),
    computeTokenCostCents: vi.fn(() => 5),
  };
});

vi.mock("@workspace/db", () => {
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([{ mspId: 10, customerId: 20 }])),
          })),
        })),
      })),
    },
    mspUsersTable: {},
  };
});

vi.mock("./prompt-loader", () => {
  return {
    getPrompt: vi.fn(() => Promise.resolve("mock prompt template with scriptOutput: {{scriptOutput}}")),
  };
});

describe("ai-analyzer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("trackAiUsage", () => {
    it("calls recordAiUsage asynchronously and returns immediately", async () => {
      trackAiUsage({
        inputTokens: 100,
        outputTokens: 200,
        model: "claude-haiku-4-5",
        mspId: 1,
        customerId: 2,
      });

      // Wait a tick for the Promise inside trackAiUsage to execute
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(recordAiUsage).toHaveBeenCalledWith({
        mspId: 1,
        nodeType: "ai_analyzer",
        feature: "m365_ai_analyzer:customer:2",
        promptTokens: 100,
        completionTokens: 200,
        costCents: 5,
        costOwner: "msp",
        model: "claude-haiku-4-5",
      });
    });
  });

  describe("runAiAnalyzer", () => {
    it("completes AI call and triggers trackAiUsage", async () => {
      vi.mocked(anthropic.messages.create).mockResolvedValue({
        content: [{ type: "text", text: "findings: [\"finding1\"]\nrecommendations: []\nscoreImpact: {}\nprofileUpdates: {}" }],
        usage: { input_tokens: 150, output_tokens: 250 },
        model: "claude-haiku-4-5",
      } as any);

      const result = await runAiAnalyzer({
        scriptOutput: "test-output",
        aiInstructions: "test-instructions",
        packageContext: "test-context",
        customerId: 20,
      });

      expect(result).toBeDefined();
      expect(anthropic.messages.create).toHaveBeenCalled();

      // Wait a tick for trackAiUsage to complete
      await new Promise((resolve) => setTimeout(resolve, 10));

      // It should query mspUsersTable to resolve mspId when customerId is present but mspId is not
      expect(recordAiUsage).toHaveBeenCalledWith(expect.objectContaining({
        mspId: 10, // resolved from db select mock
        promptTokens: 150,
        completionTokens: 250,
        model: "claude-haiku-4-5",
      }));
    });
  });
});
