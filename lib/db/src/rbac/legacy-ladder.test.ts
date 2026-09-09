/**
 * Unit tests for the transcription of today's model (#2457, part of #1696).
 *
 * The parity harness (./parity-check.ts) proves that the SEEDED DATA agrees with
 * this module. It cannot prove that this module agrees with the running product —
 * both sides of that comparison would be wrong together. These tests are the
 * other half: they pin the transcription itself, including the parts that look
 * like mistakes and are not (ServiceAccount outranking a human customer; two
 * capability columns that are read asymmetrically), so that a later session
 * "correcting" one of them fails loudly instead of quietly moving a permission.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  CAPABILITY_COLUMN_ROLE_KEYS,
  LADDER_CAPABILITY_KEYS,
  LEGACY_CAPABILITY_RULES,
  LEGACY_ROLE_ORDER,
  effectiveLegacyRole,
  isLegacyRole,
  ladderCapabilityKey,
  ladderCapabilityRole,
  legacyDecision,
  legacyRequireRole,
  legacyRoleIndex,
  type LegacyRole,
  type LegacyUserRow,
} from "./legacy-ladder";

/** A principal shape. Defaults to the least privileged thing that can exist. */
function principal(over: Partial<LegacyUserRow> = {}): LegacyUserRow {
  return {
    id: 1,
    role: "client",
    mspRole: "Assessment",
    mspId: 1,
    tenantId: 1,
    canApprovePurchases: false,
    canManageTeam: false,
    canApproveChanges: false,
    ...over,
  };
}

describe("the ladder is transcribed from the live requireAuth.ts, not from memory", () => {
  it("matches ROLE_ORDER in artifacts/api-server/src/middlewares/requireAuth.ts", () => {
    const here = fileURLToPath(new URL(".", import.meta.url));
    const path = `${here}../../../../artifacts/api-server/src/middlewares/requireAuth.ts`;

    let source: string;
    try {
      source = readFileSync(path, "utf8");
    } catch {
      throw new Error(
        `Could not read ${path}. This module is a transcription of that file's ROLE_ORDER; ` +
          `if the file has moved, the transcription needs re-verifying against wherever it went, ` +
          `not this test deleting.`,
      );
    }

    const block = /const ROLE_ORDER: MspRole\[\] = \[([^\]]*)\]/.exec(source);
    expect(block, "ROLE_ORDER is no longer declared in the shape this test reads").not.toBeNull();

    const live = [...block![1]!.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]);
    expect(live).toEqual([...LEGACY_ROLE_ORDER]);
  });
});

describe("legacyRoleIndex", () => {
  it("is the array index, ascending in privilege", () => {
    LEGACY_ROLE_ORDER.forEach((role, i) => expect(legacyRoleIndex(role)).toBe(i));
  });

  it("returns -1 for an absent or unrecognised role, which fails every real floor", () => {
    for (const value of [undefined, null, "", "CustomerAdmin", "admin"]) {
      expect(legacyRoleIndex(value)).toBe(-1);
      // Every floor in the codebase is a real rung, so index 0 is the lowest
      // anything is ever compared against.
      expect(legacyRoleIndex(value) >= legacyRoleIndex("Assessment")).toBe(false);
    }
  });
});

describe("effectiveLegacyRole — the legacy admin promotion (requireAuth.ts:210-212)", () => {
  it("promotes role='admin' to PlatformAdmin regardless of msp_role", () => {
    expect(effectiveLegacyRole({ role: "admin", mspRole: "Assessment" })).toBe("PlatformAdmin");
    expect(effectiveLegacyRole({ role: "admin", mspRole: null })).toBe("PlatformAdmin");
    expect(effectiveLegacyRole({ role: "admin", mspRole: "PlatformAdmin" })).toBe("PlatformAdmin");
  });

  it("otherwise reads msp_role, and yields undefined for anything unrecognised", () => {
    expect(effectiveLegacyRole({ role: "client", mspRole: "MSPOperator" })).toBe("MSPOperator");
    expect(effectiveLegacyRole({ role: "client", mspRole: null })).toBeUndefined();
    expect(effectiveLegacyRole({ role: "client", mspRole: "CustomerAdmin" })).toBeUndefined();
  });
});

describe("legacyRequireRole", () => {
  it("is exactly the index comparison, for every rung against every floor", () => {
    for (const held of LEGACY_ROLE_ORDER) {
      for (const floor of LEGACY_ROLE_ORDER) {
        expect(legacyRequireRole({ role: "client", mspRole: held }, floor)).toBe(
          legacyRoleIndex(held) >= legacyRoleIndex(floor),
        );
      }
    }
  });

  it("has no sideways permission — every rung is a strict superset of the one below", () => {
    // This is the property #1696 says makes the model unfixable by adding roles:
    // there is no capability a lower rung has that a higher rung lacks.
    for (let i = 1; i < LEGACY_ROLE_ORDER.length; i++) {
      const lower = LEGACY_ROLE_ORDER[i - 1]!;
      const higher = LEGACY_ROLE_ORDER[i]!;
      for (const floor of LEGACY_ROLE_ORDER) {
        if (legacyRequireRole({ role: "client", mspRole: lower }, floor)) {
          expect(legacyRequireRole({ role: "client", mspRole: higher }, floor)).toBe(true);
        }
      }
    }
  });

  it("puts a ServiceAccount ABOVE a human CustomerUser — the artifact, carried across on purpose", () => {
    expect(legacyRequireRole({ role: "client", mspRole: "ServiceAccount" }, "CustomerUser")).toBe(true);
    expect(legacyRequireRole({ role: "client", mspRole: "CustomerUser" }, "ServiceAccount")).toBe(false);
  });
});

describe("ladder capability keys", () => {
  it("covers every rung, one key each, with no collisions", () => {
    const keys = LEGACY_ROLE_ORDER.map(ladderCapabilityKey);
    expect(keys).toHaveLength(LEGACY_ROLE_ORDER.length);
    expect(new Set(keys).size).toBe(LEGACY_ROLE_ORDER.length);
    expect(Object.keys(LADDER_CAPABILITY_KEYS).sort()).toEqual([...LEGACY_ROLE_ORDER].sort());
  });

  it("round-trips, and rejects anything that is not a ladder key", () => {
    for (const role of LEGACY_ROLE_ORDER) {
      expect(ladderCapabilityRole(ladderCapabilityKey(role))).toBe(role);
    }
    expect(ladderCapabilityRole("ladder.MSPAdmin")).toBeUndefined(); // wrong spelling
    expect(ladderCapabilityRole("billing.view")).toBeUndefined();
    expect(ladderCapabilityRole("ladder.")).toBeUndefined();
  });

  it("obeys the catalog's lowercase key convention", () => {
    for (const role of LEGACY_ROLE_ORDER) {
      expect(ladderCapabilityKey(role)).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/);
    }
  });
});

describe("isLegacyRole", () => {
  it("accepts exactly the seven MSP_ROLES values", () => {
    for (const role of LEGACY_ROLE_ORDER) expect(isLegacyRole(role)).toBe(true);
    for (const other of ["CustomerAdmin", "admin", "client", "", null, undefined]) {
      expect(isLegacyRole(other)).toBe(false);
    }
  });
});

describe("the capability columns are read ASYMMETRICALLY today, and the transcription keeps that", () => {
  const asRole = (mspRole: LegacyRole, over: Partial<LegacyUserRow> = {}) => principal({ mspRole, ...over });

  it("msp:purchases.approve consults the flag only on the MSPOperator branch", () => {
    // msp-v1.ts:337-351 — the two top rungs decide by role...
    expect(legacyDecision(asRole("MSPAdmin"), "msp", "purchases.approve")).toBe(true);
    expect(legacyDecision(asRole("PlatformAdmin"), "msp", "purchases.approve")).toBe(true);
    // ...MSPOperator needs the flag...
    expect(legacyDecision(asRole("MSPOperator"), "msp", "purchases.approve")).toBe(false);
    expect(legacyDecision(asRole("MSPOperator", { canApprovePurchases: true }), "msp", "purchases.approve")).toBe(true);
    // ...and on anyone else the column grants NOTHING. Seeding it as a grant
    // would be a privilege escalation dressed up as a transcription.
    for (const role of ["Assessment", "Free", "CustomerUser", "ServiceAccount"] as const) {
      expect(legacyDecision(asRole(role, { canApprovePurchases: true }), "msp", "purchases.approve")).toBe(false);
    }
  });

  it("customer:team.manage exempts the three customer tiers only — so ServiceAccount passes flagless", () => {
    // portal-team.ts:40-54 tests isCustomerTier, an allow-list of three NAMES.
    for (const role of ["Assessment", "Free", "CustomerUser"] as const) {
      expect(legacyDecision(asRole(role), "customer", "team.manage")).toBe(false);
      expect(legacyDecision(asRole(role, { canManageTeam: true }), "customer", "team.manage")).toBe(true);
    }
    for (const role of ["ServiceAccount", "MSPOperator", "MSPAdmin", "PlatformAdmin"] as const) {
      expect(legacyDecision(asRole(role), "customer", "team.manage")).toBe(true);
    }
  });

  it("customer:changes.approve names three roles — and ServiceAccount is NOT one of them", () => {
    // portal-change-control.ts:493-506. The mirror image of the test above: the
    // two columns look symmetrical in the schema and are not in the code.
    for (const role of ["MSPOperator", "MSPAdmin", "PlatformAdmin"] as const) {
      expect(legacyDecision(asRole(role), "customer", "changes.approve")).toBe(true);
    }
    for (const role of ["Assessment", "Free", "CustomerUser", "ServiceAccount"] as const) {
      expect(legacyDecision(asRole(role), "customer", "changes.approve")).toBe(false);
      expect(legacyDecision(asRole(role, { canApproveChanges: true }), "customer", "changes.approve")).toBe(true);
    }
  });

  it("the two team-management capabilities disagree about ServiceAccount, deliberately", () => {
    const svc = asRole("ServiceAccount");
    expect(legacyDecision(svc, "customer", "team.manage")).toBe(true);
    expect(legacyDecision(svc, "customer", "changes.approve")).toBe(false);
  });

  it("msp:team.manage is the MSPAdmin rung exactly", () => {
    for (const role of LEGACY_ROLE_ORDER) {
      expect(legacyDecision(asRole(role), "msp", "team.manage")).toBe(
        legacyDecision(asRole(role), "msp", ladderCapabilityKey("MSPAdmin")),
      );
    }
  });

  it("customer:billing.view is open to every authenticated principal today", () => {
    for (const role of LEGACY_ROLE_ORDER) {
      expect(legacyDecision(asRole(role), "customer", "billing.view")).toBe(true);
    }
    // Including one with no recognised role at all — portal-billing.ts is
    // requireAuth and nothing else. See #3360.
    expect(legacyDecision(principal({ mspRole: "NotARole" }), "customer", "billing.view")).toBe(true);
  });

  it("customer:team.manage FAILS OPEN for an unrecognised role — the #3360 defect, recorded not reproduced", () => {
    // isCustomerTier is false for an unknown role, so the live code takes its
    // permitted branch. The new model denies this principal instead, which is
    // why parity-check.ts registers it as a known fail-closed divergence rather
    // than seeding a rung the user does not have.
    expect(legacyDecision(principal({ mspRole: "NotARole" }), "customer", "team.manage")).toBe(true);
    expect(legacyDecision(principal({ mspRole: null }), "customer", "team.manage")).toBe(true);
  });
});

describe("legacyDecision", () => {
  it("answers every rung capability by the ladder", () => {
    for (const held of LEGACY_ROLE_ORDER) {
      for (const floor of LEGACY_ROLE_ORDER) {
        expect(legacyDecision(principal({ mspRole: held }), "msp", ladderCapabilityKey(floor))).toBe(
          legacyRoleIndex(held) >= legacyRoleIndex(floor),
        );
      }
    }
  });

  it("carries the admin promotion into capability answers, not just requireRole", () => {
    const legacyAdmin = principal({ role: "admin", mspRole: "Assessment" });
    expect(legacyDecision(legacyAdmin, "msp", ladderCapabilityKey("PlatformAdmin"))).toBe(true);
    expect(legacyDecision(legacyAdmin, "msp", "purchases.approve")).toBe(true);
    expect(legacyDecision(legacyAdmin, "customer", "changes.approve")).toBe(true);
  });

  it("throws rather than defaulting for a capability with no transcribed rule", () => {
    // A reference implementation that silently returns false for a key it does
    // not know turns a missing rule into a passing comparison.
    expect(() => legacyDecision(principal(), "msp", "not.a.capability")).toThrow(/no transcribed rule/);
    expect(() => legacyDecision(principal(), "msp", "billing.view")).toThrow(/no transcribed rule/);
  });

  it("has one rule per (system, key), with no duplicates", () => {
    const ids = LEGACY_CAPABILITY_RULES.map((r) => `${r.system}:${r.key}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("cites a real source on every rule", () => {
    for (const rule of LEGACY_CAPABILITY_RULES) {
      expect(rule.source).toMatch(/artifacts\/api-server\/src\/.+\.ts:\d+/);
    }
  });
});

describe("the capability-column role keys", () => {
  it("are distinct and namespaced away from the rungs", () => {
    const keys = Object.values(CAPABILITY_COLUMN_ROLE_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key.startsWith("cap.")).toBe(true);
      expect(isLegacyRole(key)).toBe(false);
    }
  });
});
