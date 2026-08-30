/**
 * remediation-fix-route.test.ts — the fix-route resolver (#1539).
 *
 * Locks the resolved architecture's truth table: shape = min(finding ceiling,
 * tenant ceiling), with a live write pack raising the finding floor and a
 * write-denied tenant capping at `you_must_run` (a first-class posture, not a
 * degraded one).
 */

import { describe, it, expect } from "vitest";
import type { RemediationFixRoute, TenantConsentMap } from "@workspace/db";
import {
  fixRouteRank,
  minFixRoute,
  maxFixRoute,
  resolveTenantWriteCeiling,
  resolveFindingCeiling,
  resolveFixRoute,
  FIX_ROUTE_AFFORDANCE,
  FIX_ROUTES,
} from "./remediation-fix-route";

const granted: TenantConsentMap = { writeBack: { status: "granted" } };
const declined: TenantConsentMap = { writeBack: { status: "declined" } };
const revoked: TenantConsentMap = { writeBack: { status: "revoked" } };
const pending: TenantConsentMap = { writeBack: { status: "pending" } };

describe("rank + min/max", () => {
  it("ranks most-automated highest", () => {
    expect(fixRouteRank("we_can_run")).toBe(2);
    expect(fixRouteRank("you_must_run")).toBe(1);
    expect(fixRouteRank("admin_center_only")).toBe(0);
  });

  it("minFixRoute returns the less-automated shape", () => {
    expect(minFixRoute("we_can_run", "you_must_run")).toBe("you_must_run");
    expect(minFixRoute("you_must_run", "admin_center_only")).toBe("admin_center_only");
    expect(minFixRoute("we_can_run", "we_can_run")).toBe("we_can_run");
  });

  it("maxFixRoute returns the more-automated shape", () => {
    expect(maxFixRoute("admin_center_only", "we_can_run")).toBe("we_can_run");
    expect(maxFixRoute("you_must_run", "admin_center_only")).toBe("you_must_run");
  });

  it("FIX_ROUTES enumerates all three in rank order", () => {
    expect(FIX_ROUTES).toEqual(["we_can_run", "you_must_run", "admin_center_only"]);
  });
});

describe("resolveTenantWriteCeiling", () => {
  it("only 'granted' permits we_can_run", () => {
    expect(resolveTenantWriteCeiling(granted)).toBe("we_can_run");
  });

  it("every other status caps at you_must_run — never below", () => {
    expect(resolveTenantWriteCeiling(declined)).toBe("you_must_run");
    expect(resolveTenantWriteCeiling(revoked)).toBe("you_must_run");
    expect(resolveTenantWriteCeiling(pending)).toBe("you_must_run");
    expect(resolveTenantWriteCeiling({})).toBe("you_must_run");
    expect(resolveTenantWriteCeiling(null)).toBe("you_must_run");
    expect(resolveTenantWriteCeiling(undefined)).toBe("you_must_run");
  });
});

describe("resolveFindingCeiling", () => {
  it("a live write pack raises the authored floor to we_can_run", () => {
    expect(resolveFindingCeiling({ capability: "you_must_run", writePackAvailable: true })).toBe("we_can_run");
    expect(resolveFindingCeiling({ capability: "admin_center_only", writePackAvailable: true })).toBe("we_can_run");
    expect(resolveFindingCeiling({ capability: null, writePackAvailable: true })).toBe("we_can_run");
  });

  it("without a live pack the authored capability governs", () => {
    expect(resolveFindingCeiling({ capability: "we_can_run", writePackAvailable: false })).toBe("we_can_run");
    expect(resolveFindingCeiling({ capability: "you_must_run", writePackAvailable: false })).toBe("you_must_run");
    expect(resolveFindingCeiling({ capability: "admin_center_only", writePackAvailable: false })).toBe("admin_center_only");
  });

  it("a null capability with no pack defaults to admin_center_only", () => {
    expect(resolveFindingCeiling({ capability: null, writePackAvailable: false })).toBe("admin_center_only");
  });
});

describe("resolveFixRoute — the min() truth table", () => {
  const cases: Array<{
    name: string;
    capability: RemediationFixRoute | null;
    writePackAvailable: boolean;
    consent: TenantConsentMap | null;
    expected: RemediationFixRoute;
  }> = [
    // Automatable finding (write pack) — the tenant decides.
    { name: "automatable + granted → we run it", capability: "we_can_run", writePackAvailable: true, consent: granted, expected: "we_can_run" },
    { name: "automatable + write-denied → you run it (NASA posture)", capability: "we_can_run", writePackAvailable: true, consent: declined, expected: "you_must_run" },
    // Scriptable but no pack — cannot be run for them even with consent.
    { name: "script-only + granted → still you run it (no delegated path)", capability: "you_must_run", writePackAvailable: false, consent: granted, expected: "you_must_run" },
    { name: "script-only + denied → you run it", capability: "you_must_run", writePackAvailable: false, consent: revoked, expected: "you_must_run" },
    // Admin-centre-only — nothing to run; consent is irrelevant.
    { name: "admin-only + granted → admin centre", capability: "admin_center_only", writePackAvailable: false, consent: granted, expected: "admin_center_only" },
    { name: "admin-only + denied → admin centre", capability: "admin_center_only", writePackAvailable: false, consent: null, expected: "admin_center_only" },
    // A check a live pack maps but with no KB row at all.
    { name: "pack-only (no KB row) + granted → we run it", capability: null, writePackAvailable: true, consent: granted, expected: "we_can_run" },
    { name: "pack-only (no KB row) + denied → you run it", capability: null, writePackAvailable: true, consent: pending, expected: "you_must_run" },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(resolveFixRoute({ capability: c.capability, writePackAvailable: c.writePackAvailable, consent: c.consent })).toBe(c.expected);
    });
  }
});

describe("affordance mapping", () => {
  it("maps each shape to how its control behaves", () => {
    expect(FIX_ROUTE_AFFORDANCE.we_can_run).toBe("execute");
    expect(FIX_ROUTE_AFFORDANCE.you_must_run).toBe("copy");
    expect(FIX_ROUTE_AFFORDANCE.admin_center_only).toBe("link");
  });
});
