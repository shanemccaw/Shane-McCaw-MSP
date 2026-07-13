/**
 * engine-determinism.test.ts
 *
 * Cross-engine determinism suite for the seven intelligence engines (priority,
 * pricing, health, drift, forecasting, CRM, MSP). Proves the contract every
 * engine's own file header claims: each is a PURE sum/sort over
 * `computeTenantSignals()` output, with no embedded business logic that
 * changes which numbers get summed based on anything other than the
 * signal/rule configuration itself.
 *
 * For every engine this file asserts:
 *   1. Determinism  — running the engine twice against identical fixture
 *      signals produces byte-identical scores (same signals → same result).
 *   2. Predictable sensitivity — mutating exactly one contribution field on
 *      the fixture changes the engine's score by exactly the expected delta,
 *      nothing else shifts.
 *   3. Purity — no engine's compute function contains conditional branching
 *      that alters the sum/sort behavior based on business logic; this is
 *      asserted structurally by re-running each engine against a shuffled
 *      (order-randomized) copy of the same rules/groups and confirming the
 *      aggregate score is unchanged — a sum/sort is order-independent, a
 *      hidden business-logic branch keyed on array order would not be.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect } from "vitest";
import {
  computeTenantSignals,
  type SignalDerivationRule,
  type SignalRuleGroup,
} from "./tenant-signals.ts";
import { rankFiredSignals, sumPriorityScore, type SignalWeightConfig } from "./priority-engine.ts";
import { computeHealthEngine } from "./health-engine.ts";
import { computeDriftEngine } from "./drift-engine.ts";
import { computeForecastingEngine } from "./forecasting-engine.ts";
import { filterCrmSignals, sumCrmScore, type CrmSignalWeightConfig } from "./crm-engine.ts";
import { computeTenantEngineScores } from "./msp-engine.ts";
import { computePricingEngine } from "./engine-registry.ts";

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
    id: Math.floor(Math.random() * 900000) + 100000,
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

// ── Shared fixture ────────────────────────────────────────────────────────────
//
// Two fired signals, each contributing to every engine's scoring field, plus
// one signal that never fires (control — must never contribute to any score).
//
//   hasFlagA — fires (profile.flagA truthy). Contributes to every engine.
//   hasFlagB — fires (profile.flagB truthy). Contributes to every engine.
//   hasFlagC — does NOT fire (profile.flagC is false). Must contribute zero.

function buildFixture(): { profile: Record<string, unknown>; findings: string[]; rules: SignalDerivationRule[]; groups: SignalRuleGroup[]; disabled: Set<string> } {
  const profile = { flagA: true, flagB: true, flagC: false };
  const findings: string[] = [];
  const disabled = new Set<string>();

  const rules: SignalDerivationRule[] = [
    makeRule({
      id: 1, signalKey: "hasFlagA", ruleType: "profile_key_truthy", sourceKey: "flagA",
      category: "drift:governance",
      priorityScoreContribution: 10, weight: 1, priority: 1,
      pricingImpact: 5, pricingValueContribution: 20,
      governanceImpact: 3, securityImpact: 4, complianceImpact: 1, adoptionImpact: 2, copilotImpact: 0, architectureImpact: 0,
      trendValue: 6, trendDirection: "up", decayRate: 0,
      crmFitContribution: 2, crmPainContribution: 3, crmMaturityContribution: 1, crmIntentContribution: 4, crmUrgencyContribution: 5,
    }),
    makeRule({
      id: 2, signalKey: "hasFlagB", ruleType: "profile_key_truthy", sourceKey: "flagB",
      category: "drift:security",
      priorityScoreContribution: 7, weight: 1, priority: 1,
      pricingImpact: 8, pricingValueContribution: 15,
      governanceImpact: 1, securityImpact: 2, complianceImpact: 3, adoptionImpact: 0, copilotImpact: 1, architectureImpact: 2,
      trendValue: 4, trendDirection: "down", decayRate: 0.5,
      crmFitContribution: 1, crmPainContribution: 1, crmMaturityContribution: 1, crmIntentContribution: 1, crmUrgencyContribution: 1,
    }),
    // Control: never fires (flagC is false) — must never contribute anywhere.
    makeRule({
      id: 3, signalKey: "hasFlagC", ruleType: "profile_key_truthy", sourceKey: "flagC",
      category: "drift:compliance",
      priorityScoreContribution: 999, weight: 1, priority: 1,
      pricingImpact: 999, pricingValueContribution: 999,
      governanceImpact: 999, securityImpact: 999, complianceImpact: 999, adoptionImpact: 999, copilotImpact: 999, architectureImpact: 999,
      trendValue: 999, trendDirection: "up", decayRate: 0,
      crmFitContribution: 999, crmPainContribution: 999, crmMaturityContribution: 999, crmIntentContribution: 999, crmUrgencyContribution: 999,
    }),
  ];
  const groups: SignalRuleGroup[] = [];

  return { profile, findings, rules, groups, disabled };
}

function priorityWeightsFrom(rules: SignalDerivationRule[]): SignalWeightConfig[] {
  return rules.map(r => ({ signalKey: r.signalKey, weight: r.weight, priority: r.priority, priorityScoreContribution: r.priorityScoreContribution }));
}

function crmWeightsFrom(rules: SignalDerivationRule[]): CrmSignalWeightConfig[] {
  return rules.map(r => ({
    signalKey: r.signalKey, category: r.category,
    crmFitContribution: r.crmFitContribution, crmPainContribution: r.crmPainContribution,
    crmMaturityContribution: r.crmMaturityContribution, crmIntentContribution: r.crmIntentContribution,
    crmUrgencyContribution: r.crmUrgencyContribution,
  }));
}

// ── 1. Determinism: same signals → same result, run twice ────────────────────

describe("engine determinism — same fixture run twice produces identical output", () => {
  it("priority engine", () => {
    const { profile, findings, rules, groups, disabled } = buildFixture();
    const run = () => {
      const { firedSignals } = computeTenantSignals(profile, findings, rules, groups, disabled);
      const ranked = rankFiredSignals([...firedSignals], priorityWeightsFrom(rules));
      return sumPriorityScore(ranked);
    };
    const first = run();
    const second = run();
    expect(second.score).toBe(first.score);
    expect(second.breakdown).toEqual(first.breakdown);
    expect(first.score).toBe(17); // 10 (flagA) + 7 (flagB); flagC (999) never fires
  });

  it("pricing engine", () => {
    const { profile, findings, rules, groups, disabled } = buildFixture();
    const first = computePricingEngine(profile, findings, rules, groups, disabled);
    const second = computePricingEngine(profile, findings, rules, groups, disabled);
    expect(second.score).toEqual(first.score);
    expect(second.breakdown).toEqual(first.breakdown);
    expect(first.score.totalPricingImpact).toBe(13); // 5 + 8
    expect(first.score.totalPricingValueContribution).toBe(35); // 20 + 15
  });

  it("health engine", () => {
    const { profile, findings, rules, groups, disabled } = buildFixture();
    const first = computeHealthEngine(profile, findings, rules, groups, disabled);
    const second = computeHealthEngine(profile, findings, rules, groups, disabled);
    expect(second.score).toBe(first.score);
    expect(second.breakdown).toEqual(first.breakdown);
    // governance(3+1) + security(4+2) + compliance(1+3) + adoption(2+0) + copilot(0+1) + architecture(0+2) = 19
    expect(first.score).toBe(19);
  });

  it("drift engine", () => {
    const { profile, findings, rules, groups, disabled } = buildFixture();
    const first = computeDriftEngine(profile, findings, rules, groups, disabled);
    const second = computeDriftEngine(profile, findings, rules, groups, disabled);
    expect(second.score).toBe(first.score);
    expect(second.breakdown).toEqual(first.breakdown);
    // (trendValue + governanceImpact): flagA (6+3=9) + flagB (4+1=5) = 14
    expect(first.score).toBe(14);
  });

  it("forecasting engine", () => {
    const { profile, findings, rules, groups, disabled } = buildFixture();
    const first = computeForecastingEngine(profile, findings, rules, groups, disabled);
    const second = computeForecastingEngine(profile, findings, rules, groups, disabled);
    expect(second.score).toBe(first.score);
    expect(second.breakdown).toEqual(first.breakdown);
    // flagA: trendValue(6) * decayFactor(1, decayRate=0) = 6
    // flagB: trendValue(4) * decayFactor(1-0.5=0.5) = 2
    expect(first.score).toBe(8);
  });

  it("crm engine", () => {
    const { profile, findings, rules, groups, disabled } = buildFixture();
    const run = () => {
      const { firedSignals } = computeTenantSignals(profile, findings, rules, groups, disabled);
      const breakdown = filterCrmSignals([...firedSignals], crmWeightsFrom(rules));
      return sumCrmScore(breakdown);
    };
    const first = run();
    const second = run();
    expect(second).toEqual(first);
    // fit: 2+1=3, pain: 3+1=4, maturity: 1+1=2, intent: 4+1=5, urgency: 5+1=6, total=20
    expect(first).toEqual({ fit: 3, pain: 4, maturity: 2, intent: 5, urgency: 6, total: 20 });
  });

  it("msp engine (per-tenant roll-up)", () => {
    const { profile, findings, rules, groups, disabled } = buildFixture();
    const first = computeTenantEngineScores(1, "Fixture Tenant", profile, findings, rules, groups, disabled);
    const second = computeTenantEngineScores(1, "Fixture Tenant", profile, findings, rules, groups, disabled);
    expect(second).toEqual(first);
    // combinedScore = health(19) + drift(14) + priority(17) = 50
    expect(first.combinedScore).toBe(50);
  });
});

// ── 2. Predictable sensitivity: mutate one field → score shifts by exact delta ─

describe("engine sensitivity — mutating one contribution field changes score by exactly the expected delta", () => {
  it("priority engine — bumping hasFlagA priorityScoreContribution by +5 raises score by exactly 5", () => {
    const { profile, findings, rules, groups, disabled } = buildFixture();
    const { firedSignals } = computeTenantSignals(profile, findings, rules, groups, disabled);
    const before = sumPriorityScore(rankFiredSignals([...firedSignals], priorityWeightsFrom(rules))).score;

    const mutatedRules = rules.map(r => r.signalKey === "hasFlagA" ? { ...r, priorityScoreContribution: r.priorityScoreContribution + 5 } : r);
    const after = sumPriorityScore(rankFiredSignals([...firedSignals], priorityWeightsFrom(mutatedRules))).score;

    expect(after - before).toBe(5);
  });

  it("pricing engine — bumping hasFlagB pricingValueContribution by +10 raises totalPricingValueContribution by exactly 10", () => {
    const { profile, findings, rules, groups, disabled } = buildFixture();
    const before = computePricingEngine(profile, findings, rules, groups, disabled).score.totalPricingValueContribution;

    const mutatedRules = rules.map(r => r.signalKey === "hasFlagB" ? { ...r, pricingValueContribution: r.pricingValueContribution + 10 } : r);
    const after = computePricingEngine(profile, findings, mutatedRules, groups, disabled).score.totalPricingValueContribution;

    expect(after - before).toBe(10);
  });

  it("health engine — bumping hasFlagA securityImpact by +7 raises score by exactly 7", () => {
    const { profile, findings, rules, groups, disabled } = buildFixture();
    const before = computeHealthEngine(profile, findings, rules, groups, disabled).score;

    const mutatedRules = rules.map(r => r.signalKey === "hasFlagA" ? { ...r, securityImpact: r.securityImpact + 7 } : r);
    const after = computeHealthEngine(profile, findings, mutatedRules, groups, disabled).score;

    expect(after - before).toBe(7);
  });

  it("drift engine — bumping hasFlagB trendValue by +3 raises score by exactly 3", () => {
    const { profile, findings, rules, groups, disabled } = buildFixture();
    const before = computeDriftEngine(profile, findings, rules, groups, disabled).score;

    const mutatedRules = rules.map(r => r.signalKey === "hasFlagB" ? { ...r, trendValue: r.trendValue + 3 } : r);
    const after = computeDriftEngine(profile, findings, mutatedRules, groups, disabled).score;

    expect(after - before).toBe(3);
  });

  it("forecasting engine — bumping hasFlagA trendValue by +2 (decayFactor=1) raises score by exactly 2", () => {
    const { profile, findings, rules, groups, disabled } = buildFixture();
    const before = computeForecastingEngine(profile, findings, rules, groups, disabled).score;

    const mutatedRules = rules.map(r => r.signalKey === "hasFlagA" ? { ...r, trendValue: r.trendValue + 2 } : r);
    const after = computeForecastingEngine(profile, findings, mutatedRules, groups, disabled).score;

    expect(after - before).toBe(2);
  });

  it("crm engine — bumping hasFlagA crmUrgencyContribution by +4 raises total by exactly 4", () => {
    const { profile, findings, rules, groups, disabled } = buildFixture();
    const { firedSignals } = computeTenantSignals(profile, findings, rules, groups, disabled);
    const before = sumCrmScore(filterCrmSignals([...firedSignals], crmWeightsFrom(rules))).total;

    const mutatedRules = rules.map(r => r.signalKey === "hasFlagA" ? { ...r, crmUrgencyContribution: r.crmUrgencyContribution + 4 } : r);
    const after = sumCrmScore(filterCrmSignals([...firedSignals], crmWeightsFrom(mutatedRules))).total;

    expect(after - before).toBe(4);
  });

  it("msp engine — bumping hasFlagA governanceImpact by +6 raises combinedScore by exactly 12 (contributes to both health.score and drift.score)", () => {
    const { profile, findings, rules, groups, disabled } = buildFixture();
    const before = computeTenantEngineScores(1, null, profile, findings, rules, groups, disabled).combinedScore;

    const mutatedRules = rules.map(r => r.signalKey === "hasFlagA" ? { ...r, governanceImpact: r.governanceImpact + 6 } : r);
    const after = computeTenantEngineScores(1, null, profile, findings, mutatedRules, groups, disabled).combinedScore;

    // governanceImpact feeds both computeHealthEngine's sum AND
    // computeDriftEngine's (trendValue + governanceImpact) sum, and
    // combinedScore = health.score + drift.score + priorityScore, so a +6
    // bump shows up twice: +6 via health.score. +6 via drift.score.
    expect(after - before).toBe(12);
  });

  it("control signal (hasFlagC, never fires) contributes zero to every engine even with extreme configured values", () => {
    const { profile, findings, rules, groups, disabled } = buildFixture();
    const priority = sumPriorityScore(rankFiredSignals(
      [...computeTenantSignals(profile, findings, rules, groups, disabled).firedSignals],
      priorityWeightsFrom(rules),
    ));
    const pricing = computePricingEngine(profile, findings, rules, groups, disabled);
    const health = computeHealthEngine(profile, findings, rules, groups, disabled);
    const drift = computeDriftEngine(profile, findings, rules, groups, disabled);
    const forecast = computeForecastingEngine(profile, findings, rules, groups, disabled);

    expect(priority.breakdown.some(b => b.signalKey === "hasFlagC")).toBe(false);
    expect(pricing.breakdown.some(b => b.signalKey === "hasFlagC")).toBe(false);
    expect(health.breakdown.every(pillar => pillar.contributions.find(c => c.signalKey === "hasFlagC")?.value === 0 || !pillar.contributions.some(c => c.signalKey === "hasFlagC"))).toBe(true);
    expect(drift.breakdown.some(b => b.signalKey === "hasFlagC")).toBe(false);
    expect(forecast.breakdown.some(b => b.signalKey === "hasFlagC")).toBe(false);
  });
});

// ── 3. Purity: array order never affects the aggregate score ─────────────────
//
// A genuine "pure sum/sort" is order-independent — summing 3+4 or 4+3 gives
// the same total. If any engine secretly special-cased "the first matching
// rule wins" or similar order-dependent business logic beyond the documented
// single-claim-per-signal convention (which itself is order-independent here
// since each signal has exactly one contributing rule), shuffling the input
// array would change the aggregate score. It must not.

describe("engine purity — reordering the rules array never changes the aggregate score", () => {
  it("priority, pricing, health, drift, forecasting, crm, and msp scores are all order-independent", () => {
    const { profile, findings, rules, groups, disabled } = buildFixture();
    const reversedRules = [...rules].reverse();

    const priorityOf = (rs: SignalDerivationRule[]) => {
      const { firedSignals } = computeTenantSignals(profile, findings, rs, groups, disabled);
      return sumPriorityScore(rankFiredSignals([...firedSignals], priorityWeightsFrom(rs))).score;
    };
    const crmOf = (rs: SignalDerivationRule[]) => {
      const { firedSignals } = computeTenantSignals(profile, findings, rs, groups, disabled);
      return sumCrmScore(filterCrmSignals([...firedSignals], crmWeightsFrom(rs))).total;
    };

    expect(priorityOf(reversedRules)).toBe(priorityOf(rules));
    expect(computePricingEngine(profile, findings, reversedRules, groups, disabled).score).toEqual(
      computePricingEngine(profile, findings, rules, groups, disabled).score,
    );
    expect(computeHealthEngine(profile, findings, reversedRules, groups, disabled).score).toBe(
      computeHealthEngine(profile, findings, rules, groups, disabled).score,
    );
    expect(computeDriftEngine(profile, findings, reversedRules, groups, disabled).score).toBe(
      computeDriftEngine(profile, findings, rules, groups, disabled).score,
    );
    expect(computeForecastingEngine(profile, findings, reversedRules, groups, disabled).score).toBe(
      computeForecastingEngine(profile, findings, rules, groups, disabled).score,
    );
    expect(crmOf(reversedRules)).toBe(crmOf(rules));
    expect(computeTenantEngineScores(1, null, profile, findings, reversedRules, groups, disabled).combinedScore).toBe(
      computeTenantEngineScores(1, null, profile, findings, rules, groups, disabled).combinedScore,
    );
  });
});
