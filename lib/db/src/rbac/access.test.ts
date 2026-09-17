/**
 * #4191 — `evaluateAccess()` under test, every branch, and the ordering guarantee
 * asserted directly rather than inferred from outcomes.
 *
 * Shane's 2026-08-29 decision on #1704 makes RBAC-before-tier a rule, not a preference:
 * *"Evaluate RBAC first. If a person may not do a thing at all, telling them to upgrade
 * is wrong and leaks what the org has not bought to someone who could not use it
 * anyway."* The "never reads the tier input" case below therefore proxies the input and
 * fails the moment `tier` is touched on an RBAC denial — an implementation that
 * evaluated both and merely reported RBAC first would fail it.
 *
 * Both identity systems go through `evaluateCapability`, already covered by
 * ./evaluate.test.ts; here the RBAC half is driven only far enough to produce each of
 * its four effects, and the composition is what is under test.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  evaluateAccess,
  lowestTierBundling,
  TIER_UPGRADE_PATH,
  type AccessEvaluationInput,
  type TierCatalogEntry,
  type TierEvaluationInput,
} from "./access.ts";
import type { RbacEvaluationInput, RbacFeatureMapping } from "./evaluate.ts";
import {
  PORTAL_TIER_MODULE_KEYS,
  PORTAL_TIER_MODULE_KEY_LIST,
  isPortalTierModuleKey,
  type PortalTierModuleKey,
} from "./tier-modules.ts";

// Stable role ids — real uuids, because that is what the columns hold (#1696 req. 2).
const ENGINEER = "11111111-1111-4111-8111-111111111111";
const OWNER = "33333333-3333-4333-8333-333333333333";

const TENANT = 42;
const OTHER_TENANT = 43;

const CAPABILITY = "billing.view"; // a real customer-system catalog key

function mapping(partial: Partial<RbacFeatureMapping> & Pick<RbacFeatureMapping, "capabilityKey">): RbacFeatureMapping {
  return { system: "customer", orgId: null, allow: [], deny: [], ...partial };
}

/** RBAC input that ALLOWS: the held role is in the allow set. */
function rbacAllowing(): RbacEvaluationInput {
  return {
    system: "customer",
    capability: CAPABILITY,
    orgId: TENANT,
    roleIds: [OWNER],
    mappings: [mapping({ capabilityKey: CAPABILITY, orgId: TENANT, allow: [OWNER] })],
  };
}

/** RBAC input that DENIES explicitly: the held role is in the deny set (effect `deny`). */
function rbacDenying(): RbacEvaluationInput {
  return {
    system: "customer",
    capability: CAPABILITY,
    orgId: TENANT,
    roleIds: [ENGINEER, OWNER],
    mappings: [mapping({ capabilityKey: CAPABILITY, orgId: TENANT, allow: [OWNER], deny: [ENGINEER] })],
  };
}

/** RBAC input with no grant at all (effect `unset`). */
function rbacUnset(): RbacEvaluationInput {
  return {
    system: "customer",
    capability: CAPABILITY,
    orgId: TENANT,
    roleIds: [ENGINEER],
    mappings: [mapping({ capabilityKey: CAPABILITY, orgId: TENANT, allow: [OWNER] })],
  };
}

// The tier ladder as the #1168 migration writes it and the live `services` rows carry it
// (sort_order 1–12, two brackets per tier kept here to exercise multi-row tiers). Test
// input, mirroring real rows — nothing the product reads.
const FOUNDATION_FEATURES = ["policy_decisions", "risk_register"];
const GROWTH_FEATURES = [...FOUNDATION_FEATURES, "runbooks", "remediation_tracking", "sops_runbooks", "message_center"];
const PREMIER_FEATURES = [...GROWTH_FEATURES, "ownership", "security_plan", "pii_governance", "poams"];

const CATALOG: readonly TierCatalogEntry[] = [
  { tier: "foundation", sortOrder: 1, includedFeatures: FOUNDATION_FEATURES },
  { tier: "foundation", sortOrder: 2, includedFeatures: FOUNDATION_FEATURES },
  { tier: "growth", sortOrder: 5, includedFeatures: GROWTH_FEATURES },
  { tier: "growth", sortOrder: 6, includedFeatures: GROWTH_FEATURES },
  { tier: "premier", sortOrder: 9, includedFeatures: PREMIER_FEATURES },
  { tier: "premier", sortOrder: 10, includedFeatures: PREMIER_FEATURES },
];

function tierOn(currentTier: "foundation" | "growth" | "premier", moduleKey: PortalTierModuleKey): TierEvaluationInput {
  const includedFeatures =
    currentTier === "foundation" ? FOUNDATION_FEATURES : currentTier === "growth" ? GROWTH_FEATURES : PREMIER_FEATURES;
  return { moduleKey, includedFeatures, currentTier, catalog: CATALOG };
}

describe("RBAC first (#1704 rule 1)", () => {
  it("denies on basis rbac when RBAC denies, even though the org's tier would have covered the module", () => {
    const decision = evaluateAccess({
      rbac: rbacDenying(),
      tier: tierOn("premier", PORTAL_TIER_MODULE_KEYS.securityPlan),
    });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.basis).toBe("rbac");
    if (decision.basis !== "rbac") return;
    expect(decision.capability).toBe(CAPABILITY);
    expect(decision.system).toBe("customer");
    expect(decision.rbac.effect).toBe("deny");
    expect(decision.rbac.decidedBy).toEqual([ENGINEER]);
    expect(decision.reason).toContain(`"customer:${CAPABILITY}"`);
    // Nothing about the tier leaks into an RBAC denial.
    expect(decision).not.toHaveProperty("requiredTier");
    expect(decision).not.toHaveProperty("upgradePath");
    expect(decision.reason).not.toMatch(/tier|premier|upgrade/i);
  });

  it("never reads the tier input when RBAC denies — the ordering is structural, not cosmetic", () => {
    const reads: PropertyKey[] = [];
    const tierTrap = new Proxy({} as TierEvaluationInput, {
      get(_target, prop) {
        throw new Error(`tier.${String(prop)} was read on an RBAC denial`);
      },
    });
    const input = new Proxy<AccessEvaluationInput>(
      { rbac: rbacDenying(), tier: tierTrap },
      {
        get(target, prop, receiver) {
          reads.push(prop);
          return Reflect.get(target, prop, receiver);
        },
      },
    );

    const decision = evaluateAccess(input);

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.basis).toBe("rbac");
    expect(reads).toContain("rbac");
    expect(reads).not.toContain("tier");
  });

  it("denies on basis rbac when BOTH halves would fail — RBAC owns the explanation", () => {
    const decision = evaluateAccess({
      rbac: rbacDenying(),
      tier: tierOn("foundation", PORTAL_TIER_MODULE_KEYS.securityPlan),
    });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.basis).toBe("rbac");
  });

  it("denies on basis rbac with tier null too — no tier axis does not soften an RBAC denial", () => {
    const decision = evaluateAccess({ rbac: rbacUnset(), tier: null });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.basis).toBe("rbac");
    expect(decision.rbac.effect).toBe("unset");
  });

  it("carries a distinct human-readable reason for each RBAC effect", () => {
    const denied = evaluateAccess({ rbac: rbacDenying(), tier: null });
    const unset = evaluateAccess({ rbac: rbacUnset(), tier: null });
    const unknown = evaluateAccess({
      rbac: { ...rbacAllowing(), capability: "billing.veiw" }, // typo'd key: not in the catalog
      tier: null,
    });

    for (const decision of [denied, unset, unknown]) {
      expect(decision.allowed).toBe(false);
      if (decision.allowed) continue;
      expect(decision.basis).toBe("rbac");
      expect(decision.reason.length).toBeGreaterThan(20);
    }
    if (denied.allowed || unset.allowed || unknown.allowed) return;

    expect(denied.reason).toMatch(/explicitly denies/);
    expect(denied.reason).toMatch(/deny wins/);
    expect(unset.reason).toMatch(/No role this user holds grants/);
    expect(unknown.reason).toMatch(/not a catalogued capability/);
    expect(unknown.reason).toMatch(/failing closed/);
    expect(new Set([denied.reason, unset.reason, unknown.reason]).size).toBe(3);
  });

  it("composes evaluateCapability's own org scoping — a foreign org's grant is not honoured", () => {
    const decision = evaluateAccess({
      rbac: {
        system: "customer",
        capability: CAPABILITY,
        orgId: TENANT,
        roleIds: [OWNER],
        mappings: [mapping({ capabilityKey: CAPABILITY, orgId: OTHER_TENANT, allow: [OWNER] })],
      },
      tier: tierOn("premier", PORTAL_TIER_MODULE_KEYS.securityPlan),
    });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.basis).toBe("rbac");
    expect(decision.rbac.effect).toBe("unset");
  });
});

describe("allow", () => {
  it("allows when RBAC allows and the action has no tier axis (tier: null)", () => {
    const decision = evaluateAccess({ rbac: rbacAllowing(), tier: null });

    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    expect(decision.tier).toBeNull();
    expect(decision.rbac.effect).toBe("allow");
    expect(decision.rbac.decidedBy).toEqual([OWNER]);
  });

  it("allows when RBAC allows and the org's tier bundles the module, recording what was checked", () => {
    const decision = evaluateAccess({
      rbac: rbacAllowing(),
      tier: tierOn("growth", PORTAL_TIER_MODULE_KEYS.runbooks),
    });

    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    expect(decision.tier).toEqual({ moduleKey: "runbooks", currentTier: "growth" });
    expect(decision.rbac.effect).toBe("allow");
  });

  it("allows on the minimal tier input shape (no currentTier, no catalog) when the module is bundled", () => {
    const decision = evaluateAccess({
      rbac: rbacAllowing(),
      tier: { moduleKey: PORTAL_TIER_MODULE_KEYS.riskRegister, includedFeatures: FOUNDATION_FEATURES },
    });

    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    expect(decision.tier).toEqual({ moduleKey: "risk_register", currentTier: null });
  });
});

describe("entitlement, only after RBAC allows (#1704 rule 2)", () => {
  it("denies on basis entitlement with the real requiredTier and the portal upgrade path", () => {
    const decision = evaluateAccess({
      rbac: rbacAllowing(),
      tier: tierOn("growth", PORTAL_TIER_MODULE_KEYS.securityPlan),
    });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.basis).toBe("entitlement");
    if (decision.basis !== "entitlement") return;
    expect(decision.requiredTier).toBe("premier");
    expect(decision.upgradePath).toBe(TIER_UPGRADE_PATH);
    expect(decision.moduleKey).toBe("security_plan");
    expect(decision.currentTier).toBe("growth");
    // The RBAC half that allowed rides along for the audit record.
    expect(decision.rbac.allowed).toBe(true);
    expect(decision.rbac.effect).toBe("allow");
    expect(decision.reason).toBe(
      'Monitoring tier "growth" does not bundle "security_plan"; it is included from the "premier" tier.',
    );
  });

  it("names the LOWEST tier that bundles the module, whichever order the catalog rows arrive in", () => {
    const orders: readonly (readonly TierCatalogEntry[])[] = [
      CATALOG,
      [...CATALOG].reverse(),
      [CATALOG[4]!, CATALOG[2]!, CATALOG[0]!, CATALOG[5]!, CATALOG[3]!, CATALOG[1]!],
    ];

    for (const catalog of orders) {
      const decision = evaluateAccess({
        rbac: rbacAllowing(),
        tier: { moduleKey: PORTAL_TIER_MODULE_KEYS.runbooks, includedFeatures: FOUNDATION_FEATURES, currentTier: "foundation", catalog },
      });
      expect(decision.allowed).toBe(false);
      if (decision.allowed || decision.basis !== "entitlement") continue;
      // runbooks is in Growth AND Premier; the answer is the lower of the two.
      expect(decision.requiredTier).toBe("growth");
    }
  });

  it("says there is no active subscription when includedFeatures is empty and no currentTier is known", () => {
    const decision = evaluateAccess({
      rbac: rbacAllowing(),
      tier: { moduleKey: PORTAL_TIER_MODULE_KEYS.policyDecisions, includedFeatures: [], catalog: CATALOG },
    });

    expect(decision.allowed).toBe(false);
    if (decision.allowed || decision.basis !== "entitlement") return;
    expect(decision.currentTier).toBeNull();
    expect(decision.requiredTier).toBe("foundation");
    expect(decision.reason).toBe(
      'No active Monitoring tier subscription bundles "policy_decisions"; it is included from the "foundation" tier.',
    );
  });

  it("describes an unnamed current tier without inventing its name", () => {
    const decision = evaluateAccess({
      rbac: rbacAllowing(),
      tier: { moduleKey: PORTAL_TIER_MODULE_KEYS.ownership, includedFeatures: GROWTH_FEATURES, catalog: CATALOG },
    });

    expect(decision.allowed).toBe(false);
    if (decision.allowed || decision.basis !== "entitlement") return;
    expect(decision.reason).toBe(
      'The organisation\'s current Monitoring tier does not bundle "ownership"; it is included from the "premier" tier.',
    );
  });

  it("returns requiredTier null — and says so — when no catalog row bundles the module", () => {
    const withoutCatalog = evaluateAccess({
      rbac: rbacAllowing(),
      tier: { moduleKey: PORTAL_TIER_MODULE_KEYS.securityPlan, includedFeatures: GROWTH_FEATURES, currentTier: "growth" },
    });
    const withCatalog = evaluateAccess({
      rbac: rbacAllowing(),
      tier: { ...tierOn("growth", PORTAL_TIER_MODULE_KEYS.securityPlan), catalog: [] },
    });

    for (const decision of [withoutCatalog, withCatalog]) {
      expect(decision.allowed).toBe(false);
      if (decision.allowed || decision.basis !== "entitlement") continue;
      expect(decision.requiredTier).toBeNull();
      expect(decision.upgradePath).toBe(TIER_UPGRADE_PATH);
    }
  });

  // #4207 (2026-09-15, Shane): poams bundles at Premier only — not Foundation, not
  // Growth. Un-pins the #3104 "left unassigned" note this test used to carry.
  it("bundles poams at Premier only (#4207)", () => {
    const premier = evaluateAccess({
      rbac: rbacAllowing(),
      tier: tierOn("premier", PORTAL_TIER_MODULE_KEYS.poams),
    });
    expect(premier.allowed).toBe(true);
    if (!premier.allowed) return;
    expect(premier.tier).toEqual({ moduleKey: PORTAL_TIER_MODULE_KEYS.poams, currentTier: "premier" });

    for (const currentTier of ["foundation", "growth"] as const) {
      const decision = evaluateAccess({
        rbac: rbacAllowing(),
        tier: tierOn(currentTier, PORTAL_TIER_MODULE_KEYS.poams),
      });
      expect(decision.allowed).toBe(false);
      if (decision.allowed || decision.basis !== "entitlement") continue;
      expect(decision.requiredTier).toBe("premier");
      expect(decision.currentTier).toBe(currentTier);
    }
  });

  it("fails closed on an uncatalogued module key, with requiredTier null so no upgrade is offered for a typo", () => {
    const decision = evaluateAccess({
      rbac: rbacAllowing(),
      tier: {
        moduleKey: "security-plan" as PortalTierModuleKey, // hyphen, not underscore: not a real key
        includedFeatures: PREMIER_FEATURES,
        currentTier: "premier",
        catalog: CATALOG,
      },
    });

    expect(decision.allowed).toBe(false);
    if (decision.allowed || decision.basis !== "entitlement") return;
    expect(decision.requiredTier).toBeNull();
    expect(decision.moduleKey).toBe("security-plan");
    expect(decision.reason).toBe('"security-plan" is not a catalogued Monitoring tier module; failing closed.');
  });

  it("matches module keys exactly — a near-miss in includedFeatures does not entitle", () => {
    const decision = evaluateAccess({
      rbac: rbacAllowing(),
      tier: {
        moduleKey: PORTAL_TIER_MODULE_KEYS.securityPlan,
        includedFeatures: ["Security_Plan", " security_plan", "security_plan_v2"],
        currentTier: "premier",
        catalog: CATALOG,
      },
    });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.basis).toBe("entitlement");
  });

  it("sends the customer to the portal's billing page, absolute, under the /portal/ mount", () => {
    expect(TIER_UPGRADE_PATH).toBe("/portal/billing");
  });
});

describe("lowestTierBundling", () => {
  it("returns null for an empty catalog", () => {
    expect(lowestTierBundling("runbooks", [])).toBeNull();
  });

  it("picks the minimum sortOrder across several rows of the same tier", () => {
    expect(lowestTierBundling("security_plan", CATALOG)).toBe("premier");
    expect(lowestTierBundling("policy_decisions", CATALOG)).toBe("foundation");
  });

  it("breaks a sortOrder tie by tier name, so the answer is stable", () => {
    const tied: readonly TierCatalogEntry[] = [
      { tier: "zeta", sortOrder: 1, includedFeatures: ["x"] },
      { tier: "alpha", sortOrder: 1, includedFeatures: ["x"] },
    ];
    expect(lowestTierBundling("x", tied)).toBe("alpha");
    expect(lowestTierBundling("x", [...tied].reverse())).toBe("alpha");
  });
});

describe("tier-modules vocabulary", () => {
  it("recognises every catalogued key and rejects a near-miss", () => {
    for (const key of PORTAL_TIER_MODULE_KEY_LIST) expect(isPortalTierModuleKey(key)).toBe(true);
    expect(isPortalTierModuleKey("security-plan")).toBe(false);
    expect(isPortalTierModuleKey("")).toBe(false);
    expect(isPortalTierModuleKey(null)).toBe(false);
    expect(isPortalTierModuleKey(undefined)).toBe(false);
    expect(isPortalTierModuleKey(42)).toBe(false);
  });

  it("has no duplicate keys", () => {
    expect(new Set(PORTAL_TIER_MODULE_KEY_LIST).size).toBe(PORTAL_TIER_MODULE_KEY_LIST.length);
  });

  it("matches the keys the #1168 + #4207 includedFeatures migrations actually write", () => {
    const migration1168 = readFileSync(
      fileURLToPath(new URL("../../migrations/manual/2026-09-05-portal-tier-included-features-1168.sql", import.meta.url)),
      "utf8",
    );
    const migration4207 = readFileSync(
      fileURLToPath(new URL("../../migrations/manual/2026-09-15-poams-premier-tier-4207.sql", import.meta.url)),
      "utf8",
    );
    for (const key of PORTAL_TIER_MODULE_KEY_LIST) {
      if (key === PORTAL_TIER_MODULE_KEYS.poams) {
        // #4207 (2026-09-15, Shane): poams bundles at Premier only, assigned in its own
        // migration rather than #1168's — #1168 deliberately left it unassigned (#3104).
        expect(migration1168).not.toContain(`"${key}"`);
        expect(migration4207).toContain(`"${key}"`);
        continue;
      }
      expect(migration1168).toContain(`"${key}"`);
    }
  });
});
