import { describe, it, expect } from "vitest";
import {
  resolveCatalogPricing,
  resolveServicePriceCents,
  resolveTypeAttributesMonthlyPriceCents,
  resolveEffectiveChargeCents,
  seatBandViolationMessage,
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

// ─────────────────────────────────────────────────────────────────────────────
// Monitoring pricing matrix — permanent regression suite.
//
// Three real pricing bugs shipped one at a time, each discovered by a real
// mis-charged purchase (Stripe bypass → low-seat floor/surcharge undercharge →
// high-seat wrong charge). This matrix pins the per-seat computation for every
// tier × band × representative seat count so a change to the formula can never
// again slip through silently.
//
// The fixture mirrors the REAL catalog's structure (3 packages × 4 seat bands,
// one row per band; price lives ONLY in typeAttributes) and uses the
// live-confirmed anchor values where known (floors 15/26/101/500, Enhanced
// Micro ppu $18, Basic Micro ppu $12, Enterprise-band ppu $8, Premium flat
// monthly surcharge $160). Remaining ppu cells are representative test data —
// the matrix verifies the FORMULA (ppu × max(seats, floor) + surcharge, in
// integer cents), not Shane's live price list, which stays in the DB per the
// no-hardcoding rule.
// ─────────────────────────────────────────────────────────────────────────────

type BandFixture = {
  band: string;
  seatMin: number;
  seatMax: number | null;
  seatCountFloor: number;
  ppu: Record<"basic" | "enhanced" | "premium", string>;
};

const PREMIUM_SURCHARGE = "160.00";

const BANDS: BandFixture[] = [
  { band: "Micro",      seatMin: 1,   seatMax: 25,   seatCountFloor: 15,  ppu: { basic: "12.00", enhanced: "18.00", premium: "24.00" } },
  { band: "SMB",        seatMin: 26,  seatMax: 100,  seatCountFloor: 26,  ppu: { basic: "10.00", enhanced: "14.00", premium: "18.00" } },
  { band: "Mid-Market", seatMin: 101, seatMax: 500,  seatCountFloor: 101, ppu: { basic: "7.00",  enhanced: "10.00", premium: "13.00" } },
  { band: "Enterprise", seatMin: 501, seatMax: null, seatCountFloor: 500, ppu: { basic: "5.50",  enhanced: "8.00",  premium: "8.00" } },
];

function tierRow(band: BandFixture, pkg: "basic" | "enhanced" | "premium") {
  return {
    // Real monitoring rows: every flat price column NULL, price ONLY here.
    priceCents: null,
    price: null,
    basePrice: null,
    typeAttributes: {
      pricePerUserMonth: band.ppu[pkg],
      seatCountFloor: band.seatCountFloor,
      seatMin: band.seatMin,
      seatMax: band.seatMax,
      ...(pkg === "premium" ? { flatMonthlySurcharge: PREMIUM_SURCHARGE } : {}),
    },
  };
}

/** Hand-independent expected value: the documented formula in integer cents. */
function expectedCents(band: BandFixture, pkg: "basic" | "enhanced" | "premium", seats: number): number {
  const billable = Math.max(1, seats, band.seatCountFloor);
  const surcharge = pkg === "premium" ? parseFloat(PREMIUM_SURCHARGE) : 0;
  return Math.round((parseFloat(band.ppu[pkg]) * billable + surcharge) * 100);
}

describe("Monitoring pricing matrix — every tier × band × seat count", () => {
  const SEAT_POINTS = (band: BandFixture): number[] => {
    const pts = new Set<number>([
      1,
      band.seatCountFloor - 1,
      band.seatCountFloor,
      band.seatCountFloor + 1,
      band.seatMin,
      band.seatMax ?? 5000,
      Math.round((band.seatMin + (band.seatMax ?? 5000)) / 2),
      499, 500, 501, 1000, 2000, 5000,
    ]);
    return [...pts].filter((n) => n >= 1).sort((a, b) => a - b);
  };

  for (const band of BANDS) {
    for (const pkg of ["basic", "enhanced", "premium"] as const) {
      it(`${pkg} ${band.band} (floor ${band.seatCountFloor}) prices correctly at every seat point`, () => {
        for (const seats of SEAT_POINTS(band)) {
          const actual = resolveTypeAttributesMonthlyPriceCents(tierRow(band, pkg), seats);
          expect(actual, `${pkg} ${band.band} @ ${seats} seats`).toBe(expectedCents(band, pkg, seats));
        }
      });
    }
  }

  it("REGRESSION (2000-seat wrong charge): Enterprise-band rows at 2000 seats charge the full seat-scaled price in cents", () => {
    const ent = BANDS[3];
    // Enhanced Enterprise @ 2000 = 2000 × $8.00 = $16,000.00/mo — exactly 1,600,000 cents.
    expect(resolveTypeAttributesMonthlyPriceCents(tierRow(ent, "enhanced"), 2000)).toBe(1_600_000);
    // Premium Enterprise @ 2000 = 2000 × $8.00 + $160 = $16,160.00/mo.
    expect(resolveTypeAttributesMonthlyPriceCents(tierRow(ent, "premium"), 2000)).toBe(1_616_000);
    // Basic Enterprise @ 2000 = 2000 × $5.50 = $11,000.00/mo — exactly 1,100,000
    // cents, never 1,100 ($11.00): pins the dollars-vs-cents unit at high value.
    expect(resolveTypeAttributesMonthlyPriceCents(tierRow(ent, "basic"), 2000)).toBe(1_100_000);
  });

  it("REGRESSION (low-seat undercharge, fixed 80cb8fa3): floor + surcharge apply when seats collapse to 1", () => {
    const micro = BANDS[0];
    // Enhanced Micro @ 1 seat = 15-seat floor × $18 = $270.00/mo, not $18.
    expect(resolveTypeAttributesMonthlyPriceCents(tierRow(micro, "enhanced"), 1)).toBe(27_000);
    const ent = BANDS[3];
    // Premium Enterprise @ 1 seat = 500-seat floor × $8 + $160 = $4,160.00/mo, not $8.
    expect(resolveTypeAttributesMonthlyPriceCents(tierRow(ent, "premium"), 1)).toBe(416_000);
  });

  it("Premium vs Enhanced differ by EXACTLY the flat surcharge whenever their ppu is equal — at every seat count", () => {
    // This is the executable form of the live symptom observed at 750 and 2000
    // seats ($6,000 vs $6,160 and $16,000 vs $16,160): a seat-count-independent
    // constant gap mathematically REQUIRES equal pricePerUserMonth on the two
    // rows. The computation applies whatever ppu the row carries — so a
    // constant $160 gap in production is catalog data (Premium's ppu entered
    // equal to Enhanced's), not a computation defect dropping Premium's rate.
    const ent = BANDS[3]; // premium ppu === enhanced ppu ("8.00") in this band
    for (const seats of [501, 750, 1000, 2000, 5000]) {
      const enhanced = resolveTypeAttributesMonthlyPriceCents(tierRow(ent, "enhanced"), seats);
      const premium = resolveTypeAttributesMonthlyPriceCents(tierRow(ent, "premium"), seats);
      expect(premium - enhanced).toBe(16_000); // $160.00 in cents, seat-independent
    }
    // And when ppu genuinely differs (Mid-Market fixture), the gap SCALES with seats.
    const mid = BANDS[2];
    const gapAt200 = resolveTypeAttributesMonthlyPriceCents(tierRow(mid, "premium"), 200)
      - resolveTypeAttributesMonthlyPriceCents(tierRow(mid, "enhanced"), 200);
    const gapAt400 = resolveTypeAttributesMonthlyPriceCents(tierRow(mid, "premium"), 400)
      - resolveTypeAttributesMonthlyPriceCents(tierRow(mid, "enhanced"), 400);
    expect(gapAt400).toBeGreaterThan(gapAt200);
  });

  it("high seat counts stay in exact integer-cent space (no float drift, no overflow)", () => {
    const ent = BANDS[3];
    // 50,000 seats × $8.00 = $400,000.00/mo = 40,000,000 cents — far below
    // Number.MAX_SAFE_INTEGER; JS integer overflow is confirmed not a factor.
    expect(resolveTypeAttributesMonthlyPriceCents(tierRow(ent, "enhanced"), 50_000)).toBe(40_000_000);
    // Fractional ppu at scale rounds once, at the end: 2000 × $5.55 = $11,100.00 exactly.
    expect(
      resolveTypeAttributesMonthlyPriceCents(
        { typeAttributes: { pricePerUserMonth: "5.55" } },
        2000,
      ),
    ).toBe(1_110_000);
  });
});

describe("resolveEffectiveChargeCents — checkout charge precedence", () => {
  const ent = BANDS[3];

  it("REGRESSION (the $11.00 charge shape): a stale flat price on a per-seat tier row can NOT override the seat-scaled price", () => {
    // A monitoring row whose flat `price` column somehow carries a leftover
    // value (e.g. a mangled "$11,000" → 11.00 edit). The old resolution order
    // (price → typeAttributes) would charge $11.00/mo for a 2000-seat tier.
    const contaminated = { ...tierRow(ent, "basic"), price: "11.00" as string | null };
    expect(resolveEffectiveChargeCents(contaminated, 2000)).toBe(1_100_000); // $11,000.00 — the real price
    // Same for basePrice and priceCents contamination.
    expect(resolveEffectiveChargeCents({ ...tierRow(ent, "basic"), basePrice: "11.00" }, 2000)).toBe(1_100_000);
    expect(resolveEffectiveChargeCents({ ...tierRow(ent, "basic"), priceCents: 1100 }, 2000)).toBe(1_100_000);
  });

  it("charges the wizard contract finalPrice when present (server-computed, strictly validated)", () => {
    expect(resolveEffectiveChargeCents({ priceCents: 50_000 }, 1, 750)).toBe(75_000);
  });

  it("falls back to flat pricing for rows without typeAttributes pricing", () => {
    expect(resolveEffectiveChargeCents({ price: "250.00" }, 1)).toBe(25_000);
    expect(resolveEffectiveChargeCents({ basePrice: "99.50" }, 1)).toBe(9_950);
    expect(resolveEffectiveChargeCents({ priceCents: 25_000 }, 1)).toBe(25_000);
  });

  it("prefers legacy price over basePrice over priceCents on the flat path", () => {
    expect(resolveEffectiveChargeCents({ price: "10.00", basePrice: "999.00", priceCents: 123_456 }, 1)).toBe(1_000);
    expect(resolveEffectiveChargeCents({ basePrice: "20.00", priceCents: 123_456 }, 1)).toBe(2_000);
  });

  it("returns 0 only when nothing carries a positive price", () => {
    expect(resolveEffectiveChargeCents({}, 10)).toBe(0);
    expect(resolveEffectiveChargeCents({ price: "0.00", basePrice: null, priceCents: 0 }, 10)).toBe(0);
  });

  it("full matrix parity: for clean monitoring rows the charge equals the typeAttributes computation at every cell", () => {
    for (const band of BANDS) {
      for (const pkg of ["basic", "enhanced", "premium"] as const) {
        for (const seats of [1, band.seatCountFloor, band.seatMin, 499, 500, 1000, 2000]) {
          expect(
            resolveEffectiveChargeCents(tierRow(band, pkg), seats),
            `${pkg} ${band.band} @ ${seats}`,
          ).toBe(expectedCents(band, pkg, seats));
        }
      }
    }
  });
});

describe("seatBandViolationMessage — seat/band mismatch guard", () => {
  const ent = BANDS[3];
  const micro = BANDS[0];

  it("REGRESSION (lost seat count): buying an Enterprise-band row at 1 seat is rejected, not floor-billed silently", () => {
    expect(seatBandViolationMessage(tierRow(ent, "enhanced"), 1)).toMatch(/501\+ licensed users/);
    // The exact shape of the live bug: ?seats= dropped by a checkout link →
    // server default 1 → previously silently charged the floor-clamped price
    // while the buyer believed they were paying for their real tenant size.
  });

  it("accepts any in-band seat count (Enterprise band is unbounded above)", () => {
    expect(seatBandViolationMessage(tierRow(ent, "enhanced"), 501)).toBeNull();
    expect(seatBandViolationMessage(tierRow(ent, "enhanced"), 2000)).toBeNull();
    expect(seatBandViolationMessage(tierRow(ent, "enhanced"), 50_000)).toBeNull();
  });

  it("rejects buying a bounded band row above its seatMax (wrong band's rate would apply)", () => {
    expect(seatBandViolationMessage(tierRow(micro, "basic"), 2000)).toMatch(/up to 25 licensed users/);
    expect(seatBandViolationMessage(tierRow(micro, "basic"), 25)).toBeNull();
    expect(seatBandViolationMessage(tierRow(micro, "basic"), 1)).toBeNull();
  });

  it("never fires for rows without per-seat pricing or without a seat band", () => {
    expect(seatBandViolationMessage({ typeAttributes: null }, 1)).toBeNull();
    expect(seatBandViolationMessage({ typeAttributes: { flatMonthlyPrice: "29.00" } }, 1)).toBeNull();
    expect(seatBandViolationMessage({ typeAttributes: { pricePerUserMonth: "8.00" } }, 1)).toBeNull();
    expect(seatBandViolationMessage({ price: "250.00", typeAttributes: {} } as never, 1)).toBeNull();
  });
});
