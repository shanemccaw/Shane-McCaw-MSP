import { test } from "node:test";
import assert from "node:assert/strict";

import { DASHBOARD_METRICS } from "./metrics";
import { DASHBOARD_RENDERERS } from "./renderers";
import { getValidRenderersForMetric } from "./registry";

test("every MetricDef.key is unique", () => {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const m of DASHBOARD_METRICS) {
    if (seen.has(m.key)) dupes.push(m.key);
    seen.add(m.key);
  }
  assert.deepEqual(dupes, [], `duplicate metric keys: ${dupes.join(", ")}`);
});

test("every denominatorMetric references a real key in the same array", () => {
  const keys = new Set(DASHBOARD_METRICS.map((m) => m.key));
  for (const m of DASHBOARD_METRICS) {
    if (m.denominatorMetric !== undefined) {
      assert.ok(
        keys.has(m.denominatorMetric),
        `${m.key} references unknown denominatorMetric "${m.denominatorMetric}"`,
      );
    }
  }
});

test("every smartEligible metric has a target and bands", () => {
  for (const m of DASHBOARD_METRICS) {
    if (m.smartEligible) {
      assert.equal(
        typeof m.smartDefaultTarget,
        "number",
        `${m.key} is smartEligible but has no smartDefaultTarget`,
      );
      assert.ok(
        m.smartBands !== undefined,
        `${m.key} is smartEligible but has no smartBands`,
      );
    }
  }
});

test("non-smartEligible metrics do not carry smart config", () => {
  // Sanity: keeps the two states from silently drifting apart.
  for (const m of DASHBOARD_METRICS) {
    if (!m.smartEligible) {
      assert.equal(
        m.smartDefaultTarget,
        undefined,
        `${m.key} is not smartEligible but has a smartDefaultTarget`,
      );
      assert.equal(
        m.smartBands,
        undefined,
        `${m.key} is not smartEligible but has smartBands`,
      );
    }
  }
});

test("getValidRenderersForMetric: a trend metric gets Trend/Bar, not Stat/Gauge", () => {
  // identity.legacyAuthCount has shape "trend".
  const types = getValidRenderersForMetric("identity.legacyAuthCount").map(
    (r) => r.type,
  );
  assert.ok(types.includes("Trend"), "trend metric should allow Trend");
  assert.ok(types.includes("Bar"), "trend metric should allow Bar");
  assert.ok(!types.includes("Stat"), "trend metric should not allow Stat");
  assert.ok(!types.includes("Gauge"), "trend metric should not allow Gauge");
  assert.ok(
    !types.includes("ScoreRing"),
    "trend metric should not allow ScoreRing",
  );
});

test("getValidRenderersForMetric: scalar-with-denominator allows ScoreRing", () => {
  // compliance.oversharedSiteCount is scalar + has denominatorMetric + smartEligible.
  const types = getValidRenderersForMetric(
    "compliance.oversharedSiteCount",
  ).map((r) => r.type);
  assert.ok(types.includes("ScoreRing"), "should allow ScoreRing");
  assert.ok(types.includes("Stat"), "should allow Stat");
  assert.ok(types.includes("Smart"), "smartEligible scalar should allow Smart");
});

test("getValidRenderersForMetric: scalar without denominator excludes ScoreRing", () => {
  // identity.disabledAccountCount is scalar, no denominator, not smartEligible.
  const types = getValidRenderersForMetric(
    "identity.disabledAccountCount",
  ).map((r) => r.type);
  assert.ok(types.includes("Stat"), "should allow Stat");
  assert.ok(
    !types.includes("ScoreRing"),
    "scalar without denominator should not allow ScoreRing",
  );
  assert.ok(
    !types.includes("Smart"),
    "non-smartEligible scalar should not allow Smart",
  );
});

test("getValidRenderersForMetric: Smart only for smartEligible scalar metrics", () => {
  // identity.mfaRegisteredCount is scalar + smartEligible (but no denominator).
  const mfa = getValidRenderersForMetric("identity.mfaRegisteredCount").map(
    (r) => r.type,
  );
  assert.ok(mfa.includes("Smart"), "smartEligible scalar should allow Smart");
  assert.ok(
    !mfa.includes("ScoreRing"),
    "smartEligible scalar without denominator should not allow ScoreRing",
  );
});

test("getValidRenderersForMetric: a timeline metric gets only Timeline", () => {
  // drift.caPolicyDriftCount has shape "timeline".
  const types = getValidRenderersForMetric("drift.caPolicyDriftCount").map(
    (r) => r.type,
  );
  assert.deepEqual(types, ["Timeline"]);
});

test("getValidRenderersForMetric: unknown metric key returns []", () => {
  assert.deepEqual(getValidRenderersForMetric("does.not.exist"), []);
});

test("every renderer's acceptedShapes are valid metric shapes", () => {
  const validShapes = new Set([
    "scalar",
    "trend",
    "distribution",
    "heatmap",
    "timeline",
  ]);
  for (const r of DASHBOARD_RENDERERS) {
    for (const s of r.acceptedShapes) {
      assert.ok(validShapes.has(s), `renderer ${r.type} has invalid shape ${s}`);
    }
  }
});
