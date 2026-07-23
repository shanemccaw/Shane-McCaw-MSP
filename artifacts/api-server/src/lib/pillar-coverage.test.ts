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
    const rules = [
      makeRule({
        signalKey: "licensing:has_project_online", ruleType: "profile_key_gt",
        sourceKey: "projectPlanFiveCount", compareValue: "0", licensingImpact: 10,
      }),
      makeRule({
        signalKey: "security:lacks_entra_premium", ruleType: "profile_key_falsy",
        sourceKey: "hasAADP1orP2", securityImpact: 15,
      }),
    ];
    wireScenario({
      packageCheckKeys: ["licensing:project-online-detection", "identity:entra-plan-detection"],
      checkDefinitions: [
        {
          key: "licensing:project-online-detection",
          mapping: [{ sourceField: "skuPartNumber", targetField: "projectPlanFiveCount", transform: "countEquals('PROJECTPREMIUM')" }],
        },
        {
          key: "identity:entra-plan-detection",
          mapping: [{ sourceField: "servicePlans", targetField: "hasAADP1orP2", transform: "exists" }],
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
    const rules = [
      makeRule({
        signalKey: "governance:orphaned-teams", ruleType: "threshold",
        sourceKey: "teams:orphaned-teams", compareValue: "3", governanceImpact: 8,
      }),
    ];
    wireScenario({
      packageCheckKeys: ["teams:orphaned-teams"],
      checkDefinitions: [{ key: "teams:orphaned-teams" }],
      rules,
      profile: { "teams:orphaned-teams__itemCount": 5 }, // fires: 5 > 3 → raw 8 of max 8 → display 0
    });

    const covered = await getPillarCoverage("core:enhanced-monitoring", 4);

    expect(covered).toEqual([{ pillar: "governance", label: "Governance", score: 0 }]);
  });

  it("profile_key_* rules on a raw-properties extraction key (<prop>_count/_first/_values) count as coverage", async () => {
    const rules = [
      makeRule({
        signalKey: "adoption:no-owners", ruleType: "profile_key_eq",
        sourceKey: "owner_count", compareValue: "0", adoptionImpact: 6,
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
    const rules = [
      makeRule({
        signalKey: "security:low-secure-score", ruleType: "profile_key_lt",
        sourceKey: "securityScore", compareValue: "60", securityImpact: 20,
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
    const rules = [
      makeRule({
        signalKey: "collab:sharepoint-issues", ruleType: "findings_keyword",
        sourceKey: "SharePoint", architectureImpact: 5,
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
    ]) {
      expect(keys.has(expected), expected).toBe(true);
    }
    expect(keys.has("notCovered")).toBe(false);
    expect(keys.has("securityScore")).toBe(false); // its producer check is not covered
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
    const rules = [
      makeRule({ signalKey: "sig:gov", ruleType: "profile_key_truthy", sourceKey: "check:gov", governanceImpact: 10 }),
      makeRule({ signalKey: "sig:comp", ruleType: "profile_key_truthy", sourceKey: "check:comp", complianceImpact: 10 }),
      makeRule({ signalKey: "sig:adopt", ruleType: "profile_key_truthy", sourceKey: "check:adopt", adoptionImpact: 10 }),
      makeRule({ signalKey: "sig:copilot", ruleType: "profile_key_truthy", sourceKey: "check:copilot", copilotImpact: 10 }),
      makeRule({ signalKey: "sig:arch", ruleType: "profile_key_truthy", sourceKey: "check:arch", architectureImpact: 10 }),
      makeRule({ signalKey: "sig:lic", ruleType: "profile_key_truthy", sourceKey: "check:lic", licensingImpact: 10 }),
      makeRule({ signalKey: "sig:sec", ruleType: "profile_key_truthy", sourceKey: "check:sec", securityImpact: 10 }),
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
      // The package's own check — governance only.
      makeRule({ signalKey: "sig:gov", ruleType: "profile_key_truthy", sourceKey: "check:gov", governanceImpact: 10 }),
      // A security rule EXISTS system-wide, but no check in this package feeds it.
      makeRule({ signalKey: "sig:sec", ruleType: "profile_key_truthy", sourceKey: "check:sec", securityImpact: 20 }),
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
    expect(computePillarDisplayScore("security", output, impacts)).toBeNull();
  });

  it("returns null when no rules anywhere configure an impact for the pillar (theoreticalMax 0)", () => {
    const output = computeHealthEngine({}, [], [secRule], []);
    const impacts = getSignalHealthImpacts([secRule], []);
    expect(computePillarDisplayScore("licensing", output, impacts)).toBeNull();
  });

  it("computeDisplayHealth is unchanged for the six health pillars", () => {
    const govRule = makeRule({
      signalKey: "sig:gov", ruleType: "profile_key_truthy", sourceKey: "check:gov", governanceImpact: 10,
    });
    const output = computeHealthEngine({ "check:gov": true }, [], [govRule], []);
    const display = computeDisplayHealth(output, [govRule], []);

    expect(display.map((p) => p.pillar)).toEqual([...HEALTH_PILLARS]);
    expect(display.find((p) => p.pillar === "governance")!.displayScore).toBe(0); // 10 of max 10 fired
    for (const p of display) {
      if (p.pillar !== "governance") expect(p.displayScore).toBeNull(); // no impacts configured
    }
  });
});
