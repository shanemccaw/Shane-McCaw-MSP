/**
 * ai-billing-cost-broadcast.test.ts
 *
 * AI Cost Governance Phase 3 (#51): recordAiUsage() pushes a per-call DELTA
 * onto the "ai-cost" SSE hub channel so the admin StatusBar's Today/Month
 * segments move within one frame of a real AI call.
 *
 * The point of this file is that the broadcast is a *thin, passive* addition.
 * It must not alter recordAiUsage()'s existing behaviour in any way, so the
 * load-bearing assertions are the negative ones:
 *   - a broadcast that THROWS must not skip the MSP ledger debit and must not
 *     make recordAiUsage reject (usage recording is documented non-fatal);
 *   - a failed INSERT must not broadcast a cost that was never recorded;
 *   - the frame carries a delta, never a running total.
 *
 * Kept in its own file rather than folded into ai-billing.test.ts, which mocks
 * @workspace/db as a bare object and exercises only the pure helpers — this
 * needs a chainable insert/select mock that would change that file's baseline.
 *
 * Run with: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── DB mock ───────────────────────────────────────────────────────────────────

interface InsertCall { table: string; values: Record<string, unknown> }

let insertCalls: InsertCall[] = [];
let usageReturning: unknown[] = [];
let insertShouldThrow = false;
let balanceRows: unknown[] = [];

vi.mock("@workspace/db", () => {
  const aiUsageEventsTable = { __name: "ai_usage_events", eventId: "event_id", occurredAt: "occurred_at" };
  const aiBalanceLedgerTable = { __name: "ai_balance_ledger", mspId: "msp_id", amountCents: "amount_cents", txnType: "txn_type", periodKey: "period_key", createdAt: "created_at" };

  return {
    db: {
      insert: vi.fn((table: { __name?: string }) => ({
        values: vi.fn((values: Record<string, unknown>) => {
          insertCalls.push({ table: table.__name ?? "?", values });
          if (insertShouldThrow && table.__name === "ai_usage_events") {
            throw new Error("insert failed");
          }
          return {
            returning: vi.fn(() => Promise.resolve(usageReturning)),
            then: (resolve: (v: unknown) => unknown) => resolve(undefined),
          };
        }),
      })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(balanceRows)),
        })),
      })),
    },
    aiUsageEventsTable,
    aiBalanceLedgerTable,
    mspAiPurchasesTable: { __name: "msp_ai_purchases" },
    mspSubscriptionsTable: { __name: "msp_subscriptions" },
    servicesTable: { __name: "services" },
  };
});

const broadcastToHubWithReplay = vi.fn();
vi.mock("./sse-hub.ts", () => ({
  broadcastToHubWithReplay: (...args: unknown[]) => broadcastToHubWithReplay(...args),
}));

const logWarn = vi.fn();
vi.mock("./logger", () => {
  const stub = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: (...a: unknown[]) => logWarn(...a) };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});

import { recordAiUsage, AI_COST_SSE_CHANNEL } from "./ai-billing.ts";

const OCCURRED_AT = new Date("2026-07-28T12:34:56.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  insertCalls = [];
  insertShouldThrow = false;
  balanceRows = [{ total: "5000" }];
  usageReturning = [{ eventId: "event-uuid-1", occurredAt: OCCURRED_AT }];
});

/** The single broadcast payload, for assertion convenience. */
function lastFrame(): Record<string, unknown> {
  expect(broadcastToHubWithReplay).toHaveBeenCalledTimes(1);
  return broadcastToHubWithReplay.mock.calls[0]![2] as Record<string, unknown>;
}

describe("recordAiUsage → ai-cost SSE broadcast", () => {
  it("broadcasts one delta frame on the ai-cost channel with a null scope", async () => {
    await recordAiUsage({
      mspId: 42,
      nodeType: "generate_document",
      feature: "workflow:generate_document",
      costCents: 134,
      costOwner: "msp",
      customerId: 501,
      model: "claude-sonnet-4-6",
      generatedArtifactType: "sow",
      generatedArtifactName: "SOW - Contoso",
    });

    expect(broadcastToHubWithReplay).toHaveBeenCalledTimes(1);
    const [channel, scope] = broadcastToHubWithReplay.mock.calls[0]!;
    expect(channel).toBe("ai-cost");
    expect(channel).toBe(AI_COST_SSE_CHANNEL);
    // Null scope: this is a platform-wide admin view, so the frame must reach
    // channel-firehose subscribers rather than being keyed to one MSP.
    expect(scope).toBeNull();
  });

  it("carries the cost of THIS call — a delta, never a running total", async () => {
    await recordAiUsage({ mspId: 42, nodeType: "chat_message", costCents: 7, costOwner: "msp" });
    const frame = lastFrame();
    expect(frame.costCents).toBe(7);
    // The MSP's balance in this test is 5000 cents; nothing balance-shaped may
    // leak into the frame or the client would double-count on every call.
    expect(Object.values(frame)).not.toContain(5000);
  });

  it("carries the attribution and artifact fields the popover renders", async () => {
    await recordAiUsage({
      mspId: 42,
      nodeType: "generate_document",
      feature: "workflow:generate_document",
      costCents: 134,
      costOwner: "msp",
      customerId: 501,
      model: "claude-sonnet-4-6",
      generatedArtifactType: "sow",
      generatedArtifactName: "SOW - Contoso",
    });

    expect(lastFrame()).toMatchObject({
      type: "ai-cost",
      eventId: "event-uuid-1",
      occurredAt: OCCURRED_AT.toISOString(),
      costCents: 134,
      costOwner: "msp",
      mspId: 42,
      customerId: 501,
      nodeType: "generate_document",
      feature: "workflow:generate_document",
      model: "claude-sonnet-4-6",
      generatedArtifactType: "sow",
      generatedArtifactName: "SOW - Contoso",
    });
  });

  it("uses the row's real occurredAt, not the moment of the broadcast", async () => {
    await recordAiUsage({ mspId: 1, nodeType: "chat_message", costCents: 1, costOwner: "msp" });
    expect(lastFrame().occurredAt).toBe(OCCURRED_AT.toISOString());
  });

  it("normalises absent attribution to null instead of dropping the keys", async () => {
    usageReturning = [{ eventId: "e2", occurredAt: OCCURRED_AT }];
    await recordAiUsage({ mspId: null, nodeType: "chat_message", costCents: 3, costOwner: "platform" });
    const frame = lastFrame();
    expect(frame.mspId).toBeNull();
    expect(frame.customerId).toBeNull();
    expect(frame.generatedArtifactType).toBeNull();
    // feature falls back to nodeType, matching what the row itself stores.
    expect(frame.feature).toBe("chat_message");
  });

  it("broadcasts platform-owned usage too (it never touches an MSP ledger)", async () => {
    await recordAiUsage({ mspId: null, nodeType: "chat_message", costCents: 9, costOwner: "platform" });
    expect(broadcastToHubWithReplay).toHaveBeenCalledTimes(1);
    // Platform-owned usage must not create a ledger debit...
    expect(insertCalls.filter((c) => c.table === "ai_balance_ledger")).toHaveLength(0);
    // ...but must still be visible in the platform-wide cost view.
    expect(lastFrame().costOwner).toBe("platform");
  });

  it("still broadcasts a zero-cost call so the ledger view stays complete", async () => {
    await recordAiUsage({ mspId: 42, nodeType: "chat_message", costCents: 0, costOwner: "msp" });
    expect(broadcastToHubWithReplay).toHaveBeenCalledTimes(1);
    expect(lastFrame().costCents).toBe(0);
  });
});

describe("recordAiUsage → broadcast must not change existing behaviour", () => {
  it("still debits the MSP ledger AFTER broadcasting", async () => {
    await recordAiUsage({ mspId: 42, nodeType: "generate_document", costCents: 134, costOwner: "msp" });

    const debit = insertCalls.find((c) => c.table === "ai_balance_ledger");
    expect(debit).toBeDefined();
    expect(debit!.values).toMatchObject({
      mspId: 42,
      txnType: "consumption",
      amountCents: -134,
      balanceAfterCents: 5000 - 134,
    });
  });

  it("a THROWING broadcast does not skip the ledger debit and does not reject", async () => {
    broadcastToHubWithReplay.mockImplementationOnce(() => {
      throw new Error("hub exploded");
    });

    // recordAiUsage resolves with the persisted row's costCents/eventId (never
    // undefined) since Jul 2026's "Document Engine cost return value" — the
    // broadcast throwing must not turn that into a rejection OR a null (null
    // means the USAGE ROW never landed, which isn't what happened here).
    await expect(
      recordAiUsage({ mspId: 42, nodeType: "generate_document", costCents: 134, costOwner: "msp" }),
    ).resolves.toEqual({ costCents: 134, eventId: "event-uuid-1" });

    // The whole reason the broadcast has its own try/catch: an unreachable
    // status bar must never cost an MSP its debit or look like a failed record.
    const debit = insertCalls.find((c) => c.table === "ai_balance_ledger");
    expect(debit).toBeDefined();
    expect(debit!.values).toMatchObject({ amountCents: -134 });
    expect(logWarn).toHaveBeenCalled();
  });

  it("does NOT broadcast when the usage insert itself fails", async () => {
    insertShouldThrow = true;

    // Null, not undefined: the usage row never landed, so the caller has no
    // real costCents to report (see recordAiUsage's own "null, not a cost"
    // doc comment) — recording remains non-fatal (never rejects) either way.
    await expect(
      recordAiUsage({ mspId: 42, nodeType: "generate_document", costCents: 134, costOwner: "msp" }),
    ).resolves.toBeNull();

    // Broadcasting a cost whose row never landed would put money on the status
    // bar that no ledger query can ever account for.
    expect(broadcastToHubWithReplay).not.toHaveBeenCalled();
    expect(insertCalls.filter((c) => c.table === "ai_balance_ledger")).toHaveLength(0);
  });

  it("still derives cost from tokens when costCents is omitted, and broadcasts that derived cost", async () => {
    await recordAiUsage({
      mspId: 42,
      nodeType: "chat_message",
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      costOwner: "msp",
      model: "claude-3-haiku-20240307",
    });

    // 25 cents input + 125 cents output = 150 — the frame and the row agree.
    expect(lastFrame().costCents).toBe(150);
    const usageRow = insertCalls.find((c) => c.table === "ai_usage_events");
    expect(usageRow!.values).toMatchObject({ costCents: 150 });
  });
});
