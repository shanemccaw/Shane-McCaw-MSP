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
    // they always state the real fire condition (never its complement), plus
    // the actual observed value, so a passing-looking relation next to a
    // FALSE result badge can never be misread as "should have fired".
    expect(lt.reason).toBe("requires profile[mfaRegisteredCount] < 5 to fire; actual value = 2");
    expect(gt.reason).toBe("requires profile[mfaRegisteredCount] > 5 to fire; actual value = 2");
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

  it("traces a profile_key_eq rule stored against the FULL <checkKey>__itemCount sourceKey (the real signal.governance.access-review-completion case)", () => {
    // profile_key_eq does not auto-append __itemCount like threshold does —
    // evaluateRule reads mergedProfile[sourceKey] literally — so a rule
    // targeting the itemCount value must store the full suffixed sourceKey to
    // evaluate correctly. The trace must find it there too, not just under
    // the bare checkKey convention threshold rules use.
    const trace = traceCheckResponse({
      checkKey: "governance:access-review-completion",
      items: MFA_ITEMS.slice(0, 2),
      mapping: [],
      properties: [],
      rules: [
        makeRule({
          id: 42,
          ruleType: "profile_key_eq",
          sourceKey: "governance:access-review-completion__itemCount",
          compareValue: "2",
        }),
      ],
    });

    const itemCountKey = trace.keys.find(k => k.key === "governance:access-review-completion__itemCount")!;
    expect(itemCountKey.uncovered).toBe(false);
    expect(itemCountKey.rules).toHaveLength(1);
    expect(itemCountKey.rules[0]!.ruleId).toBe(42);
    expect(itemCountKey.rules[0]!.result).toBe(true); // 2 == 2
  });

  it("still finds a threshold rule under the bare checkKey alongside a profile_key_* rule under the suffixed key", () => {
    const trace = traceCheckResponse({
      checkKey: "identity:mfa-registration",
      items: MFA_ITEMS,
      mapping: [],
      properties: [],
      rules: [
        makeRule({ id: 7, ruleType: "threshold", sourceKey: "identity:mfa-registration", compareValue: "2" }),
        makeRule({ id: 8, ruleType: "profile_key_gt", sourceKey: "identity:mfa-registration__itemCount", compareValue: "10" }),
      ],
    });

    const itemCountKey = trace.keys.find(k => k.key === "identity:mfa-registration__itemCount")!;
    const ruleIds = itemCountKey.rules.map(r => r.ruleId).sort();
    expect(ruleIds).toEqual([7, 8]);
    expect(itemCountKey.rules.find(r => r.ruleId === 7)!.result).toBe(true); // 3 > 2
    expect(itemCountKey.rules.find(r => r.ruleId === 8)!.result).toBe(false); // 3 > 10 is false
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

  it("attaches a per-key suggestion to a COVERED key too, so the trace UI can offer 'Add rule' on it", () => {
    // The top-level suggestions list stays uncovered-only (the cards), but each
    // readable key — covered or not — now carries its own inferred suggestion so
    // the per-property "Add rule" button has a pre-filled draft to accept without
    // a second inference path. This is what makes multi-rule OR-groups on an
    // already-covered property one click instead of a from-scratch form.
    const trace = traceCheckResponse({
      checkKey: "identity:mfa-registration",
      items: MFA_ITEMS,
      mapping: [{ sourceField: "isMfaRegistered", targetField: "mfaRegisteredCount", transform: "countTruthy" }],
      properties: [],
      rules: [makeRule({ id: 1, ruleType: "profile_key_lt", sourceKey: "mfaRegisteredCount", compareValue: "5" })],
    });

    const covered = trace.keys.find(k => k.key === "mfaRegisteredCount")!;
    expect(covered.uncovered).toBe(false);
    // Covered, yet it carries a suggestion for the operator's next OR-condition.
    expect(covered.suggestion).not.toBeNull();
    expect(covered.suggestion!.sourceKey).toBe("mfaRegisteredCount");
    // …but it is NOT duplicated into the uncovered-only cards list.
    expect(trace.suggestions.map(s => s.sourceKey)).not.toContain("mfaRegisteredCount");
  });

  it("leaves the synthetic item-count key without a suggestion (direction can't be name-guessed)", () => {
    const trace = traceCheckResponse({
      checkKey: "identity:mfa-registration",
      items: MFA_ITEMS,
      mapping: [],
      properties: [],
      rules: [],
    });
    const itemCount = trace.keys.find(k => k.key === "identity:mfa-registration__itemCount")!;
    expect(itemCount.suggestion).toBeNull();
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

// ── #402: raw / countWhere through the Simulator Studio's OWN trace path ──────
//
// traceCheckResponse is the function behind the Studio's engine trace, and it
// runs the real applyMapping. Asserting here — rather than only against
// applyMapping directly — is what makes this the same derivation an operator
// reads on screen: response -> mapping -> profile keys -> rules.
//
// This is NOT a substitute for the live run against a real tenant (no database
// or Graph credentials exist in a Claude Code session). It is the same code
// path over the real captured response shape.

/** GET /v1.0/subscribedSkus, the endpoint behind license:sku-utilization. */
const SUBSCRIBED_SKUS_RESPONSE = [
  { skuPartNumber: "ENTERPRISEPREMIUM", skuId: "c7df2760-2c81-4ef7-b578-5b5392b571df", consumedUnits: 14, capabilityStatus: "Enabled", prepaidUnits: { enabled: 25, suspended: 0, warning: 0 } },
  { skuPartNumber: "SPE_E3", skuId: "05e9a617-0261-4cee-bb44-138d3ef5d965", consumedUnits: 9, capabilityStatus: "Enabled", prepaidUnits: { enabled: 10, suspended: 0, warning: 0 } },
  { skuPartNumber: "Microsoft_365_Copilot", skuId: "639dec6b-bb19-468b-871c-c5c441c4b0cb", consumedUnits: 0, capabilityStatus: "Enabled", prepaidUnits: { enabled: 5, suspended: 0, warning: 0 } },
  { skuPartNumber: "VISIOCLIENT", skuId: "c5928f49-12ba-48f7-ada3-0d743a3601d5", consumedUnits: 2, capabilityStatus: "Suspended", prepaidUnits: { enabled: 2, suspended: 3, warning: 0 } },
];

describe("traceCheckResponse — raw / countWhere (#402)", () => {
  it("license:sku-utilization: skuData now carries the real SKU list the run fetched", () => {
    const trace = traceCheckResponse({
      checkKey: "license:sku-utilization",
      items: SUBSCRIBED_SKUS_RESPONSE,
      mapping: [{ sourceField: "value", targetField: "skuData", transform: "raw" }],
      properties: ["skuPartNumber"],
      rules: [],
    });

    const skuData = trace.keys.find(k => k.key === "skuData")!;
    expect(skuData.origin).toBe("mapping");
    expect(skuData.transform).toBe("raw");
    expect(skuData.value).toEqual(SUBSCRIBED_SKUS_RESPONSE);

    // The contradiction #402 reports, now resolved: the mapped target and the
    // automatic property extraction beside it agree on the same four SKUs.
    const partNumbers = trace.keys.find(k => k.key === "skuPartNumber_values")!;
    expect((partNumbers.value as string[])).toHaveLength(4);
    expect((skuData.value as Array<{ skuPartNumber: string }>).map(s => s.skuPartNumber))
      .toEqual(partNumbers.value);
  });

  it("shows what the same check produced while the transform was missing", () => {
    // Same response, same mapping shape, an unimplemented transform name: the
    // target is present and empty next to four real SKUs. That is exactly the
    // screen #402 was filed from.
    const trace = traceCheckResponse({
      checkKey: "license:sku-utilization",
      items: SUBSCRIBED_SKUS_RESPONSE,
      mapping: [{ sourceField: "value", targetField: "skuData", transform: "neverImplemented" }],
      properties: ["skuPartNumber"],
      rules: [],
    });
    expect(trace.keys.find(k => k.key === "skuData")!.value).toEqual([]);
    expect(trace.keys.find(k => k.key === "skuPartNumber_values")!.value).toHaveLength(4);
  });

  it("license:unused-assigned: countWhere feeds a real rule with a real number", () => {
    const users = [
      { id: "u1", assignedLicenses: [{ skuId: "e3" }], signInActivity: { lastSignInDateTime: "2020-01-01T00:00:00Z" } },
      { id: "u2", assignedLicenses: [{ skuId: "e5" }], signInActivity: { lastSignInDateTime: "2020-06-01T00:00:00Z" } },
      { id: "u3", assignedLicenses: [{ skuId: "e3" }], signInActivity: { lastSignInDateTime: new Date().toISOString() } },
      { id: "u4", assignedLicenses: [], signInActivity: { lastSignInDateTime: "2019-01-01T00:00:00Z" } },
    ];
    const trace = traceCheckResponse({
      checkKey: "license:unused-assigned",
      items: users,
      mapping: [{
        sourceField: "value",
        targetField: "unusedAssignedCount",
        transform: "countWhere('assignedLicenses length> 0 && {{signInActivity.lastSignInDateTime}} olderThanDays 90')",
      }],
      properties: [],
      rules: [makeRule({ id: 402, ruleType: "profile_key_gt", sourceKey: "unusedAssignedCount", compareValue: "1" })],
    });

    const key = trace.keys.find(k => k.key === "unusedAssignedCount")!;
    expect(key.value).toBe(2);          // u1 and u2: licensed and dormant; u3 recent, u4 unlicensed
    expect(key.uncovered).toBe(false);
    expect(key.rules[0]!.result).toBe(true);
    expect(key.rules[0]!.reason).toBe("requires profile[unusedAssignedCount] > 1 to fire; actual value = 2");
  });
});
