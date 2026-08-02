/**
 * warRoomGovernanceWalk.test.ts — #331 (War Room epic #302).
 *
 * The issue's verification ask has two halves, and both are claims about the
 * OUTPUT tracking the INPUT rather than about any one number:
 *
 *   • head / bars / delta on the five governance topics must reflect genuine
 *     findings. A test that only ever feeds one payload cannot tell a real
 *     wiring from a constant, so the two tenants below are genuinely different
 *     and every real assertion checks the output moved with them.
 *   • Everything not wired must be visibly marked. That is asserted the strict
 *     way: sweep EVERY head, bar, heat cell and delta row of all five sections
 *     and require each one to be real, NO DATA, or NOT WIRED — never a bare
 *     leftover from the Northline Health script.
 *
 * Run with Node's own test runner (msp-portal has no vitest):
 *   pnpm --filter @workspace/msp-portal test
 */

import test from "node:test";
import assert from "node:assert/strict";

import { GOV_WALK } from "./data/warRoomData.ts";
import { WAR_ROOM_NO_DATA_COLOR, type WarRoomPillarStatsPayload } from "./warRoomPillarStats.ts";
import {
  govWalkCard,
  govWalkValue,
  GOV_WALK_WIRING,
  GOV_WALK_SOURCE_CHECK,
  WAR_ROOM_NOT_WIRED_COLOR,
  WAR_ROOM_NOT_WIRED_LABEL,
  WAR_ROOM_NO_DATA_LABEL,
} from "./warRoomGovernanceWalk.ts";

function pillar(name: string, score: number | null, stats: Record<string, number | null>) {
  return {
    pillar: name,
    enginePillar: name,
    score,
    rawRiskScore: 0,
    stats: Object.entries(stats).map(([id, value]) => ({
      id,
      label: id,
      unit: "count" as const,
      value,
      ...(value == null ? { unavailableReason: "no_data" } : {}),
      source: `monitor_profile:${id}`,
      replaces: "",
    })),
    findings: [],
    findingCounts: { critical: 0, warning: 0 },
  };
}

/** A small, mostly-healthy tenant. */
const TENANT_A: WarRoomPillarStatsPayload = {
  pillars: [
    pillar("governance", 62, {
      "governance.sites": 87,
      "governance.overshared": 3,
      "governance.exposure": 1_940,
      "governance.publicChannels": 0,
    }),
    pillar("compliance", 71, {
      "compliance.missingLabels": 512,
      "compliance.guests": 24,
    }),
  ],
  findingsRunId: "run-a",
  findingsRunStatus: "completed",
  activeRunId: null,
  generatedAt: "2026-08-02T09:00:00.000Z",
};

/** A bigger, worse tenant — every figure differs from A. */
const TENANT_B: WarRoomPillarStatsPayload = {
  pillars: [
    pillar("governance", 21, {
      "governance.sites": 1_540,
      "governance.overshared": 220,
      "governance.exposure": 310_776,
      "governance.publicChannels": 44,
    }),
    pillar("compliance", 18, {
      "compliance.missingLabels": 61_000,
      "compliance.guests": 903,
    }),
  ],
  findingsRunId: "run-b",
  findingsRunStatus: "completed",
  activeRunId: null,
  generatedAt: "2026-08-02T09:00:00.000Z",
};

/** Scanned, but these particular checks reported nothing. */
const TENANT_EMPTY: WarRoomPillarStatsPayload = {
  pillars: [
    pillar("governance", null, {
      "governance.sites": null,
      "governance.overshared": null,
      "governance.exposure": null,
    }),
    pillar("compliance", null, {
      "compliance.missingLabels": null,
      "compliance.guests": null,
    }),
  ],
  findingsRunId: null,
  findingsRunStatus: null,
  activeRunId: null,
  generatedAt: "2026-08-02T09:00:00.000Z",
};

const section = (id: string) => GOV_WALK.find((s: any) => s.id === id);
const wire = (id: string, payload: WarRoomPillarStatsPayload | null) =>
  govWalkCard(section(id), "governance", payload);

// ── The real numbers ─────────────────────────────────────────────────────────

test("Org-Wide Sharing head is the real overshared-site count, per tenant", () => {
  const a = wire("orgwide", TENANT_A);
  const b = wire("orgwide", TENANT_B);

  assert.equal(a.head.v, "3");
  assert.equal(b.head.v, "220");
  assert.equal(a.head.l, "sites flagged overshared");
  assert.equal(a.head.wired, true);
  // The check that produced it is named on the card, not just implied.
  assert.ok(a.head.note.includes("compliance:overshared-sites"));
  // And nothing of the fictional headline survives.
  assert.notEqual(a.head.v, section("orgwide").head.v);
});

test("Org-Wide Sharing bars carry real values and NOT WIRED where none exists", () => {
  const a = wire("orgwide", TENANT_A);

  assert.equal(a.bars[0].v, "3 sites");
  assert.equal(a.bars[0].wired, true);
  // No check counts anonymous links — sample text kept, greyed, marked.
  assert.equal(a.bars[1].notWired, true);
  assert.equal(a.bars[1].flag, WAR_ROOM_NOT_WIRED_LABEL);
  assert.equal(a.bars[1].c, WAR_ROOM_NOT_WIRED_COLOR);
  assert.equal(a.bars[1].v, section("orgwide").bars[1].v, "sample content is kept, not blanked");
  assert.equal(a.bars[2].v, "24 guests");
  // 87 sites total − 3 overshared.
  assert.equal(a.bars[3].v, "84 sites");

  const b = wire("orgwide", TENANT_B);
  assert.equal(b.bars[0].v, "220 sites");
  assert.equal(b.bars[2].v, "903 guests");
  assert.equal(b.bars[3].v, "1,320 sites");
});

test("bar widths are proportional to the largest real value in the chart", () => {
  const a = wire("orgwide", TENANT_A);
  const wired = a.bars.filter((bar: any) => bar.wired);
  const max = Math.max(...wired.map((bar: any) => bar.value));
  const widest = wired.find((bar: any) => bar.value === max);

  assert.equal(widest.pct, 100);
  for (const bar of wired) {
    assert.equal(bar.pct, bar.value > 0 ? Math.max(2, Math.round((100 * bar.value) / max)) : 0);
  }
});

test("a real zero reads as healthy, not as a critical finding", () => {
  const clean: WarRoomPillarStatsPayload = {
    ...TENANT_A,
    pillars: [
      pillar("governance", 96, {
        "governance.sites": 40,
        "governance.overshared": 0,
        "governance.exposure": 0,
      }),
      pillar("compliance", 96, { "compliance.missingLabels": 0, "compliance.guests": 0 }),
    ],
  };
  const a = wire("orgwide", clean);

  assert.equal(a.head.v, "0");
  assert.equal(a.head.tone, "#34d399");
  assert.equal(a.bars[0].flag, "within threshold");
  assert.equal(a.bars[0].pct, 0);
});

test("delta rows carry the real Now value and a definitional Resolved target", () => {
  const a = wire("orgwide", TENANT_A);

  assert.deepEqual(a.delta[0], ["Sites flagged overshared", "3", "0"]);
  assert.deepEqual(a.delta[1], ["Items over-exposed", "1,940", "0"]);
  // The score projection has no producer — sample kept, row marked.
  assert.ok(a.delta[2][0].includes(WAR_ROOM_NOT_WIRED_LABEL));
  assert.equal(a.delta[2][1], section("orgwide").delta[2][1]);

  const b = wire("orgwide", TENANT_B);
  assert.deepEqual(b.delta[1], ["Items over-exposed", "310,776", "0"]);
});

test("the other four sections wire the head and delta rows that are real", () => {
  assert.equal(wire("sensitive", TENANT_B).head.v, "61,000");
  assert.deepEqual(wire("sensitive", TENANT_B).delta[1], [
    "Files with no sensitivity label", "61,000", "0",
  ]);

  assert.equal(wire("external", TENANT_B).head.v, "903");
  assert.equal(wire("external", TENANT_B).head.l, "guest identities with standing access");

  assert.equal(wire("copilot", TENANT_B).head.v, "310,776");
  assert.deepEqual(wire("copilot", TENANT_B).delta[1], ["Items over-exposed", "310,776", "0"]);

  // 02's headline is a concentration statistic needing site-level data.
  const locations = wire("locations", TENANT_B);
  assert.equal(locations.head.notWired, true);
  assert.deepEqual(locations.delta[0], ["Sites flagged overshared", "220", "0"]);
});

// ── The three states ─────────────────────────────────────────────────────────

test("a wired item with no tenant data is NO DATA, never the sample number", () => {
  const a = wire("orgwide", TENANT_EMPTY);

  assert.equal(a.head.noData, true);
  assert.equal(a.head.v, "—");
  assert.equal(a.head.tone, WAR_ROOM_NO_DATA_COLOR);
  assert.equal(a.bars[0].flag, WAR_ROOM_NO_DATA_LABEL);
  assert.equal(a.bars[0].v, "—");
  assert.ok(a.delta[0][0].includes(WAR_ROOM_NO_DATA_LABEL));
  assert.equal(a.delta[0][1], "—");
  // NO DATA and NOT WIRED must stay visually distinct — they mean different things.
  assert.notEqual(WAR_ROOM_NO_DATA_COLOR, WAR_ROOM_NOT_WIRED_COLOR);
});

test("an absent payload behaves exactly like a scan with no values", () => {
  for (const id of Object.keys(GOV_WALK_WIRING)) {
    const card = wire(id, null);
    for (const bar of card.bars) assert.ok(bar.wired !== true);
    for (const row of card.delta) assert.ok(row[1] === "—" || row[0].includes(WAR_ROOM_NOT_WIRED_LABEL));
  }
});

test("the two derived-count guards refuse to invent a number", () => {
  // Overshared > total is two checks disagreeing, not a measurement.
  const contradictory: WarRoomPillarStatsPayload = {
    ...TENANT_A,
    pillars: [
      pillar("governance", 10, { "governance.sites": 5, "governance.overshared": 90 }),
      pillar("compliance", 10, {}),
    ],
  };
  assert.equal(govWalkValue(contradictory, "sitesNotOvershared"), null);
  assert.equal(wire("orgwide", contradictory).bars[3].noData, true);

  // One half missing is the same answer.
  const half: WarRoomPillarStatsPayload = {
    ...TENANT_A,
    pillars: [pillar("governance", 10, { "governance.sites": 40 }), pillar("compliance", 10, {})],
  };
  assert.equal(govWalkValue(half, "sitesNotOvershared"), null);
});

test("EVERY item on all five sections is real, NO DATA or NOT WIRED", () => {
  for (const raw of GOV_WALK) {
    const card = govWalkCard(raw, "governance", TENANT_A);

    const state = (item: any) =>
      item.wired === true || item.noData === true || item.notWired === true;

    assert.ok(state(card.head), `${raw.id}: head is unmarked`);
    for (const [i, bar] of card.bars.entries()) assert.ok(state(bar), `${raw.id}: bar ${i} is unmarked`);
    for (const [i, cell] of card.heat.entries()) assert.ok(state(cell), `${raw.id}: heat ${i} is unmarked`);
    for (const [i, row] of card.delta.entries()) {
      const wired = GOV_WALK_WIRING[raw.id]?.delta?.[i] != null;
      assert.ok(
        wired || row[0].includes(WAR_ROOM_NOT_WIRED_LABEL),
        `${raw.id}: delta ${i} is unmarked`,
      );
    }
    // The narrative lists and the gate strip are whole-block markers.
    assert.equal(card.wrongNotWired, true);
    assert.equal(card.fixNotWired, true);
    assert.equal(card.gateNotWired, !!raw.gate);
  }
});

test("every heat cell is NOT WIRED today — no classification breakdown exists", () => {
  for (const raw of GOV_WALK) {
    for (const cell of govWalkCard(raw, "governance", TENANT_B).heat) {
      assert.equal(cell.notWired, true);
      assert.equal(cell.c, WAR_ROOM_NOT_WIRED_COLOR);
      assert.ok(cell.sub.includes(WAR_ROOM_NOT_WIRED_LABEL));
    }
  }
});

// ── Blast radius ─────────────────────────────────────────────────────────────

test("cards this table does not own pass through byte-identical", () => {
  const orgwide = section("orgwide");
  // Another pillar's walk, even at the same index.
  assert.equal(govWalkCard(orgwide, "licensing", TENANT_A), orgwide);
  assert.equal(govWalkCard(orgwide, null, TENANT_A), orgwide);
  // The engine band — deliberately out of scope, see the module header.
  const engineish = { id: "freshness", head: { v: "04:12" }, bars: [], heat: [], delta: [] };
  assert.equal(govWalkCard(engineish, "governance", TENANT_A), engineish);
  assert.equal(govWalkCard(null, "governance", TENANT_A), null);
});

test("the wiring table only names sections and sources that really exist", () => {
  const ids = new Set(GOV_WALK.map((s: any) => s.id));
  for (const id of Object.keys(GOV_WALK_WIRING)) {
    assert.ok(ids.has(id), `wiring names an unknown section: ${id}`);
    const raw = section(id);
    const wiring = GOV_WALK_WIRING[id]!;
    // An index-aligned array that outgrew its card would silently mis-wire rows.
    assert.ok((wiring.bars?.length ?? 0) <= (raw.bars?.length ?? 0));
    assert.ok((wiring.delta?.length ?? 0) <= (raw.delta?.length ?? 0));
    for (const spec of [...(wiring.bars ?? []), ...(wiring.delta ?? []), wiring.head]) {
      if (!spec) continue;
      assert.ok(GOV_WALK_SOURCE_CHECK[spec.source], `unknown source: ${spec.source}`);
    }
  }
});
