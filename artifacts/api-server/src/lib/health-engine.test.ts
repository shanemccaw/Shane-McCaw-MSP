/**
 * health-engine.test.ts
 *
 * Unit tests for the architecture-health scoring engine:
 *   computeHealthEngine()        — full pure engine (fires signals + sums impacts)
 *   getSignalHealthImpacts()     — per-signal max-of-configured-rows impact lookup
 *   sumArchitectureHealth()      — pure per-pillar + overall sum
 *
 * Confirms the engine is a deterministic pure sum over signal fields with no
 * conditional logic, and that per-pillar sums plus the overall score match
 * hand-computed expectations from seeded test signals.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect } from "vitest";
import {
  computeHealthEngine,
  getSignalHealthImpacts,
  sumArchitectureHealth,
  HEALTH_PILLARS,
  type SignalHealthImpactConfig,
} from "./health-engine.ts";
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

describe("getSignalHealthImpacts", () => {
  it("reads each pillar field directly off a single rule", () => {
    const rule = makeRule({
      signalKey: "hasSecurityGaps",
      ruleType: "profile_key_falsy",
      sourceKey: "mfaEnforced",
      governanceImpact: 1,
      securityImpact: 10,
      complianceImpact: 2,
      adoptionImpact: 0,
      copilotImpact: 0,
      architectureImpact: 3,
    });
    const impacts = getSignalHealthImpacts([rule], []);
    const cfg = impacts.get("hasSecurityGaps")!;
    expect(cfg).toEqual<SignalHealthImpactConfig>({
      signalKey: "hasSecurityGaps",
      governanceImpact: 1,
      securityImpact: 10,
      complianceImpact: 2,
      adoptionImpact: 0,
      copilotImpact: 0,
      architectureImpact: 3,
      licensingImpact: 0,
    });
  });

  it("takes the MAX of duplicate values across multiple rules for the same signal (no double counting)", () => {
    const rule1 = makeRule({ signalKey: "hasGovernanceGaps", ruleType: "profile_key_lt", sourceKey: "governanceScore", governanceImpact: 5 });
    const rule2 = makeRule({ signalKey: "hasGovernanceGaps", ruleType: "profile_key_truthy", sourceKey: "hasGovernanceGaps", governanceImpact: 5 });
    const impacts = getSignalHealthImpacts([rule1, rule2], []);
    // NOT 10 — max, not sum, of duplicate rows
    expect(impacts.get("hasGovernanceGaps")!.governanceImpact).toBe(5);
  });

  it("takes the MAX when values differ across rules for the same signal", () => {
    const rule1 = makeRule({ signalKey: "hasSecurityGaps", ruleType: "profile_key_falsy", sourceKey: "mfaEnforced", securityImpact: 3 });
    const rule2 = makeRule({ signalKey: "hasSecurityGaps", ruleType: "profile_key_eq", sourceKey: "conditionalAccessPolicyCount", securityImpact: 8 });
    const impacts = getSignalHealthImpacts([rule1, rule2], []);
    expect(impacts.get("hasSecurityGaps")!.securityImpact).toBe(8);
  });

  it("considers both rules and groups for the same signal", () => {
    const group = makeGroup({ signalKey: "hasCopilotLicenses", logic: "OR", copilotImpact: 4 });
    const rule = makeRule({ signalKey: "hasCopilotLicenses", ruleType: "profile_key_gt", sourceKey: "copilotLicenseCount", copilotImpact: 9 });
    const impacts = getSignalHealthImpacts([rule], [group]);
    expect(impacts.get("hasCopilotLicenses")!.copilotImpact).toBe(9);
  });
});

describe("sumArchitectureHealth", () => {
  it("sums each pillar independently and the overall score as their total", () => {
    const impacts = new Map<string, SignalHealthImpactConfig>([
      ["sigA", { signalKey: "sigA", governanceImpact: 5, securityImpact: 10, complianceImpact: 0, adoptionImpact: 2, copilotImpact: 0, architectureImpact: 1, licensingImpact: 0 }],
      ["sigB", { signalKey: "sigB", governanceImpact: 3, securityImpact: 0, complianceImpact: 4, adoptionImpact: 0, copilotImpact: 6, architectureImpact: 0, licensingImpact: 0 }],
    ]);

    const { score, breakdown } = sumArchitectureHealth(["sigA", "sigB"], impacts);

    const byPillar = Object.fromEntries(breakdown.map(b => [b.pillar, b.score]));
    expect(byPillar).toEqual({
      governance: 8,   // 5 + 3
      security: 10,    // 10 + 0
      compliance: 4,   // 0 + 4
      adoption: 2,     // 2 + 0
      copilot: 6,      // 0 + 6
      architecture: 1, // 1 + 0
      licensing: 0,    // 0 + 0
    });

    // overall score is exactly the sum of the six pillar sums
    const handComputedOverall = 8 + 10 + 4 + 2 + 6 + 1;
    expect(score).toBe(handComputedOverall);
    expect(breakdown.reduce((sum, p) => sum + p.score, 0)).toBe(score);
  });

  it("includes every pillar in the breakdown, even when a signal contributes zero", () => {
    const impacts = new Map<string, SignalHealthImpactConfig>([
      ["sigA", { signalKey: "sigA", governanceImpact: 0, securityImpact: 0, complianceImpact: 0, adoptionImpact: 0, copilotImpact: 0, architectureImpact: 0, licensingImpact: 0 }],
    ]);
    const { score, breakdown } = sumArchitectureHealth(["sigA"], impacts);
    expect(score).toBe(0);
    expect(breakdown.map(b => b.pillar)).toEqual([...HEALTH_PILLARS]);
    for (const p of breakdown) expect(p.score).toBe(0);
  });

  it("treats a signal absent from the impacts map as contributing zero everywhere (no crash)", () => {
    const { score, breakdown } = sumArchitectureHealth(["unknownSignal"], new Map());
    expect(score).toBe(0);
    for (const p of breakdown) {
      expect(p.score).toBe(0);
      expect(p.contributions).toEqual([{ signalKey: "unknownSignal", value: 0 }]);
    }
  });
});

describe("computeHealthEngine — end-to-end pure sum, no conditional logic", () => {
  it("matches a hand-computed score across a realistic multi-signal, multi-pillar scenario", () => {
    const rules: SignalDerivationRule[] = [
      makeRule({
        signalKey: "hasSecurityGaps", ruleType: "profile_key_falsy", sourceKey: "mfaEnforced",
        securityImpact: 15, complianceImpact: 5,
      }),
      makeRule({
        signalKey: "hasGovernanceGaps", ruleType: "profile_key_truthy", sourceKey: "hasGovernanceGaps",
        governanceImpact: 12,
      }),
      makeRule({
        signalKey: "hasCopilotLicenses", ruleType: "profile_key_gt", sourceKey: "copilotLicenseCount", compareValue: "0",
        copilotImpact: 8, adoptionImpact: 3,
      }),
      // Not fired — copilotLicenseCount is 0 in the profile below, so this must NOT contribute.
      makeRule({
        signalKey: "hasSharePointIssues", ruleType: "profile_key_gt", sourceKey: "sharepointSiteCount", compareValue: "0",
        architectureImpact: 100,
      }),
    ];

    const profile = { mfaEnforced: false, hasGovernanceGaps: true, copilotLicenseCount: 25, sharepointSiteCount: 0 };
    const result = computeHealthEngine(profile, [], rules, []);

    expect(result.engine).toBe("health");
    expect(result.rawSignals.sort()).toEqual(["alwaysInclude", "hasCopilotLicenses", "hasGovernanceGaps", "hasSecurityGaps"].sort());

    const byPillar = Object.fromEntries(result.breakdown.map(b => [b.pillar, b.score]));
    expect(byPillar).toEqual({
      governance: 12,
      security: 15,
      compliance: 5,
      adoption: 3,
      copilot: 8,
      architecture: 0, // hasSharePointIssues never fired — its 100 must not leak in
      licensing: 0,
    });

    const handComputedScore = 12 + 15 + 5 + 3 + 8 + 0;
    expect(result.score).toBe(handComputedScore);
    expect(result.workflowVariables.architectureHealthScore).toBe(handComputedScore);
    expect(result.workflowVariables.securityHealthContribution).toBe(15);
    expect(result.workflowVariables.governanceHealthContribution).toBe(12);
  });

  it("is a pure sum with no conditional/threshold logic — doubling every impact field exactly doubles the score", () => {
    const rules: SignalDerivationRule[] = [
      makeRule({ signalKey: "hasSecurityGaps", ruleType: "profile_key_falsy", sourceKey: "mfaEnforced", securityImpact: 7, governanceImpact: 2 }),
    ];
    const profile = { mfaEnforced: false };

    const base = computeHealthEngine(profile, [], rules, []);

    const doubledRules: SignalDerivationRule[] = [
      makeRule({ signalKey: "hasSecurityGaps", ruleType: "profile_key_falsy", sourceKey: "mfaEnforced", securityImpact: 14, governanceImpact: 4 }),
    ];
    const doubled = computeHealthEngine(profile, [], doubledRules, []);

    expect(doubled.score).toBe(base.score * 2);
  });

  it("excludes disabled signals from both firing and the health sum entirely", () => {
    const rules: SignalDerivationRule[] = [
      makeRule({ signalKey: "hasSecurityGaps", ruleType: "profile_key_falsy", sourceKey: "mfaEnforced", securityImpact: 20 }),
    ];
    const profile = { mfaEnforced: false };

    const enabled = computeHealthEngine(profile, [], rules, [], new Set());
    expect(enabled.score).toBe(20);

    const disabled = computeHealthEngine(profile, [], rules, [], new Set(["hasSecurityGaps"]));
    expect(disabled.score).toBe(0);
    expect(disabled.rawSignals).not.toContain("hasSecurityGaps");
  });

  it("returns a deterministic result across repeated calls with identical inputs", () => {
    const rules: SignalDerivationRule[] = [
      makeRule({ signalKey: "hasCopilotLicenses", ruleType: "profile_key_gt", sourceKey: "copilotLicenseCount", compareValue: "0", copilotImpact: 6, adoptionImpact: 4 }),
    ];
    const profile = { copilotLicenseCount: 10 };

    const first = computeHealthEngine(profile, [], rules, []);
    const second = computeHealthEngine(profile, [], rules, []);

    expect(second.score).toBe(first.score);
    expect(second.breakdown).toEqual(first.breakdown);
  });

  it("uses AND/OR group logic exactly as computeTenantSignals does, and sums the group's impact fields once", () => {
    const group = makeGroup({ signalKey: "hasGovernanceGaps", logic: "AND", governanceImpact: 9, complianceImpact: 1 });
    const rule1 = makeRule({ signalKey: "hasGovernanceGaps", ruleType: "profile_key_lt", sourceKey: "governanceScore", compareValue: "60", groupId: group.id });
    const rule2 = makeRule({ signalKey: "hasGovernanceGaps", ruleType: "profile_key_truthy", sourceKey: "hasGovernanceGaps", groupId: group.id });

    // Both AND conditions true → signal fires → group's impact fields count once.
    const fired = computeHealthEngine({ governanceScore: 40, hasGovernanceGaps: true }, [], [rule1, rule2], [group]);
    expect(fired.score).toBe(9 + 1);

    // Only one AND condition true → signal does not fire → zero contribution.
    const notFired = computeHealthEngine({ governanceScore: 40 }, [], [rule1, rule2], [group]);
    expect(notFired.score).toBe(0);
  });
});
