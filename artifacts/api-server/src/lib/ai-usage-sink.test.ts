/**
 * ai-usage-sink.test.ts
 *
 * AI Cost Governance Phase 2 (#50): traceability fields threaded from a
 * metered AiUsageRecord into recordAiUsage()'s opts, plus correlationId
 * sourced from request-context.ts rather than call-site attribution.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AiUsageRecord } from "@workspace/integrations-anthropic-ai";

vi.mock("@workspace/integrations-anthropic-ai", () => ({
  registerAiUsageSink: vi.fn(),
}));

vi.mock("./logger", () => {
  const stub = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});

const recordAiUsage = vi.fn(async (..._args: unknown[]) => {});
vi.mock("./ai-billing", () => ({
  recordAiUsage: (...args: unknown[]) => recordAiUsage(...args),
}));

const getRequestContext = vi.fn<() => { traceId: string } | undefined>(() => undefined);
vi.mock("./request-context", () => ({
  getRequestContext: () => getRequestContext(),
}));

import { handleAiUsageRecord } from "./ai-usage-sink";

function baseRecord(overrides: Partial<AiUsageRecord> = {}): AiUsageRecord {
  return {
    model: "claude-sonnet-4-6",
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    costOwner: "msp",
    mspId: 42,
    nodeType: "generate_document",
    feature: "workflow:generate_document",
    attributed: true,
    ...overrides,
  };
}

describe("handleAiUsageRecord", () => {
  beforeEach(() => {
    recordAiUsage.mockClear();
    getRequestContext.mockReset();
    getRequestContext.mockReturnValue(undefined);
  });

  it("threads all artifact/customer/trigger fields through for a document-generating call", () => {
    handleAiUsageRecord(
      baseRecord({
        customerId: 501,
        generatedArtifactType: "sow",
        generatedArtifactName: "SOW - Acme Corp",
        generatedArtifactId: "9001",
        triggerSource: "document-engine",
      }),
    );

    expect(recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 501,
        generatedArtifactType: "sow",
        generatedArtifactName: "SOW - Acme Corp",
        generatedArtifactId: "9001",
        triggerSource: "document-engine",
      }),
    );
  });

  it("leaves customerId/artifact fields null for a platform-level call with no artifact — that is correct, not a gap", () => {
    handleAiUsageRecord(
      baseRecord({
        mspId: null,
        costOwner: "platform",
        nodeType: "generate_insight",
        feature: "campaign_brief",
        attributed: false,
        // No customerId/generatedArtifactType/... — genuinely platform-level.
      }),
    );

    expect(recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: null,
        generatedArtifactType: undefined,
        generatedArtifactName: undefined,
        generatedArtifactId: undefined,
        triggerSource: undefined,
      }),
    );
  });

  it("populates correlationId from request-context.ts's traceId when available", () => {
    getRequestContext.mockReturnValue({ traceId: "trace-abc-123" });

    handleAiUsageRecord(baseRecord());

    expect(recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: "trace-abc-123" }),
    );
  });

  it("leaves correlationId undefined when there is no active request-context", () => {
    getRequestContext.mockReturnValue(undefined);

    handleAiUsageRecord(baseRecord());

    expect(recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: undefined }),
    );
  });

  // Phase 5 (#53): the sink is also the channel by which a caller learns what
  // its call cost, so it must hand back what the ledger actually persisted.
  it("relays the persisted costCents so a capture scope can report it", async () => {
    recordAiUsage.mockResolvedValueOnce({ costCents: 734, eventId: "12" } as never);

    const persisted = await handleAiUsageRecord(baseRecord());

    expect(persisted).toEqual({ costCents: 734, eventId: "12" });
  });

  it("relays nothing when recording failed — unknown cost, not a zero one", async () => {
    // recordAiUsage swallows its own failures and returns null; reporting 0
    // here would tell the caller the call was free.
    recordAiUsage.mockResolvedValueOnce(null as never);

    const persisted = await handleAiUsageRecord(baseRecord());

    expect(persisted).toBeUndefined();
  });
});
