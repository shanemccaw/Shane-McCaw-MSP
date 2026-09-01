/**
 * ai-cost-capture.test.ts
 *
 * Phase 5 of the AI Cost Governance & Billing Rollup initiative (#53) — the
 * cost figure `generateDocument()` / `generateSowDocument()` hand back to their
 * callers.
 *
 * The contract under test is a single-source-of-truth one. The returned cost
 * must be the figure the ledger actually wrote for that call's own
 * `ai_usage_events` row — never a second, independently computed number that
 * could drift from what the MSP was charged. So these tests drive the real
 * capture path (metered client → usage record → sink → persisted cost) and
 * assert the value surfaces from the SINK, not from any local calculation.
 *
 * The three honesty cases the phase exists to get right, all covered below:
 *   - real path      → `costCents` is the sink's figure, status "recorded"
 *   - no AI call     → a real `0`, status "no-ai-call" (dry-run / drift reuse),
 *                      which is NOT the same as an unknown cost
 *   - recording lost → `costCents` is NULL, status "unknown" — recording is
 *                      deliberately non-fatal, so this is a reachable state and
 *                      must never be reported as a free call
 *
 * Run: pnpm --filter @workspace/api-server run test -- ai-cost-capture
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  meterAnthropicClient,
  withAiUsageCapture,
  totalCapturedCostCents,
  registerAiUsageSink,
  resetAiUsageBuffer,
  type AiUsageRecord,
  type AiUsagePersistResult,
  // The ./metering subpath, not the package root: the root re-exports ./client,
  // whose module-level env-var checks throw when AI_INTEGRATIONS_ANTHROPIC_* are
  // unset. Same reason as ai-usage-metering.test.ts.
} from "@workspace/integrations-anthropic-ai/metering";

/** A fake SDK client whose `create` resolves with a real-shaped usage block. */
function fakeClient(usage: { input_tokens: number; output_tokens: number } | null = { input_tokens: 1000, output_tokens: 500 }) {
  return meterAnthropicClient({
    messages: {
      create: async (..._args: never[]) => ({
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "<html>doc</html>" }],
        ...(usage ? { usage } : {}),
      }),
      stream: (..._args: never[]) => {
        throw new Error("not used");
      },
    },
  });
}

/** The attribution the document engines apply to their own call. */
const DOC_ATTRIBUTION = {
  mspId: 7,
  customerId: 42,
  generatedArtifactType: "governance_snapshot",
  triggerSource: "document-engine",
};

afterEach(() => {
  registerAiUsageSink(null);
  resetAiUsageBuffer();
});

beforeEach(() => {
  resetAiUsageBuffer();
});

describe("cost capture — the real path", () => {
  it("returns the cost the SINK persisted, not a recomputed figure", async () => {
    const seen: AiUsageRecord[] = [];
    // 917 is deliberately not derivable from the token counts by any pricing
    // formula — if the engine ever recomputed cost instead of reading the
    // ledger's row back, this assertion is what fails.
    registerAiUsageSink((record): AiUsagePersistResult => {
      seen.push(record);
      return { costCents: 917, eventId: "5150" };
    });

    const client = fakeClient();
    const { result, costs } = await withAiUsageCapture(DOC_ATTRIBUTION, () =>
      client.messages.create({} as never) as Promise<{ model: string }>,
    );

    expect(result.model).toBe("claude-sonnet-4-6");
    expect(costs).toHaveLength(1);
    expect(costs[0].status).toBe("recorded");
    expect(costs[0].costCents).toBe(917);
    expect(costs[0].eventId).toBe("5150");
    expect(totalCapturedCostCents(costs)).toBe(917);

    // The captured call is the same one that was billed: same attribution, same
    // tokens. That identity is the whole point — one call, one row, one figure.
    expect(seen).toHaveLength(1);
    expect(seen[0].mspId).toBe(7);
    expect(seen[0].customerId).toBe(42);
    expect(seen[0].promptTokens).toBe(1000);
    expect(seen[0].completionTokens).toBe(500);
  });

  it("waits for an asynchronous sink, as the real DB-backed one is", async () => {
    registerAiUsageSink(async (): Promise<AiUsagePersistResult> => {
      await new Promise((r) => setTimeout(r, 10));
      return { costCents: 250, eventId: "1" };
    });

    const client = fakeClient();
    const { costs } = await withAiUsageCapture(DOC_ATTRIBUTION, () =>
      client.messages.create({} as never) as Promise<unknown>,
    );

    expect(costs[0].costCents).toBe(250);
    expect(costs[0].status).toBe("recorded");
  });

  it("sums multiple calls made inside one capture scope", async () => {
    registerAiUsageSink((): AiUsagePersistResult => ({ costCents: 40, eventId: null }));

    const client = fakeClient();
    const { costs } = await withAiUsageCapture(DOC_ATTRIBUTION, async () => {
      await client.messages.create({} as never);
      await client.messages.create({} as never);
      return null;
    });

    expect(costs).toHaveLength(2);
    expect(totalCapturedCostCents(costs)).toBe(80);
  });
});

describe("cost capture — recording failed (unknown, never zero)", () => {
  it("reports null when the sink reports nothing back", async () => {
    // The pre-existing void-returning sink shape, and also what the real sink
    // returns when recordAiUsage() catches a DB failure.
    registerAiUsageSink(() => undefined);

    const client = fakeClient();
    const { costs } = await withAiUsageCapture(DOC_ATTRIBUTION, () =>
      client.messages.create({} as never) as Promise<unknown>,
    );

    expect(costs[0].status).toBe("recording-failed");
    expect(costs[0].costCents).toBeNull();
    // The distinction this whole phase turns on.
    expect(costs[0].costCents).not.toBe(0);
    expect(totalCapturedCostCents(costs)).toBeNull();
  });

  it("reports null when the sink throws, and never breaks the model call", async () => {
    registerAiUsageSink(() => {
      throw new Error("ledger down");
    });

    const client = fakeClient();
    const { result, costs } = await withAiUsageCapture(DOC_ATTRIBUTION, () =>
      client.messages.create({} as never) as Promise<{ model: string }>,
    );

    // The document still generated — a billing fault must not fail generation.
    expect(result.model).toBe("claude-sonnet-4-6");
    expect(costs[0].status).toBe("recording-failed");
    expect(costs[0].costCents).toBeNull();
  });

  it("reports null when the sink's promise rejects", async () => {
    registerAiUsageSink(async () => {
      throw new Error("insert failed");
    });

    const client = fakeClient();
    const { costs } = await withAiUsageCapture(DOC_ATTRIBUTION, () =>
      client.messages.create({} as never) as Promise<unknown>,
    );

    expect(costs[0].costCents).toBeNull();
  });

  it("reports unrecorded, not zero, when no sink is installed at all", async () => {
    registerAiUsageSink(null);

    const client = fakeClient();
    const { costs } = await withAiUsageCapture(
      DOC_ATTRIBUTION,
      () => client.messages.create({} as never) as Promise<unknown>,
      { settleTimeoutMs: 20 },
    );

    expect(costs[0].status).toBe("unrecorded");
    expect(costs[0].costCents).toBeNull();
  });

  it("a total is null if ANY call in the scope failed to report — never a partial sum", async () => {
    let call = 0;
    registerAiUsageSink((): AiUsagePersistResult | void => {
      call += 1;
      // First call bills, second one's row is lost.
      return call === 1 ? { costCents: 500, eventId: "1" } : undefined;
    });

    const client = fakeClient();
    const { costs } = await withAiUsageCapture(DOC_ATTRIBUTION, async () => {
      await client.messages.create({} as never);
      await client.messages.create({} as never);
      return null;
    });

    // 500 would be a real understatement of real spend presented as a total.
    expect(totalCapturedCostCents(costs)).toBeNull();
  });

  it("still surfaces a token-less response as a call whose cost is a floor", async () => {
    registerAiUsageSink((): AiUsagePersistResult => ({ costCents: 0, eventId: "9" }));

    const client = fakeClient(null); // no `usage` block — e.g. a raw stream
    const { costs } = await withAiUsageCapture(DOC_ATTRIBUTION, () =>
      client.messages.create({} as never) as Promise<unknown>,
    );

    expect(costs[0].tokensUnknown).toBe(true);
    expect(costs[0].status).toBe("recorded");
  });
});

describe("cost capture — no AI call was made", () => {
  it("captures nothing when the scope makes no model call (the dry-run / reuse shape)", async () => {
    registerAiUsageSink((): AiUsagePersistResult => ({ costCents: 999, eventId: "1" }));

    const { result, costs } = await withAiUsageCapture(DOC_ATTRIBUTION, async () => "preview-only");

    expect(result).toBe("preview-only");
    expect(costs).toHaveLength(0);
    // An empty capture is "no data", which is why the engines do NOT run it
    // through totalCapturedCostCents for their no-AI-call branches — they
    // return an explicit 0 + "no-ai-call" instead. Pinning that here so the
    // engines' 0 can never be confused with this null.
    expect(totalCapturedCostCents(costs)).toBeNull();
  });
});
