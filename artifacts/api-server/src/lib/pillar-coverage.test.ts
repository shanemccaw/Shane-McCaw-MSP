/**
 * pillar-coverage.test.ts
 *
 * Unit tests for getPillarCoverage()'s seven-pillar radar coverage — in
 * particular the security pillar, which is scored by the standalone Security
 * Engine (combined into calculateArchitectureHealthScore's breakdown one
 * level up, never part of HEALTH_PILLARS) and must still be a checkable
 * coverage option here. Regression target: a security-focused package
 * (core:security-baseline shape) used to return radar.pillars: [] because the
 * loop only walked the six HEALTH_PILLARS.
 *
 * DB-free: mocks the same module boundaries as health-engine.test.ts
 * (buildTenantProfile / getDisabledSignalKeys / fetchSignalRulesAndGroups)
 * plus @workspace/db's `db.select` for the monitoring_package_checks lookup.
 * Everything else — signal firing, both engines, the display normalization —
 * runs the real code.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { getPillarCoverage } from "./pillar-coverage.ts";
import { computePillarDisplayScore, computeDisplayHealth } from "./health-display.ts";
import {
  computeHealthEngine,
  getSignalHealthImpacts,
  HEALTH_PILLARS,
} from "./health-engine.ts";
import { buildTenantProfile, getDisabledSignalKeys } from "./tenant-signals.ts";
import { fetchSignalRulesAndGroups } from "./priority-engine.ts";
import { db } from "@workspace/db";
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

/** Wires the three mocked module boundaries for one scenario. */
function wireScenario(opts: {
  packageCheckKeys: string[];
  rules: SignalDerivationRule[];
  groups?: SignalRuleGroup[];
  profile: Record<string, unknown>;
}) {
  vi.mocked(db.select).mockReturnValue({
    from: () => ({
      where: async () => opts.packageCheckKeys.map((checkKey) => ({ checkKey })),
    }),
  } as unknown as ReturnType<typeof db.select>);
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

describe("getPillarCoverage — security pillar (Security Engine, combined one level up)", () => {
  it("REGRESSION: a security-only package (core:security-baseline shape) yields a real security entry, not []", async () => {
    // Mark Perry shape: every check the package runs feeds identity/security
    // signals with securityImpact only — zero impact on the six health pillars.
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
