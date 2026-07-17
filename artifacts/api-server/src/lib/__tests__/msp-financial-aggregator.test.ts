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
      .mockReturnValueOnce(createChain(subsMock))
      .mockReturnValueOnce(createChain(invoicesMock))
      .mockReturnValueOnce(createChain(tasksMock))
      .mockReturnValueOnce(createChain(offersMock))
      .mockReturnValueOnce(createChain(activeSignalsMock))
      .mockReturnValueOnce(createChain(offerStatsMock))
      .mockReturnValueOnce(createChain(openTasksMock));

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
});
