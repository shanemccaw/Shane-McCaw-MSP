import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for cost-engine.ts's five responsibilities: price lookup,
 * multiplication, aggregation, formatting, and safety (unknown-SKU handling).
 * DB is mocked with a FIFO queue keyed by sku_part_number lookups — one
 * `.select().from(skuPriceReferenceTable).where(...)` per distinct SKU.
 */

let mockPriceRows: Record<string, { displayName: string; monthlyPriceCents: number | null }> = {};

vi.mock("@workspace/db", () => {
  const mockDb = {
    select: vi.fn(() => {
      let lastSku: string | undefined;
      const chain: any = {
        from: () => chain,
        where: (cond: any) => {
          lastSku = cond?.right ?? cond?.value ?? cond;
          return chain;
        },
        limit: () => chain,
        then: (onFulfilled: any, onRejected: any) => {
          const sku = typeof lastSku === "string" ? lastSku : String(lastSku);
          const row = mockPriceRows[sku];
          return Promise.resolve(row ? [row] : []).then(onFulfilled, onRejected);
        },
      };
      return chain;
    }),
  };
  return {
    db: mockDb,
    skuPriceReferenceTable: { skuPartNumber: "sku_part_number", displayName: "display_name", monthlyPriceCents: "monthly_price_cents" },
  };
});

vi.mock("drizzle-orm", () => ({ eq: (col: any, val: any) => ({ right: val }) }));

import { computeSkuCostBreakdown, formatCentsAsDollars, centsToDollars } from "./cost-engine.ts";

describe("cost-engine", () => {
  beforeEach(() => {
    mockPriceRows = {
      SPE_E3: { displayName: "Microsoft 365 E3", monthlyPriceCents: 3600 },
      SPE_E5: { displayName: "Microsoft 365 E5", monthlyPriceCents: 5700 },
      MCOSTANDARD: { displayName: "Skype for Business Online Plan 2", monthlyPriceCents: null },
    };
  });

  it("multiplies count x price per SKU and aggregates a total (real known SKUs)", async () => {
    const result = await computeSkuCostBreakdown({ SPE_E3: 10, SPE_E5: 2 });
    const e3 = result.lines.find((l) => l.skuPartNumber === "SPE_E3")!;
    const e5 = result.lines.find((l) => l.skuPartNumber === "SPE_E5")!;
    expect(e3.totalMonthlyPriceCents).toBe(36000);
    expect(e5.totalMonthlyPriceCents).toBe(11400);
    expect(result.totalMonthlyCents).toBe(47400);
    expect(result.totalAnnualCents).toBe(47400 * 12);
    expect(result.unknownSkus).toEqual([]);
  });

  it("never guesses a price for an unknown SKU — falls back to null/0 and warns", async () => {
    const result = await computeSkuCostBreakdown({ NOT_A_REAL_SKU: 5 });
    const line = result.lines[0];
    expect(line.priceKnown).toBe(false);
    expect(line.unitMonthlyPriceCents).toBeNull();
    expect(line.totalMonthlyPriceCents).toBeNull();
    expect(result.totalMonthlyCents).toBe(0);
    expect(result.unknownSkus).toEqual(["NOT_A_REAL_SKU"]);
  });

  it("treats a SKU with a NULL price on file (e.g. retired product) the same as unknown", async () => {
    const result = await computeSkuCostBreakdown({ MCOSTANDARD: 3 });
    expect(result.lines[0].priceKnown).toBe(false);
    expect(result.totalMonthlyCents).toBe(0);
    expect(result.unknownSkus).toEqual(["MCOSTANDARD"]);
  });

  it("skips zero/negative counts", async () => {
    const result = await computeSkuCostBreakdown({ SPE_E3: 0, SPE_E5: -1 });
    expect(result.lines).toEqual([]);
    expect(result.totalMonthlyCents).toBe(0);
  });

  it("formats cents as whole dollars", () => {
    expect(formatCentsAsDollars(47400)).toBe("$474");
    expect(formatCentsAsDollars(0)).toBe("$0");
    expect(centsToDollars(36000)).toBe(360);
  });
});
