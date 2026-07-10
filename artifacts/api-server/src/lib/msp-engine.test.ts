/**
 * msp-engine.test.ts
 *
 * Unit tests for the pure aggregation core of the MSP portfolio-risk engine:
 *   aggregatePortfolioRisk()    — sums per-tenant combinedScore into portfolioRisk, sorts rankedTenants
 *   computeTenantEngineScores() — sums the health/drift/priority engines' scores into combinedScore
 *
 * These prove the engine is a pure sum/sort over the outputs of the
 * existing health, drift, and priority engines — nothing is weighted,
 * recomputed, or conditionally included.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect } from "vitest";
import { aggregatePortfolioRisk, computeTenantEngineScores, type TenantEngineScores } from "./msp-engine.ts";
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

function rule(overrides: Partial<SignalDerivationRule> & Pick<SignalDerivationRule, "id" | "signalKey" | "ruleType" | "sourceKey">): SignalDerivationRule {
  return {
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

function tenant(id: number, combinedScore: number, overrides: Partial<TenantEngineScores> = {}): TenantEngineScores {
  return {
    tenantId: id,
    tenantName: `Tenant ${id}`,
    architectureHealthScore: 0,
    driftScore: 0,
    priorityScore: 0,
    combinedScore,
    firedSignals: [],
    ...overrides,
  };
}

describe("aggregatePortfolioRisk", () => {
  it("portfolioRisk is exactly the sum of every tenant's combinedScore", () => {
    const tenants = [tenant(1, 30), tenant(2, 50), tenant(3, 20)];
    const { portfolioRisk } = aggregatePortfolioRisk(tenants);
    expect(portfolioRisk).toBe(100);
  });

  it("changing one tenant's combinedScore changes portfolioRisk by exactly that delta", () => {
    const before = aggregatePortfolioRisk([tenant(1, 30), tenant(2, 50)]);
    const after = aggregatePortfolioRisk([tenant(1, 30), tenant(2, 65)]);
    expect(after.portfolioRisk - before.portfolioRisk).toBe(15);
  });

  it("sorts rankedTenants descending by combinedScore", () => {
    const tenants = [tenant(1, 10), tenant(2, 90), tenant(3, 50)];
    const { rankedTenants } = aggregatePortfolioRisk(tenants);
    expect(rankedTenants.map(t => t.tenantId)).toEqual([2, 3, 1]);
  });

  it("does not mutate the input array (returns a sorted copy)", () => {
    const tenants = [tenant(1, 10), tenant(2, 90)];
    aggregatePortfolioRisk(tenants);
    expect(tenants.map(t => t.tenantId)).toEqual([1, 2]);
  });

  it("returns portfolioRisk 0 and empty rankedTenants for an empty portfolio", () => {
    const { portfolioRisk, rankedTenants } = aggregatePortfolioRisk([]);
    expect(portfolioRisk).toBe(0);
    expect(rankedTenants).toEqual([]);
  });

  it("is deterministic — same input always produces the same output", () => {
    const tenants = [tenant(1, 30), tenant(2, 50), tenant(3, 20)];
    const first = aggregatePortfolioRisk(tenants);
    const second = aggregatePortfolioRisk(tenants);
    expect(second).toEqual(first);
  });
});

describe("computeTenantEngineScores", () => {
  it("combinedScore is exactly the sum of the health, drift, and priority engine scores — nothing else", () => {
    const rules: SignalDerivationRule[] = [
      rule({ id: 1, signalKey: "hasSecurityGaps", ruleType: "profile_key_falsy", sourceKey: "mfaEnforced", category: "priority:x", priorityScoreContribution: 40, securityImpact: 10 }),
      rule({ id: 2, signalKey: "hasSecurityGaps", ruleType: "profile_key_falsy", sourceKey: "mfaEnforced", category: "drift:x", trendValue: 5, governanceImpact: 3 }),
    ];
    const groups: SignalRuleGroup[] = [];
    const profile = { mfaEnforced: false };

    const result = computeTenantEngineScores(1, "Acme", profile, [], rules, groups, new Set());

    // health: for signal hasSecurityGaps, each pillar takes the MAX configured across its
    // rules — securityImpact 10 (rule 1) + governanceImpact 3 (rule 2) = 13
    expect(result.architectureHealthScore).toBe(13);
    // drift: trendValue(5) + governanceImpact(3) from the drift:-tagged rule = 8
    expect(result.driftScore).toBe(8);
    // priority: priorityScoreContribution 40 for hasSecurityGaps + alwaysInclude(0) = 40
    expect(result.priorityScore).toBe(40);
    expect(result.combinedScore).toBe(result.architectureHealthScore + result.driftScore + result.priorityScore);
    expect(result.combinedScore).toBe(61);
  });

  it("respects disabled signals across all three underlying engines identically", () => {
    const rules: SignalDerivationRule[] = [
      rule({ id: 1, signalKey: "hasSecurityGaps", ruleType: "profile_key_falsy", sourceKey: "mfaEnforced", category: "priority:x", priorityScoreContribution: 40, securityImpact: 10, trendValue: 5, governanceImpact: 3 }),
    ];
    const groups: SignalRuleGroup[] = [];
    const profile = { mfaEnforced: false };

    const enabled = computeTenantEngineScores(1, "Acme", profile, [], rules, groups, new Set());
    const disabled = computeTenantEngineScores(1, "Acme", profile, [], rules, groups, new Set(["hasSecurityGaps"]));

    expect(enabled.combinedScore).toBeGreaterThan(disabled.combinedScore);
    expect(disabled.architectureHealthScore).toBe(0);
    expect(disabled.driftScore).toBe(0);
    expect(disabled.priorityScore).toBe(0);
  });

  it("is deterministic for identical inputs", () => {
    const rules: SignalDerivationRule[] = [
      rule({ id: 1, signalKey: "hasSecurityGaps", ruleType: "profile_key_falsy", sourceKey: "mfaEnforced", priorityScoreContribution: 20, securityImpact: 5 }),
    ];
    const profile = { mfaEnforced: false };

    const first = computeTenantEngineScores(1, "Acme", profile, [], rules, [], new Set());
    const second = computeTenantEngineScores(1, "Acme", profile, [], rules, [], new Set());
    expect(second).toEqual(first);
  });
});
