import { describe, it, expect } from "vitest";
import {
  resolveCatalogPricing,
  resolveServicePriceCents,
  resolveTypeAttributesMonthlyPriceCents,
  isServiceFree,
} from "../catalog-pricing";

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

  it("REGRESSION: a monitoring tier priced ONLY via typeAttributes.pricePerUserMonth is NOT free (second live Stripe bypass)", () => {
    // The exact shape of a real monitoring_tier row created via the admin
    // panel: the monitoring-tier editor writes NO flat price (priceFixed:
    // false) — price/basePrice/priceCents are all NULL and the entire price
    // lives in typeAttributes. Reading only the flat columns judged this
    // "free": consent-success inline-finalized the order and the free-checkout
    // guard passed it, provisioning a real Enhanced Monitoring subscription
    // for $0 with Stripe never invoked.
    expect(
      isServiceFree({
        isFreeOffering: false,
        priceCents: null,
        price: null,
        basePrice: null,
        typeAttributes: { pricePerUserMonth: "8.00", seatCountFloor: 5, flatMonthlySurcharge: null },
      }),
    ).toBe(false);
  });

  it("treats a typeAttributes flatMonthlySurcharge-only or flatMonthlyPrice-only service as paid", () => {
    expect(
      isServiceFree({ isFreeOffering: false, typeAttributes: { flatMonthlySurcharge: "25.00" } }),
    ).toBe(false);
    // recurring_addon pricing model
    expect(
      isServiceFree({ isFreeOffering: false, typeAttributes: { flatMonthlyPrice: "29.00" } }),
    ).toBe(false);
  });

  it("stays free when typeAttributes exist but carry no positive pricing", () => {
    expect(
      isServiceFree({
        isFreeOffering: false,
        priceCents: null,
        price: null,
        basePrice: null,
        typeAttributes: { tenantTierLabel: "Core", pricePerUserMonth: null, flatMonthlySurcharge: "0.00" },
      }),
    ).toBe(true);
    expect(isServiceFree({ isFreeOffering: false, typeAttributes: {} })).toBe(true);
    expect(isServiceFree({ isFreeOffering: false, typeAttributes: null })).toBe(true);
  });

  it("honors isFreeOffering even when typeAttributes pricing is present (intentional free promo)", () => {
    expect(
      isServiceFree({ isFreeOffering: true, typeAttributes: { pricePerUserMonth: "8.00" } }),
    ).toBe(true);
  });
});

describe("resolveTypeAttributesMonthlyPriceCents", () => {
  it("computes pricePerUserMonth × seats", () => {
    expect(
      resolveTypeAttributesMonthlyPriceCents({ typeAttributes: { pricePerUserMonth: "8.00" } }, 10),
    ).toBe(8000);
  });

  it("clamps seats up to the seatCountFloor (minimum billable seats)", () => {
    expect(
      resolveTypeAttributesMonthlyPriceCents(
        { typeAttributes: { pricePerUserMonth: "8.00", seatCountFloor: 5 } },
        1,
      ),
    ).toBe(4000);
  });

  it("clamps a zero/negative/missing seat count to 1", () => {
    expect(
      resolveTypeAttributesMonthlyPriceCents({ typeAttributes: { pricePerUserMonth: "8.00" } }, 0),
    ).toBe(800);
    expect(
      resolveTypeAttributesMonthlyPriceCents({ typeAttributes: { pricePerUserMonth: "8.00" } }, -3),
    ).toBe(800);
    expect(
      resolveTypeAttributesMonthlyPriceCents({ typeAttributes: { pricePerUserMonth: "8.00" } }),
    ).toBe(800);
  });

  it("adds flatMonthlySurcharge on top of per-seat pricing", () => {
    expect(
      resolveTypeAttributesMonthlyPriceCents(
        { typeAttributes: { pricePerUserMonth: "8.00", flatMonthlySurcharge: "25.00" } },
        10,
      ),
    ).toBe(10500);
  });

  it("resolves a flatMonthlyPrice-only add-on independent of seats", () => {
    expect(
      resolveTypeAttributesMonthlyPriceCents({ typeAttributes: { flatMonthlyPrice: "29.00" } }, 50),
    ).toBe(2900);
  });

  it("returns 0 for missing/empty/non-numeric typeAttributes pricing", () => {
    expect(resolveTypeAttributesMonthlyPriceCents({}, 10)).toBe(0);
    expect(resolveTypeAttributesMonthlyPriceCents({ typeAttributes: null }, 10)).toBe(0);
    expect(
      resolveTypeAttributesMonthlyPriceCents({ typeAttributes: { pricePerUserMonth: "" } }, 10),
    ).toBe(0);
    expect(
      resolveTypeAttributesMonthlyPriceCents({ typeAttributes: { pricePerUserMonth: "abc" } }, 10),
    ).toBe(0);
  });
});
