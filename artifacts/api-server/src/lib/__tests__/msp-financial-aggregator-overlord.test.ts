import { describe, it, expect, vi } from "vitest";
import {
  aggregatePlatformMonitoringMrr,
  calculateColonyCompositeScore,
} from "../msp-financial-aggregator.ts";
import { db } from "@workspace/db";

vi.mock("@workspace/db", () => {
  return {
    db: {
      select: vi.fn(),
    },
    mspSubscriptionsTable: {},
    invoicesTable: {},
    kanbanTasksTable: {},
    salesOffersTable: {},
    tenantSignalHistoryTable: {},
    servicesTable: {},
    projectsTable: {},
    mspUsersTable: {},
    workflowStepsTable: {},
    clientServicesTable: {},
    mspsTable: {},
  };
});

const createChain = (resolveValue: any) => {
  const chain = {
    from: vi.fn().mockImplementation(() => chain),
    innerJoin: vi.fn().mockImplementation(() => chain),
    leftJoin: vi.fn().mockImplementation(() => chain),
    where: vi.fn().mockImplementation(() => chain),
    groupBy: vi.fn().mockImplementation(() => chain),
    then: (resolve: any) => resolve(resolveValue),
  };
  return chain;
};

const emptyChain = () => createChain([]);

/** One aggregateMspTelemetry() invocation issues exactly 7 sequential db.select calls. */
function queueTelemetryRound(opts: {
  subs?: any[];
  invoices?: any[];
  tasks?: any[];
  offers?: any[];
  activeSignals?: any[];
  offerStats?: any[];
  openTasks?: any[];
}) {
  vi.mocked(db.select)
    .mockReturnValueOnce(createChain(opts.subs ?? []) as any)
    .mockReturnValueOnce(createChain(opts.invoices ?? []) as any)
    .mockReturnValueOnce(createChain(opts.tasks ?? []) as any)
    .mockReturnValueOnce(createChain(opts.offers ?? []) as any)
    .mockReturnValueOnce(createChain(opts.activeSignals ?? [{ count: 0 }]) as any)
    .mockReturnValueOnce(createChain(opts.offerStats ?? []) as any)
    .mockReturnValueOnce(createChain(opts.openTasks ?? [{ count: 0 }]) as any);
}

describe("aggregatePlatformMonitoringMrr", () => {
  it("sums monitoring MRR platform-wide with no mspId filter", async () => {
    const subsMock = [
      { priceCents: 10000, internalCostCents: 7000 }, // 100.00 retail / 70.00 wholesale
      { priceCents: 5000, internalCostCents: 3000 }, // 50.00 retail / 30.00 wholesale
    ];
    vi.mocked(db.select).mockReturnValueOnce(createChain(subsMock) as any);

    const result = await aggregatePlatformMonitoringMrr();

    expect(result).toEqual({
      grossRevenueUsd: "150.00",
      wholesaleCostUsd: "100.00",
      mspMarginUsd: "50.00",
      mspMarginPct: "33.3%",
    });
  });

  it("scopes to startDate exactly like aggregateMspTelemetry's Category A, proving the window is not a no-op", async () => {
    const allSubs = [
      { priceCents: 10000, internalCostCents: 7000 }, // created before startDate
      { priceCents: 5000, internalCostCents: 3000 }, // created on/after startDate
    ];
    const scopedSubs = [allSubs[1]];

    vi.mocked(db.select).mockReturnValueOnce(createChain(scopedSubs) as any);
    const scopedResult = await aggregatePlatformMonitoringMrr(new Date("2026-07-01"));
    expect(scopedResult).toEqual({
      grossRevenueUsd: "50.00",
      wholesaleCostUsd: "30.00",
      mspMarginUsd: "20.00",
      mspMarginPct: "40.0%",
    });

    vi.mocked(db.select).mockReturnValueOnce(createChain(allSubs) as any);
    const unscopedResult = await aggregatePlatformMonitoringMrr(undefined);
    expect(unscopedResult).toEqual({
      grossRevenueUsd: "150.00",
      wholesaleCostUsd: "100.00",
      mspMarginUsd: "50.00",
      mspMarginPct: "33.3%",
    });

    expect(scopedResult).not.toEqual(unscopedResult);
  });

  it("reconciles to the sum of per-MSP monitoringMrr — no mspId filter applied to the where clause", async () => {
    // Two MSPs' worth of active subscriptions returned in one unfiltered query,
    // proving the platform aggregator sums across MSPs rather than scoping to one.
    const mspASub = { priceCents: 10000, internalCostCents: 7000 }; // 100.00 / 70.00
    const mspBSub = { priceCents: 20000, internalCostCents: 14000 }; // 200.00 / 140.00

    vi.mocked(db.select).mockReturnValueOnce(createChain([mspASub, mspBSub]) as any);
    const platformTotal = await aggregatePlatformMonitoringMrr();

    expect(platformTotal.grossRevenueUsd).toBe("300.00");
    expect(platformTotal.wholesaleCostUsd).toBe("210.00");
  });
});

describe("calculateColonyCompositeScore", () => {
  it("computes the locked Factory Floor formula with no momentum bonus", async () => {
    // Lifetime round: monitoringMrr = 1000, projectRevenue = 500, remediation = 200, offer = 100
    queueTelemetryRound({
      subs: [{ priceCents: 100000, internalCostCents: 100000 }], // 1000.00 retail, 0 margin
      invoices: [{ amount: "500.00" }], // 500.00 retail (default wholesale split, doesn't matter for grossRevenueUsd)
      tasks: [{ priceCents: 20000, internalCostCents: 20000 }], // 200.00 retail
      offers: [{ adjustedPriceCents: 10000, internalCostCents: 10000 }], // 100.00 retail
    });
    // Current month round: total revenue = 100 (below trailing avg, no bonus)
    queueTelemetryRound({
      subs: [{ priceCents: 10000, internalCostCents: 10000 }], // 100.00 retail this month
    });
    // Trailing 3-month round: total revenue = 900 => avg = 300 (current month's 100 < 300)
    queueTelemetryRound({
      subs: [{ priceCents: 90000, internalCostCents: 90000 }], // 900.00 retail over trailing window
    });

    const result = await calculateColonyCompositeScore(42);

    // baseScore = 1000*1.0 + 500*0.6 + (200+100)*0.4 = 1000 + 300 + 120 = 1420
    expect(result.momentumBonusApplied).toBe(false);
    expect(result.score).toBeCloseTo(1420, 5);
    expect(result.currentMonthRevenueUsd).toBeCloseTo(100, 5);
    expect(result.trailingThreeMonthAvgRevenueUsd).toBeCloseTo(300, 5);
  });

  it("applies the +10% momentum bonus when current month revenue exceeds the trailing 3-month average", async () => {
    // Lifetime round: monitoringMrr = 1000, everything else 0
    queueTelemetryRound({
      subs: [{ priceCents: 100000, internalCostCents: 100000 }], // 1000.00 retail
    });
    // Current month round: total revenue = 500 (exceeds trailing avg of 100)
    queueTelemetryRound({
      subs: [{ priceCents: 50000, internalCostCents: 50000 }], // 500.00 retail this month
    });
    // Trailing 3-month round: total revenue = 300 => avg = 100
    queueTelemetryRound({
      subs: [{ priceCents: 30000, internalCostCents: 30000 }], // 300.00 retail over trailing window
    });

    const result = await calculateColonyCompositeScore(42);

    // baseScore = 1000*1.0 = 1000; momentum bonus applies => 1000 * 1.1 = 1100
    expect(result.momentumBonusApplied).toBe(true);
    expect(result.score).toBeCloseTo(1100, 5);
  });
});
