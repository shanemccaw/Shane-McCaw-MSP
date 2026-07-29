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
          // Tenant/User Refactor Phase 5: the mspId lookup now left-joins
          // tenants onto users. A tenant-scoped user (CustomerUser/Free/
          // Assessment) carries a NULL users.mspId, so the MSP must come from
          // tenants.mspId — the row shape below models exactly that case,
          // which is the one a naive users.mspId-only rewrite would break.
          leftJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve([{ userMspId: null, tenantMspId: 10, tenantId: 99 }])),
            })),
          })),
        })),
      })),
    },
    usersTable: {},
    tenantsTable: {},
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
        customerId: 2,
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

      // It should resolve mspId from the caller's users row (falling through to
      // tenants.mspId for a tenant-scoped user) when customerId is present but
      // mspId is not, and it should report the resolved tenants.id (not the
      // raw users.id passed in as customerId) to ai_usage_events.
      expect(recordAiUsage).toHaveBeenCalledWith(expect.objectContaining({
        mspId: 10, // resolved from db select mock (tenants.mspId)
        customerId: 99, // resolved tenants.id from db select mock (users.tenantId), not the raw input customerId (20)
        promptTokens: 150,
        completionTokens: 250,
        model: "claude-haiku-4-5",
      }));
    });
  });
});
