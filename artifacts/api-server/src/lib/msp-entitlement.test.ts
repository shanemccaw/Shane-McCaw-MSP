/**
 * msp-entitlement.test.ts
 *
 * Unit tests for the pure compareTierRank() helper and the TIER_RANK map
 * (these do NOT hit the database — compareTierRank is side-effect-free), plus
 * loadTier()'s merge of typeAttributes.tierCapabilities with the admin-editable
 * mspPlanCapabilitiesTable rows (Git #3683 — requirePlanFeature() previously
 * never read that table at all).
 *
 * Run with: pnpm --filter @workspace/api-server run test
 */

import { vi, describe, it, expect } from "vitest";

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn() },
  servicesTable: { id: "id", name: "name", typeAttributes: "type_attributes" },
  mspSubscriptionsTable: {
    serviceId: "service_id",
    status: "status",
    dunningState: "dunning_state",
    mspId: "msp_id",
  },
  tenantsTable: { mspId: "msp_id", status: "status" },
  mspPlanCapabilitiesTable: { serviceId: "service_id", capabilityKey: "capability_key", enabled: "enabled" },
}));

vi.mock("./logger.ts", () => {
  const noop = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
  return { logger: { ...noop, child: () => noop } };
});

import { compareTierRank, TIER_RANK, loadTier, tierAllowsFeature } from "./msp-entitlement";
import { db } from "@workspace/db";

type MockDb = { select: ReturnType<typeof vi.fn> };
const mockDb = db as unknown as MockDb;

/** Chain for the subscription+service join query (`.from().innerJoin().where().limit()`). */
function subscriptionChain(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
}

/** Chain for the capability-rules query (`.from().where()`, resolves directly). */
function capabilityRulesChain(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(rows),
  };
}

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

describe("loadTier — mspPlanCapabilitiesTable overlay (Git #3683)", () => {
  const baseSub = {
    serviceId: 42,
    status: "active",
    dunningState: null,
    tierName: "Pro",
  };

  it("falls back to typeAttributes.tierCapabilities when no capability rule rows exist", async () => {
    mockDb.select = vi.fn()
      .mockReturnValueOnce(subscriptionChain([
        { ...baseSub, typeAttributes: { tierCapabilities: { advanced_signals: false } } },
      ]))
      .mockReturnValueOnce(capabilityRulesChain([]));

    const tier = await loadTier(1);
    expect(tier?.tierCapabilities).toEqual({ advanced_signals: false });
    expect(tierAllowsFeature(tier, "advanced_signals")).toBe(false);
  });

  it("a capability rule row GATES a feature that typeAttributes left open", async () => {
    mockDb.select = vi.fn()
      .mockReturnValueOnce(subscriptionChain([
        { ...baseSub, typeAttributes: {} },
      ]))
      .mockReturnValueOnce(capabilityRulesChain([
        { capabilityKey: "custom_workflows", enabled: false },
      ]));

    const tier = await loadTier(1);
    expect(tier?.tierCapabilities).toEqual({ custom_workflows: false });
    expect(tierAllowsFeature(tier, "custom_workflows")).toBe(false);
  });

  it("a capability rule row OVERRIDES typeAttributes to re-open a gated feature", async () => {
    mockDb.select = vi.fn()
      .mockReturnValueOnce(subscriptionChain([
        { ...baseSub, typeAttributes: { tierCapabilities: { sales_offers: false } } },
      ]))
      .mockReturnValueOnce(capabilityRulesChain([
        { capabilityKey: "sales_offers", enabled: true },
      ]));

    const tier = await loadTier(1);
    expect(tier?.tierCapabilities).toEqual({ sales_offers: true });
    expect(tierAllowsFeature(tier, "sales_offers")).toBe(true);
  });

  it("returns null (no gating) when the MSP has no subscription row", async () => {
    mockDb.select = vi.fn().mockReturnValueOnce(subscriptionChain([]));
    expect(await loadTier(1)).toBeNull();
  });
});
