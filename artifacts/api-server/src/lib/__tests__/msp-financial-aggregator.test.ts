import { describe, it, expect, vi } from "vitest";
import { aggregateMspTelemetry } from "../msp-financial-aggregator.ts";
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

describe("aggregateMspTelemetry", () => {
  it("queries and aggregates telemetry correctly", async () => {
    const subsMock = [{ priceCents: 10000, internalCostCents: 7000 }]; // 100.00 retail, 70.00 wholesale
    const invoicesMock = [{ amount: "150.00" }]; // 150.00 retail, default 70% = 105.00 wholesale => 45.00 margin (30%)
    const tasksMock = [{ priceCents: 5000, internalCostCents: 3000 }]; // 50.00 retail, 30.00 wholesale => 20.00 margin (40%)
    const offersMock = [{ adjustedPriceCents: 30000, internalCostCents: 21000 }]; // 300.00 retail, 210.00 wholesale => 90.00 margin (30%)
    const activeSignalsMock = [{ count: 12 }];
    const offerStatsMock = [
      { state: "accepted", count: 3 },
      { state: "rejected", count: 1 },
    ];
    const openTasksMock = [{ count: 4 }];

    vi.mocked(db.select)
      .mockReturnValueOnce(createChain(subsMock) as any)
      .mockReturnValueOnce(createChain(invoicesMock) as any)
      .mockReturnValueOnce(createChain(tasksMock) as any)
      .mockReturnValueOnce(createChain(offersMock) as any)
      .mockReturnValueOnce(createChain(activeSignalsMock) as any)
      .mockReturnValueOnce(createChain(offerStatsMock) as any)
      .mockReturnValueOnce(createChain(openTasksMock) as any);

    const result = await aggregateMspTelemetry(42, new Date("2026-07-01"));

    expect(result.financials.monitoringMrr).toEqual({
      grossRevenueUsd: "100.00",
      wholesaleCostUsd: "70.00",
      mspMarginUsd: "30.00",
      mspMarginPct: "30.0%",
    });

    expect(result.financials.projectRevenue).toEqual({
      grossRevenueUsd: "150.00",
      wholesaleCostUsd: "105.00",
      mspMarginUsd: "45.00",
      mspMarginPct: "30.0%",
    });

    expect(result.financials.remediationRevenue).toEqual({
      grossRevenueUsd: "50.00",
      wholesaleCostUsd: "30.00",
      mspMarginUsd: "20.00",
      mspMarginPct: "40.0%",
    });

    expect(result.financials.offerRevenue).toEqual({
      grossRevenueUsd: "300.00",
      wholesaleCostUsd: "210.00",
      mspMarginUsd: "90.00",
      mspMarginPct: "30.0%",
    });

    // Total: 100 + 150 + 50 + 300 = 600.00
    // Wholesale: 70 + 105 + 30 + 210 = 415.00
    // Margin: 185.00 => 185 / 600 = 30.83% => "30.8%"
    expect(result.financials.total).toEqual({
      grossRevenueUsd: "600.00",
      wholesaleCostUsd: "415.00",
      mspMarginUsd: "185.00",
      mspMarginPct: "30.8%",
    });

    expect(result.metrics).toEqual({
      activeSignalsCount: 12,
      offerAcceptanceRate: 75,
      openFulfillmentTasksCount: 4,
    });
  });

  it("scopes monitoringMrr to startDate instead of always reflecting the current moment", async () => {
    // Subscriptions query mock: startDate-filtered call returns only 1 of the 2
    // subscriptions a "no startDate" call would return, proving the where()
    // clause is actually applied rather than ignored.
    const allSubs = [
      { priceCents: 10000, internalCostCents: 7000 }, // created before startDate
      { priceCents: 5000, internalCostCents: 3000 }, // created on/after startDate
    ];
    const scopedSubs = [allSubs[1]];

    const emptyChain = createChain([]);

    vi.mocked(db.select)
      .mockReturnValueOnce(createChain(scopedSubs) as any) // Category A: monitoringMrr (scoped)
      .mockReturnValueOnce(emptyChain as any) // Category B: invoices
      .mockReturnValueOnce(emptyChain as any) // Category C: tasks
      .mockReturnValueOnce(emptyChain as any) // Category D: offers
      .mockReturnValueOnce(createChain([{ count: 0 }]) as any) // active signals
      .mockReturnValueOnce(createChain([]) as any) // offer stats
      .mockReturnValueOnce(createChain([{ count: 0 }]) as any); // open tasks

    const scopedResult = await aggregateMspTelemetry(42, new Date("2026-07-01"));

    // Only the second subscription (50.00 retail / 30.00 wholesale) should count.
    expect(scopedResult.financials.monitoringMrr).toEqual({
      grossRevenueUsd: "50.00",
      wholesaleCostUsd: "30.00",
      mspMarginUsd: "20.00",
      mspMarginPct: "40.0%",
    });

    vi.mocked(db.select)
      .mockReturnValueOnce(createChain(allSubs) as any) // Category A: monitoringMrr (unscoped)
      .mockReturnValueOnce(emptyChain as any)
      .mockReturnValueOnce(emptyChain as any)
      .mockReturnValueOnce(emptyChain as any)
      .mockReturnValueOnce(createChain([{ count: 0 }]) as any)
      .mockReturnValueOnce(createChain([]) as any)
      .mockReturnValueOnce(createChain([{ count: 0 }]) as any);

    const unscopedResult = await aggregateMspTelemetry(42, undefined);

    // Both subscriptions count when no startDate is given.
    expect(unscopedResult.financials.monitoringMrr).toEqual({
      grossRevenueUsd: "150.00",
      wholesaleCostUsd: "100.00",
      mspMarginUsd: "50.00",
      mspMarginPct: "33.3%",
    });

    // The two results must differ — this is the actual proof that startDate
    // changes monitoringMrr output instead of being a no-op.
    expect(scopedResult.financials.monitoringMrr).not.toEqual(
      unscopedResult.financials.monitoringMrr,
    );
  });
});

describe("aggregateMspTelemetry categoryBreakdown (5-way split)", () => {
  it("buckets every projectType/deliveryType value, including the disclosed 'other' residual", async () => {
    const subsMock = [{ priceCents: 100000, internalCostCents: 70000 }]; // monitoring: 1000.00 / 700.00

    const invoicesMock = [
      { amount: "100.00", projectType: "project" }, // -> consulting
      { amount: "200.00", projectType: "retainer" }, // -> subscriptionsRetainers
      { amount: "300.00", projectType: "quick_win" }, // -> assessmentsQuickFixes
      { amount: "50.00", projectType: null }, // no linked project -> other
    ];

    const tasksMock = [
      { priceCents: 10000, internalCostCents: 10000, deliveryType: "document_generation" }, // -> documents
      { priceCents: 20000, internalCostCents: 20000, deliveryType: "assessment" }, // -> assessmentsQuickFixes
      { priceCents: 30000, internalCostCents: 30000, deliveryType: "retainer" }, // -> subscriptionsRetainers
      { priceCents: 5000, internalCostCents: 5000, deliveryType: "bundle_subscription" }, // -> subscriptionsRetainers
      { priceCents: 1000, internalCostCents: 1000, deliveryType: "none" }, // -> other
    ];

    const offersMock = [
      { adjustedPriceCents: 4000, internalCostCents: 4000, deliveryType: "document_generation" }, // -> documents
      { adjustedPriceCents: 6000, internalCostCents: 6000, deliveryType: undefined }, // unlinked service -> other
    ];

    vi.mocked(db.select)
      .mockReturnValueOnce(createChain(subsMock) as any)
      .mockReturnValueOnce(createChain(invoicesMock) as any)
      .mockReturnValueOnce(createChain(tasksMock) as any)
      .mockReturnValueOnce(createChain(offersMock) as any)
      .mockReturnValueOnce(createChain([{ count: 0 }]) as any)
      .mockReturnValueOnce(createChain([]) as any)
      .mockReturnValueOnce(createChain([{ count: 0 }]) as any);

    const result = await aggregateMspTelemetry(42);

    expect(result.categoryBreakdown.monitoring).toEqual({
      grossRevenueUsd: "1000.00",
      wholesaleCostUsd: "700.00",
      mspMarginUsd: "300.00",
      mspMarginPct: "30.0%",
    });

    // Consulting: only the projectType="project" invoice (100.00 retail, default 70% wholesale)
    expect(result.categoryBreakdown.consulting).toEqual({
      grossRevenueUsd: "100.00",
      wholesaleCostUsd: "70.00",
      mspMarginUsd: "30.00",
      mspMarginPct: "30.0%",
    });

    // Subscriptions/Retainers: retainer invoice (200/140) + retainer task (300/300) + bundle_subscription task (50/50)
    expect(result.categoryBreakdown.subscriptionsRetainers).toEqual({
      grossRevenueUsd: "550.00",
      wholesaleCostUsd: "490.00",
      mspMarginUsd: "60.00",
      mspMarginPct: "10.9%",
    });

    // Assessments/Quick Fixes: quick_win invoice (300/210) + assessment task (200/200)
    expect(result.categoryBreakdown.assessmentsQuickFixes).toEqual({
      grossRevenueUsd: "500.00",
      wholesaleCostUsd: "410.00",
      mspMarginUsd: "90.00",
      mspMarginPct: "18.0%",
    });

    // Documents: document_generation task (100/100) + document_generation offer (40/40)
    expect(result.categoryBreakdown.documents).toEqual({
      grossRevenueUsd: "140.00",
      wholesaleCostUsd: "140.00",
      mspMarginUsd: "0.00",
      mspMarginPct: "0.0%",
    });

    // Other (disclosed residual): unlinked invoice (50/35) + deliveryType="none" task (10/10) + unlinked offer (60/60)
    expect(result.categoryBreakdown.other).toEqual({
      grossRevenueUsd: "120.00",
      wholesaleCostUsd: "105.00",
      mspMarginUsd: "15.00",
      mspMarginPct: "12.5%",
    });

    // Sanity check: the 5-way + disclosed-other split must reconcile to the same
    // total the 4 legacy categories already produce — no revenue silently dropped.
    const categorySum =
      Number(result.categoryBreakdown.monitoring.grossRevenueUsd) +
      Number(result.categoryBreakdown.consulting.grossRevenueUsd) +
      Number(result.categoryBreakdown.subscriptionsRetainers.grossRevenueUsd) +
      Number(result.categoryBreakdown.assessmentsQuickFixes.grossRevenueUsd) +
      Number(result.categoryBreakdown.documents.grossRevenueUsd) +
      Number(result.categoryBreakdown.other.grossRevenueUsd);
    expect(categorySum).toBeCloseTo(Number(result.financials.total.grossRevenueUsd), 5);
  });
});
