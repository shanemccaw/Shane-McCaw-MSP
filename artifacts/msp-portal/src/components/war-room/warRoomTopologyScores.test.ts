import test from "node:test";
import assert from "node:assert/strict";

import {
  TOPOLOGY_PILLAR_GROUPS,
  ENGINE_PILLAR_TO_TOPOLOGY_GROUP,
  toTopologyBaseline,
  hasRealScores,
  computeTopologyDeltas,
  projectTopologyScores,
} from "./warRoomTopologyScores.ts";
import { CHANGES, GOV_LEVERS, DIVES, DIVE_INV, LIC_SKUS } from "./data/warRoomData.ts";

const CATALOGS = { CHANGES, GOV_LEVERS, DIVES, DIVE_INV, LIC_SKUS } as never;

/**
 * Real, varied per-pillar scores in the exact shape
 * `useRealTelemetryComparison().pillars` delivers (see `toPillarViews`). The
 * spread is the point of #312: the diagram used to average one low-skewed demo
 * source into every ring, so a healthy pillar and a critical one drew the same.
 */
const REAL_PILLARS = [
  { pillar: "governance", axis: "Governance", actual: 34, gap: 66 },
  { pillar: "compliance", axis: "Compliance", actual: 88, gap: 12 },
  { pillar: "adoption", axis: "Adoption", actual: 71, gap: 29 },
  { pillar: "copilot", axis: "Copilot Readiness", actual: 22, gap: 78 },
  { pillar: "architecture", axis: "Architecture", actual: 91, gap: 9 },
  { pillar: "licensing", axis: "Licensing", actual: 55, gap: 45 },
  { pillar: "security", axis: "Security", actual: 47, gap: 53 },
];

test("every engine pillar maps onto exactly one topology group, architecture -> Health", () => {
  const groups = Object.values(ENGINE_PILLAR_TO_TOPOLOGY_GROUP);
  assert.equal(groups.length, TOPOLOGY_PILLAR_GROUPS.length);
  assert.deepEqual([...groups].sort(), [...TOPOLOGY_PILLAR_GROUPS].sort());
  // The only non-identity pair — the engine's name for the War Room's Health pillar.
  assert.equal(ENGINE_PILLAR_TO_TOPOLOGY_GROUP.architecture, "Health");
});

test("toTopologyBaseline carries every real pillar score onto its group", () => {
  assert.deepEqual(toTopologyBaseline(REAL_PILLARS), {
    Security: 47,
    Governance: 34,
    Licensing: 55,
    Adoption: 71,
    Copilot: 22,
    Compliance: 88,
    Health: 91,
  });
});

test("a pillar the engine returned nothing for stays null, never zero-filled", () => {
  // `toPillarViews` has already dropped null-displayScore pillars upstream, so
  // "absent" is exactly how an unmeasured pillar arrives here.
  const partial = toTopologyBaseline([
    { pillar: "security", actual: 40 },
    { pillar: "governance", actual: 61 },
  ]);
  assert.equal(partial.Security, 40);
  assert.equal(partial.Governance, 61);
  for (const group of ["Licensing", "Adoption", "Copilot", "Compliance", "Health"] as const) {
    assert.equal(partial[group], null, `${group} must be null, not a fabricated score`);
  }
});

test("toTopologyBaseline ignores unknown pillars and non-finite scores", () => {
  const scores = toTopologyBaseline([
    { pillar: "sustainability", actual: 50 },
    { pillar: "security", actual: Number.NaN },
    { pillar: "adoption", actual: 64 },
  ]);
  assert.equal(scores.Security, null);
  assert.equal(scores.Adoption, 64);
  assert.equal(Object.values(scores).filter((v) => typeof v === "number").length, 1);
});

test("hasRealScores separates a loaded-but-empty engine result from a real one", () => {
  assert.equal(hasRealScores(null), false);
  assert.equal(hasRealScores(toTopologyBaseline([])), false);
  assert.equal(hasRealScores(toTopologyBaseline(REAL_PILLARS)), true);
});

test("no toggles set means no deltas and no projection at all", () => {
  const deltas = computeTopologyDeltas({}, CATALOGS);
  assert.deepEqual(deltas, {});
  // null, not an all-zero map: the canvas's `ghosting` check must see that the
  // customer has not moved anything, so the outer ring does not shadow the inner.
  assert.equal(projectTopologyScores(toTopologyBaseline(REAL_PILLARS), deltas), null);
});

test("governance levers and staged changes both feed real point deltas", () => {
  const govLever = GOV_LEVERS[0];
  const deltas = computeTopologyDeltas(
    { levers: { [govLever.id]: true }, changes: { ca01: true } },
    CATALOGS,
  );
  // Same arithmetic the previous absolute projection used: lever d.score + CHANGES.gov.
  assert.equal(deltas.Governance, govLever.d.score + CHANGES.ca01.gov);
  assert.equal(deltas.Security, CHANGES.ca01.sec);
  assert.equal(deltas.Copilot, CHANGES.ca01.ready);
});

test("a deep-dive lever, its inventory toggle and a completed run all score", () => {
  const lever = DIVES.security.levers[0];
  const inventoryToggle = DIVE_INV.security.toggle.id;
  const leverOnly = computeTopologyDeltas({ levers: { [`security:${lever.id}`]: true } }, CATALOGS);
  assert.equal(leverOnly.Security, lever.score);

  const withInventory = computeTopologyDeltas(
    { levers: { [`security:${lever.id}`]: true, [`security:${inventoryToggle}`]: true } },
    CATALOGS,
  );
  assert.equal(withInventory.Security, lever.score + 9);

  const withRun = computeTopologyDeltas(
    {
      levers: { [`security:${lever.id}`]: true, [`security:${inventoryToggle}`]: true },
      invRun: { security: "done" },
    },
    CATALOGS,
  );
  assert.equal(withRun.Security, lever.score + 9 + 4);
});

test("the licence adjuster scores the CHANGE it makes, not an absolute demo score", () => {
  const e5 = LIC_SKUS.find((s) => s.id === "e5")!;
  // Setting a SKU back to what it already is is not a change — no delta.
  assert.equal(computeTopologyDeltas({ lic: { e5: e5.purchased } }, CATALOGS).Licensing, undefined);

  // Cutting the 888 unassigned E5 seats reduces waste, so Licensing improves.
  const trimmed = computeTopologyDeltas({ lic: { e5: e5.assigned } }, CATALOGS);
  assert.ok(trimmed.Licensing! > 0, `expected a positive Licensing delta, got ${trimmed.Licensing}`);

  // Buying seats nobody is assigned adds waste, so Licensing gets worse.
  const inflated = computeTopologyDeltas({ lic: { e5: e5.purchased + 2000 } }, CATALOGS);
  assert.ok(inflated.Licensing! < 0, `expected a negative Licensing delta, got ${inflated.Licensing}`);
});

test("buying Copilot seats raises Copilot readiness, and stacks with a staged change", () => {
  const copilot = LIC_SKUS.find((s) => s.id === "copilot")!;
  const seatsOnly = computeTopologyDeltas({ lic: { copilot: copilot.purchased + 900 } }, CATALOGS);
  assert.ok(seatsOnly.Copilot! > 0);

  // The previous projection let the seat curve OVERWRITE the staged-change gain;
  // as deltas the two independent customer actions add up instead.
  const both = computeTopologyDeltas(
    { lic: { copilot: copilot.purchased + 900 }, changes: { ca01: true } },
    CATALOGS,
  );
  assert.equal(both.Copilot, seatsOnly.Copilot! + CHANGES.ca01.ready);
});

test("the projection moves the REAL baseline, and only the pillars that moved", () => {
  const baseline = toTopologyBaseline(REAL_PILLARS);
  const projected = projectTopologyScores(baseline, { Governance: 12, Security: 5 })!;
  assert.deepEqual(projected, { Security: 47 + 5, Governance: 34 + 12 });
  // Sparse: an untouched pillar is absent, so the canvas draws no ghost for it.
  assert.equal("Adoption" in projected, false);
});

test("the projection cannot invent a starting point for an unmeasured pillar", () => {
  const baseline = toTopologyBaseline([{ pillar: "security", actual: 40 }]);
  // Governance has no real score, so a real governance lever has nothing to move.
  const projected = projectTopologyScores(baseline, { Governance: 20, Security: 6 });
  assert.deepEqual(projected, { Security: 46 });
});

test("a projected score is capped at the engine's 99 ceiling and never negative", () => {
  const baseline = toTopologyBaseline([
    { pillar: "compliance", actual: 95 },
    { pillar: "licensing", actual: 5 },
  ]);
  const projected = projectTopologyScores(baseline, { Compliance: 40, Licensing: -60 })!;
  assert.equal(projected.Compliance, 99);
  assert.equal(projected.Licensing, 0);
});

test("with no real baseline at all there is nothing to project", () => {
  assert.equal(projectTopologyScores(null, { Governance: 20 }), null);
});
