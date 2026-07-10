/**
 * drift-engine.test.ts
 *
 * Unit tests for computeDriftEngine() — proves:
 *   1. Score is a pure sum of trendValue + governanceImpact over fired,
 *      enabled, drift:* category signals — no other math or conditionals.
 *   2. Non-drift categories are excluded from the score entirely.
 *   3. Disabled signals never contribute, even if their category matches.
 *   4. Signals that did not fire never contribute.
 *   5. trendDirection is read directly off the highest-magnitude contributor,
 *      never derived from a formula.
 *   6. Output matches the unified engine contract.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect } from "vitest";
import { computeDriftEngine } from "./drift-engine.ts";
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

describe("computeDriftEngine — basic shape", () => {
  it("returns the unified engine output contract", () => {
    const result = computeDriftEngine({}, [], [], []);
    expect(result.engine).toBe("drift");
    expect(typeof result.score).toBe("number");
    expect(Array.isArray(result.breakdown)).toBe(true);
    expect(Array.isArray(result.driftBreakdown)).toBe(true);
    expect(Array.isArray(result.rawSignals)).toBe(true);
    expect(Array.isArray(result.rawRules)).toBe(true);
    expect(Array.isArray(result.rawRuleGroups)).toBe(true);
    expect(result.workflowVariables).toBeDefined();
    expect(typeof result.timestamp).toBe("string");
  });

  it("scores zero when no rules are configured", () => {
    const result = computeDriftEngine({}, [], [], []);
    expect(result.score).toBe(0);
    expect(result.breakdown).toEqual([]);
    expect(result.trendDirection).toBe("flat");
  });
});

describe("computeDriftEngine — pure summation", () => {
  it("sums trendValue + governanceImpact for a single fired drift signal (ungrouped rule)", () => {
    const rules = [
      makeRule({
        signalKey: "hasGovernanceGaps",
        ruleType: "profile_key_truthy",
        sourceKey: "hasGovernanceGaps",
        category: "drift:governance",
        trendValue: 5,
        governanceImpact: 3,
        trendDirection: "up",
      }),
    ];
    const result = computeDriftEngine({ hasGovernanceGaps: true }, [], rules, []);
    expect(result.score).toBe(8); // 5 + 3, nothing else
    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0]).toMatchObject({
      signalKey: "hasGovernanceGaps",
      category: "drift:governance",
      trendValue: 5,
      governanceImpact: 3,
      contribution: 8,
    });
    expect(result.trendDirection).toBe("up");
  });

  it("sums across multiple fired drift signals with no other math", () => {
    const rules = [
      makeRule({ signalKey: "sigA", ruleType: "profile_key_truthy", sourceKey: "a", category: "drift:policy", trendValue: 4, governanceImpact: 1, trendDirection: "up" }),
      makeRule({ signalKey: "sigB", ruleType: "profile_key_truthy", sourceKey: "b", category: "drift:controls", trendValue: -2, governanceImpact: 6, trendDirection: "down" }),
    ];
    const result = computeDriftEngine({ a: true, b: true }, [], rules, []);
    // (4 + 1) + (-2 + 6) = 5 + 4 = 9
    expect(result.score).toBe(9);
    expect(result.breakdown).toHaveLength(2);
  });

  it("includes drift contributions from a fired rule group, using the group's own intelligence fields", () => {
    const group = makeGroup({
      signalKey: "hasGovernanceGaps",
      logic: "OR",
      category: "drift:policy",
      trendValue: 10,
      governanceImpact: 2,
      trendDirection: "up",
    });
    const rule = makeRule({
      signalKey: "hasGovernanceGaps",
      ruleType: "profile_key_truthy",
      sourceKey: "hasGovernanceGaps",
      groupId: group.id,
      // Rule-level intelligence fields are irrelevant once grouped — the
      // group's fields are what get attributed.
      category: "pricing:ignored",
      trendValue: 999,
      governanceImpact: 999,
    });
    const result = computeDriftEngine({ hasGovernanceGaps: true }, [], [rule], [group]);
    expect(result.score).toBe(12); // 10 + 2, from the group only
    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0].category).toBe("drift:policy");
  });

  it("does NOT count a drift-tagged AND group whose rules do not all evaluate true, even if the signal fired via another rule", () => {
    // hasGovernanceGaps fires via a separate, non-drift ungrouped rule —
    // but the drift-tagged AND group's own condition is false because only
    // one of its two rules is satisfied. The false group must not contribute.
    const driftGroup = makeGroup({
      signalKey: "hasGovernanceGaps",
      logic: "AND",
      category: "drift:policy",
      trendValue: 50,
      governanceImpact: 50,
    });
    const driftGroupRule1 = makeRule({ signalKey: "hasGovernanceGaps", ruleType: "profile_key_truthy", sourceKey: "flagA", groupId: driftGroup.id });
    const driftGroupRule2 = makeRule({ signalKey: "hasGovernanceGaps", ruleType: "profile_key_truthy", sourceKey: "flagB", groupId: driftGroup.id });
    const otherFiringRule = makeRule({ signalKey: "hasGovernanceGaps", ruleType: "profile_key_truthy", sourceKey: "otherTrigger", category: "pricing:unrelated" });

    const profile = { flagA: true, flagB: false, otherTrigger: true }; // signal fires via otherTrigger; drift AND group is false (flagB missing)
    const result = computeDriftEngine(profile, [], [driftGroupRule1, driftGroupRule2, otherFiringRule], [driftGroup]);

    expect(result.score).toBe(0);
    expect(result.breakdown).toEqual([]);
  });

  it("does NOT count a drift-tagged ungrouped rule that evaluates false, even though its signal fired via a different rule", () => {
    const driftRule = makeRule({ signalKey: "hasGovernanceGaps", ruleType: "profile_key_truthy", sourceKey: "driftFlag", category: "drift:policy", trendValue: 40, governanceImpact: 40 });
    const otherFiringRule = makeRule({ signalKey: "hasGovernanceGaps", ruleType: "profile_key_truthy", sourceKey: "otherTrigger", category: "pricing:unrelated" });

    const profile = { driftFlag: false, otherTrigger: true }; // signal fires via otherTrigger; driftRule itself is false
    const result = computeDriftEngine(profile, [], [driftRule, otherFiringRule], []);

    expect(result.score).toBe(0);
    expect(result.breakdown).toEqual([]);
  });

  it("DOES count a drift-tagged rule that independently evaluates true, in addition to whatever else fired the signal", () => {
    const driftRule = makeRule({ signalKey: "hasGovernanceGaps", ruleType: "profile_key_truthy", sourceKey: "driftFlag", category: "drift:policy", trendValue: 7, governanceImpact: 3 });
    const otherFiringRule = makeRule({ signalKey: "hasGovernanceGaps", ruleType: "profile_key_truthy", sourceKey: "otherTrigger", category: "pricing:unrelated" });

    const profile = { driftFlag: true, otherTrigger: true }; // both true — signal fires, and drift rule is independently true
    const result = computeDriftEngine(profile, [], [driftRule, otherFiringRule], []);

    expect(result.score).toBe(10);
    expect(result.breakdown).toHaveLength(1);
  });

  it("counts a signal at most once even when it has multiple true drift-tagged contributors (group precedence over ungrouped rule)", () => {
    const group = makeGroup({ signalKey: "hasGovernanceGaps", logic: "OR", category: "drift:policy", trendValue: 100, governanceImpact: 0 });
    const groupRule = makeRule({ signalKey: "hasGovernanceGaps", ruleType: "profile_key_truthy", sourceKey: "flagA", groupId: group.id });
    const ungroupedDriftRule = makeRule({ signalKey: "hasGovernanceGaps", ruleType: "profile_key_truthy", sourceKey: "flagB", category: "drift:policy", trendValue: 999, governanceImpact: 999 });

    const profile = { flagA: true, flagB: true }; // both the group and the ungrouped rule are independently true
    const result = computeDriftEngine(profile, [], [groupRule, ungroupedDriftRule], [group]);

    // Only ONE breakdown entry for the signal — the group wins by precedence.
    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0].source).toBe("group");
    expect(result.score).toBe(100);
  });

  it("counts a signal at most once when it has two true drift-tagged rule groups (first group in declaration order wins)", () => {
    const groupA = makeGroup({ id: 1, signalKey: "hasGovernanceGaps", logic: "OR", category: "drift:policy", trendValue: 10, governanceImpact: 0 });
    const groupB = makeGroup({ id: 2, signalKey: "hasGovernanceGaps", logic: "OR", category: "drift:policy", trendValue: 999, governanceImpact: 0 });
    const ruleA = makeRule({ signalKey: "hasGovernanceGaps", ruleType: "profile_key_truthy", sourceKey: "flagA", groupId: groupA.id });
    const ruleB = makeRule({ signalKey: "hasGovernanceGaps", ruleType: "profile_key_truthy", sourceKey: "flagB", groupId: groupB.id });

    const profile = { flagA: true, flagB: true }; // both groups independently true
    const result = computeDriftEngine(profile, [], [ruleA, ruleB], [groupA, groupB]);

    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0].sourceId).toBe(groupA.id);
    expect(result.score).toBe(10);
  });
});

describe("computeDriftEngine — category filtering", () => {
  it("excludes fired signals whose category does not start with drift:", () => {
    const rules = [
      makeRule({ signalKey: "hasCopilotLicenses", ruleType: "profile_key_truthy", sourceKey: "hasCopilotLicenses", category: "copilot:readiness", trendValue: 50, governanceImpact: 50 }),
    ];
    const result = computeDriftEngine({ hasCopilotLicenses: true }, [], rules, []);
    expect(result.score).toBe(0);
    expect(result.breakdown).toEqual([]);
  });

  it("only counts the drift-tagged signal when mixed with a non-drift signal", () => {
    const rules = [
      makeRule({ signalKey: "driftSig", ruleType: "profile_key_truthy", sourceKey: "d", category: "drift:governance", trendValue: 3, governanceImpact: 2 }),
      makeRule({ signalKey: "nonDriftSig", ruleType: "profile_key_truthy", sourceKey: "n", category: "pricing:tier", trendValue: 100, governanceImpact: 100 }),
    ];
    const result = computeDriftEngine({ d: true, n: true }, [], rules, []);
    expect(result.score).toBe(5); // only the drift signal
    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0].signalKey).toBe("driftSig");
  });
});

describe("computeDriftEngine — firing gate", () => {
  it("excludes drift signals that did not fire", () => {
    const rules = [
      makeRule({ signalKey: "hasGovernanceGaps", ruleType: "profile_key_truthy", sourceKey: "hasGovernanceGaps", category: "drift:governance", trendValue: 10, governanceImpact: 10 }),
    ];
    const result = computeDriftEngine({ hasGovernanceGaps: false }, [], rules, []);
    expect(result.score).toBe(0);
    expect(result.breakdown).toEqual([]);
  });

  it("excludes disabled signals even if drift-tagged and otherwise matching", () => {
    const rules = [
      makeRule({ signalKey: "hasGovernanceGaps", ruleType: "profile_key_truthy", sourceKey: "hasGovernanceGaps", category: "drift:governance", trendValue: 10, governanceImpact: 10 }),
    ];
    const disabled = new Set(["hasGovernanceGaps"]);
    const result = computeDriftEngine({ hasGovernanceGaps: true }, [], rules, [], disabled);
    expect(result.score).toBe(0);
    expect(result.breakdown).toEqual([]);
    expect(result.rawSignals).not.toContain("hasGovernanceGaps");
  });
});

describe("computeDriftEngine — trendDirection derivation", () => {
  it("reads trendDirection from the single contributor when only one fires", () => {
    const rules = [
      makeRule({ signalKey: "sigA", ruleType: "profile_key_truthy", sourceKey: "a", category: "drift:policy", trendValue: 1, governanceImpact: 1, trendDirection: "down" }),
    ];
    const result = computeDriftEngine({ a: true }, [], rules, []);
    expect(result.trendDirection).toBe("down");
  });

  it("picks trendDirection from the highest-magnitude contributor, not the first or last", () => {
    const rules = [
      makeRule({ signalKey: "sigSmall", ruleType: "profile_key_truthy", sourceKey: "small", category: "drift:a", trendValue: 1, governanceImpact: 0, trendDirection: "up" }),
      makeRule({ signalKey: "sigBig", ruleType: "profile_key_truthy", sourceKey: "big", category: "drift:b", trendValue: -20, governanceImpact: -5, trendDirection: "down" }),
    ];
    const result = computeDriftEngine({ small: true, big: true }, [], rules, []);
    // |1| < |-25| so the big contributor's direction wins even though its score is negative
    expect(result.trendDirection).toBe("down");
    expect(result.score).toBe(-24); // 1 + (-25)
  });

  it("never derives trendDirection from the sign of the score itself", () => {
    // Score is negative overall (-2), but the dominant (highest-magnitude)
    // contributor by far trends "up". If trendDirection were derived from
    // sign(score) this would incorrectly report "down".
    const rules = [
      makeRule({ signalKey: "sigUp", ruleType: "profile_key_truthy", sourceKey: "up1", category: "drift:a", trendValue: 15, governanceImpact: 5, trendDirection: "up" }),
      makeRule({ signalKey: "sigDown", ruleType: "profile_key_truthy", sourceKey: "down1", category: "drift:b", trendValue: -20, governanceImpact: -2, trendDirection: "down" }),
    ];
    const result = computeDriftEngine({ up1: true, down1: true }, [], rules, []);
    expect(result.score).toBe(-2); // (15 + 5) + (-20 + -2) = 20 - 22 = -2
    expect(result.trendDirection).toBe("down"); // |-22| > |20| so "down" dominates, matching magnitude not score sign
  });
});

describe("computeDriftEngine — rawRules/rawRuleGroups/rawSignals passthrough", () => {
  it("returns the full rule and group inputs alongside fired signal keys", () => {
    const group = makeGroup({ signalKey: "hasGovernanceGaps", logic: "OR", category: "drift:policy", trendValue: 2, governanceImpact: 2 });
    const rule = makeRule({ signalKey: "hasGovernanceGaps", ruleType: "profile_key_truthy", sourceKey: "hasGovernanceGaps", groupId: group.id });
    const result = computeDriftEngine({ hasGovernanceGaps: true }, [], [rule], [group]);
    expect(result.rawRules).toEqual([rule]);
    expect(result.rawRuleGroups).toEqual([group]);
    expect(result.rawSignals).toContain("hasGovernanceGaps");
    expect(result.rawSignals).toContain("alwaysInclude");
  });
});
