/**
 * pillar-matrix.test.ts
 *
 * Regression tests for the Simulator Studio Pillar Matrix (cross-signal
 * per-pillar impact tuning). Covers the three behaviors the spec calls out:
 *   1. The matrix filters to ONLY the selected pillar's non-zero rules, sorted
 *      highest-impact first.
 *   2. The fed / structurally-inert indicator matches the REAL producible-key
 *      logic (pillar-coverage's buildProducibleProfileKeys + ruleIsFedByPackage),
 *      not a hand-rolled reimplementation.
 *   3. The inline edit persists through the shared intelligence-field parser —
 *      including licensingImpact, the pillar the admin round-trip historically
 *      dropped — without zeroing unrelated fields (partial-update base merge).
 *
 * DB-free: buildPillarMatrix and parseIntelligenceFields are pure; the only
 * reason for the DATABASE_URL guard is that importing the modules transitively
 * evaluates lib/db's index (pg.Pool is lazy — never connects).
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
});

import { buildPillarMatrix } from "./pillar-matrix.ts";
import { buildProducibleProfileKeys, ruleIsFedByPackage, resolveOwningCheckKey } from "./pillar-coverage.ts";
import type { SignalDerivationRule, SignalRuleGroup } from "./tenant-signals.ts";
import { parseIntelligenceFields } from "../routes/admin-signal-rules.ts";

// ── Minimal fixture factories ────────────────────────────────────────────────
// buildPillarMatrix only reads id/signalKey/ruleType/sourceKey/groupId/description
// plus the pillar field; getSignalHealthImpacts reads the seven *Impact fields
// with `?? 0`, so unset impacts default to 0 — keep fixtures to what each test needs.

let nextId = 1;
function rule(partial: Partial<SignalDerivationRule>): SignalDerivationRule {
  return {
    id: partial.id ?? nextId++,
    signalKey: partial.signalKey ?? "sig",
    ruleType: partial.ruleType ?? "profile_key_gt",
    sourceKey: partial.sourceKey ?? "someKey",
    groupId: partial.groupId ?? null,
    description: partial.description ?? null,
    ...partial,
  } as unknown as SignalDerivationRule;
}

function group(partial: Partial<SignalRuleGroup>): SignalRuleGroup {
  return { id: partial.id ?? nextId++, signalKey: partial.signalKey ?? "sig", ...partial } as unknown as SignalRuleGroup;
}

const FIELD = "governanceImpact";

describe("buildPillarMatrix — filtering & sort", () => {
  it("returns only rows with a non-zero value for the selected pillar, highest first", () => {
    const rules = [
      rule({ signalKey: "sigA", sourceKey: "kA", governanceImpact: 5 } as Partial<SignalDerivationRule>),
      rule({ signalKey: "sigB", sourceKey: "kB", governanceImpact: 40 } as Partial<SignalDerivationRule>),
      // Non-zero for a DIFFERENT pillar only — must be excluded from governance.
      rule({ signalKey: "sigC", sourceKey: "kC", governanceImpact: 0, securityImpact: 99 } as Partial<SignalDerivationRule>),
      rule({ signalKey: "sigD", sourceKey: "kD", governanceImpact: 12 } as Partial<SignalDerivationRule>),
    ];
    const fed = new Map(rules.map((r) => [r.id, true]));
    const evaluable = new Set(["sigA", "sigB", "sigD"]);

    const { rows } = buildPillarMatrix(rules, [], FIELD, fed, evaluable);

    expect(rows.map((r) => r.signalKey)).toEqual(["sigB", "sigD", "sigA"]); // 40, 12, 5
    expect(rows.every((r) => r.ruleImpact > 0)).toBe(true);
    expect(rows.find((r) => r.signalKey === "sigC")).toBeUndefined();
  });
});

describe("buildPillarMatrix — theoreticalMax & dual-source MAX", () => {
  it("excludes non-evaluable signals from theoreticalMax (the exploit fix)", () => {
    const rules = [
      rule({ signalKey: "sigA", governanceImpact: 10 } as Partial<SignalDerivationRule>),
      rule({ signalKey: "sigB", governanceImpact: 20 } as Partial<SignalDerivationRule>), // not evaluable
      rule({ signalKey: "sigC", governanceImpact: 5 } as Partial<SignalDerivationRule>),
    ];
    const fed = new Map(rules.map((r) => [r.id, r.signalKey !== "sigB"]));
    const evaluable = new Set(["sigA", "sigC"]);

    const { theoreticalMax, contributingSignalCount } = buildPillarMatrix(rules, [], FIELD, fed, evaluable);

    expect(theoreticalMax).toBe(15); // sigB's 20 must NOT inflate the denominator
    expect(contributingSignalCount).toBe(2);
  });

  it("uses the MAX across a signal's rules AND its group; flags when the rule isn't the winning source", () => {
    const rules = [rule({ id: 100, signalKey: "sigA", governanceImpact: 10 } as Partial<SignalDerivationRule>)];
    const groups = [group({ signalKey: "sigA", governanceImpact: 30 } as Partial<SignalRuleGroup>)];
    const fed = new Map([[100, true]]);
    const evaluable = new Set(["sigA"]);

    const { theoreticalMax, rows } = buildPillarMatrix(rules, groups, FIELD, fed, evaluable);

    expect(theoreticalMax).toBe(30); // group's 30 wins the MAX, not the rule's 10
    expect(rows[0].effectiveSignalImpact).toBe(30);
    expect(rows[0].groupImpact).toBe(30);
    expect(rows[0].isWinningSource).toBe(false); // the rule's own 10 is inert for scoring
  });
});

describe("buildPillarMatrix — fed indicator matches the real producible-key logic", () => {
  it("marks fed exactly as ruleIsFedByPackage over buildProducibleProfileKeys does", () => {
    // A real ruleType-aware fixture: a threshold rule keys off a check key; a
    // profile_key rule keys off a mapping targetField / bridged legacy key.
    const checkDefs = [
      { key: "identity:ca-policy-count", mapping: [{ sourceField: "x", targetField: "conditionalAccessPolicyCount" }], properties: null, requiresCustomerScript: false },
    ];
    const allCheckKeys = new Set(checkDefs.map((c) => c.key));
    const producible = buildProducibleProfileKeys(allCheckKeys, checkDefs);

    const rules = [
      // threshold, sourceKey IS a covered check key → fed
      rule({ signalKey: "sigThresholdFed", ruleType: "threshold", sourceKey: "identity:ca-policy-count", governanceImpact: 8 } as Partial<SignalDerivationRule>),
      // threshold, sourceKey is NOT a covered check → inert
      rule({ signalKey: "sigThresholdInert", ruleType: "threshold", sourceKey: "identity:nonexistent", governanceImpact: 7 } as Partial<SignalDerivationRule>),
      // profile_key, sourceKey is a bridged/mapped producible key → fed
      rule({ signalKey: "sigProfileFed", ruleType: "profile_key_gt", sourceKey: "conditionalAccessPolicyCount", governanceImpact: 6 } as Partial<SignalDerivationRule>),
      // profile_key, sourceKey no check produces → inert
      rule({ signalKey: "sigProfileInert", ruleType: "profile_key_gt", sourceKey: "keyNoCheckProduces", governanceImpact: 5 } as Partial<SignalDerivationRule>),
    ];

    // Derive fed/evaluable the SAME way the route's computeRuleFedStatus does —
    // per-rule ruleIsFedByPackage over the real producible key set.
    const fed = new Map<number, boolean>();
    const evaluable = new Set<string>();
    for (const r of rules) {
      const isFed = ruleIsFedByPackage(r, allCheckKeys, producible);
      fed.set(r.id, isFed);
      if (isFed) evaluable.add(r.signalKey);
    }

    const { rows } = buildPillarMatrix(rules, [], FIELD, fed, evaluable);
    const bySignal = Object.fromEntries(rows.map((r) => [r.signalKey, r.fed]));

    expect(bySignal["sigThresholdFed"]).toBe(true);
    expect(bySignal["sigThresholdInert"]).toBe(false);
    expect(bySignal["sigProfileFed"]).toBe(true);
    expect(bySignal["sigProfileInert"]).toBe(false);

    // And the inert rows correctly report the signal as non-evaluable.
    expect(rows.find((r) => r.signalKey === "sigThresholdInert")!.signalEvaluable).toBe(false);
    expect(rows.find((r) => r.signalKey === "sigProfileFed")!.signalEvaluable).toBe(true);
  });
});

describe("buildPillarMatrix — checkKey threading for the rule-trace modal", () => {
  it("resolves each row's owning check via the real resolveOwningCheckKey logic, so a click opens the correct check", () => {
    const checkDefs = [
      { key: "identity:ca-policy-count", mapping: [{ sourceField: "x", targetField: "conditionalAccessPolicyCount" }], properties: null, requiresCustomerScript: false },
      { key: "identity:mfa-registration", mapping: [], properties: null, requiresCustomerScript: false },
    ];

    const rules = [
      rule({ signalKey: "sigThreshold", ruleType: "threshold", sourceKey: "identity:mfa-registration", governanceImpact: 8 } as Partial<SignalDerivationRule>),
      rule({ signalKey: "sigProfile", ruleType: "profile_key_gt", sourceKey: "conditionalAccessPolicyCount", governanceImpact: 6 } as Partial<SignalDerivationRule>),
      rule({ signalKey: "sigInert", ruleType: "profile_key_gt", sourceKey: "keyNoCheckProduces", governanceImpact: 5 } as Partial<SignalDerivationRule>),
    ];

    const checkKeyByRuleId = new Map<number, string | null>();
    for (const r of rules) checkKeyByRuleId.set(r.id, resolveOwningCheckKey(r, checkDefs));

    const fed = new Map<number, boolean>(rules.map((r) => [r.id, checkKeyByRuleId.get(r.id) != null]));
    const evaluable = new Set<string>(rules.filter((r) => checkKeyByRuleId.get(r.id) != null).map((r) => r.signalKey));

    const { rows } = buildPillarMatrix(rules, [], FIELD, fed, evaluable, checkKeyByRuleId);
    const bySignal = Object.fromEntries(rows.map((r) => [r.signalKey, r.checkKey]));

    expect(bySignal["sigThreshold"]).toBe("identity:mfa-registration");
    expect(bySignal["sigProfile"]).toBe("identity:ca-policy-count");
    expect(bySignal["sigInert"]).toBeNull();
  });

  it("defaults checkKey to null when no map is passed, so the button never renders for old callers", () => {
    const rules = [rule({ signalKey: "sig", ruleType: "threshold", sourceKey: "x", governanceImpact: 4 } as Partial<SignalDerivationRule>)];
    const { rows } = buildPillarMatrix(rules, [], FIELD, new Map([[rules[0].id, true]]), new Set(["sig"]));
    expect(rows[0].checkKey).toBeNull();
  });
});

describe("parseIntelligenceFields — inline edit persistence (incl. licensing round-trip)", () => {
  it("parses a licensingImpact edit and preserves unrelated fields from the base row", () => {
    // Simulates the matrix editing the licensing pillar of an existing rule: the
    // PATCH body carries only the one field; the base is the prior DB row.
    const base = {
      priority: 0, weight: 0, pricingImpact: 0, priorityScoreContribution: 0, pricingValueContribution: 0,
      governanceImpact: 3, securityImpact: 0, complianceImpact: 0, adoptionImpact: 0, copilotImpact: 0,
      architectureImpact: 0, licensingImpact: 7, trendValue: 0, trendDirection: "flat", decayRate: 0, ttlDays: 0,
      confidence: 0, severity: "low", category: "", pillar: "", crmFitContribution: 0, crmPainContribution: 0,
      crmMaturityContribution: 0, crmIntentContribution: 0, crmUrgencyContribution: 0,
    } as Record<string, number | string>;

    const { values, error } = parseIntelligenceFields({ licensingImpact: 42 }, base);

    expect(error).toBeUndefined();
    expect(values.licensingImpact).toBe(42); // the edited pillar persists
    expect(values.governanceImpact).toBe(3); // unrelated pillar preserved from base
  });

  it("defaults licensingImpact to 0 for a create (no base, no body value)", () => {
    const { values } = parseIntelligenceFields({});
    expect(values.licensingImpact).toBe(0);
  });

  it("preserves a base licensingImpact when a DIFFERENT pillar is edited", () => {
    const base = {
      ...(parseIntelligenceFields({}).values as Record<string, number | string>),
      licensingImpact: 15,
    };
    const { values } = parseIntelligenceFields({ governanceImpact: 9 }, base);
    expect(values.governanceImpact).toBe(9);
    expect(values.licensingImpact).toBe(15); // not zeroed by the unrelated edit
  });
});
