/**
 * cio-narrative-generator.test.ts
 *
 * #149: the real Anthropic call inside generateCioNarrative() was unwrapped by
 * withAiAttribution, so every assessment-run narrative wrote an unattributed
 * ai_usage_events row (attributed:false, customerId null) — invisible to
 * cost-per-assessment-run (#81). This drives the real function through the
 * real metering module (only the DB and sibling lib modules are stubbed) and
 * asserts the persisted record carries the tenant's real mspId/customerId.
 *
 * Run: pnpm --filter @workspace/api-server run test -- cio-narrative-generator
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  registerAiUsageSink,
  resetAiUsageBuffer,
  type AiUsagePersistResult,
  type AiUsageRecord,
} from "@workspace/integrations-anthropic-ai/metering";

let selectQueue: unknown[][] = [];
let anthropicCalls: unknown[] = [];
let updateSets: Record<string, unknown>[] = [];

function chainStub(rows: unknown[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    from: () => obj,
    where: () => obj,
    limit: () => obj,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return obj;
}

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => ({ type: "eq", args }),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => chainStub(selectQueue.shift() ?? []),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updateSets.push(values);
        return { where: async () => undefined };
      },
    }),
  },
  mspDiagnosticRunsTable: { runId: "runId", cioNarrativeStatus: "cioNarrativeStatus" },
  tenantsTable: { id: "id", customerName: "customerName", mspId: "mspId" },
  industryBenchmarkReferenceTable: {},
}));

// The genuine metering module, wrapping a fake SDK — so the record the test
// asserts on is what the real capture path produced, not a stub that could
// agree with the call site while both are wrong.
vi.mock("@workspace/integrations-anthropic-ai", async () => {
  const metering = await import("@workspace/integrations-anthropic-ai/metering");
  return {
    withAiAttribution: metering.withAiAttribution,
    anthropic: metering.meterAnthropicClient({
      messages: {
        create: (async (params: unknown) => {
          anthropicCalls.push(params);
          return {
            model: "claude-sonnet-4-6",
            content: [{ type: "text", text: "<h3>Headline</h3><p>Body</p>" }],
            usage: { input_tokens: 500, output_tokens: 300 },
          };
        }) as never,
        stream: (() => {
          throw new Error("stream not used by cio-narrative-generator");
        }) as never,
      },
    }),
  };
});

vi.mock("./health-engine", () => ({
  calculateArchitectureHealthScore: async () => {
    throw new Error("no health data in this test");
  },
}));
vi.mock("./health-display", () => ({ computeDisplayHealth: () => [] }));
vi.mock("./pillar-coverage", () => ({ fetchEvaluableSignalKeys: async () => new Set() }));
vi.mock("./priority-engine", () => ({
  fetchSignalRulesAndGroups: async () => ({ rules: [], groups: [] }),
}));
vi.mock("./license-waste-source", () => ({ resolveLicenseWasteCounts: async () => null }));
vi.mock("./cost-engine", () => ({
  computeSkuCostBreakdown: async () => ({ totalMonthlyCents: 0, totalAnnualCents: 0 }),
  centsToDollars: (cents: number) => cents / 100,
}));
vi.mock("./prompt-loader", () => ({
  getPrompt: async (_key: string, fallback: string) => fallback,
}));
vi.mock("./logger", () => {
  const stub = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});

import { generateCioNarrative } from "./cio-narrative-generator.ts";

const PARAMS = {
  runId: "run-abc",
  customerId: 42,
  tenantId: "tenant-guid-1",
  findings: [],
};

function queueHappyPath(): void {
  selectQueue = [
    [{ status: "not_started" }],       // idempotency check
    [{ name: "Acme Co", mspId: 7 }],   // tenantsTable customer/msp lookup
    [],                                 // industryBenchmarkReferenceTable
  ];
}

beforeEach(() => {
  anthropicCalls = [];
  updateSets = [];
  resetAiUsageBuffer();
  queueHappyPath();
});

afterEach(() => {
  registerAiUsageSink(null);
  resetAiUsageBuffer();
});

describe("generateCioNarrative() — AI usage attribution (#149)", () => {
  it("attributes the model call to the tenant's real mspId and customerId, not unattributed", async () => {
    let record: AiUsageRecord | null = null;
    registerAiUsageSink((r): AiUsagePersistResult => {
      record = r;
      return { costCents: 42, eventId: "1" };
    });

    await generateCioNarrative(PARAMS);

    expect(anthropicCalls).toHaveLength(1);
    expect(record!.attributed).toBe(true);
    expect(record!.mspId).toBe(7);
    expect(record!.customerId).toBe(42);
    expect(record!.costOwner).toBe("msp");
    expect(record!.runId).toBe("run-abc");
    expect(updateSets.some((s) => s.cioNarrativeStatus === "ready")).toBe(true);
  });

  it("never runs unattributed when the tenant row resolves an mspId", async () => {
    let record: AiUsageRecord | null = null;
    registerAiUsageSink((r): AiUsagePersistResult => {
      record = r;
      return { costCents: 1, eventId: "1" };
    });

    await generateCioNarrative(PARAMS);

    // Prior to the #149 fix this was false and customerId was undefined —
    // the exact gap that made assessment-run spend invisible to the ledger.
    expect(record!.attributed).not.toBe(false);
    expect(record!.customerId).not.toBeUndefined();
  });
});
