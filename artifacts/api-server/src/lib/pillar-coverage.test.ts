/**
 * pillar-coverage.test.ts
 *
 * Unit tests for getPillarCoverage()'s seven-pillar radar coverage — in
 * particular the security pillar, which is scored by the standalone Security
 * Engine (combined into calculateArchitectureHealthScore's breakdown one
 * level up, never part of HEALTH_PILLARS) and must still be a checkable
 * coverage option here. Regression targets:
 *   1. A security-focused package (core:security-baseline shape) used to
 *      return radar.pillars: [] because the loop only walked the six
 *      HEALTH_PILLARS.
 *   2. A real broad package (core:enhanced-monitoring shape, 122 checks / 67
 *      passing live) STILL returned radar.pillars: [] because the
 *      check→signal join was a naive `sourceKey === checkKey` equality —
 *      but real `profile_key_*` rules reference `monitor_checks.mapping`
 *      targetFields (`hasAADP1orP2`, `projectPlanFiveCount`, …), never check
 *      keys, so zero signals ever counted as covered. The join is now
 *      ruleType-aware over the profile keys the package's checks genuinely
 *      produce (see pillar-coverage.ts header).
 *
 * DB-free: mocks the same module boundaries as health-engine.test.ts
 * (buildTenantProfile / getDisabledSignalKeys / fetchSignalRulesAndGroups)
 * plus @workspace/db's `db.select` for the monitoring_package_checks and
 * monitor_checks lookups. Everything else — signal firing, both engines, the
 * display normalization — runs the real code.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// The @workspace/db mock below keeps the REAL schema exports (the table
// objects are used as dispatch sentinels in the db.select mock), so the real
// lib/db index.ts evaluates — which hard-requires DATABASE_URL at module scope.
// vi.hoisted runs before the hoisted vi.mock factories, so the fake URL is in
// place before importOriginal evaluates it (pg.Pool is lazy — never connects).
vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
});

vi.mock("./tenant-signals.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tenant-signals.ts")>();
  return {
    ...actual,
    buildTenantProfile: vi.fn(),
    getDisabledSignalKeys: vi.fn(),
  };
});
vi.mock("./priority-engine.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./priority-engine.ts")>();
  return {
    ...actual,
    fetchSignalRulesAndGroups: vi.fn(),
  };
});
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: { select: vi.fn() },
  };
});

import {
  getPillarCoverage,
  buildProducibleProfileKeys,
  ruleIsFedByPackage,
  fetchEvaluableSignalKeys,
  resolveOwningCheckKey,
  computeRuleFedStatus,
} from "./pillar-coverage.ts";
import { computePillarDisplayScore, computeDisplayHealth } from "./health-display.ts";
import {
  computeHealthEngine,
  getSignalHealthImpacts,
  HEALTH_PILLARS,
} from "./health-engine.ts";
import { buildTenantProfile, getDisabledSignalKeys } from "./tenant-signals.ts";
import { fetchSignalRulesAndGroups } from "./priority-engine.ts";
import { db, monitoringPackageChecksTable, monitorChecksTable } from "@workspace/db";
import type { SignalDerivationRule, SignalRuleGroup } from "./tenant-signals.ts";

const BASE_DATE = new Date("2024-01-01T00:00:00Z");

const DEFAULT_INTELLIGENCE_FIELDS = {
  priority: 0,
  weight: 0,
  pricingImpact: 0,
  priorityScoreContribution: 0,
  pricingValueContribution: 0,
  governanceImpact: 0,
  securityImpact: 0,
  complianceImpact: 0,
  adoptionImpact: 0,
  copilotImpact: 0,
  architectureImpact: 0,
  licensingImpact: 0,
  trendValue: 0,
  trendDirection: "flat" as const,
  decayRate: 0,
  ttlDays: 0,
  confidence: 0,
  severity: "low" as const,
  category: "",
  pillar: "",
  crmFitContribution: 0,
  crmPainContribution: 0,
  crmMaturityContribution: 0,
  crmIntentContribution: 0,
  crmUrgencyContribution: 0,
};

let nextRuleId = 1000;
function makeRule(
  overrides: Partial<SignalDerivationRule> & Pick<SignalDerivationRule, "signalKey" | "ruleType" | "sourceKey">,
): SignalDerivationRule {
  return {
    id: nextRuleId++,
    groupId: null,
    compareValue: null,
    denominatorKey: null,
    description: null,
    sortOrder: 0,
    createdAt: BASE_DATE,
    updatedAt: BASE_DATE,
    ...DEFAULT_INTELLIGENCE_FIELDS,
    ...overrides,
  };
}

/** The monitor_checks definition subset getPillarCoverage fetches. */
interface CheckDef {
  key: string;
  mapping?: Array<{ sourceField: string; targetField: string; transform?: string }>;
  properties?: string[];
  /** Defaults false (Graph check) — the monitor_checks schema default. */
  requiresCustomerScript?: boolean;
}

/** Wires the mocked module boundaries for one scenario. The db.select mock
 *  dispatches by table: monitoring_package_checks → the package's check keys,
 *  monitor_checks → the check definitions (mapping/properties). */
function wireScenario(opts: {
  packageCheckKeys: string[];
  checkDefinitions?: CheckDef[];
  rules: SignalDerivationRule[];
  groups?: SignalRuleGroup[];
  profile: Record<string, unknown>;
}) {
  const defs = (opts.checkDefinitions ?? []).map((d) => ({
    key: d.key,
    mapping: d.mapping ?? [],
    properties: d.properties ?? [],
    requiresCustomerScript: d.requiresCustomerScript ?? false,
  }));
  vi.mocked(db.select).mockImplementation((() => ({
    from: (table: unknown) => {
      if (table === monitoringPackageChecksTable) {
        return { where: async () => opts.packageCheckKeys.map((checkKey) => ({ checkKey })) };
      }
      if (table === monitorChecksTable) {
        return { where: async () => defs };
      }
      throw new Error("pillar-coverage.test: unexpected table in db.select mock");
    },
  })) as unknown as typeof db.select);
  vi.mocked(fetchSignalRulesAndGroups).mockResolvedValue({ rules: opts.rules, groups: opts.groups ?? [] });
  vi.mocked(buildTenantProfile).mockResolvedValue({
    mergedProfile: opts.profile,
    findings: [] as string[],
    customerId: 1,
    mspId: null,
    tenantId: null,
  } as Awaited<ReturnType<typeof buildTenantProfile>>);
  vi.mocked(getDisabledSignalKeys).mockResolvedValue(new Set());
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getPillarCoverage — real check→signal linkage (mapping targetFields, not checkKey equality)", () => {
  it("REGRESSION (enhanced-monitoring shape): profile_key_* rules on mapping targetFields count as coverage — was radar.pillars []", async () => {
    // Real seeded shapes from the repo's own migrations:
    //   licensing:project-online-detection --mapping--> projectPlanFiveCount
    //     → rule profile_key_gt projectPlanFiveCount  (2026-07-22-project-online-sku-detection.sql)
    //   license-gap check --mapping--> hasAADP1orP2
    //     → rule profile_key_falsy hasAADP1orP2       (2026-07-22-license-gap-sales-offer-wiring.sql)
    // NONE of these sourceKeys equal a check key — the old join matched zero.
    // TWO evaluable signals per pillar, not one, since #517: a pillar backed by
    // a single signal is now withheld as `insufficient_data` rather than scored,
    // so a one-rule fixture would exercise the floor instead of the linkage this
    // test is about. Both extra rules read a second real mapping targetField on
    // the SAME check, which is exactly the shape the regression describes.
    const rules = [
      makeRule({
        signalKey: "licensing:has_project_online", ruleType: "profile_key_gt",
        sourceKey: "projectPlanFiveCount", compareValue: "0", licensingImpact: 10,
      }),
      makeRule({
        signalKey: "licensing:has_visio", ruleType: "profile_key_gt",
        sourceKey: "visioPlanTwoCount", compareValue: "0", licensingImpact: 10,
      }),
      makeRule({
        signalKey: "security:lacks_entra_premium", ruleType: "profile_key_falsy",
        sourceKey: "hasAADP1orP2", securityImpact: 15,
      }),
      makeRule({
        signalKey: "security:lacks_defender", ruleType: "profile_key_falsy",
        sourceKey: "hasDefender", securityImpact: 15,
      }),
    ];
    wireScenario({
      packageCheckKeys: ["licensing:project-online-detection", "identity:entra-plan-detection"],
      checkDefinitions: [
        {
          key: "licensing:project-online-detection",
          mapping: [
            { sourceField: "skuPartNumber", targetField: "projectPlanFiveCount", transform: "countEquals('PROJECTPREMIUM')" },
            { sourceField: "skuPartNumber", targetField: "visioPlanTwoCount", transform: "countEquals('VISIOCLIENT')" },
          ],
        },
        {
          key: "identity:entra-plan-detection",
          mapping: [
            { sourceField: "servicePlans", targetField: "hasAADP1orP2", transform: "exists" },
            { sourceField: "servicePlans", targetField: "hasDefender", transform: "exists" },
          ],
        },
      ],
      rules,
      // Neither signal fires → both pillars at healthy 100, both still covered.
      profile: {},
    });

    const covered = await getPillarCoverage("core:enhanced-monitoring", 4);

    expect(covered.map((c) => c.pillar).sort()).toEqual(["licensing", "security"]);
    for (const entry of covered) expect(entry.score).toBe(100);
  });

  it("threshold rules link via bare checkKey (evaluateRule reads <sourceKey>__itemCount stamped per check)", async () => {
    // Two threshold rules on the same check, both firing, so the pillar clears
    // the #517 evaluable-signal floor without changing what this test asserts:
    // raw 16 of theoreticalMax 16 is still a fully-realized risk → display 0.
    const rules = [
      makeRule({
        signalKey: "governance:orphaned-teams", ruleType: "threshold",
        sourceKey: "teams:orphaned-teams", compareValue: "3", governanceImpact: 8,
      }),
      makeRule({
        signalKey: "governance:orphaned-teams-severe", ruleType: "threshold",
        sourceKey: "teams:orphaned-teams", compareValue: "4", governanceImpact: 8,
      }),
    ];
    wireScenario({
      packageCheckKeys: ["teams:orphaned-teams"],
      checkDefinitions: [{ key: "teams:orphaned-teams" }],
      rules,
      profile: { "teams:orphaned-teams__itemCount": 5 }, // both fire: 5 > 3 and 5 > 4
    });

    const covered = await getPillarCoverage("core:enhanced-monitoring", 4);

    expect(covered).toEqual([{ pillar: "governance", label: "Governance", score: 0 }]);
  });

  it("profile_key_* rules on a raw-properties extraction key (<prop>_count/_first/_values) count as coverage", async () => {
    // Two rules on two extraction keys of the same raw property, clearing the
    // #517 floor while keeping the claim (an extraction key is real coverage).
    const rules = [
      makeRule({
        signalKey: "adoption:no-owners", ruleType: "profile_key_eq",
        sourceKey: "owner_count", compareValue: "0", adoptionImpact: 6,
      }),
      makeRule({
        signalKey: "adoption:no-named-owner", ruleType: "profile_key_falsy",
        sourceKey: "owner_first", adoptionImpact: 6,
      }),
    ];
    wireScenario({
      packageCheckKeys: ["groups:ownerless"],
      checkDefinitions: [{ key: "groups:ownerless", properties: ["owner"] }],
      rules,
      profile: {},
    });

    const covered = await getPillarCoverage("core:enhanced-monitoring", 4);

    expect(covered.map((c) => c.pillar)).toEqual(["adoption"]);
  });

  it("bridged legacy keys count only when their real producer check is in the package (securityScore ← security:secure-score)", async () => {
    // Both rules read the SAME bridged key, so the producer-gating claim is
    // unchanged — they are covered together or not at all — while the pillar
    // clears the #517 evaluable-signal floor.
    const rules = [
      makeRule({
        signalKey: "security:low-secure-score", ruleType: "profile_key_lt",
        sourceKey: "securityScore", compareValue: "60", securityImpact: 20,
      }),
      makeRule({
        signalKey: "security:very-low-secure-score", ruleType: "profile_key_lt",
        sourceKey: "securityScore", compareValue: "30", securityImpact: 20,
      }),
    ];

    // Producer present → covered.
    wireScenario({
      packageCheckKeys: ["security:secure-score"],
      checkDefinitions: [{ key: "security:secure-score" }],
      rules,
      profile: {},
    });
    expect((await getPillarCoverage("core:enhanced-monitoring", 4)).map((c) => c.pillar)).toEqual(["security"]);

    // Producer absent → honest [].
    wireScenario({
      packageCheckKeys: ["teams:orphaned-teams"],
      checkDefinitions: [{ key: "teams:orphaned-teams" }],
      rules,
      profile: {},
    });
    expect(await getPillarCoverage("core:narrow", 4)).toEqual([]);
  });

  it("findings_keyword rules link when the keyword appears inside a covered check key (deriveMonitorFindings strings start with it)", async () => {
    // Two keywords, both genuinely inside the covered check key, so the
    // case-insensitive substring claim is unchanged and the pillar clears the
    // #517 evaluable-signal floor.
    const rules = [
      makeRule({
        signalKey: "collab:sharepoint-issues", ruleType: "findings_keyword",
        sourceKey: "SharePoint", architectureImpact: 5,
      }),
      makeRule({
        signalKey: "collab:anonymous-link-issues", ruleType: "findings_keyword",
        sourceKey: "anonymous", architectureImpact: 5,
      }),
    ];
    wireScenario({
      packageCheckKeys: ["sharepoint:anonymous-links"],
      checkDefinitions: [{ key: "sharepoint:anonymous-links" }],
      rules,
      profile: {},
    });

    const covered = await getPillarCoverage("core:enhanced-monitoring", 4);

    expect(covered.map((c) => c.pillar)).toEqual(["architecture"]);
  });

  it("a profile_key_* rule on a script-only profile key (no monitor-check producer) is honestly NOT package coverage", async () => {
    const rules = [
      makeRule({
        signalKey: "governance:script-only", ruleType: "profile_key_truthy",
        sourceKey: "someScriptOnlyField", governanceImpact: 10,
      }),
    ];
    wireScenario({
      packageCheckKeys: ["teams:orphaned-teams"],
      checkDefinitions: [{ key: "teams:orphaned-teams" }],
      rules,
      // Even if the tenant's script wrote it and the signal FIRES, the package
      // didn't produce it — coverage stays honest.
      profile: { someScriptOnlyField: true },
    });

    expect(await getPillarCoverage("core:enhanced-monitoring", 4)).toEqual([]);
  });

  it("runtime license-gap flags (hasAADP1orP2/hasDefender) count as producible for any package with a Graph check — even with NO mapping targeting them", async () => {
    // Real live shape: the 2026-07-22 seeded rules read hasAADP1orP2/hasDefender,
    // but NO monitor_checks.mapping row ever lists those targetFields — they are
    // stamped at runtime by executeMonitorCheck on a LicenseGapError and merged
    // by mergeMonitorProfileRows regardless of row status. Enumerating mapping
    // targetFields alone misses this producer entirely (the gap this test pins).
    const rules = [
      makeRule({
        signalKey: "security:lacks_entra_premium", ruleType: "profile_key_falsy",
        sourceKey: "hasAADP1orP2", securityImpact: 15,
      }),
      makeRule({
        signalKey: "security:lacks_defender", ruleType: "profile_key_falsy",
        sourceKey: "hasDefender", securityImpact: 12,
      }),
    ];
    wireScenario({
      // A Graph check with NO mapping at all — the flags must still count.
      packageCheckKeys: ["teams:orphaned-teams"],
      checkDefinitions: [{ key: "teams:orphaned-teams" }],
      rules,
      profile: {},
    });

    expect((await getPillarCoverage("core:enhanced-monitoring", 4)).map((c) => c.pillar)).toEqual(["security"]);
  });

  it("license-gap flags are NOT producible by an all-script package (script checks never call Graph)", async () => {
    const rules = [
      makeRule({
        signalKey: "security:lacks_entra_premium", ruleType: "profile_key_falsy",
        sourceKey: "hasAADP1orP2", securityImpact: 15,
      }),
    ];
    wireScenario({
      packageCheckKeys: ["script:local-ad-audit"],
      checkDefinitions: [{ key: "script:local-ad-audit", requiresCustomerScript: true }],
      rules,
      profile: {},
    });

    expect(await getPillarCoverage("core:script-only", 4)).toEqual([]);
  });
});

describe("buildProducibleProfileKeys / ruleIsFedByPackage — pure linkage helpers", () => {
  it("enumerates checkKey, __itemCount, mapping targetFields, property extraction keys, and gated bridged keys", () => {
    const keys = buildProducibleProfileKeys(new Set(["identity:ca-policy-count", "x:check"]), [
      {
        key: "x:check",
        mapping: [{ sourceField: "a", targetField: "mappedField" }],
        properties: ["displayName"],
      },
      // Definition for a check NOT in the covered set — must contribute nothing.
      { key: "y:other", mapping: [{ sourceField: "b", targetField: "notCovered" }], properties: [] },
    ]);

    for (const expected of [
      "x:check",
      "x:check__itemCount",
      "mappedField",
      "displayName_count",
      "displayName_first",
      "displayName_values",
      // bridged, gated on identity:ca-policy-count being covered
      "conditionalAccessPolicyCount",
      "conditionalAccessPoliciesCount",
      // runtime license-gap flags — producible by any Graph (non-script) check
      "hasAADP1orP2",
      "hasDefender",
    ]) {
      expect(keys.has(expected), expected).toBe(true);
    }
    expect(keys.has("notCovered")).toBe(false);
    expect(keys.has("securityScore")).toBe(false); // its producer check is not covered
  });

  it("license-gap flags are gated on at least one Graph (non-script) covered check", () => {
    const scriptOnly = buildProducibleProfileKeys(new Set(["script:audit"]), [
      { key: "script:audit", mapping: [], properties: [], requiresCustomerScript: true },
    ]);
    expect(scriptOnly.has("hasAADP1orP2")).toBe(false);
    expect(scriptOnly.has("hasDefender")).toBe(false);

    const withGraph = buildProducibleProfileKeys(new Set(["script:audit", "teams:orphaned-teams"]), [
      { key: "script:audit", mapping: [], properties: [], requiresCustomerScript: true },
      { key: "teams:orphaned-teams", mapping: [], properties: [] }, // absent flag = Graph (schema default)
    ]);
    expect(withGraph.has("hasAADP1orP2")).toBe(true);
    expect(withGraph.has("hasDefender")).toBe(true);
  });

  it("ruleIsFedByPackage dispatches by ruleType", () => {
    const covered = new Set(["sharepoint:anonymous-links"]);
    const producible = buildProducibleProfileKeys(covered, [{ key: "sharepoint:anonymous-links", mapping: [], properties: [] }]);

    expect(ruleIsFedByPackage({ ruleType: "threshold", sourceKey: "sharepoint:anonymous-links" }, covered, producible)).toBe(true);
    expect(ruleIsFedByPackage({ ruleType: "threshold", sourceKey: "other:check" }, covered, producible)).toBe(false);
    expect(ruleIsFedByPackage({ ruleType: "findings_keyword", sourceKey: "sharepoint" }, covered, producible)).toBe(true);
    expect(ruleIsFedByPackage({ ruleType: "findings_keyword", sourceKey: "teams" }, covered, producible)).toBe(false);
    expect(ruleIsFedByPackage({ ruleType: "findings_keyword", sourceKey: "" }, covered, producible)).toBe(false);
    expect(ruleIsFedByPackage({ ruleType: "profile_key_truthy", sourceKey: "sharepoint:anonymous-links__itemCount" }, covered, producible)).toBe(true);
    expect(ruleIsFedByPackage({ ruleType: "profile_key_truthy", sourceKey: "unproducedField" }, covered, producible)).toBe(false);
  });

  it("resolveOwningCheckKey finds the real check that owns a rule's sourceKey, by ruleType", () => {
    const defs = [
      { key: "sharepoint:anonymous-links", mapping: [], properties: [] },
      { key: "identity:mfa-registration", mapping: [{ sourceField: "a", targetField: "mfaRegisteredCount" }], properties: ["displayName"] },
      { key: "identity:ca-policy-count", mapping: [], properties: [] },
    ];

    // threshold: bare sourceKey must equal a real checkKey.
    expect(resolveOwningCheckKey({ ruleType: "threshold", sourceKey: "sharepoint:anonymous-links" }, defs)).toBe(
      "sharepoint:anonymous-links",
    );
    expect(resolveOwningCheckKey({ ruleType: "threshold", sourceKey: "no:such-check" }, defs)).toBeNull();

    // findings_keyword: unambiguous single substring match.
    expect(resolveOwningCheckKey({ ruleType: "findings_keyword", sourceKey: "sharepoint" }, defs)).toBe(
      "sharepoint:anonymous-links",
    );
    expect(resolveOwningCheckKey({ ruleType: "findings_keyword", sourceKey: "identity" }, defs)).toBeNull(); // 2 matches, ambiguous
    expect(resolveOwningCheckKey({ ruleType: "findings_keyword", sourceKey: "" }, defs)).toBeNull();

    // profile_key_*: mapping targetField, property-derived key, synthetic itemCount, bridged key.
    expect(resolveOwningCheckKey({ ruleType: "profile_key_gt", sourceKey: "mfaRegisteredCount" }, defs)).toBe(
      "identity:mfa-registration",
    );
    expect(resolveOwningCheckKey({ ruleType: "profile_key_truthy", sourceKey: "displayName_count" }, defs)).toBe(
      "identity:mfa-registration",
    );
    expect(
      resolveOwningCheckKey({ ruleType: "profile_key_truthy", sourceKey: "sharepoint:anonymous-links__itemCount" }, defs),
    ).toBe("sharepoint:anonymous-links");
    expect(
      resolveOwningCheckKey({ ruleType: "profile_key_eq", sourceKey: "conditionalAccessPolicyCount" }, defs),
    ).toBe("identity:ca-policy-count");
    expect(resolveOwningCheckKey({ ruleType: "profile_key_truthy", sourceKey: "unproducedField" }, defs)).toBeNull();
  });
});

describe("getPillarCoverage — security pillar (Security Engine, combined one level up)", () => {
  it("REGRESSION: a security-only package (core:security-baseline shape) yields a real security entry, not []", async () => {
    // Mark Perry shape: every check the package runs feeds identity/security
    // signals with securityImpact only — zero impact on the six health pillars.
    // These rules' sourceKeys equal the check keys directly (the defensive
    // bare-checkKey linkage path, which the original narrow-package
    // verification relied on — kept working).
    const rules = [
      makeRule({
        signalKey: "identity:mfa-disabled", ruleType: "profile_key_falsy", sourceKey: "identity:mfa-check",
        securityImpact: 15,
      }),
      makeRule({
        signalKey: "identity:legacy-auth", ruleType: "profile_key_truthy", sourceKey: "identity:legacy-auth-check",
        securityImpact: 10,
      }),
    ];
    wireScenario({
      packageCheckKeys: ["identity:mfa-check", "identity:legacy-auth-check"],
      checkDefinitions: [{ key: "identity:mfa-check" }, { key: "identity:legacy-auth-check" }],
      rules,
      // Only the mfa signal fires → raw security 15 of theoreticalMax 25.
      profile: { "identity:mfa-check": false, "identity:legacy-auth-check": false },
    });

    const covered = await getPillarCoverage("core:security-baseline", 21);

    expect(covered).toEqual([
      {
        pillar: "security",
        label: "Security",
        // Real Security Engine raw score 15, theoreticalMax 25 → 100 − 60 = 40.
        score: 40,
      },
    ]);
  });

  it("a broader package surfaces all seven pillars when coverage genuinely exists — security appended after the six", async () => {
    // TWO rules per pillar (#517's evaluable-signal floor) — the second reads a
    // second real check, which is also the more realistic shape for a "broad
    // package" fixture. Neither fires, so every pillar still displays 100.
    const rules = [
      makeRule({ signalKey: "sig:gov", ruleType: "profile_key_truthy", sourceKey: "check:gov", governanceImpact: 10 }),
      makeRule({ signalKey: "sig:gov-b", ruleType: "profile_key_truthy", sourceKey: "check:gov-b", governanceImpact: 10 }),
      makeRule({ signalKey: "sig:comp", ruleType: "profile_key_truthy", sourceKey: "check:comp", complianceImpact: 10 }),
      makeRule({ signalKey: "sig:comp-b", ruleType: "profile_key_truthy", sourceKey: "check:comp-b", complianceImpact: 10 }),
      makeRule({ signalKey: "sig:adopt", ruleType: "profile_key_truthy", sourceKey: "check:adopt", adoptionImpact: 10 }),
      makeRule({ signalKey: "sig:adopt-b", ruleType: "profile_key_truthy", sourceKey: "check:adopt-b", adoptionImpact: 10 }),
      makeRule({ signalKey: "sig:copilot", ruleType: "profile_key_truthy", sourceKey: "check:copilot", copilotImpact: 10 }),
      makeRule({ signalKey: "sig:copilot-b", ruleType: "profile_key_truthy", sourceKey: "check:copilot-b", copilotImpact: 10 }),
      makeRule({ signalKey: "sig:arch", ruleType: "profile_key_truthy", sourceKey: "check:arch", architectureImpact: 10 }),
      makeRule({ signalKey: "sig:arch-b", ruleType: "profile_key_truthy", sourceKey: "check:arch-b", architectureImpact: 10 }),
      makeRule({ signalKey: "sig:lic", ruleType: "profile_key_truthy", sourceKey: "check:lic", licensingImpact: 10 }),
      makeRule({ signalKey: "sig:lic-b", ruleType: "profile_key_truthy", sourceKey: "check:lic-b", licensingImpact: 10 }),
      makeRule({ signalKey: "sig:sec", ruleType: "profile_key_truthy", sourceKey: "check:sec", securityImpact: 10 }),
      makeRule({ signalKey: "sig:sec-b", ruleType: "profile_key_truthy", sourceKey: "check:sec-b", securityImpact: 10 }),
    ];
    wireScenario({
      packageCheckKeys: rules.map((r) => r.sourceKey),
      checkDefinitions: rules.map((r) => ({ key: r.sourceKey })),
      rules,
      // No signal fires → every pillar at its healthy display max, all still covered.
      profile: {},
    });

    const covered = await getPillarCoverage("core:broad", 1);

    expect(covered.map((c) => c.pillar)).toEqual([...HEALTH_PILLARS, "security"]);
    for (const entry of covered) expect(entry.score).toBe(100);
    expect(covered.find((c) => c.pillar === "security")!.label).toBe("Security");
  });

  it("honest omission stands: a package whose checks feed no security-impacting signal gets no security entry", async () => {
    const rules = [
      // The package's own check — governance only. Two signals off the one check
      // so governance clears #517's evaluable-signal floor and the assertion
      // below is about the SECURITY omission, not about the floor.
      makeRule({ signalKey: "sig:gov", ruleType: "profile_key_truthy", sourceKey: "check:gov", governanceImpact: 10 }),
      makeRule({ signalKey: "sig:gov-b", ruleType: "profile_key_truthy", sourceKey: "check:gov__itemCount", governanceImpact: 10 }),
      // A security rule EXISTS system-wide, but no check in this package feeds it.
      makeRule({ signalKey: "sig:sec", ruleType: "profile_key_truthy", sourceKey: "check:sec", securityImpact: 20 }),
      makeRule({ signalKey: "sig:sec-b", ruleType: "profile_key_truthy", sourceKey: "check:sec-b", securityImpact: 20 }),
    ];
    wireScenario({
      packageCheckKeys: ["check:gov"],
      checkDefinitions: [{ key: "check:gov" }],
      rules,
      profile: { "check:gov": true },
    });

    const covered = await getPillarCoverage("core:governance-only", 1);

    expect(covered.map((c) => c.pillar)).toEqual(["governance"]);
    expect(covered.find((c) => c.pillar === "security")).toBeUndefined();
  });

  it("honest omission stands for the six health pillars too: uncovered pillars are absent", async () => {
    const rules = [
      makeRule({
        signalKey: "sig:multi", ruleType: "profile_key_truthy", sourceKey: "check:multi",
        governanceImpact: 5, securityImpact: 5, // nothing for the other five pillars
      }),
      // A second signal off the same check, weighted on the same two pillars, so
      // both clear #517's evaluable-signal floor. The other five pillars stay at
      // zero weight — which is what this test is actually asserting.
      makeRule({
        signalKey: "sig:multi-b", ruleType: "profile_key_truthy", sourceKey: "check:multi__itemCount",
        governanceImpact: 5, securityImpact: 5,
      }),
    ];
    wireScenario({
      packageCheckKeys: ["check:multi"],
      checkDefinitions: [{ key: "check:multi" }],
      rules,
      profile: { "check:multi": true },
    });

    const covered = await getPillarCoverage("core:two-pillar", 1);

    expect(covered.map((c) => c.pillar).sort()).toEqual(["governance", "security"]);
  });

  it("returns [] when the package has no curated checks at all (monitoring_package_checks empty)", async () => {
    wireScenario({
      packageCheckKeys: [],
      rules: [makeRule({ signalKey: "sig:sec", ruleType: "profile_key_truthy", sourceKey: "check:sec", securityImpact: 20 })],
      profile: {},
    });

    expect(await getPillarCoverage("core:uncurated", 1)).toEqual([]);
  });
});

describe("computePillarDisplayScore — shared normalization, no fabrication", () => {
  const secRule = makeRule({
    signalKey: "sig:sec", ruleType: "profile_key_truthy", sourceKey: "check:sec", securityImpact: 20,
  });

  it("returns null for security on a pure computeHealthEngine output (no security breakdown entry — never fabricate 100)", () => {
    const output = computeHealthEngine({ "check:sec": true }, [], [secRule], []);
    const impacts = getSignalHealthImpacts([secRule], []);
    expect(output.breakdown.find((b) => b.pillar === "security")).toBeUndefined();
    // sig:sec IS evaluable here (theoreticalMax > 0) so the null is genuinely
    // the missing-breakdown guard, not an empty denominator.
    expect(computePillarDisplayScore("security", output, impacts, new Set(["sig:sec"]))).toBeNull();
  });

  it("returns null when no rules anywhere configure an impact for the pillar (theoreticalMax 0)", () => {
    const output = computeHealthEngine({}, [], [secRule], []);
    const impacts = getSignalHealthImpacts([secRule], []);
    expect(computePillarDisplayScore("licensing", output, impacts, new Set(["sig:sec"]))).toBeNull();
  });

  it("computeDisplayHealth is unchanged for the six health pillars", () => {
    // Two governance rules, both firing (#517's evaluable-signal floor): raw 20
    // of theoreticalMax 20 is still a fully-realized risk → display 0.
    const govRule = makeRule({
      signalKey: "sig:gov", ruleType: "profile_key_truthy", sourceKey: "check:gov", governanceImpact: 10,
    });
    const govRuleB = makeRule({
      signalKey: "sig:gov-b", ruleType: "profile_key_truthy", sourceKey: "check:gov-b", governanceImpact: 10,
    });
    const rules = [govRule, govRuleB];
    const output = computeHealthEngine({ "check:gov": true, "check:gov-b": true }, [], rules, []);
    const display = computeDisplayHealth(output, rules, [], new Set(["sig:gov", "sig:gov-b"]));

    expect(display.map((p) => p.pillar)).toEqual([...HEALTH_PILLARS]);
    expect(display.find((p) => p.pillar === "governance")!.displayScore).toBe(0); // 20 of max 20 fired
    for (const p of display) {
      if (p.pillar !== "governance") expect(p.displayScore).toBeNull(); // no impacts configured
    }
  });

  it("theoreticalMax excludes non-evaluable signals — a non-producible rule's impact must not dilute the denominator", () => {
    // Governance real risk fully realized: raw 40 of an evaluable max 40 → 0.
    // TWO real rules, both firing, so the pillar clears #517's evaluable-signal
    // floor and this test measures the denominator claim rather than the floor.
    const realRule = makeRule({
      signalKey: "gov:real", ruleType: "profile_key_truthy", sourceKey: "gov:real-check", governanceImpact: 20,
    });
    const realRuleB = makeRule({
      signalKey: "gov:real-b", ruleType: "profile_key_truthy", sourceKey: "gov:real-check-b", governanceImpact: 20,
    });
    // Orphaned rule: extreme impact but its signal is NOT in the evaluable set.
    const orphanRule = makeRule({
      signalKey: "gov:orphan", ruleType: "profile_key_truthy", sourceKey: "gov:nonexistent", governanceImpact: 1000,
    });
    const rules = [realRule, realRuleB, orphanRule];
    const output = computeHealthEngine(
      { "gov:real-check": true, "gov:real-check-b": true },
      [],
      rules,
      [],
    );
    const impacts = getSignalHealthImpacts(rules, []);

    // Only the real signals are evaluable → theoreticalMax 40 → 100 − 40/40·100 = 0.
    expect(computePillarDisplayScore("governance", output, impacts, new Set(["gov:real", "gov:real-b"]))).toBe(0);
    // The OLD (buggy) behaviour, reproduced by treating the orphan as evaluable:
    // theoreticalMax 1040 → 100 − 40/1040·100 = round(96.15) = 96 (falsely healthier).
    expect(
      computePillarDisplayScore("governance", output, impacts, new Set(["gov:real", "gov:real-b", "gov:orphan"])),
    ).toBe(96);
  });
});

describe("fetchEvaluableSignalKeys + live scoring — Shane's exact exploit against the real catalog", () => {
  // Wires db.select so the FULL monitor_checks catalog (fetchEvaluableSignalKeys
  // reads it with no `.where`) resolves to `defs`. The object is both awaitable
  // and `.where`-able so this same mock also serves any `.where`-shaped read.
  function wireCatalog(defs: CheckDef[]) {
    const rows = defs.map((d) => ({
      key: d.key,
      mapping: d.mapping ?? [],
      properties: d.properties ?? [],
      requiresCustomerScript: d.requiresCustomerScript ?? false,
    }));
    vi.mocked(db.select).mockImplementation((() => ({
      from: (table: unknown) => {
        if (table === monitorChecksTable) {
          return Object.assign(Promise.resolve(rows), { where: async () => rows });
        }
        throw new Error("wireCatalog: unexpected table in db.select mock");
      },
    })) as unknown as typeof db.select);
  }

  it("a rule with an EXTREME weight whose sourceKey no check produces does NOT move theoreticalMax (score stays honest)", async () => {
    // Only the two real checks exist in the catalog. `gov:phantom-check` does not.
    // Two real rules rather than one so governance clears #517's evaluable-signal
    // floor — this test is about the orphan's weight, not about coverage depth.
    wireCatalog([{ key: "gov:real-check" }, { key: "gov:real-check-b" }]);

    const realRule = makeRule({
      signalKey: "governance:real", ruleType: "profile_key_truthy",
      sourceKey: "gov:real-check", governanceImpact: 20,
    });
    const realRuleB = makeRule({
      signalKey: "governance:real-b", ruleType: "profile_key_truthy",
      sourceKey: "gov:real-check-b", governanceImpact: 20,
    });
    // Shane's test rule: weight 1000 + governanceImpact 1000, but its sourceKey
    // matches nothing producible → it can never fire and must never count.
    const extremeOrphan = makeRule({
      signalKey: "governance:orphan", ruleType: "profile_key_truthy",
      sourceKey: "gov:phantom-check", weight: 1000, governanceImpact: 1000,
    });

    const rules = [realRule, realRuleB, extremeOrphan];
    // Only the real signals fire (raw governance 40); the orphan never fires.
    const output = computeHealthEngine(
      { "gov:real-check": true, "gov:real-check-b": true },
      [],
      rules,
      [],
    );
    expect(output.breakdown.find((b) => b.pillar === "governance")!.score).toBe(40);

    const evaluable = await fetchEvaluableSignalKeys(rules);
    expect(evaluable.has("governance:real")).toBe(true);
    expect(evaluable.has("governance:orphan")).toBe(false); // sourceKey not producible by any real check

    const gov = computeDisplayHealth(output, rules, [], evaluable)
      .find((p) => p.pillar === "governance")!;
    // theoreticalMax = 40 (the orphan's 1000 is excluded) → 100 − 40/40·100 = 0.
    // The bug would have produced ~96 (falsely healthier the instant the rule was created).
    expect(gov.displayScore).toBe(0);
  });

  it("a rule with the SAME extreme weight but a REAL producible sourceKey DOES move theoreticalMax (genuine headroom)", async () => {
    // Both checks exist — the high-weight rule now reads a producible key.
    wireCatalog([{ key: "gov:real-check" }, { key: "gov:real-check-2" }]);

    const realRule = makeRule({
      signalKey: "governance:real", ruleType: "profile_key_truthy",
      sourceKey: "gov:real-check", governanceImpact: 20,
    });
    const extremeReal = makeRule({
      signalKey: "governance:big", ruleType: "profile_key_truthy",
      sourceKey: "gov:real-check-2", weight: 1000, governanceImpact: 1000,
    });

    // Big rule doesn't fire this scan (its key absent from the profile), but it
    // is evaluable, so it legitimately widens the theoretical maximum.
    const output = computeHealthEngine({ "gov:real-check": true }, [], [realRule, extremeReal], []);
    expect(output.breakdown.find((b) => b.pillar === "governance")!.score).toBe(20);

    const evaluable = await fetchEvaluableSignalKeys([realRule, extremeReal]);
    expect(evaluable.has("governance:big")).toBe(true); // producible → counts toward theoreticalMax

    const gov = computeDisplayHealth(output, [realRule, extremeReal], [], evaluable)
      .find((p) => p.pillar === "governance")!;
    // theoreticalMax = 20 + 1000 = 1020 → 100 − 20/1020·100 = round(98.04) = 98.
    expect(gov.displayScore).toBe(98);
  });
});

// ── #509: the contract behind GET /api/admin/signal-rules/check-fed ────────────
// That route is a thin wrapper: it hands `computeRuleFedStatus` a single
// synthetic rule (id 0) built from the ruleType + sourceKey the operator is
// typing, and returns `{ fed, owningCheckKey }` straight out of the two maps it
// gets back. So exercising computeRuleFedStatus with a one-rule array IS
// exercising the endpoint's answer, without an HTTP harness — and it pins the
// property that makes the live feedback worth showing at all: the verdict is
// ruleType-SENSITIVE, so the same string can be fed as one type and inert as
// another.
describe("computeRuleFedStatus — single-rule lookups (the /check-fed endpoint's answer)", () => {
  function wireCatalog(defs: CheckDef[]) {
    const rows = defs.map((d) => ({
      key: d.key,
      mapping: d.mapping ?? [],
      properties: d.properties ?? [],
      requiresCustomerScript: d.requiresCustomerScript ?? false,
    }));
    vi.mocked(db.select).mockImplementation((() => ({
      from: (table: unknown) => {
        if (table === monitorChecksTable) {
          return Object.assign(Promise.resolve(rows), { where: async () => rows });
        }
        throw new Error("wireCatalog: unexpected table in db.select mock");
      },
    })) as unknown as typeof db.select);
  }

  /** Exactly what the route does for one (ruleType, sourceKey) pair. */
  async function checkFed(ruleType: string, sourceKey: string) {
    const { fedByRuleId, checkKeyByRuleId } = await computeRuleFedStatus([
      { id: 0, ruleType, sourceKey, signalKey: "" } as Parameters<typeof computeRuleFedStatus>[0][number],
    ]);
    return { fed: fedByRuleId.get(0) ?? false, owningCheckKey: checkKeyByRuleId.get(0) ?? null };
  }

  it("a threshold rule on a real check key is fed, and names that check", async () => {
    wireCatalog([{ key: "identity:ca-policy-count" }, { key: "security:secure-score" }]);
    // threshold reads profile[`${sourceKey}__itemCount`], stamped per check row —
    // so the sourceKey IS a check key.
    expect(await checkFed("threshold", "identity:ca-policy-count")).toEqual({
      fed: true,
      owningCheckKey: "identity:ca-policy-count",
    });
  });

  it("`copilotReadinessMet` is NOT evaluable — no check in the catalog produces it", async () => {
    // A realistic catalog that nonetheless produces no such profile key: no
    // mapping targets it, no raw property derives it, it is no check's key.
    wireCatalog([
      { key: "identity:ca-policy-count" },
      { key: "licensing:project-online-detection", mapping: [{ sourceField: "n", targetField: "projectPlanFiveCount" }] },
    ]);
    expect(await checkFed("profile_key_truthy", "copilotReadinessMet")).toEqual({
      fed: false,
      owningCheckKey: null,
    });
  });

  it("a profile_key_* rule on a real mapping targetField is fed, and names the producing check", async () => {
    wireCatalog([
      { key: "licensing:project-online-detection", mapping: [{ sourceField: "n", targetField: "projectPlanFiveCount" }] },
    ]);
    expect(await checkFed("profile_key_gt", "projectPlanFiveCount")).toEqual({
      fed: true,
      owningCheckKey: "licensing:project-online-detection",
    });
  });

  it("the SAME key flips fed→inert when the ruleType changes — why the feedback is worth showing live", async () => {
    wireCatalog([
      { key: "licensing:project-online-detection", mapping: [{ sourceField: "n", targetField: "projectPlanFiveCount" }] },
    ]);
    // As a profile read it is produced by that check's mapping (above); as a
    // threshold it would have to BE a check key, and no check is named that.
    expect(await checkFed("threshold", "projectPlanFiveCount")).toEqual({
      fed: false,
      owningCheckKey: null,
    });
  });

  it("reports fed with a null owningCheckKey when the producer is genuinely ambiguous", async () => {
    // resolveOwningCheckKey deliberately refuses to guess when a keyword matches
    // more than one check key — the rule is still fed, just not by ONE check.
    // The UI renders this as "Fed by a real check" rather than naming one.
    wireCatalog([{ key: "identity:mfa-state" }, { key: "identity:mfa-registration" }]);
    expect(await checkFed("findings_keyword", "mfa")).toEqual({ fed: true, owningCheckKey: null });
  });
});
