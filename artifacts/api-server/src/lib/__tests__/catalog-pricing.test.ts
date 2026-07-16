import { describe, it, expect } from "vitest";
import { resolveCatalogPricing } from "../catalog-pricing";

describe("resolveCatalogPricing", () => {
  it("computes wholesaleCostCents using default 70% retail price if internalCostCents is null or undefined", () => {
    // 100 * 0.70 = 70
    const result1 = resolveCatalogPricing({ priceCents: 100, internalCostCents: null });
    expect(result1.wholesaleCostCents).toBe(70);
    expect(result1.retailPriceCents).toBe(100);
    expect(result1.mspMarginCents).toBe(30);

    // 150 * 0.70 = 105
    const result2 = resolveCatalogPricing({ priceCents: 150 });
    expect(result2.wholesaleCostCents).toBe(105);
    expect(result2.retailPriceCents).toBe(150);
    expect(result2.mspMarginCents).toBe(45);
  });

  it("rounds the wholesaleCostCents when using default 70%", () => {
    // 125 * 0.70 = 87.5 => rounded to 88
    const result = resolveCatalogPricing({ priceCents: 125 });
    expect(result.wholesaleCostCents).toBe(88);
    expect(result.retailPriceCents).toBe(125);
    expect(result.mspMarginCents).toBe(37);
  });

  it("uses internalCostCents if explicitly provided", () => {
    const result = resolveCatalogPricing({ priceCents: 100, internalCostCents: 50 });
    expect(result.wholesaleCostCents).toBe(50);
    expect(result.retailPriceCents).toBe(100);
    expect(result.mspMarginCents).toBe(50);
  });
});
