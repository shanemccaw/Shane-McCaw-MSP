/**
 * partner-qbr-generator.test.ts
 *
 * Unit tests for the Partner QBR generator.
 *
 * Covers:
 *   - currentQuarterKey derives the calendar quarter
 *   - a `ready` cached row for the current quarter is returned WITHOUT any AI
 *     call (the cost-discipline cache) unless force is set
 *   - an empty book returns null (nothing to review), no AI call
 *   - the happy path streams Opus, extracts HTML, records usage, persists ready
 *
 * Run: pnpm --filter @workspace/api-server run test -- partner-qbr-generator
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  streamFinalMessage, streamFn, insertChain, updateChain, dbSelect,
  extractAiHtml, getPrompt, recordAiUsage, gatherExecutiveBook,
} = vi.hoisted(() => {
  const streamFinalMessage = vi.fn();
  const streamFn = vi.fn(() => ({ finalMessage: streamFinalMessage }));
  const insertChain: Record<string, ReturnType<typeof vi.fn>> = {};
  insertChain["values"] = vi.fn(() => insertChain);
  insertChain["onConflictDoUpdate"] = vi.fn(() => Promise.resolve());
  const updateChain: Record<string, ReturnType<typeof vi.fn>> = {};
  updateChain["set"] = vi.fn(() => updateChain);
  updateChain["where"] = vi.fn(() => Promise.resolve());
  return {
    streamFinalMessage, streamFn, insertChain, updateChain,
    dbSelect: vi.fn(),
    extractAiHtml: vi.fn(),
    getPrompt: vi.fn(async (_k: string, fallback: string) => fallback),
    recordAiUsage: vi.fn(),
    gatherExecutiveBook: vi.fn(),
  };
});

vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: { messages: { stream: streamFn } },
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: dbSelect,
    insert: vi.fn(() => insertChain),
    update: vi.fn(() => updateChain),
  },
  mspPartnerQbrsTable: { mspId: "mspId", quarterKey: "quarterKey" },
  mspsTable: { id: "id", name: "name" },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (c: unknown, v: unknown) => ({ eq: [c, v] }),
}));

vi.mock("./sow-pricing", () => ({ extractAiHtml }));
vi.mock("./prompt-loader", () => ({ getPrompt }));
vi.mock("./ai-billing", () => ({ recordAiUsage }));
vi.mock("./msp-executive-data.ts", () => ({ gatherExecutiveBook }));

vi.mock("./logger", () => {
  const stub = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});

import { currentQuarterKey, getOrGeneratePartnerQbr, getCurrentPartnerQbr } from "./partner-qbr-generator.ts";

function selectReturning(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "limit"]) chain[m] = vi.fn(() => chain);
  chain["then"] = (res: (v: unknown) => void, rej: (e: unknown) => void) => Promise.resolve(rows).then(res, rej);
  return chain;
}

const MSP_ID = 900;

const nonEmptyBook = {
  mspId: MSP_ID,
  customerCount: 2,
  topRisks: [{ customerId: 1, name: "Acme", healthScore: 70, goodnessPercent: 30, capturedAt: null }],
  topOpportunities: [{ customerId: 2, name: "Beta", openOfferCount: 1, totalValueCents: 100000, topOfferTitle: "SIEM", topScore: 90 }],
  rollup: { avgGoodnessPercent: 58, atRiskCount: 1, totalOpenOpportunityCents: 100000, openOfferCount: 1 },
};

beforeEach(() => {
  streamFinalMessage.mockReset();
  streamFn.mockClear();
  dbSelect.mockReset();
  extractAiHtml.mockReset();
  recordAiUsage.mockReset();
  gatherExecutiveBook.mockReset();
  insertChain.values.mockClear();
  insertChain.onConflictDoUpdate.mockClear();
  updateChain.set.mockClear();
  updateChain.where.mockClear();
});

describe("currentQuarterKey", () => {
  it("maps a date to its calendar quarter", () => {
    expect(currentQuarterKey(new Date("2026-07-20T00:00:00Z"))).toBe("2026-Q3");
    expect(currentQuarterKey(new Date("2026-01-01T00:00:00Z"))).toBe("2026-Q1");
    expect(currentQuarterKey(new Date("2026-12-31T00:00:00Z"))).toBe("2026-Q4");
  });
});

describe("getCurrentPartnerQbr", () => {
  it("returns the cached row for the current quarter, or null", async () => {
    dbSelect.mockReturnValueOnce(selectReturning([{
      status: "ready", quarterKey: "2026-Q3", title: "t", htmlContent: "<h1>x</h1>",
      model: "claude-opus-4-8", generatedAt: new Date("2026-07-20T00:00:00Z"), errorMessage: null,
    }]));
    const res = await getCurrentPartnerQbr(MSP_ID, new Date("2026-07-20T00:00:00Z"));
    expect(res?.status).toBe("ready");
    expect(res?.htmlContent).toBe("<h1>x</h1>");
  });
});

describe("getOrGeneratePartnerQbr", () => {
  it("returns a cached ready QBR WITHOUT any AI call when not forced", async () => {
    dbSelect.mockReturnValueOnce(selectReturning([{
      status: "ready", quarterKey: "2026-Q3", title: "t", htmlContent: "<h1>cached</h1>",
      model: "claude-opus-4-8", generatedAt: new Date("2026-07-20T00:00:00Z"), errorMessage: null,
    }]));

    const res = await getOrGeneratePartnerQbr(MSP_ID, {}, new Date("2026-07-20T00:00:00Z"));

    expect(res?.status).toBe("ready");
    expect(res?.htmlContent).toBe("<h1>cached</h1>");
    expect(streamFn).not.toHaveBeenCalled();
    expect(gatherExecutiveBook).not.toHaveBeenCalled();
  });

  it("returns null (no AI call) when the book is empty", async () => {
    dbSelect.mockReturnValueOnce(selectReturning([])); // no cached row
    gatherExecutiveBook.mockResolvedValueOnce({ ...nonEmptyBook, customerCount: 0, topRisks: [], topOpportunities: [] });

    const res = await getOrGeneratePartnerQbr(MSP_ID, {}, new Date("2026-07-20T00:00:00Z"));

    expect(res).toBeNull();
    expect(streamFn).not.toHaveBeenCalled();
  });

  it("streams Opus, extracts HTML, records usage and persists ready", async () => {
    dbSelect
      .mockReturnValueOnce(selectReturning([])) // loadCurrentQbrRow — none cached
      .mockReturnValueOnce(selectReturning([{ name: "Acme MSP" }])); // msp name
    gatherExecutiveBook.mockResolvedValueOnce(nonEmptyBook);
    streamFinalMessage.mockResolvedValueOnce({
      stop_reason: "end_turn",
      usage: { input_tokens: 1200, output_tokens: 900 },
      model: "claude-opus-4-8",
      content: [{ type: "text", text: "<h1>QBR</h1>" }],
    });
    extractAiHtml.mockReturnValueOnce("<h1>QBR</h1>");

    const res = await getOrGeneratePartnerQbr(MSP_ID, { force: true }, new Date("2026-07-20T00:00:00Z"));

    expect(streamFn).toHaveBeenCalledTimes(1);
    expect((streamFn.mock.lastCall as unknown[] | undefined)?.[0]).toMatchObject({ model: "claude-opus-4-8" });
    expect(res?.status).toBe("ready");
    expect(res?.htmlContent).toBe("<h1>QBR</h1>");
    expect(res?.quarterKey).toBe("2026-Q3");
    // Claimed the row as generating, then persisted ready.
    expect(insertChain.onConflictDoUpdate).toHaveBeenCalledTimes(1);
    expect(updateChain.set).toHaveBeenCalledTimes(1);
    // Cost telemetry recorded, owned by the MSP.
    expect(recordAiUsage).toHaveBeenCalledWith(expect.objectContaining({
      mspId: MSP_ID, nodeType: "partner_qbr", costOwner: "msp",
    }));
  });
});
