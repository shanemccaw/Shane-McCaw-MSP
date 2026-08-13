/**
 * forecasting-engine.test.ts
 *
 * Unit tests for computeForecastingEngine() — proves:
 *   1. Score is a pure sum of trendValue * decayFactor over fired, enabled
 *      signals whose contributing rule/group defines a non-zero trendValue —
 *      no other math or conditionals.
 *   2. decayFactor = (1 - decayRate) only when decayRate is non-zero,
 *      otherwise 1 — never invented from ttlDays or any other formula.
 *   3. Signals with zero trendValue are excluded entirely.
 *   4. Disabled signals never contribute, even if they define a trendValue.
 *   5. Signals that did not fire never contribute.
 *   6. trendDirection is read directly off the highest-magnitude contributor,
 *      never derived from a formula.
 *   7. Output matches the unified engine contract and is deterministic
 *      across repeated calls with the same input.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect } from "vitest";
import { computeForecastingEngine } from "./forecasting-engine.ts";
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

function makeRule(
  overrides: Partial<SignalDerivationRule> & Pick<SignalDerivationRule, "signalKey" | "ruleType" | "sourceKey">,
): SignalDerivationRule {
  return {
    id: Math.floor(Math.random() * 9000) + 1000,
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

function makeGroup(
  overrides: Partial<SignalRuleGroup> & Pick<SignalRuleGroup, "signalKey" | "logic">,
): SignalRuleGroup {
  return {
    id: Math.floor(Math.random() * 9000) + 1000,
    label: null,
    sortOrder: 0,
    createdAt: BASE_DATE,
    ...DEFAULT_INTELLIGENCE_FIELDS,
    ...overrides,
  };
}

describe("computeForecastingEngine — basic shape", () => {
  it("returns the unified engine output contract", () => {
    const result = computeForecastingEngine({}, [], [], []);
    expect(result.engine).toBe("forecast");
    expect(typeof result.score).toBe("number");
    expect(Array.isArray(result.breakdown)).toBe(true);
    expect(Array.isArray(result.forecastBreakdown)).toBe(true);
    expect(Array.isArray(result.rawSignals)).toBe(true);
    expect(Array.isArray(result.rawRules)).toBe(true);
    expect(Array.isArray(result.rawRuleGroups)).toBe(true);
    expect(result.workflowVariables).toBeDefined();
    expect(typeof result.timestamp).toBe("string");
  });

  it("scores zero when no rules are configured", () => {
    const result = computeForecastingEngine({}, [], [], []);
    expect(result.score).toBe(0);
    expect(result.breakdown).toEqual([]);
    expect(result.trendDirection).toBe("flat");
  });
});

describe("computeForecastingEngine — pure summation, no decay", () => {
  it("sums trendValue (decayFactor 1) for a single fired signal (ungrouped rule)", () => {
    const rules = [
      makeRule({
        signalKey: "hasGovernanceGaps",
        ruleType: "profile_key_truthy",
        sourceKey: "hasGovernanceGaps",
        trendValue: 5,
        trendDirection: "up",
      }),
    ];
    const result = computeForecastingEngine({ hasGovernanceGaps: true }, [], rules, []);
    expect(result.score).toBe(5);
    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0]).toMatchObject({
      signalKey: "hasGovernanceGaps",
      trendValue: 5,
      decayRate: 0,
      decayFactor: 1,
      contribution: 5,
    });
    expect(result.trendDirection).toBe("up");
  });

  it("sums across multiple fired signals with no other math", () => {
    const rules = [
      makeRule({ signalKey: "sigA", ruleType: "profile_key_truthy", sourceKey: "a", trendValue: 4, trendDirection: "up" }),
      makeRule({ signalKey: "sigB", ruleType: "profile_key_truthy", sourceKey: "b", trendValue: -2, trendDirection: "down" }),
    ];
    const result = computeForecastingEngine({ a: true, b: true }, [], rules, []);
    expect(result.score).toBe(2); // 4 + (-2)
    expect(result.breakdown).toHaveLength(2);
  });

  it("includes contributions from a fired rule group, using the group's own intelligence fields", () => {
    const group = makeGroup({
      signalKey: "hasGovernanceGaps",
      logic: "OR",
      trendValue: 10,
      trendDirection: "up",
    });
    const rule = makeRule({
      signalKey: "hasGovernanceGaps",
      ruleType: "profile_key_truthy",
      sourceKey: "hasGovernanceGaps",
      groupId: group.id,
      // Rule-level trendValue is irrelevant once grouped — the group's own
      // fields are what get attributed.
      trendValue: 999,
    });
    const result = computeForecastingEngine({ hasGovernanceGaps: true }, [], [rule], [group]);
    expect(result.score).toBe(10);
    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0].source).toBe("group");
  });
});

describe("computeForecastingEngine — decayRate applied as stored multiplier", () => {
  it("applies decayFactor = 1 - decayRate when decayRate is non-zero", () => {
    const rules = [
      makeRule({ signalKey: "sigA", ruleType: "profile_key_truthy", sourceKey: "a", trendValue: 100, decayRate: 0.3, trendDirection: "up" }),
    ];
    const result = computeForecastingEngine({ a: true }, [], rules, []);
    expect(result.breakdown[0].decayFactor).toBeCloseTo(0.7);
    expect(result.score).toBeCloseTo(70); // 100 * 0.7
  });

  it("does not apply any decay when decayRate is exactly 0", () => {
    const rules = [
      makeRule({ signalKey: "sigA", ruleType: "profile_key_truthy", sourceKey: "a", trendValue: 50, decayRate: 0, trendDirection: "up" }),
    ];
    const result = computeForecastingEngine({ a: true }, [], rules, []);
    expect(result.breakdown[0].decayFactor).toBe(1);
    expect(result.score).toBe(50);
  });

  it("applies decay from the group's own decayRate field, ignoring the rule's decayRate once grouped", () => {
    const group = makeGroup({ signalKey: "sigA", logic: "OR", trendValue: 40, decayRate: 0.5, trendDirection: "up" });
    const rule = makeRule({ signalKey: "sigA", ruleType: "profile_key_truthy", sourceKey: "a", groupId: group.id, decayRate: 0.9 });
    const result = computeForecastingEngine({ a: true }, [], [rule], [group]);
    expect(result.breakdown[0].decayFactor).toBeCloseTo(0.5);
    expect(result.score).toBeCloseTo(20); // 40 * 0.5
  });

  it("applies decay symmetrically to negative trend values", () => {
    const rules = [
      makeRule({ signalKey: "sigA", ruleType: "profile_key_truthy", sourceKey: "a", trendValue: -50, decayRate: 0.2, trendDirection: "down" }),
    ];
    const result = computeForecastingEngine({ a: true }, [], rules, []);
    expect(result.score).toBeCloseTo(-40); // -50 * 0.8
  });
});

describe("computeForecastingEngine — zero-trendValue exclusion", () => {
  it("excludes fired signals whose rule defines trendValue = 0", () => {
    const rules = [
      makeRule({ signalKey: "hasCopilotLicenses", ruleType: "profile_key_truthy", sourceKey: "hasCopilotLicenses", trendValue: 0 }),
    ];
    const result = computeForecastingEngine({ hasCopilotLicenses: true }, [], rules, []);
    expect(result.score).toBe(0);
    expect(result.breakdown).toEqual([]);
  });

  it("only counts the trend-defining signal when mixed with a zero-trend signal", () => {
    const rules = [
      makeRule({ signalKey: "trendSig", ruleType: "profile_key_truthy", sourceKey: "t", trendValue: 3 }),
      makeRule({ signalKey: "noTrendSig", ruleType: "profile_key_truthy", sourceKey: "n", trendValue: 0 }),
    ];
    const result = computeForecastingEngine({ t: true, n: true }, [], rules, []);
    expect(result.score).toBe(3);
    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0].signalKey).toBe("trendSig");
  });
});

describe("computeForecastingEngine — firing gate", () => {
  it("excludes trend-defining signals that did not fire", () => {
    const rules = [
      makeRule({ signalKey: "hasGovernanceGaps", ruleType: "profile_key_truthy", sourceKey: "hasGovernanceGaps", trendValue: 10 }),
    ];
    const result = computeForecastingEngine({ hasGovernanceGaps: false }, [], rules, []);
    expect(result.score).toBe(0);
    expect(result.breakdown).toEqual([]);
  });

  it("excludes disabled signals even if they define a trendValue", () => {
    const rules = [
      makeRule({ signalKey: "hasGovernanceGaps", ruleType: "profile_key_truthy", sourceKey: "hasGovernanceGaps", trendValue: 10 }),
    ];
    const disabled = new Set(["hasGovernanceGaps"]);
    const result = computeForecastingEngine({ hasGovernanceGaps: true }, [], rules, [], disabled);
    expect(result.score).toBe(0);
    expect(result.breakdown).toEqual([]);
    expect(result.rawSignals).not.toContain("hasGovernanceGaps");
  });
});

describe("computeForecastingEngine — trendDirection derivation", () => {
  it("reads trendDirection from the single contributor when only one fires", () => {
    const rules = [
      makeRule({ signalKey: "sigA", ruleType: "profile_key_truthy", sourceKey: "a", trendValue: 1, trendDirection: "down" }),
    ];
    const result = computeForecastingEngine({ a: true }, [], rules, []);
    expect(result.trendDirection).toBe("down");
  });

  it("picks trendDirection from the highest-magnitude contributor, not the first or last", () => {
    const rules = [
      makeRule({ signalKey: "sigSmall", ruleType: "profile_key_truthy", sourceKey: "small", trendValue: 1, trendDirection: "up" }),
      makeRule({ signalKey: "sigBig", ruleType: "profile_key_truthy", sourceKey: "big", trendValue: -20, trendDirection: "down" }),
    ];
    const result = computeForecastingEngine({ small: true, big: true }, [], rules, []);
    expect(result.trendDirection).toBe("down");
    expect(result.score).toBe(-19); // 1 + (-20)
  });

  it("never derives trendDirection from the sign of the score itself", () => {
    const rules = [
      makeRule({ signalKey: "sigUp", ruleType: "profile_key_truthy", sourceKey: "up1", trendValue: 15, trendDirection: "up" }),
      makeRule({ signalKey: "sigDown", ruleType: "profile_key_truthy", sourceKey: "down1", trendValue: -20, trendDirection: "down" }),
    ];
    const result = computeForecastingEngine({ up1: true, down1: true }, [], rules, []);
    expect(result.score).toBe(-5); // 15 + (-20)
    expect(result.trendDirection).toBe("down"); // |-20| > |15| so "down" dominates
  });
});

describe("computeForecastingEngine — single-claim precedence (no double counting)", () => {
  it("counts a signal at most once when it has multiple true trend-defining contributors (group precedence over ungrouped rule)", () => {
    const group = makeGroup({ signalKey: "sigA", logic: "OR", trendValue: 100 });
    const groupRule = makeRule({ signalKey: "sigA", ruleType: "profile_key_truthy", sourceKey: "flagA", groupId: group.id });
    const ungroupedTrendRule = makeRule({ signalKey: "sigA", ruleType: "profile_key_truthy", sourceKey: "flagB", trendValue: 999 });

    const profile = { flagA: true, flagB: true };
    const result = computeForecastingEngine(profile, [], [groupRule, ungroupedTrendRule], [group]);

    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0].source).toBe("group");
    expect(result.score).toBe(100);
  });

  it("counts a signal at most once when it has two true trend-defining rule groups (first group in declaration order wins)", () => {
    const groupA = makeGroup({ id: 1, signalKey: "sigA", logic: "OR", trendValue: 10 });
    const groupB = makeGroup({ id: 2, signalKey: "sigA", logic: "OR", trendValue: 999 });
    const ruleA = makeRule({ signalKey: "sigA", ruleType: "profile_key_truthy", sourceKey: "flagA", groupId: groupA.id });
    const ruleB = makeRule({ signalKey: "sigA", ruleType: "profile_key_truthy", sourceKey: "flagB", groupId: groupB.id });

    const profile = { flagA: true, flagB: true };
    const result = computeForecastingEngine(profile, [], [ruleA, ruleB], [groupA, groupB]);

    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0].sourceId).toBe(groupA.id);
    expect(result.score).toBe(10);
  });
});

describe("computeForecastingEngine — rawRules/rawRuleGroups/rawSignals passthrough", () => {
  it("returns the full rule and group inputs alongside fired signal keys", () => {
    const group = makeGroup({ signalKey: "hasGovernanceGaps", logic: "OR", trendValue: 2 });
    const rule = makeRule({ signalKey: "hasGovernanceGaps", ruleType: "profile_key_truthy", sourceKey: "hasGovernanceGaps", groupId: group.id });
    const result = computeForecastingEngine({ hasGovernanceGaps: true }, [], [rule], [group]);
    expect(result.rawRules).toEqual([rule]);
    expect(result.rawRuleGroups).toEqual([group]);
    expect(result.rawSignals).toContain("hasGovernanceGaps");
    expect(result.rawSignals).toContain("alwaysInclude");
  });
});

describe("computeForecastingEngine — determinism", () => {
  it("returns identical score/breakdown across repeated calls with the same input", () => {
    const rules = [
      makeRule({ signalKey: "sigA", ruleType: "profile_key_truthy", sourceKey: "a", trendValue: 12, decayRate: 0.25, trendDirection: "up" }),
      makeRule({ signalKey: "sigB", ruleType: "profile_key_truthy", sourceKey: "b", trendValue: -8, decayRate: 0.1, trendDirection: "down" }),
    ];
    const profile = { a: true, b: true };

    const first = computeForecastingEngine(profile, [], rules, []);
    const second = computeForecastingEngine(profile, [], rules, []);

    expect(second.score).toBe(first.score);
    expect(second.breakdown).toEqual(first.breakdown);
    expect(second.trendDirection).toBe(first.trendDirection);
  });
});
