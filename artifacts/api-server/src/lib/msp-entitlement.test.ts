/**
 * msp-entitlement.test.ts
 *
 * Unit tests for the pure compareTierRank() helper and the TIER_RANK map.
 * These tests do NOT hit the database — compareTierRank is side-effect-free.
 *
 * Run with: pnpm --filter @workspace/api-server run test
 */

import { vi, describe, it, expect } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  servicesTable: {},
  mspSubscriptionsTable: {},
  mspCustomersTable: {},
}));

vi.mock("./logger.ts", () => ({
  logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
}));

import { compareTierRank, TIER_RANK } from "./msp-entitlement";

describe("TIER_RANK map", () => {
  it("starter and basic share rank 0", () => {
    expect(TIER_RANK["starter"]).toBe(0);
    expect(TIER_RANK["basic"]).toBe(0);
  });

  it("pro/professional are above starter", () => {
    expect(TIER_RANK["pro"]).toBeGreaterThan(TIER_RANK["starter"]);
    expect(TIER_RANK["professional"]).toBe(TIER_RANK["pro"]);
  });

  it("business > pro", () => {
    expect(TIER_RANK["business"]).toBeGreaterThan(TIER_RANK["pro"]);
  });

  it("enterprise is the highest", () => {
    const max = Math.max(...Object.values(TIER_RANK));
    expect(TIER_RANK["enterprise"]).toBe(max);
  });
});

describe("compareTierRank — no required tier", () => {
  it("returns ok:true when requiredTier is null", () => {
    expect(compareTierRank("starter", null)).toEqual({ ok: true });
  });

  it("returns ok:true when requiredTier is undefined", () => {
    expect(compareTierRank("pro", undefined)).toEqual({ ok: true });
  });

  it("returns ok:true when requiredTier is empty string", () => {
    expect(compareTierRank("enterprise", "")).toEqual({ ok: true });
  });
});

describe("compareTierRank — known tier comparisons", () => {
  it("starter satisfies starter requirement", () => {
    expect(compareTierRank("starter", "starter")).toEqual({ ok: true });
  });

  it("pro satisfies starter requirement", () => {
    expect(compareTierRank("pro", "starter")).toEqual({ ok: true });
  });

  it("enterprise satisfies enterprise requirement", () => {
    expect(compareTierRank("enterprise", "enterprise")).toEqual({ ok: true });
  });

  it("starter does NOT satisfy pro requirement", () => {
    const result = compareTierRank("starter", "pro");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.currentTier).toBe("starter");
      expect(result.requiredTier).toBe("pro");
    }
  });

  it("pro does NOT satisfy enterprise requirement", () => {
    const result = compareTierRank("pro", "enterprise");
    expect(result.ok).toBe(false);
  });

  it("business satisfies pro requirement", () => {
    expect(compareTierRank("business", "pro")).toEqual({ ok: true });
  });

  it("null current tier is treated as starter (rank 0)", () => {
    expect(compareTierRank(null, "starter")).toEqual({ ok: true });
    const result = compareTierRank(null, "pro");
    expect(result.ok).toBe(false);
  });
});

describe("compareTierRank — unknown required tier (fail closed)", () => {
  it("unknown required tier 'growth' fails closed", () => {
    const result = compareTierRank("enterprise", "growth");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.requiredTier).toBe("growth");
    }
  });

  it("unknown required tier fails even when current is enterprise", () => {
    expect(compareTierRank("enterprise", "platinum").ok).toBe(false);
  });

  it("unknown required tier fails for null current tier", () => {
    expect(compareTierRank(null, "growth").ok).toBe(false);
  });

  it("unrecognised current tier is treated as starter — still blocks if required is pro", () => {
    const result = compareTierRank("growth", "pro");
    expect(result.ok).toBe(false);
  });
});

describe("compareTierRank — case insensitivity", () => {
  it("handles uppercase required tier", () => {
    expect(compareTierRank("pro", "PRO")).toEqual({ ok: true });
  });

  it("handles mixed-case current tier", () => {
    expect(compareTierRank("Enterprise", "enterprise")).toEqual({ ok: true });
  });
});
