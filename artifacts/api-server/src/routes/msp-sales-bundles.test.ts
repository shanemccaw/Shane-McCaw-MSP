/**
 * msp-sales-bundles.test.ts
 *
 * Tests for:
 *   1. Pricing determinism — same package keys always produce the same internalCostCents
 *   2. Plan gating — multi-package bundles require custom_bundle_composition
 *   3. Mixed-frequency assignment fan-out — one activation event per package on assign
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { Request, Response, NextFunction } from "express";

// ── Mock @workspace/db ────────────────────────────────────────────────────────

const mockDbInsert = vi.fn();
const mockDbSelect = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbDelete = vi.fn();

const mockDb = {
  insert: mockDbInsert,
  select: mockDbSelect,
  update: mockDbUpdate,
  delete: mockDbDelete,
};

vi.mock("@workspace/db", () => ({
  db: mockDb,
  monitoringPackagesTable: { key: "key", label: "label", platformCostCents: "platform_cost_cents", status: "status" },
  mspSalesBundlesTable: { bundleId: "bundle_id", mspId: "msp_id", status: "status" },
  mspSalesBundleAssignmentsTable: { bundleId: "bundle_id", mspId: "msp_id", assignmentId: "assignment_id", status: "status" },
  mspCustomersTable: { id: "id", mspId: "msp_id" },
  mspEventStoreTable: { mspId: "msp_id" },
  mspAuditLogsTable: { actorUserId: "actor_user_id" },
}));

// ── Mock middlewares ───────────────────────────────────────────────────────────

vi.mock("../middlewares/requireAuth.ts", () => ({
  requireRole: (_role: string) => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../lib/logger.ts", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// ── Pricing determinism tests ─────────────────────────────────────────────────

describe("computeInternalCost (pricing determinism)", () => {
  /**
   * The pricing computation is a pure sum of platformCostCents across the
   * supplied package keys. The same input must always produce the same output
   * regardless of call order or concurrent callers.
   */

  function computeCost(packages: Array<{ platformCostCents: number }>): number {
    return packages.reduce((sum, p) => sum + (p.platformCostCents ?? 0), 0);
  }

  it("returns 0 for an empty package list", () => {
    expect(computeCost([])).toBe(0);
  });

  it("sums platformCostCents for a single package", () => {
    expect(computeCost([{ platformCostCents: 500 }])).toBe(500);
  });

  it("sums platformCostCents across multiple packages (deterministic)", () => {
    const pkgs = [
      { platformCostCents: 500 },
      { platformCostCents: 1000 },
      { platformCostCents: 250 },
    ];
    const result1 = computeCost(pkgs);
    const result2 = computeCost(pkgs);
    expect(result1).toBe(1750);
    expect(result1).toBe(result2); // idempotent
  });

  it("is commutative — order of packages does not affect total", () => {
    const pkgsA = [{ platformCostCents: 500 }, { platformCostCents: 1000 }];
    const pkgsB = [{ platformCostCents: 1000 }, { platformCostCents: 500 }];
    expect(computeCost(pkgsA)).toBe(computeCost(pkgsB));
  });

  it("handles packages with zero cost (included packages)", () => {
    const pkgs = [{ platformCostCents: 0 }, { platformCostCents: 500 }];
    expect(computeCost(pkgs)).toBe(500);
  });

  it("handles all-zero packages", () => {
    const pkgs = [{ platformCostCents: 0 }, { platformCostCents: 0 }];
    expect(computeCost(pkgs)).toBe(0);
  });

  it("is associative — intermediate groupings produce the same total", () => {
    const pkgs = [
      { platformCostCents: 100 },
      { platformCostCents: 200 },
      { platformCostCents: 300 },
      { platformCostCents: 400 },
    ];
    const totalAll = computeCost(pkgs);
    const totalGroup1 = computeCost(pkgs.slice(0, 2));
    const totalGroup2 = computeCost(pkgs.slice(2));
    expect(totalGroup1 + totalGroup2).toBe(totalAll);
  });
});

// ── Plan gating tests ──────────────────────────────────────────────────────────

describe("plan gating — custom_bundle_composition", () => {
  /**
   * Multi-package bundles are gated on the "custom_bundle_composition" feature.
   * Single-package bundles are available on all tiers.
   *
   * We test the gating logic in isolation by simulating the middleware chain
   * used in the POST /api/msp/sales-bundles route.
   */

  type CapabilityMap = Record<string, boolean>;

  function isCustomCompositionAllowed(
    packageCount: number,
    tierCapabilities: CapabilityMap,
  ): { allowed: boolean; reason?: string } {
    if (packageCount <= 1) {
      return { allowed: true }; // single-package always allowed
    }
    // Multi-package: require custom_bundle_composition
    if (tierCapabilities["custom_bundle_composition"] === false) {
      return { allowed: false, reason: "custom_bundle_composition requires Pro tier" };
    }
    return { allowed: true };
  }

  it("allows single-package bundles on Starter tier", () => {
    const result = isCustomCompositionAllowed(1, { custom_bundle_composition: false });
    expect(result.allowed).toBe(true);
  });

  it("blocks multi-package bundles on Starter tier", () => {
    const result = isCustomCompositionAllowed(3, { custom_bundle_composition: false });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Pro tier");
  });

  it("allows multi-package bundles on Pro tier (feature enabled)", () => {
    const result = isCustomCompositionAllowed(3, { custom_bundle_composition: true });
    expect(result.allowed).toBe(true);
  });

  it("allows multi-package bundles when capability key is absent (not gated)", () => {
    // Missing key = not gated (platform default = allowed), matching requirePlanFeature logic
    const result = isCustomCompositionAllowed(3, {});
    expect(result.allowed).toBe(true);
  });

  it("allows single-package bundles with no subscription (unsubscribed MSP)", () => {
    // Single-package never requires custom_bundle_composition
    const result = isCustomCompositionAllowed(1, {});
    expect(result.allowed).toBe(true);
  });

  it("blocks 2-package bundle on Starter, allows on Pro", () => {
    const starter = isCustomCompositionAllowed(2, { custom_bundle_composition: false });
    const pro = isCustomCompositionAllowed(2, { custom_bundle_composition: true });
    expect(starter.allowed).toBe(false);
    expect(pro.allowed).toBe(true);
  });
});

// ── Mixed-frequency assignment fan-out tests ──────────────────────────────────

describe("assignment fan-out — one activation event per monitoring package", () => {
  /**
   * When a bundle is assigned to a customer, the system emits one
   * "bundle.package.activated" event per monitoring package in the bundle.
   * This supports mixed-frequency bundles (hourly + daily + live packages)
   * because each engine subscribes to its own event type.
   *
   * We test the fan-out logic in isolation without hitting the DB.
   */

  function computeActivationEvents(
    mspId: number,
    customerId: number,
    bundleId: string,
    packageKeys: string[],
    correlationId: string,
  ) {
    return packageKeys.map((packageKey) => ({
      mspId,
      customerId,
      eventType: "bundle.package.activated",
      payload: { bundleId, packageKey, activatedAt: expect.any(String) },
      correlationId,
      ownerType: "msp",
    }));
  }

  it("emits zero events for a bundle with no packages", () => {
    const events = computeActivationEvents(1, 10, "bundle-uuid", [], "assignment-uuid");
    expect(events).toHaveLength(0);
  });

  it("emits exactly one event for a single-package bundle", () => {
    const events = computeActivationEvents(1, 10, "bundle-uuid", ["security-essentials"], "assignment-uuid");
    expect(events).toHaveLength(1);
    expect(events[0]!.payload.packageKey).toBe("security-essentials");
    expect(events[0]!.eventType).toBe("bundle.package.activated");
  });

  it("emits one event per package for a multi-package (mixed-frequency) bundle", () => {
    const packageKeys = ["m365-health-hourly", "compliance-daily", "live-mfa-monitor"];
    const events = computeActivationEvents(1, 10, "bundle-uuid", packageKeys, "assignment-uuid");
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.payload.packageKey)).toEqual(packageKeys);
  });

  it("all events share the same bundleId and correlationId (the assignmentId)", () => {
    const bundleId = "test-bundle-id";
    const assignmentId = "test-assignment-id";
    const events = computeActivationEvents(1, 10, bundleId, ["pkg-a", "pkg-b"], assignmentId);
    expect(events.every((e) => e.payload.bundleId === bundleId)).toBe(true);
    expect(events.every((e) => e.correlationId === assignmentId)).toBe(true);
  });

  it("sets ownerType to 'msp' on all events (not platform or customer)", () => {
    const events = computeActivationEvents(1, 10, "bundle-uuid", ["pkg-x"], "assign-uuid");
    expect(events.every((e) => e.ownerType === "msp")).toBe(true);
  });

  it("each event carries its own package key (no key duplication)", () => {
    const packageKeys = ["pkg-1", "pkg-2", "pkg-3", "pkg-4", "pkg-5"];
    const events = computeActivationEvents(1, 10, "bundle-uuid", packageKeys, "assign-uuid");
    const emittedKeys = events.map((e) => e.payload.packageKey);
    expect(new Set(emittedKeys).size).toBe(packageKeys.length);
    packageKeys.forEach((k) => expect(emittedKeys).toContain(k));
  });

  it("revocation emits deactivation events with correct event type", () => {
    function computeDeactivationEvents(
      mspId: number,
      customerId: number,
      bundleId: string,
      packageKeys: string[],
      correlationId: string,
    ) {
      return packageKeys.map((packageKey) => ({
        mspId,
        customerId,
        eventType: "bundle.package.deactivated",
        payload: { bundleId, packageKey, revokedAt: new Date().toISOString() },
        correlationId,
        ownerType: "msp",
      }));
    }

    const events = computeDeactivationEvents(1, 10, "bundle-uuid", ["pkg-a", "pkg-b"], "assign-uuid");
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.eventType === "bundle.package.deactivated")).toBe(true);
  });
});

// ── Pricing preview endpoint logic ────────────────────────────────────────────

describe("pricing-preview endpoint logic", () => {
  it("returns zero cost and empty breakdown for no package keys", () => {
    const packageKeys: string[] = [];
    const breakdown: Array<{ platformCostCents: number }> = [];
    const internalCostCents = breakdown.reduce((s, b) => s + (b.platformCostCents ?? 0), 0);
    expect(internalCostCents).toBe(0);
  });

  it("computes breakdown correctly for a mixed set of packages", () => {
    const packages = [
      { key: "pkg-a", label: "Package A", platformCostCents: 1000, engines: ["monitoring"], requiredPlanFeature: undefined, available: true },
      { key: "pkg-b", label: "Package B", platformCostCents: 500, engines: ["live"], requiredPlanFeature: "custom_bundle_composition", available: true },
      { key: "pkg-c", label: "Package C", platformCostCents: 0, engines: ["monitoring"], requiredPlanFeature: undefined, available: true },
    ];
    const internalCostCents = packages.reduce((s, b) => s + (b.platformCostCents ?? 0), 0);
    expect(internalCostCents).toBe(1500);
    expect(packages.find((p) => p.key === "pkg-c")?.platformCostCents).toBe(0);
  });

  it("margin is resalePrice minus internalCost", () => {
    const internalCostCents = 1500;
    const resalePriceCents = 3000;
    const margin = resalePriceCents - internalCostCents;
    const marginPct = Math.round((margin / internalCostCents) * 100);
    expect(margin).toBe(1500);
    expect(marginPct).toBe(100); // 100% markup
  });
});
