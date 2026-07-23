/**
 * monitor-check-trace.test.ts
 *
 * Regression tests for the Simulator Studio's engine trace (phase 2).
 *
 * KEY TESTING RULE HONORED HERE, same as the phase-1 suite: the real
 * `applyMapping` and `evaluateRule` are NOT mocked and NOT reimplemented —
 * these tests exercise the genuine functions through `traceCheckResponse`, so a
 * regression in either shows up here rather than being masked by a stub that
 * agrees with a forked copy. Only the DB-backed rule fetch is supplied as data,
 * because that's an input to the trace, not part of its logic.
 *
 * Run with: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi } from "vitest";

// monitor-check-trace imports monitor-executor, which imports @workspace/db —
// and lib/db's index.ts hard-requires DATABASE_URL at module scope. vi.hoisted
// runs before the static imports below are evaluated, so the fake URL is in
// place in time (pg.Pool is lazy — it never connects, and nothing under test
// performs a query). Same pattern as pillar-coverage.test.ts.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
});

import {
  traceCheckResponse,
  inferSuggestion,
  suggestPillarImpacts,
  domainOf,
} from "./monitor-check-trace.ts";
import type { SignalDerivationRule } from "./tenant-signals.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Minimal-but-real rule row: every intelligence field the type demands. */
function makeRule(over: Partial<SignalDerivationRule> & Pick<SignalDerivationRule, "id" | "ruleType" | "sourceKey">): SignalDerivationRule {
  return {
    signalKey: "security:test",
    groupId: null,
    compareValue: null,
    description: null,
    sortOrder: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
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
    trendDirection: "flat",
    decayRate: 0,
    ttlDays: 0,
    confidence: 0,
    severity: "low",
    category: "",
    pillar: "",
    crmFitContribution: 0,
    crmPainContribution: 0,
    crmMaturityContribution: 0,
    crmIntentContribution: 0,
    crmUrgencyContribution: 0,
    ...over,
  } as SignalDerivationRule;
}

/** A real-shaped Graph response: three users, two MFA-registered. */
const MFA_ITEMS = [
  { id: "u1", isMfaRegistered: true, userPrincipalName: "a@x.com" },
  { id: "u2", isMfaRegistered: true, userPrincipalName: "b@x.com" },
  { id: "u3", isMfaRegistered: false, userPrincipalName: "c@x.com" },
];

// ── Fed vs unfed keys ─────────────────────────────────────────────────────────

describe("traceCheckResponse — identifies fed vs unfed keys against a real response", () => {
  it("separates keys a rule reads from keys nothing reads", () => {
    const trace = traceCheckResponse({
      checkKey: "identity:mfa-registration",
      items: MFA_ITEMS,
      // Real mapping shapes, run through the real applyMapping.
      mapping: [
        { sourceField: "isMfaRegistered", targetField: "mfaRegisteredCount", transform: "countTruthy" },
        { sourceField: "isMfaRegistered", targetField: "mfaNotRegisteredCount", transform: "countFalse" },
      ],
      properties: [],
      rules: [
        makeRule({ id: 101, ruleType: "profile_key_lt", sourceKey: "mfaRegisteredCount", compareValue: "5" }),
      ],
    });

    const fed = trace.keys.find(k => k.key === "mfaRegisteredCount");
    const unfed = trace.keys.find(k => k.key === "mfaNotRegisteredCount");

    // Fed: a real rule reads it.
    expect(fed).toBeDefined();
    expect(fed!.uncovered).toBe(false);
    expect(fed!.rules).toHaveLength(1);
    expect(fed!.rules[0]!.ruleId).toBe(101);
    // The real countTruthy transform: 2 of 3 users registered.
    expect(fed!.value).toBe(2);

    // Unfed: produced by the mapping, but no rule references it.
    expect(unfed).toBeDefined();
    expect(unfed!.uncovered).toBe(true);
    expect(unfed!.rules).toHaveLength(0);
    expect(unfed!.value).toBe(1);

    expect(trace.coveredKeyCount).toBe(1);
    // mfaNotRegisteredCount + the synthetic __itemCount key (no threshold rule).
    expect(trace.uncoveredKeyCount).toBe(2);
  });

  it("evaluates each matching rule with the REAL evaluateRule and surfaces its own reason string", () => {
    const trace = traceCheckResponse({
      checkKey: "identity:mfa-registration",
      items: MFA_ITEMS,
      mapping: [{ sourceField: "isMfaRegistered", targetField: "mfaRegisteredCount", transform: "countTruthy" }],
      properties: [],
      rules: [
        // Fires: 2 < 5.
        makeRule({ id: 1, ruleType: "profile_key_lt", sourceKey: "mfaRegisteredCount", compareValue: "5" }),
        // Does not fire: 2 is not > 5.
        makeRule({ id: 2, ruleType: "profile_key_gt", sourceKey: "mfaRegisteredCount", compareValue: "5" }),
      ],
    });

    const key = trace.keys.find(k => k.key === "mfaRegisteredCount")!;
    const lt = key.rules.find(r => r.ruleId === 1)!;
    const gt = key.rules.find(r => r.ruleId === 2)!;

    expect(lt.result).toBe(true);
    expect(gt.result).toBe(false);

    // The reason strings are evaluateRule's own format, not a re-worded copy:
    // `profile[<key>] = <val> < <threshold>`.
    expect(lt.reason).toBe("profile[mfaRegisteredCount] = 2 < 5");
    expect(gt.reason).toBe("profile[mfaRegisteredCount] = 2 <= 5");
  });

  it("traces a threshold rule against the synthetic <checkKey>__itemCount key the real merge produces", () => {
    const trace = traceCheckResponse({
      checkKey: "identity:mfa-registration",
      items: MFA_ITEMS,
      mapping: [],
      properties: [],
      // threshold rules read the CHECK KEY, not a mapped field.
      rules: [makeRule({ id: 7, ruleType: "threshold", sourceKey: "identity:mfa-registration", compareValue: "2" })],
    });

    const itemCountKey = trace.keys.find(k => k.key === "identity:mfa-registration__itemCount")!;
    expect(itemCountKey.origin).toBe("itemCount");
    expect(itemCountKey.value).toBe(3);
    expect(itemCountKey.uncovered).toBe(false);
    expect(itemCountKey.rules[0]!.result).toBe(true); // 3 > 2
    expect(itemCountKey.rules[0]!.reason).toContain("itemCount = 3");
  });

  it("uses the REAL applyMapping transforms rather than a local reimplementation", () => {
    // countEquals carries its comparison value inline in the transform string —
    // a behaviour only the real applyMapping implements.
    const trace = traceCheckResponse({
      checkKey: "devices:compliance",
      items: [
        { complianceState: "compliant" },
        { complianceState: "noncompliant" },
        { complianceState: "noncompliant" },
      ],
      mapping: [
        { sourceField: "complianceState", targetField: "nonCompliantDeviceCount", transform: "countEquals('noncompliant')" },
      ],
      properties: [],
      rules: [],
    });

    expect(trace.keys.find(k => k.key === "nonCompliantDeviceCount")!.value).toBe(2);
  });
});

// ── Suggestion direction discipline ───────────────────────────────────────────

describe("inferSuggestion — infers rule_type from the real observed value type", () => {
  it("a protective BOOLEAN gets profile_key_falsy (the alarm is it being off)", () => {
    const s = inferSuggestion("mfaEnforced", true, "identity:mfa-registration");
    expect(s).not.toBeNull();
    expect(s!.observedType).toBe("boolean");
    expect(s!.ruleType).toBe("profile_key_falsy");
    expect(s!.compareValue).toBeNull();
    expect(s!.rationale).toMatch(/should be ON/i);
  });

  it("a non-protective BOOLEAN gets profile_key_truthy", () => {
    const s = inferSuggestion("legacyAuthDetected", true, "identity:legacy-auth");
    expect(s!.ruleType).toBe("profile_key_truthy");
  });

  it("a PROTECTIVE count gets profile_key_lt — the CA-policy-count direction lesson", () => {
    // A count of something that SHOULD exist: the alarm is a LOW value, so a
    // "> n" rule would be backwards and could never fire on the zero-policy
    // tenant that actually needs attention.
    const s = inferSuggestion("conditionalAccessPolicyCount", 4, "identity:ca-policy-count");
    expect(s!.observedType).toBe("number");
    expect(s!.ruleType).toBe("profile_key_lt");
    expect(s!.compareValue).toBe("4");
    expect(s!.rationale).toMatch(/not gt/i);
  });

  it("a protective count observed at ZERO raises the threshold to 1 so the rule can actually fire", () => {
    // `lt 0` is unsatisfiable for a non-negative count — a dead rule.
    const s = inferSuggestion("conditionalAccessPolicyCount", 0, "identity:ca-policy-count");
    expect(s!.ruleType).toBe("profile_key_lt");
    expect(s!.compareValue).toBe("1");
  });

  it("a RISK count gets profile_key_gt in the opposite direction", () => {
    const s = inferSuggestion("staleGuestAccountCount", 12, "identity:guest-accounts");
    expect(s!.ruleType).toBe("profile_key_gt");
    expect(s!.compareValue).toBe("12");
  });

  it("a risk count observed at zero fires on ANY occurrence", () => {
    const s = inferSuggestion("riskyUserCount", 0, "identity:risky-users");
    expect(s!.ruleType).toBe("profile_key_gt");
    expect(s!.compareValue).toBe("0");
  });

  it("an ambiguous count says so explicitly instead of pretending confidence", () => {
    const s = inferSuggestion("widgetTally", 9, "platform:widgets");
    expect(s!.ruleType).toBe("profile_key_gt");
    expect(s!.rationale).toMatch(/CONFIRM THE DIRECTION/);
  });

  it("returns null for values no rule type can read, rather than inventing a dead rule", () => {
    // groupByCount produces an object; arrays and nulls likewise have no
    // meaningful profile_key_* rule.
    expect(inferSuggestion("byDomain", { contoso: 3 }, "identity:users")).toBeNull();
    expect(inferSuggestion("values", [1, 2], "identity:users")).toBeNull();
    expect(inferSuggestion("thing", null, "identity:users")).toBeNull();
  });
});

// ── Suggestions are offered ONLY for uncovered keys ───────────────────────────

describe("traceCheckResponse — suggestions", () => {
  it("suggests a rule for an uncovered key and stays silent on a covered one", () => {
    const trace = traceCheckResponse({
      checkKey: "identity:mfa-registration",
      items: MFA_ITEMS,
      mapping: [
        { sourceField: "isMfaRegistered", targetField: "mfaRegisteredCount", transform: "countTruthy" },
        { sourceField: "isMfaRegistered", targetField: "mfaNotRegisteredCount", transform: "countFalse" },
      ],
      properties: [],
      rules: [makeRule({ id: 1, ruleType: "profile_key_lt", sourceKey: "mfaRegisteredCount", compareValue: "5" })],
    });

    const keys = trace.suggestions.map(s => s.sourceKey);
    expect(keys).toContain("mfaNotRegisteredCount");
    expect(keys).not.toContain("mfaRegisteredCount");
  });

  it("assigns a dominant pillar from the check key's domain with small, bounded spillover", () => {
    const { dominantPillar, pillarImpacts } = suggestPillarImpacts("identity:mfa-registration");
    expect(dominantPillar).toBe("security");
    expect(pillarImpacts["securityImpact"]).toBe(5);
    // Spillover: small and non-zero on plausibly-related pillars only.
    expect(pillarImpacts["governanceImpact"]).toBe(2);
    expect(pillarImpacts["complianceImpact"]).toBe(2);
    // Everything else stays at exactly zero — a rule that nudges every pillar
    // is indistinguishable from noise.
    expect(pillarImpacts["adoptionImpact"]).toBe(0);
    expect(pillarImpacts["copilotImpact"]).toBe(0);
    expect(pillarImpacts["architectureImpact"]).toBe(0);
  });

  it("never emits licensingImpact — the admin signal-rules API cannot round-trip it", () => {
    // Showing an operator a number the save silently drops would be a lie.
    const { pillarImpacts } = suggestPillarImpacts("licensing:sku-usage");
    expect(pillarImpacts).not.toHaveProperty("licensingImpact");
    // The licensing domain still gets a real, writable dominant pillar.
    expect(Object.values(pillarImpacts).some(v => v === 5)).toBe(true);
  });

  it("derives the domain from the check key prefix (monitor_checks has no category column)", () => {
    expect(domainOf("identity:mfa-registration")).toBe("identity");
    expect(domainOf("sharepoint:anonymous-links")).toBe("sharepoint");
    expect(domainOf("nocolon")).toBe("nocolon");
  });

  it("falls back to a real pillar for an unknown domain instead of throwing", () => {
    const { dominantPillar, pillarImpacts } = suggestPillarImpacts("madeupdomain:thing");
    expect(dominantPillar).toBe("governance");
    expect(pillarImpacts["governanceImpact"]).toBe(5);
  });
});
