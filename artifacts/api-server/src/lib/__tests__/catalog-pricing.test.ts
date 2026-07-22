import { describe, it, expect } from "vitest";
import { resolveCatalogPricing, resolveServicePriceCents, isServiceFree } from "../catalog-pricing";

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

describe("resolveServicePriceCents", () => {
  it("uses the canonical priceCents when it is positive", () => {
    expect(resolveServicePriceCents({ priceCents: 25000, price: null, basePrice: null })).toBe(25000);
  });

  it("REGRESSION: a paid service priced ONLY via priceCents (legacy price/basePrice NULL) resolves to its real price, not 0", () => {
    // This is the exact shape a service created via the modern admin 'create'
    // endpoint has: priceCents set, legacy decimal columns NULL. Reading only the
    // legacy columns (the old bug) resolved this to 0 → treated as free → bypassed Stripe.
    expect(resolveServicePriceCents({ priceCents: 25000, price: null, basePrice: null })).toBe(25000);
  });

  it("falls back to the legacy decimal price (dollars → cents) when priceCents is absent", () => {
    expect(resolveServicePriceCents({ priceCents: null, price: "250.00", basePrice: null })).toBe(25000);
    expect(resolveServicePriceCents({ priceCents: null, price: null, basePrice: "99.50" })).toBe(9950);
  });

  it("prefers price over basePrice on the legacy path", () => {
    expect(resolveServicePriceCents({ priceCents: null, price: "10.00", basePrice: "999.00" })).toBe(1000);
  });

  it("falls through a zero priceCents to a positive legacy price", () => {
    expect(resolveServicePriceCents({ priceCents: 0, price: "50.00", basePrice: null })).toBe(5000);
  });

  it("returns 0 when no field carries a positive price", () => {
    expect(resolveServicePriceCents({ priceCents: null, price: null, basePrice: null })).toBe(0);
    expect(resolveServicePriceCents({ priceCents: 0, price: "0.00", basePrice: "0" })).toBe(0);
    expect(resolveServicePriceCents({})).toBe(0);
  });
});

describe("isServiceFree", () => {
  it("REGRESSION: a paid assessment priced ONLY via priceCents is NOT free (would otherwise bypass Stripe)", () => {
    // The core Stripe-bypass bug: isFree derived from legacy price/basePrice only.
    expect(isServiceFree({ isFreeOffering: false, priceCents: 25000, price: null, basePrice: null })).toBe(false);
  });

  it("treats a legacy-priced service as paid", () => {
    expect(isServiceFree({ isFreeOffering: false, priceCents: null, price: "250.00", basePrice: null })).toBe(false);
  });

  it("treats a genuinely zero-price service as free", () => {
    expect(isServiceFree({ isFreeOffering: false, priceCents: null, price: null, basePrice: null })).toBe(true);
    expect(isServiceFree({ isFreeOffering: false, priceCents: 0, price: "0.00", basePrice: null })).toBe(true);
  });

  it("honors an explicit isFreeOffering flag even when a priceCents value is present (intentional free promo)", () => {
    expect(isServiceFree({ isFreeOffering: true, priceCents: 25000, price: null, basePrice: null })).toBe(true);
  });
});
