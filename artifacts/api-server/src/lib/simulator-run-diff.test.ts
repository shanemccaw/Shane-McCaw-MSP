/**
 * simulator-run-diff.test.ts
 *
 * Regression tests for the Simulator Studio's run-to-run diff (phase 3).
 *
 * KEY TESTING RULE HONORED HERE, same as the phase-2 suite: `applyMapping` and
 * `evaluateRule` are NOT mocked and NOT reimplemented. The diff runs the genuine
 * `traceCheckResponse()` per side, so these tests exercise the real mapping and
 * the real rule evaluator end to end — a regression in either surfaces here
 * instead of being masked by a stub that agrees with a forked copy.
 *
 * Run with: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi } from "vitest";

// simulator-run-diff imports monitor-check-trace -> monitor-executor -> @workspace/db,
// and lib/db's index.ts hard-requires DATABASE_URL at module scope. vi.hoisted runs
// before the static imports below are evaluated. Same pattern as monitor-check-trace.test.ts.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
});

import { diffCheckRuns, valuesEqual, type DiffSide } from "./simulator-run-diff.ts";
import type { SignalDerivationRule } from "./tenant-signals.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Minimal-but-real rule row: every intelligence field the type demands. */
function makeRule(
  over: Partial<SignalDerivationRule> & Pick<SignalDerivationRule, "id" | "ruleType" | "sourceKey">,
): SignalDerivationRule {
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

const CHECK_KEY = "identity:mfa-registration";

const MAPPING = [{ sourceField: "isMfaRegistered", targetField: "mfaRegisteredCount", transform: "countTruthy" }];

function side(over: Partial<DiffSide> & Pick<DiffSide, "runId" | "items" | "startedAt">): DiffSide {
  return {
    checkKey: CHECK_KEY,
    mapping: MAPPING,
    properties: [],
    status: "completed",
    resultStatus: "ok",
    ...over,
  };
}

/** Three users, two of them MFA-registered. */
const ITEMS_2_OF_3 = [
  { id: "u1", isMfaRegistered: true },
  { id: "u2", isMfaRegistered: true },
  { id: "u3", isMfaRegistered: false },
];

/** The same three users after one more registered — the real changed value. */
const ITEMS_3_OF_3 = [
  { id: "u1", isMfaRegistered: true },
  { id: "u2", isMfaRegistered: true },
  { id: "u3", isMfaRegistered: true },
];

// ── Value comparison ──────────────────────────────────────────────────────────

describe("valuesEqual", () => {
  it("treats identical scalars as unchanged", () => {
    expect(valuesEqual(2, 2)).toBe(true);
    expect(valuesEqual("a", "a")).toBe(true);
    expect(valuesEqual(false, false)).toBe(true);
  });

  it("treats different scalars as changed", () => {
    expect(valuesEqual(2, 3)).toBe(false);
    expect(valuesEqual(0, false)).toBe(false);
    expect(valuesEqual(null, undefined)).toBe(false);
  });

  it("compares groupByCount objects by content, not identity or key order", () => {
    // Without this, every grouped key would report as "changed" on every run.
    expect(valuesEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(valuesEqual({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
  });
});

// ── The diff ──────────────────────────────────────────────────────────────────

describe("diffCheckRuns", () => {
  it("identifies a real changed value between two runs", () => {
    const diff = diffCheckRuns({
      sideA: side({ runId: "run-a", items: ITEMS_2_OF_3, startedAt: "2026-07-23T10:00:00.000Z" }),
      sideB: side({ runId: "run-b", items: ITEMS_3_OF_3, startedAt: "2026-07-23T11:00:00.000Z" }),
      rules: [],
    });

    const changed = diff.keyChanges.find((k) => k.key === "mfaRegisteredCount");
    expect(changed).toBeDefined();
    expect(changed!.change).toBe("changed");
    // Real countTruthy over the real items on each side: 2 → 3.
    expect(changed!.before).toBe(2);
    expect(changed!.after).toBe(3);
    // The mapping was identical on both sides, so the value moved because the
    // response did — not because the catalog was edited.
    expect(diff.mappingChanged).toBe(false);
    expect(changed!.producedDifferently).toBe(false);
  });

  it("orders the sides chronologically regardless of the argument order", () => {
    const earlier = side({ runId: "run-a", items: ITEMS_2_OF_3, startedAt: "2026-07-23T10:00:00.000Z" });
    const later = side({ runId: "run-b", items: ITEMS_3_OF_3, startedAt: "2026-07-23T11:00:00.000Z" });

    const forwards = diffCheckRuns({ sideA: earlier, sideB: later, rules: [] });
    const backwards = diffCheckRuns({ sideA: later, sideB: earlier, rules: [] });

    for (const diff of [forwards, backwards]) {
      expect(diff.before.runId).toBe("run-a");
      expect(diff.after.runId).toBe("run-b");
      expect(diff.keyChanges.find((k) => k.key === "mfaRegisteredCount")!.before).toBe(2);
      expect(diff.keyChanges.find((k) => k.key === "mfaRegisteredCount")!.after).toBe(3);
    }
  });

  it("reports keys whose value did not move as unchanged rather than listing them", () => {
    const diff = diffCheckRuns({
      sideA: side({ runId: "run-a", items: ITEMS_2_OF_3, startedAt: "2026-07-23T10:00:00.000Z" }),
      sideB: side({ runId: "run-b", items: ITEMS_2_OF_3, startedAt: "2026-07-23T11:00:00.000Z" }),
      rules: [],
    });

    expect(diff.keyChanges).toHaveLength(0);
    // mfaRegisteredCount + the synthetic __itemCount key.
    expect(diff.unchangedKeyCount).toBeGreaterThanOrEqual(2);
  });

  it("reports a rule that stopped firing, with the REAL evaluateRule reason on each side", () => {
    // "fewer than 3 registered" — true at 2 of 3, false at 3 of 3.
    const rules = [makeRule({ id: 55, ruleType: "profile_key_lt", sourceKey: "mfaRegisteredCount", compareValue: "3" })];

    const diff = diffCheckRuns({
      sideA: side({ runId: "run-a", items: ITEMS_2_OF_3, startedAt: "2026-07-23T10:00:00.000Z" }),
      sideB: side({ runId: "run-b", items: ITEMS_3_OF_3, startedAt: "2026-07-23T11:00:00.000Z" }),
      rules,
    });

    expect(diff.ruleChanges).toHaveLength(1);
    const change = diff.ruleChanges[0]!;
    expect(change.ruleId).toBe(55);
    expect(change.change).toBe("stopped_firing");
    expect(change.before).toBe(true);
    expect(change.after).toBe(false);
    // Straight from evaluateRule — never re-authored by the diff.
    expect(change.reasonBefore).toBe("profile[mfaRegisteredCount] = 2 < 3");
    // evaluateRule states the failing case in its own words ("3 >= 3"), and the
    // diff surfaces that verbatim rather than paraphrasing it.
    expect(change.reasonAfter).toBe("profile[mfaRegisteredCount] = 3 >= 3");
  });

  it("reports a rule that started firing", () => {
    // "more than 2 registered" — false at 2 of 3, true at 3 of 3.
    const rules = [makeRule({ id: 56, ruleType: "profile_key_gt", sourceKey: "mfaRegisteredCount", compareValue: "2" })];

    const diff = diffCheckRuns({
      sideA: side({ runId: "run-a", items: ITEMS_2_OF_3, startedAt: "2026-07-23T10:00:00.000Z" }),
      sideB: side({ runId: "run-b", items: ITEMS_3_OF_3, startedAt: "2026-07-23T11:00:00.000Z" }),
      rules,
    });

    const change = diff.ruleChanges.find((r) => r.ruleId === 56)!;
    expect(change.change).toBe("started_firing");
    expect(change.before).toBe(false);
    expect(change.after).toBe(true);
  });

  it("counts a rule whose outcome held steady as unchanged", () => {
    const rules = [makeRule({ id: 57, ruleType: "profile_key_lt", sourceKey: "mfaRegisteredCount", compareValue: "99" })];

    const diff = diffCheckRuns({
      sideA: side({ runId: "run-a", items: ITEMS_2_OF_3, startedAt: "2026-07-23T10:00:00.000Z" }),
      sideB: side({ runId: "run-b", items: ITEMS_3_OF_3, startedAt: "2026-07-23T11:00:00.000Z" }),
      rules,
    });

    expect(diff.ruleChanges).toHaveLength(0);
    expect(diff.unchangedRuleCount).toBe(1);
  });

  it("flags a rule that appeared because its source key was only produced by the later run", () => {
    const rules = [makeRule({ id: 58, ruleType: "profile_key_gt", sourceKey: "guestCount", compareValue: "0" })];

    const diff = diffCheckRuns({
      sideA: side({ runId: "run-a", items: ITEMS_2_OF_3, startedAt: "2026-07-23T10:00:00.000Z" }),
      sideB: side({
        runId: "run-b",
        items: [{ id: "g1", userType: "Guest" }],
        startedAt: "2026-07-23T11:00:00.000Z",
        mapping: [
          ...MAPPING,
          { sourceField: "userType", targetField: "guestCount", transform: "countEquals('Guest')" },
        ],
      }),
      rules,
    });

    const change = diff.ruleChanges.find((r) => r.ruleId === 58)!;
    expect(change.change).toBe("appeared");
    expect(change.before).toBeNull();
    expect(change.after).toBe(true);
  });

  it("says so explicitly when the two runs' mapping snapshots disagree", () => {
    // A key that moved because the MAPPING changed is a different finding from
    // one that moved because the tenant changed — the UI must be able to tell.
    const diff = diffCheckRuns({
      sideA: side({ runId: "run-a", items: ITEMS_2_OF_3, startedAt: "2026-07-23T10:00:00.000Z" }),
      sideB: side({
        runId: "run-b",
        items: ITEMS_2_OF_3,
        startedAt: "2026-07-23T11:00:00.000Z",
        mapping: [{ sourceField: "isMfaRegistered", targetField: "mfaRegisteredCount", transform: "countFalse" }],
      }),
      rules: [],
    });

    expect(diff.mappingChanged).toBe(true);
    const changed = diff.keyChanges.find((k) => k.key === "mfaRegisteredCount")!;
    // countTruthy 2 → countFalse 1, off an identical response.
    expect(changed.before).toBe(2);
    expect(changed.after).toBe(1);
    expect(changed.producedDifferently).toBe(true);
    expect(changed.transformBefore).toBe("countTruthy");
    expect(changed.transformAfter).toBe("countFalse");
  });

  it("does not report a reordered mapping as a mapping change", () => {
    const diff = diffCheckRuns({
      sideA: side({
        runId: "run-a",
        items: ITEMS_2_OF_3,
        startedAt: "2026-07-23T10:00:00.000Z",
        mapping: [
          { sourceField: "isMfaRegistered", targetField: "mfaRegisteredCount", transform: "countTruthy" },
          { sourceField: "id", targetField: "userCount", transform: "count" },
        ],
      }),
      sideB: side({
        runId: "run-b",
        items: ITEMS_2_OF_3,
        startedAt: "2026-07-23T11:00:00.000Z",
        mapping: [
          { sourceField: "id", targetField: "userCount", transform: "count" },
          { sourceField: "isMfaRegistered", targetField: "mfaRegisteredCount", transform: "countTruthy" },
        ],
      }),
      rules: [],
    });

    expect(diff.mappingChanged).toBe(false);
    expect(diff.keyChanges).toHaveLength(0);
  });

  it("carries both full traces so the UI can show either side without a second round trip", () => {
    const diff = diffCheckRuns({
      sideA: side({ runId: "run-a", items: ITEMS_2_OF_3, startedAt: "2026-07-23T10:00:00.000Z" }),
      sideB: side({ runId: "run-b", items: ITEMS_3_OF_3, startedAt: "2026-07-23T11:00:00.000Z" }),
      rules: [],
    });

    expect(diff.traces.before.itemCount).toBe(3);
    expect(diff.traces.after.itemCount).toBe(3);
    expect(diff.traces.before.keys.some((k) => k.key === "mfaRegisteredCount")).toBe(true);
  });
});
