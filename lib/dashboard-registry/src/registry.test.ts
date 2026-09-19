import { test } from "node:test";
import assert from "node:assert/strict";

import { DASHBOARD_METRICS } from "./metrics.ts";
import { DASHBOARD_RENDERERS } from "./renderers.ts";
import { getValidRenderersForMetric } from "./registry.ts";
import {
  classifySourceKey,
  sourceKeyIsCatalogClaim,
  NOT_COLLECTED_PREFIX,
  CATALOG_DRIFT_BACKLOG,
  MONITOR_CHECK_CATALOG_SNAPSHOT,
} from "./sourceKeyContract.ts";

test("no monitor_profile metric names a sourceKey a live audit has ruled out", () => {
  // #441. A phantom sourceKey is invisible at runtime — it resolves exactly like
  // a tenant that has not collected the check — so it can only be caught here.
  // See sourceKeyContract.ts for why this is a deny list rather than an
  // allow-list of "real" domains.
  const bad: string[] = [];
  for (const m of DASHBOARD_METRICS) {
    if (m.sourceType !== "monitor_profile") continue;
    if (!sourceKeyIsCatalogClaim(m.key)) continue;
    const verdict = classifySourceKey(m.sourceKey);
    if (!verdict.ok) bad.push(`${m.key}: ${verdict.reason}`);
  }
  assert.deepEqual(bad, [], `phantom sourceKeys:\n  ${bad.join("\n  ")}`);
});

test("a not_collected sourceKey and a not_collected status always travel together", () => {
  // Either half alone is a lie: the sentinel prefix with an "available" status
  // makes the metric look resolvable, and the status without the prefix leaves a
  // real-looking catalog key pointing at nothing.
  for (const m of DASHBOARD_METRICS) {
    const sentinel = m.sourceKey.startsWith(NOT_COLLECTED_PREFIX);
    assert.equal(
      sentinel,
      m.status === "not_collected",
      `${m.key}: sourceKey "${m.sourceKey}" and status "${m.status}" disagree about whether it is collected`,
    );
  }
});

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

// -- #4573 -- the per-check audit of CATALOG_DRIFT_BACKLOG --------------------

test("CATALOG_DRIFT_BACKLOG names a real blocker for exactly the keys it lists (#4573)", () => {
  // The backlog is only honest if each entry says why it is still there. A key
  // without a blocker is a TODO nobody has looked at; a blocker without a key is
  // a stale note about something already resolved.
  const keys = [...CATALOG_DRIFT_BACKLOG.keys].sort();
  const blockerKeys = Object.keys(CATALOG_DRIFT_BACKLOG.blockers).sort();
  assert.deepEqual(blockerKeys, keys, "every backlog key needs exactly one blocker, and no blocker may outlive its key");
  for (const [key, blocker] of Object.entries(CATALOG_DRIFT_BACKLOG.blockers)) {
    assert.ok(blocker.trim().length >= 40, `${key}: blocker is too thin to be an audit finding: "${blocker}"`);
  }
});

test("every CATALOG_DRIFT_BACKLOG key is still used by a metric and still absent from the catalog (#4573)", () => {
  const used = new Set(DASHBOARD_METRICS.map((m) => m.sourceKey));
  const inSnapshot = new Set(MONITOR_CHECK_CATALOG_SNAPSHOT.keys);
  for (const key of CATALOG_DRIFT_BACKLOG.keys) {
    assert.ok(used.has(key), `${key} is on the backlog but no metric uses it any more - remove the entry`);
    assert.ok(
      !inSnapshot.has(key),
      `${key} is on the backlog but IS in the catalog snapshot - the check now exists, so remap the metric and drop the entry`,
    );
  }
});

test("the six #4573 remaps each point at a check the live catalog has (#4573)", () => {
  // Metric -> the real check it now reads. Each was audited against the check's
  // own mapping (and live extractedProperties where the tenant had data); see
  // build-journal/4573-plan.md. Asserting the pairing, not just membership, stops
  // a later edit from swapping one real key for another real-but-wrong one.
  const remaps: Record<string, string> = {
    "intune.nonCompliantDeviceCount": "devices:compliant-vs-noncompliant",
    "intune.unencryptedDeviceCount": "devices:encryption-status",
    "collaboration.teamsChannelCount": "teams:channel-sprawl",
    "compliance.guestUserCount": "governance:guest-count",
    "compliance.orphanedTeamCount": "teams:ownerless-teams",
    "copilot.overshareExposureCount": "copilot:data-exposure-risk",
  };
  for (const [metricKey, checkKey] of Object.entries(remaps)) {
    const m = DASHBOARD_METRICS.find((d) => d.key === metricKey);
    assert.ok(m, `${metricKey} missing from the registry`);
    assert.equal(m.sourceKey, checkKey, `${metricKey} should read ${checkKey}`);
    assert.equal(m.status, "available", `${metricKey} has a real source, so it must not be marked not_collected`);
    const verdict = classifySourceKey(m.sourceKey);
    assert.ok(verdict.ok && verdict.kind === "in_snapshot", `${metricKey} -> ${checkKey} is not in the live catalog snapshot`);
  }
});

test("a metric retired to not_collected in #4573 kept its label, shape and scope (#4573)", () => {
  // Retirement changes what the metric CLAIMS to be sourced from, never what it
  // is. Stored dashboard widgets reference metrics by key and pick a renderer by
  // shape, so those must survive untouched.
  const retired = DASHBOARD_METRICS.filter(
    (m) => m.sourceKey.startsWith(NOT_COLLECTED_PREFIX) && m.status === "not_collected",
  );
  assert.ok(retired.length >= 46, `expected at least the 46 metrics retired by #4573, found ${retired.length}`);
  for (const m of retired) {
    assert.ok(m.label.length > 0 && m.shape && m.scope, `${m.key} lost a structural field in retirement`);
    assert.equal(m.smartEligible, false, `${m.key} is not_collected so cannot be smart-graded`);
  }
});
