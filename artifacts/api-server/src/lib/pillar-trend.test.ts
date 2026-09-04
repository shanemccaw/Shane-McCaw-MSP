/**
 * pillar-trend.test.ts
 *
 * Unit tests for `getPillarScoreTrends()` — the #356 aggregation that walks a
 * tenant's real, insert-only `tenant_monitor_profiles` history and replays it
 * through the SAME per-check → pillar-impact resolution the live score already
 * uses (health-engine.ts / security-engine.ts / health-display.ts run for
 * real here, unmocked — only the DB layer and the rule/catalog fetches are
 * faked, mirroring pillar-coverage.test.ts's mocking boundary).
 *
 * Regression targets, each proven rather than asserted:
 *   1. A pillar with real, varying monitor history across enough days produces
 *      a real series that matches hand-computed expected scores exactly.
 *   2. A pillar with monitor history but NO evaluable rule stays null — never
 *      a fabricated flat line.
 *   3. Fewer than PILLAR_TREND_MIN_POINTS real checkpoints stays null even
 *      though every individual day is computable — two dots is not a trend.
 *   4. The pre-window seed state (the latest row per check strictly BEFORE the
 *      window) genuinely carries forward into in-window checkpoints, proven by
 *      a check that only has a SEED row (never touched again inside the
 *      window) still holding its fired state at every later checkpoint.
 *   5. No tenantId / no monitor history at all → every pillar null.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Same pattern as pillar-coverage.test.ts: keep the real schema exports (used
// as dispatch sentinels below) but stub DATABASE_URL before the real
// lib/db index.ts evaluates at module scope.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
});

vi.mock("./tenant-signals.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tenant-signals.ts")>();
  return { ...actual, getDisabledSignalKeys: vi.fn() };
});
vi.mock("./priority-engine.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./priority-engine.ts")>();
  return { ...actual, fetchSignalRulesAndGroups: vi.fn() };
});
// #413: the denominator this module applies to every checkpoint is now the
// TENANT-scoped one (`fetchTenantEvaluableSignalKeys`), not the catalog-wide
// `fetchEvaluableSignalKeys`. Same mocking boundary, same injected set — the
// tests below are unchanged in intent: they hand the replay a fixed denominator
// and assert the resulting series.
vi.mock("./pillar-coverage.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pillar-coverage.ts")>();
  return { ...actual, fetchTenantEvaluableSignalKeys: vi.fn() };
});
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: { select: vi.fn(), selectDistinctOn: vi.fn() } };
});

import {
  getPillarScoreTrends,
  PILLAR_TREND_MIN_POINTS,
  PILLAR_TREND_WINDOW_DAYS,
} from "./pillar-trend.ts";
import { RADAR_PILLARS, fetchTenantEvaluableSignalKeys } from "./pillar-coverage.ts";
import { getDisabledSignalKeys } from "./tenant-signals.ts";
import { fetchSignalRulesAndGroups } from "./priority-engine.ts";
import { db, tenantsTable, tenantMonitorProfilesTable } from "@workspace/db";
import type { SignalDerivationRule, SignalRuleGroup } from "./tenant-signals.ts";

const DEFAULT_INTELLIGENCE_FIELDS = {
  priority: 0,
  weight: 0,
  pricingImpact: 0,
  priorityScoreContribution: 0,
  pricingValueContribution: 0,
  governanceImpact: 0,
  securityImpact: 0,
  complianceImpact: 0,
  adoptionImpact: 0,
  copilotImpact: 0,
  architectureImpact: 0,
  licensingImpact: 0,
  trendValue: 0,
  trendDirection: "flat" as const,
  decayRate: 0,
  ttlDays: 0,
  confidence: 0,
  severity: "low" as const,
  category: "",
  pillar: "",
  crmFitContribution: 0,
  crmPainContribution: 0,
  crmMaturityContribution: 0,
  crmIntentContribution: 0,
  crmUrgencyContribution: 0,
};

const BASE_DATE = new Date("2024-01-01T00:00:00Z");

function makeRule(overrides: Partial<SignalDerivationRule> & Pick<SignalDerivationRule, "signalKey" | "ruleType" | "sourceKey">): SignalDerivationRule {
  return {
    id: 1,
    groupId: null,
    compareValue: null,
    denominatorKey: null,
    description: null,
    sortOrder: 0,
    createdAt: BASE_DATE,
    updatedAt: BASE_DATE,
    ...DEFAULT_INTELLIGENCE_FIELDS,
    ...overrides,
  };
}

interface RowInput {
  checkKey: string;
  itemCount: number;
  daysAgo: number;
}

function row(input: RowInput) {
  return {
    checkKey: input.checkKey,
    status: "ok",
    severityMatched: null,
    extractedProperties: { _itemCount: input.itemCount },
    collectedAt: new Date(Date.now() - input.daysAgo * 24 * 60 * 60 * 1000),
  };
}

/** Wires db.select / db.selectDistinctOn for one scenario. */
function wireDb(opts: { tenantId: string | null; seedRows?: ReturnType<typeof row>[]; windowRows?: ReturnType<typeof row>[] }) {
  vi.mocked(db.select).mockImplementation((() => ({
    from: (table: unknown) => {
      if (table === tenantsTable) {
        return { where: () => ({ limit: async () => (opts.tenantId == null ? [] : [{ tenantId: opts.tenantId }]) }) };
      }
      if (table === tenantMonitorProfilesTable) {
        return { where: () => ({ orderBy: async () => opts.windowRows ?? [] }) };
      }
      throw new Error("pillar-trend.test: unexpected table in db.select mock");
    },
  })) as unknown as typeof db.select);

  vi.mocked(db.selectDistinctOn).mockImplementation((() => ({
    from: () => ({ where: () => ({ orderBy: async () => opts.seedRows ?? [] }) }),
  })) as unknown as typeof db.selectDistinctOn);
}

function wireRules(rules: SignalDerivationRule[], groups: SignalRuleGroup[], evaluableSignalKeys: Set<string>) {
  vi.mocked(fetchSignalRulesAndGroups).mockResolvedValue({ rules, groups });
  vi.mocked(getDisabledSignalKeys).mockResolvedValue(new Set());
  vi.mocked(fetchTenantEvaluableSignalKeys).mockResolvedValue(evaluableSignalKeys);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getPillarScoreTrends", () => {
  it("returns every RADAR_PILLARS entry null when the customer has no tenantId", async () => {
    wireDb({ tenantId: null });
    wireRules([], [], new Set());
    const trends = await getPillarScoreTrends(1);
    expect([...trends.keys()].sort()).toEqual([...RADAR_PILLARS].sort());
    for (const pillar of RADAR_PILLARS) expect(trends.get(pillar)).toBeNull();
  });

  it("returns every pillar null when there is no monitor history in the window", async () => {
    wireDb({ tenantId: "tenant-1", windowRows: [] });
    wireRules([], [], new Set());
    const trends = await getPillarScoreTrends(1);
    for (const pillar of RADAR_PILLARS) expect(trends.get(pillar)).toBeNull();
  });

  it("produces a real per-day series for a pillar an evaluable rule feeds, matching hand-computed scores", async () => {
    // Two threshold rules, both firing when test:check-a's itemCount > 0, each
    // worth 10 licensingImpact. theoreticalMax = 20, so a fired day displays 0
    // and an unfired day displays 100 — computed by the REAL
    // computeHealthEngine/computePillarDisplayScore, not asserted by hand.
    //
    // TWO rather than one because of #517: a pillar backed by a single evaluable
    // signal is now withheld as `insufficient_data` at every checkpoint, which
    // would make this test measure the floor instead of the replay it is about.
    const rules = [
      makeRule({
        signalKey: "sig:test", ruleType: "threshold", sourceKey: "test:check-a",
        compareValue: "0", licensingImpact: 10,
      }),
      makeRule({
        signalKey: "sig:test-b", ruleType: "threshold", sourceKey: "test:check-a",
        compareValue: "0", licensingImpact: 10,
      }),
    ];
    wireRules(rules, [], new Set(["sig:test", "sig:test-b"]));

    const windowRows = [
      row({ checkKey: "test:check-a", itemCount: 0, daysAgo: 25 }), // no fire -> 100
      row({ checkKey: "test:check-a", itemCount: 5, daysAgo: 20 }), // fire -> 0
      row({ checkKey: "test:check-a", itemCount: 0, daysAgo: 15 }), // no fire -> 100
      row({ checkKey: "test:check-a", itemCount: 3, daysAgo: 10 }), // fire -> 0
      row({ checkKey: "test:check-a", itemCount: 0, daysAgo: 5 }),  // no fire -> 100
      row({ checkKey: "test:check-a", itemCount: 2, daysAgo: 1 }),  // fire -> 0
    ];
    wireDb({ tenantId: "tenant-1", windowRows });

    const trends = await getPillarScoreTrends(1);
    const licensing = trends.get("licensing");
    expect(licensing).not.toBeNull();
    expect(licensing!.map((p) => p.score)).toEqual([100, 0, 100, 0, 100, 0]);
    // Dates strictly ascending — one checkpoint per real day, in order.
    const dates = licensing!.map((p) => p.date);
    expect(dates).toEqual([...dates].sort());
    expect(new Set(dates).size).toBe(6);

    // A pillar no rule configures any impact for stays null, never a
    // fabricated flat line riding along on the same profile history.
    expect(trends.get("governance")).toBeNull();
  });

  it("stays null below PILLAR_TREND_MIN_POINTS even though every day is computable", async () => {
    // Two evaluable signals so the pillar clears #517's floor — otherwise this
    // test would pass for the wrong reason (insufficient coverage, not too few
    // checkpoints), which is exactly the vacuous green it exists to avoid.
    const rules = [
      makeRule({
        signalKey: "sig:test", ruleType: "threshold", sourceKey: "test:check-a",
        compareValue: "0", licensingImpact: 10,
      }),
      makeRule({
        signalKey: "sig:test-b", ruleType: "threshold", sourceKey: "test:check-a",
        compareValue: "0", licensingImpact: 10,
      }),
    ];
    wireRules(rules, [], new Set(["sig:test", "sig:test-b"]));

    expect(PILLAR_TREND_MIN_POINTS).toBeGreaterThan(3);
    const windowRows = [
      row({ checkKey: "test:check-a", itemCount: 0, daysAgo: 20 }),
      row({ checkKey: "test:check-a", itemCount: 5, daysAgo: 10 }),
      row({ checkKey: "test:check-a", itemCount: 0, daysAgo: 1 }),
    ];
    wireDb({ tenantId: "tenant-1", windowRows });

    const trends = await getPillarScoreTrends(1);
    expect(trends.get("licensing")).toBeNull();
  });

  it("carries the pre-window seed state forward into in-window checkpoints", async () => {
    // check-a only has a SEED row (fired, before the window) and is never
    // touched again inside the window; check-b fires the daily checkpoints.
    // If the seed did not carry forward, check-a would read as never-fired
    // (itemCount 0) and every checkpoint would show 100, not 0.
    // Two evaluable signals off the same seeded check (#517's floor); both carry
    // forward together, so raw 20 of theoreticalMax 20 still displays 0.
    const rules = [
      makeRule({
        signalKey: "sig:seeded", ruleType: "threshold", sourceKey: "test:check-a",
        compareValue: "0", licensingImpact: 10,
      }),
      makeRule({
        signalKey: "sig:seeded-b", ruleType: "threshold", sourceKey: "test:check-a",
        compareValue: "0", licensingImpact: 10,
      }),
    ];
    wireRules(rules, [], new Set(["sig:seeded", "sig:seeded-b"]));

    const seedRows = [row({ checkKey: "test:check-a", itemCount: 5, daysAgo: 40 })];
    const windowRows = [
      row({ checkKey: "test:check-b", itemCount: 1, daysAgo: 25 }),
      row({ checkKey: "test:check-b", itemCount: 1, daysAgo: 20 }),
      row({ checkKey: "test:check-b", itemCount: 1, daysAgo: 15 }),
      row({ checkKey: "test:check-b", itemCount: 1, daysAgo: 10 }),
      row({ checkKey: "test:check-b", itemCount: 1, daysAgo: 5 }),
    ];
    wireDb({ tenantId: "tenant-1", seedRows, windowRows });

    const trends = await getPillarScoreTrends(1);
    const licensing = trends.get("licensing");
    expect(licensing).not.toBeNull();
    expect(licensing!.map((p) => p.score)).toEqual([0, 0, 0, 0, 0]);
  });

  it("resolves ONE denominator for the whole window, from the union of everything that ever fired (#413)", async () => {
    // Two checks that fire on DIFFERENT days. If the denominator were resolved
    // per checkpoint, the two points would be scored against different
    // theoreticalMax values and the series would not be comparable; if the
    // fired-signal union were taken from a single checkpoint, whichever signal
    // did not fire that day would be missing from the denominator and its day
    // could exceed it. Both are pinned by asserting a SINGLE resolution call
    // carrying BOTH signal keys.
    const rules = [
      makeRule({ id: 1, signalKey: "sig:early", ruleType: "threshold", sourceKey: "test:check-a", compareValue: "0", licensingImpact: 10 }),
      makeRule({ id: 2, signalKey: "sig:late", ruleType: "threshold", sourceKey: "test:check-b", compareValue: "0", licensingImpact: 10 }),
    ];
    wireRules(rules, [], new Set(["sig:early", "sig:late"]));

    const windowRows = [
      row({ checkKey: "test:check-a", itemCount: 1, daysAgo: 25 }), // sig:early fires, sig:late has not yet
      row({ checkKey: "test:check-b", itemCount: 0, daysAgo: 20 }),
      row({ checkKey: "test:check-b", itemCount: 0, daysAgo: 15 }),
      row({ checkKey: "test:check-b", itemCount: 0, daysAgo: 10 }),
      row({ checkKey: "test:check-b", itemCount: 1, daysAgo: 5 }),  // sig:late fires only here
    ];
    wireDb({ tenantId: "tenant-1", windowRows });

    await getPillarScoreTrends(1);

    expect(vi.mocked(fetchTenantEvaluableSignalKeys)).toHaveBeenCalledTimes(1);
    const [customerId, passedRules, opts] = vi.mocked(fetchTenantEvaluableSignalKeys).mock.calls[0]!;
    expect(customerId).toBe(1);
    expect(passedRules).toBe(rules);
    const fired = new Set(opts?.firedSignalKeys ?? []);
    expect(fired.has("sig:early")).toBe(true);
    expect(fired.has("sig:late")).toBe(true);
  });

  it("labels the series with the real window length", async () => {
    const rule = makeRule({
      signalKey: "sig:test", ruleType: "threshold", sourceKey: "test:check-a",
      compareValue: "0", licensingImpact: 10,
    });
    wireRules([rule], [], new Set(["sig:test"]));
    const windowRows = Array.from({ length: 5 }, (_, i) =>
      row({ checkKey: "test:check-a", itemCount: i, daysAgo: 25 - i * 5 }),
    );
    wireDb({ tenantId: "tenant-1", windowRows });

    await getPillarScoreTrends(1);
    // PILLAR_TREND_WINDOW_DAYS is what the caller (pillar-summary-stats.ts)
    // labels the wire payload's `window` field with — pin it so a change here
    // is a deliberate edit, not a silent drift between the two files.
    expect(PILLAR_TREND_WINDOW_DAYS).toBe(30);
  });
});
