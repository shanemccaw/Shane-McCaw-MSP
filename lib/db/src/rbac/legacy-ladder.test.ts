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
  CUSTOMER_PLATFORM_ROLE_KEYS,
  LADDER,
  LADDER_CAPABILITY_KEYS,
  LEGACY_CAPABILITY_RULES,
  LEGACY_CUSTOMER_TIER_ROLES,
  LEGACY_MSP_STAFF_ROLES,
  LEGACY_ROLE,
  LEGACY_ROLE_ORDER,
  RETIRED_ROLE_VALUES,
  canonicalRoleValue,
  effectiveLegacyRole,
  isLegacyRole,
  ladderCapabilityKey,
  ladderCapabilityRole,
  legacyDecision,
  legacyRequireRole,
  legacyRoleIndex,
  type LegacyRole,
  type LegacyUserRow,
} from "./legacy-ladder.ts";

/** A principal shape. Defaults to the least privileged thing that can exist. */
function principal(over: Partial<LegacyUserRow> = {}): LegacyUserRow {
  return {
    id: 1,
    role: "client",
    mspRole: "Free",
    mspId: 1,
    tenantId: 1,
    canApprovePurchases: false,
    canManageTeam: false,
    canApproveChanges: false,
    ...over,
  };
}

describe("this module is now the ONLY copy of the ordering (#2460)", () => {
  it("requireAuth.ts declares no ordering array and no index comparison", () => {
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

    // Until #2460 this test read requireAuth.ts's own `ROLE_ORDER` array and
    // asserted LEGACY_ROLE_ORDER matched it byte for byte — a drift guard between
    // two live copies of the same ordering. #2460 deleted that array, `roleIndex()`
    // and `MSP_ROLES` itself, so there is no second copy left to drift from: this
    // module is the migration's compatibility shim and the only transcription.
    //
    // The guard that still earns its place is the inverse one. Reintroducing an
    // ordering comparison in the middleware is exactly the regression #1696 exists
    // to prevent — it would be a rule the database does not know about, silently
    // outranking the seeded `ladder.*` rows the real gate decides from.
    expect(source, "ROLE_ORDER was retired by #2460 — a new one is a second, unseeded copy of the ladder")
      .not.toMatch(/const\s+ROLE_ORDER\b/);
    expect(source, "roleIndex() was retired by #2460 — an ordering comparison here is not visible to the RBAC model")
      .not.toMatch(/function\s+roleIndex\b/);

    // And the strings themselves are gone from it — #2460's own mechanical contract.
    for (const role of LEGACY_ROLE_ORDER) {
      expect(source, `requireAuth.ts still contains the "${role}" literal`).not.toContain(`"${role}"`);
    }
  });

  it("exposes the seven values by name, so no other file needs the literal", () => {
    expect(Object.values(LEGACY_ROLE).sort()).toEqual([...LEGACY_ROLE_ORDER].sort());
    expect([...LEGACY_MSP_STAFF_ROLES]).toEqual(["MSPAdmin", "MSPOperator"]);
    expect([...LEGACY_CUSTOMER_TIER_ROLES]).toEqual(["Customer", "Free"]);
    // LADDER is the capability-key face of the same seven, and must agree with the
    // rung → key map the seed was computed from.
    expect(Object.values(LADDER).sort()).toEqual(Object.values(LADDER_CAPABILITY_KEYS).sort());
    expect(LADDER.mspAdmin).toBe(ladderCapabilityKey("MSPAdmin"));
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
      expect(legacyRoleIndex(value) >= legacyRoleIndex("Free")).toBe(false);
    }
  });
});

describe("effectiveLegacyRole — the legacy admin promotion (requireAuth.ts:210-212)", () => {
  it("promotes role='admin' to PlatformAdmin regardless of msp_role", () => {
    expect(effectiveLegacyRole({ role: "admin", mspRole: "Free" })).toBe("PlatformAdmin");
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

  it("puts a ServiceAccount ABOVE a human Customer — the artifact, carried across on purpose", () => {
    expect(legacyRequireRole({ role: "client", mspRole: "ServiceAccount" }, "Customer")).toBe(true);
    expect(legacyRequireRole({ role: "client", mspRole: "Customer" }, "ServiceAccount")).toBe(false);
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
  it("accepts exactly the seven legacy role values", () => {
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
    for (const role of ["Free", "Customer", "ServiceAccount"] as const) {
      expect(legacyDecision(asRole(role, { canApprovePurchases: true }), "msp", "purchases.approve")).toBe(false);
    }
  });

  it("customer:team.manage exempts the three customer tiers only — so ServiceAccount passes flagless", () => {
    // portal-team.ts before #2460 tested isCustomerTier, an allow-list of three NAMES.
    for (const role of ["Free", "Customer"] as const) {
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
    for (const role of ["Free", "Customer", "ServiceAccount"] as const) {
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

  it("customer:billing.view and customer:billing.manage are MSP staff by rung, nobody below them (#3629)", () => {
    // #3465 transcribed both as every rung (the routes were requireAuth only); #3629
    // narrowed them by decision — Shane, 2026-09-11, resolving #3587.
    for (const key of ["billing.view", "billing.manage"]) {
      const allowed = LEGACY_ROLE_ORDER.filter((rung) => legacyDecision(asRole(rung), "customer", key));
      expect(allowed, key).toEqual([LEGACY_ROLE.mspOperator, LEGACY_ROLE.mspAdmin, LEGACY_ROLE.platformAdmin]);
      expect(legacyDecision(principal({ role: "admin" }), "customer", key), key).toBe(true);
      // No capability COLUMN reaches billing — only #3629's two role memberships do.
      const everyColumn = { canApprovePurchases: true, canManageTeam: true, canApproveChanges: true };
      expect(legacyDecision(asRole("Customer", everyColumn), "customer", key), key).toBe(false);
      // A principal with no recognised rung now holds nothing unless granted a role,
      // which is why parity-check.ts no longer registers the two #3360 billing twins.
      expect(legacyDecision(principal({ mspRole: "NotARole" }), "customer", key), key).toBe(false);
      expect(legacyDecision(principal({ mspRole: "NotARole", billingRole: true }), "customer", key), key).toBe(true);
    }
  });

  it("customer:team.manage FAILS OPEN for an unrecognised role — the #3360 defect, recorded not reproduced", () => {
    // isCustomerTier was false for an unknown role, so the pre-#2460 code took its
    // permitted branch. The new model denies this principal instead — and so has
    // the live route since #2460 (pinned by portal-team.test.ts) — which is why
    // parity-check.ts registers it as a known fail-closed divergence rather than
    // seeding a rung the user does not have.
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
    const legacyAdmin = principal({ role: "admin", mspRole: "Free" });
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

describe("#3590 — CustomerUser renamed Customer, Assessment folded into Free", () => {
  const row = (mspRole: string | null, role = "client"): LegacyUserRow => ({
    id: 1, role, mspRole, mspId: 1, tenantId: 1,
    canApprovePurchases: false, canManageTeam: false, canApproveChanges: false,
  });

  it("maps exactly the two retired values, and nothing else", () => {
    expect(canonicalRoleValue("CustomerUser")).toBe(LEGACY_ROLE.customer);
    expect(canonicalRoleValue("Assessment")).toBe(LEGACY_ROLE.free);
    expect(canonicalRoleValue(LEGACY_ROLE.mspAdmin)).toBe(LEGACY_ROLE.mspAdmin);
    expect(canonicalRoleValue("NotARole")).toBe("NotARole");
    expect(canonicalRoleValue(undefined)).toBeUndefined();
    expect(canonicalRoleValue(null)).toBeNull();
    // An inherited property name is not an alias.
    expect(canonicalRoleValue("toString")).toBe("toString");
  });

  it("never lets a retired value stand as a rung in its own right, and always points at a real one", () => {
    for (const [retired, current] of Object.entries(RETIRED_ROLE_VALUES)) {
      expect(isLegacyRole(retired)).toBe(false);
      expect(isLegacyRole(current)).toBe(true);
    }
  });

  it("reads a pre-rename claim as the rung it became", () => {
    expect(effectiveLegacyRole({ role: "client", mspRole: "CustomerUser" })).toBe(LEGACY_ROLE.customer);
    expect(effectiveLegacyRole({ role: "client", mspRole: "Assessment" })).toBe(LEGACY_ROLE.free);
    expect(legacyRequireRole({ role: "client", mspRole: "CustomerUser" }, LEGACY_ROLE.customer)).toBe(true);
    expect(legacyRequireRole({ role: "client", mspRole: "Assessment" }, LEGACY_ROLE.customer)).toBe(false);
  });

  it("customer:marketplace.browse-full is every rung except the pre-payment Free rung", () => {
    const allowed = LEGACY_ROLE_ORDER.filter((rung) => legacyDecision(row(rung), "customer", "marketplace.browse-full"));
    expect(allowed).toEqual([
      LEGACY_ROLE.customer,
      LEGACY_ROLE.serviceAccount,
      LEGACY_ROLE.mspOperator,
      LEGACY_ROLE.mspAdmin,
      LEGACY_ROLE.platformAdmin,
    ]);
    expect(legacyDecision(row(LEGACY_ROLE.free, "admin"), "customer", "marketplace.browse-full")).toBe(true);
  });
});

describe("#3629 — the Customer Admin and Billing platform roles", () => {
  const customerKeys = LEGACY_CAPABILITY_RULES.filter((rule) => rule.system === "customer").map((rule) => rule.key);
  const isBilling = (key: string) => key === "billing.view" || key === "billing.manage";

  it("Customer Admin holds every customer-system capability, even on the Free rung", () => {
    expect([...customerKeys].sort()).toEqual(
      ["billing.manage", "billing.view", "changes.approve", "marketplace.browse-full", "team.manage"],
    );
    for (const key of customerKeys) {
      expect(legacyDecision(principal({ mspRole: "Free" }), "customer", key), key).toBe(false);
      expect(legacyDecision(principal({ mspRole: "Free", customerAdmin: true }), "customer", key), key).toBe(true);
    }
  });

  it("Billing adds billing.view and billing.manage and nothing else", () => {
    for (const rung of ["Free", "Customer"] as const) {
      for (const key of customerKeys) {
        const without = legacyDecision(principal({ mspRole: rung }), "customer", key);
        const withBilling = legacyDecision(principal({ mspRole: rung, billingRole: true }), "customer", key);
        expect(withBilling, `${rung} ${key}`).toBe(isBilling(key) ? true : without);
        if (isBilling(key)) expect(without, `${rung} ${key}`).toBe(false);
      }
    }
  });

  it("neither role reaches the MSP system", () => {
    const base = principal({ mspRole: "Customer" });
    for (const rule of LEGACY_CAPABILITY_RULES.filter((r) => r.system === "msp")) {
      expect(legacyDecision({ ...base, customerAdmin: true, billingRole: true }, "msp", rule.key), rule.key).toBe(
        legacyDecision(base, "msp", rule.key),
      );
    }
  });

  it("the role keys are distinct, are not rungs, and do not collide with the capability-column roles", () => {
    const keys = Object.values(CUSTOMER_PLATFORM_ROLE_KEYS);
    const all = [...keys, ...Object.values(CAPABILITY_COLUMN_ROLE_KEYS)];
    expect(new Set(all).size).toBe(all.length);
    for (const key of keys) expect(isLegacyRole(key)).toBe(false);
  });
});
