import { test } from "node:test";
import assert from "node:assert/strict";

import { inferDirection, resolveSmartState } from "./smart-state";
import type { MetricDef } from "@workspace/dashboard-registry";

// The two real band presets from the registry (metrics.ts). Direction is
// inferred from these + the target, so the tests use the exact live values.
const COVERAGE_UP_BANDS = { critical: 50, needsImprovement: 80, acceptable: 95 };
const RISK_COUNT_BANDS = { critical: 10, needsImprovement: 5, acceptable: 1 };

/** A higher-is-better coverage metric (e.g. MFA coverage: 100 is the goal). */
const coverageMetric: MetricDef = {
  key: "identity.mfaRegisteredCount",
  label: "MFA Registered Users",
  valueType: "percentage-eligible",
  shape: "scalar",
  sourceType: "monitor_profile",
  sourceKey: "identity:mfa-registration",
  scope: "customer",
  status: "available",
  smartEligible: true,
  smartDefaultTarget: 100,
  smartBands: COVERAGE_UP_BANDS,
};

/** A lower-is-better risk-count metric (e.g. legacy auth users: 0 is the goal). */
const riskMetric: MetricDef = {
  key: "identity.legacyAuthCount",
  label: "Legacy Auth Usage",
  valueType: "count",
  shape: "trend",
  sourceType: "monitor_profile",
  sourceKey: "identity:legacy-auth-usage",
  scope: "customer",
  status: "available",
  smartEligible: true,
  smartDefaultTarget: 0,
  smartBands: RISK_COUNT_BANDS,
};

// ── Direction inference ────────────────────────────────────────────────────────

test("inferDirection: ascending bands + high target → higher-is-better", () => {
  assert.equal(inferDirection(COVERAGE_UP_BANDS, 100), "higher-is-better");
});

test("inferDirection: descending bands + zero target → lower-is-better", () => {
  assert.equal(inferDirection(RISK_COUNT_BANDS, 0), "lower-is-better");
});

test("inferDirection: non-monotonic bands → null (ambiguous, don't guess)", () => {
  // critical between the others — fits neither strictly-monotonic pattern.
  assert.equal(inferDirection({ critical: 80, needsImprovement: 50, acceptable: 95 }, 100), null);
});

test("inferDirection: ascending bands but target below acceptable → null", () => {
  // Ordering says higher-is-better, but the target contradicts it.
  assert.equal(inferDirection(COVERAGE_UP_BANDS, 10), null);
});

// ── State: below target → remediation ─────────────────────────────────────────

test("higher-is-better below target → remediation with deltaFromStart", () => {
  const history = [
    { t: "2026-01-01T00:00:00Z", value: 40 },
    { t: "2026-01-05T00:00:00Z", value: 60 },
  ];
  const r = resolveSmartState(coverageMetric, 70, history);
  assert.equal(r.state, "remediation");
  assert.equal(r.direction, "higher-is-better");
  assert.equal(r.target, 100);
  assert.equal(r.currentValue, 70);
  assert.equal(r.deltaFromStart, 30); // 70 - earliest(40)
});

test("lower-is-better above target → remediation", () => {
  const history = [
    { t: "2026-01-01T00:00:00Z", value: 12 },
    { t: "2026-01-05T00:00:00Z", value: 6 },
  ];
  const r = resolveSmartState(riskMetric, 3, history);
  assert.equal(r.state, "remediation");
  assert.equal(r.direction, "lower-is-better");
  assert.equal(r.deltaFromStart, 3 - 12); // -9 (going down = improving)
});

// ── State: at target ──────────────────────────────────────────────────────────

test("at target with clean history (never dipped below acceptable) → complete", () => {
  const history = [
    { t: "2026-01-01T00:00:00Z", value: 96 }, // >= acceptable(95)
    { t: "2026-01-05T00:00:00Z", value: 98 },
    { t: "2026-01-10T00:00:00Z", value: 100 },
  ];
  const r = resolveSmartState(coverageMetric, 100, history);
  assert.equal(r.state, "complete");
});

test("at target but a recent dip below acceptable in the window → remediation (hysteresis)", () => {
  const history = [
    { t: "2026-01-01T00:00:00Z", value: 40 }, // dipped below acceptable(95)
    { t: "2026-01-05T00:00:00Z", value: 80 },
    { t: "2026-01-10T00:00:00Z", value: 100 },
  ];
  const r = resolveSmartState(coverageMetric, 100, history);
  // The grace behavior: recovered to target but still telling the recovery story.
  assert.equal(r.state, "remediation");
  // Sparkline start point is the earliest point in the window (the dip origin).
  assert.equal(r.deltaFromStart, 60); // 100 - 40
});

test("at target (lower-is-better) with a spike above acceptable → remediation", () => {
  const history = [
    { t: "2026-01-01T00:00:00Z", value: 8 }, // above acceptable(1) = a dip on the bad side
    { t: "2026-01-05T00:00:00Z", value: 2 },
    { t: "2026-01-10T00:00:00Z", value: 0 },
  ];
  const r = resolveSmartState(riskMetric, 0, history);
  assert.equal(r.state, "remediation");
});

test("at target with empty history → complete (nothing to keep it in remediation)", () => {
  const r = resolveSmartState(coverageMetric, 100, []);
  assert.equal(r.state, "complete");
  assert.equal(r.deltaFromStart, undefined);
});

test("history in arbitrary order is sorted before earliest/dip logic", () => {
  // Provided newest-first; earliest is still the 2026-01-01 point.
  const history = [
    { t: "2026-01-10T00:00:00Z", value: 100 },
    { t: "2026-01-01T00:00:00Z", value: 40 },
    { t: "2026-01-05T00:00:00Z", value: 80 },
  ];
  const r = resolveSmartState(coverageMetric, 100, history);
  assert.equal(r.state, "remediation"); // the 40 dip is found regardless of order
  assert.equal(r.deltaFromStart, 60); // earliest is 40, not 100
});

// ── Guardrails ─────────────────────────────────────────────────────────────────

test("throws on a non-smart-eligible metric", () => {
  const notSmart: MetricDef = { ...coverageMetric, smartEligible: false };
  assert.throws(() => resolveSmartState(notSmart, 50, []), /non-smart metric/);
});

test("throws on a metric whose bands don't infer a direction", () => {
  const bad: MetricDef = {
    ...coverageMetric,
    smartBands: { critical: 80, needsImprovement: 50, acceptable: 95 }, // non-monotonic
  };
  assert.throws(() => resolveSmartState(bad, 100, []), /don't infer a clean direction/);
});
