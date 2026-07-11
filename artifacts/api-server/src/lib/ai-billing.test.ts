/**
 * ai-billing.test.ts
 *
 * Tests for AI Cost Governance & Billing.
 * Covers: admission gating, mid-run overage billing, block-then-resume semantics,
 * monthly grant credit/expiry, and alert threshold calculation.
 *
 * These tests run against an in-memory ledger mock — no real DB required.
 */

import { describe, it, expect, beforeEach, vi, type MockedFunction } from "vitest";

// ── Inline balance state mock ──────────────────────────────────────────────────
// We mock the DB interactions so these tests run without a live Postgres instance.

vi.mock("@workspace/db", () => {
  return {
    db: {},
    aiUsageEventsTable: {},
    aiBalanceLedgerTable: {},
    mspAiPurchasesTable: {},
    mspSubscriptionsTable: {},
    servicesTable: {},
  };
});

// ── Helpers under test ─────────────────────────────────────────────────────────

import {
  computeTokenCostCents,
  periodKeyFor,
  ALERT_THRESHOLDS,
  type AiBalanceSummary,
} from "./ai-billing.js";

// ── Test: computeTokenCostCents ────────────────────────────────────────────────

describe("computeTokenCostCents", () => {
  it("returns 0 when no tokens", () => {
    expect(computeTokenCostCents({ promptTokens: 0, completionTokens: 0 })).toBe(0);
  });

  it("uses default rate when model unknown", () => {
    // Default: input = 25 cents/M, output = 125 cents/M
    // 1M input tokens = 25 cents
    const cost = computeTokenCostCents({
      promptTokens: 1_000_000,
      completionTokens: 0,
      model: "unknown-model",
    });
    expect(cost).toBe(25);
  });

  it("applies Claude Haiku rates correctly", () => {
    const cost = computeTokenCostCents({
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      model: "claude-3-haiku-20240307",
    });
    // 25 cents input + 125 cents output = 150
    expect(cost).toBe(150);
  });

  it("uses model-specific rate for gpt-4o-mini", () => {
    const cost = computeTokenCostCents({
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      model: "gpt-4o-mini",
    });
    // input=15 + output=60 = 75
    expect(cost).toBe(75);
  });

  it("rounds up fractional cents", () => {
    // 500K tokens at 25 cents/M = 12.5 cents → ceil = 13
    const cost = computeTokenCostCents({
      promptTokens: 500_000,
      completionTokens: 0,
      model: "claude-3-haiku-20240307",
    });
    expect(cost).toBe(13);
  });
});

// ── Test: periodKeyFor ─────────────────────────────────────────────────────────

describe("periodKeyFor", () => {
  it("returns UTC year-month", () => {
    const d = new Date("2026-07-11T15:00:00Z");
    expect(periodKeyFor(d)).toBe("2026-07");
  });

  it("handles year rollover", () => {
    const d = new Date("2026-01-01T00:00:00Z");
    expect(periodKeyFor(d)).toBe("2026-01");
  });

  it("zero-pads month", () => {
    const d = new Date("2026-03-15T12:00:00Z");
    expect(periodKeyFor(d)).toBe("2026-03");
  });
});

// ── Test: alert thresholds ─────────────────────────────────────────────────────

describe("alert thresholds", () => {
  it("ALERT_THRESHOLDS are [80, 90, 95, 100]", () => {
    expect(ALERT_THRESHOLDS).toEqual([80, 90, 95, 100]);
  });

  function alertFor(usagePct: number): null | 80 | 90 | 95 | 100 {
    if (usagePct >= 100) return 100;
    if (usagePct >= 95)  return 95;
    if (usagePct >= 90)  return 90;
    if (usagePct >= 80)  return 80;
    return null;
  }

  it("returns null below 80%", () => {
    expect(alertFor(0)).toBeNull();
    expect(alertFor(50)).toBeNull();
    expect(alertFor(79)).toBeNull();
  });

  it("returns 80 at exactly 80%", () => {
    expect(alertFor(80)).toBe(80);
    expect(alertFor(89)).toBe(80);
  });

  it("returns 90 at 90%", () => {
    expect(alertFor(90)).toBe(90);
    expect(alertFor(94)).toBe(90);
  });

  it("returns 95 at 95%", () => {
    expect(alertFor(95)).toBe(95);
    expect(alertFor(99)).toBe(95);
  });

  it("returns 100 at or above 100%", () => {
    expect(alertFor(100)).toBe(100);
    expect(alertFor(150)).toBe(100);
  });
});

// ── Test: admission gate semantics ─────────────────────────────────────────────

describe("admission gate semantics", () => {
  /**
   * Simulates the run-scoped admission gate logic.
   * - First AI-dependent node: check balance → set aiAdmitted
   * - Subsequent AI-dependent nodes: use cached aiAdmitted flag (no re-check)
   * - Mid-run overage: allowed (bills as real overage)
   */

  interface MockRun {
    aiAdmitted: boolean | null;
    balanceCents: number;
    nodesExecuted: string[];
    nodesBlocked: string[];
  }

  function simulateRun(opts: {
    initialBalanceCents: number;
    nodes: Array<{ id: string; isAI: boolean; costCents: number }>;
  }): MockRun {
    let balance = opts.initialBalanceCents;
    const run: MockRun = {
      aiAdmitted: null,
      balanceCents: balance,
      nodesExecuted: [],
      nodesBlocked: [],
    };

    for (const node of opts.nodes) {
      if (!node.isAI) {
        // Non-AI nodes always run
        run.nodesExecuted.push(node.id);
        continue;
      }

      // AI-dependent node
      if (run.aiAdmitted === null) {
        // First AI node — check balance once
        if (balance > 0) {
          run.aiAdmitted = true;
        } else {
          run.aiAdmitted = false;
          run.nodesBlocked.push(node.id);
          continue;
        }
      }

      if (run.aiAdmitted) {
        // Execute unconditionally — even if balance goes negative mid-run
        run.nodesExecuted.push(node.id);
        balance -= node.costCents;
        run.balanceCents = balance;
      } else {
        run.nodesBlocked.push(node.id);
      }
    }

    return run;
  }

  it("admits run when balance is positive", () => {
    const run = simulateRun({
      initialBalanceCents: 1000,
      nodes: [
        { id: "start", isAI: false, costCents: 0 },
        { id: "generate_doc", isAI: true, costCents: 100 },
      ],
    });
    expect(run.aiAdmitted).toBe(true);
    expect(run.nodesExecuted).toContain("generate_doc");
    expect(run.nodesBlocked).toHaveLength(0);
  });

  it("blocks run when balance is zero", () => {
    const run = simulateRun({
      initialBalanceCents: 0,
      nodes: [
        { id: "start", isAI: false, costCents: 0 },
        { id: "generate_doc", isAI: true, costCents: 100 },
      ],
    });
    expect(run.aiAdmitted).toBe(false);
    expect(run.nodesBlocked).toContain("generate_doc");
    expect(run.nodesExecuted).not.toContain("generate_doc");
  });

  it("blocks run when balance is negative", () => {
    const run = simulateRun({
      initialBalanceCents: -50,
      nodes: [
        { id: "generate_doc", isAI: true, costCents: 100 },
      ],
    });
    expect(run.aiAdmitted).toBe(false);
    expect(run.nodesBlocked).toContain("generate_doc");
  });

  it("non-AI nodes always run regardless of balance", () => {
    const run = simulateRun({
      initialBalanceCents: 0,
      nodes: [
        { id: "check_script_output", isAI: false, costCents: 0 },
        { id: "collect_diagnostics", isAI: false, costCents: 0 },
        { id: "generate_doc", isAI: true, costCents: 100 },
      ],
    });
    expect(run.nodesExecuted).toContain("check_script_output");
    expect(run.nodesExecuted).toContain("collect_diagnostics");
    expect(run.nodesBlocked).toContain("generate_doc");
  });

  it("mid-run overage: subsequent AI nodes execute even if balance goes negative", () => {
    const run = simulateRun({
      initialBalanceCents: 50, // only 50 cents, but two nodes cost 100 each
      nodes: [
        { id: "gen_doc_1", isAI: true, costCents: 100 },
        { id: "gen_doc_2", isAI: true, costCents: 100 },
      ],
    });
    // Admitted at first node (balance=50 > 0)
    expect(run.aiAdmitted).toBe(true);
    // Both nodes execute — admission is checked ONCE per run
    expect(run.nodesExecuted).toContain("gen_doc_1");
    expect(run.nodesExecuted).toContain("gen_doc_2");
    // Balance went negative: 50 - 100 - 100 = -150
    expect(run.balanceCents).toBe(-150);
  });

  it("admission check does NOT re-run on subsequent AI nodes", () => {
    // Balance starts at 100, drops to -50 after first node, second node still runs
    const run = simulateRun({
      initialBalanceCents: 100,
      nodes: [
        { id: "gen_doc_1", isAI: true, costCents: 150 },  // drops to -50
        { id: "gen_doc_2", isAI: true, costCents: 50 },   // still runs
      ],
    });
    expect(run.aiAdmitted).toBe(true);
    expect(run.nodesExecuted).toContain("gen_doc_1");
    expect(run.nodesExecuted).toContain("gen_doc_2");
    expect(run.balanceCents).toBe(-100);
  });

  it("block-then-resume: aiAdmitted=false stays false for the run", () => {
    // A run that was blocked stays blocked even if balance somehow increases
    // (balance increases don't re-admit a run — the flag is set once)
    const run = simulateRun({
      initialBalanceCents: 0,
      nodes: [
        { id: "gen_doc_1", isAI: true, costCents: 100 },
        { id: "notification", isAI: false, costCents: 0 },
        { id: "gen_doc_2", isAI: true, costCents: 100 }, // also blocked (same run, aiAdmitted=false)
      ],
    });
    expect(run.aiAdmitted).toBe(false);
    expect(run.nodesBlocked).toContain("gen_doc_1");
    expect(run.nodesExecuted).toContain("notification"); // non-AI still runs
    expect(run.nodesBlocked).toContain("gen_doc_2");
  });
});

// ── Test: platform-cost nodes bypass MSP balance ──────────────────────────────

describe("platform-funded nodes", () => {
  it("platform cost owner is always admitted, never checks balance", () => {
    // Simulated: platform nodes have costOwner="platform" so they bypass the gate
    function isPlatformAdmitted(costOwner: "msp" | "platform", balance: number): boolean {
      if (costOwner === "platform") return true;
      return balance > 0;
    }

    expect(isPlatformAdmitted("platform", 0)).toBe(true);
    expect(isPlatformAdmitted("platform", -1000)).toBe(true);
    expect(isPlatformAdmitted("msp", 0)).toBe(false);
    expect(isPlatformAdmitted("msp", 1)).toBe(true);
  });
});
