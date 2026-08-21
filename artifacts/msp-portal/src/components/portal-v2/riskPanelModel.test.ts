/**
 * riskPanelModel.test.ts — pins the Governance/Security risk drop derivation.
 *
 * Run with the portal's `npm test` (tsx --test over the src test glob).
 *
 * These assertions guard the two things that are easy to get subtly wrong when
 * transcribing `buildRiskDrop`: the 5×5 grid's ORDER (likelihood 5 at the top,
 * impact rising left to right) and its FOUR-band colour scale, which is NOT the
 * Risk Register page's three-band `heatCell`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildRiskPanel, buildRiskDetail, heatBand } from "./riskPanelModel";

test("heatBand is the prototype's four-step scale (8195), not the register's three", () => {
  assert.equal(heatBand(25), "#f87171"); // >= 15
  assert.equal(heatBand(15), "#f87171");
  assert.equal(heatBand(12), "#fb923c"); // >= 9  — the extra band the register lacks
  assert.equal(heatBand(9), "#fb923c");
  assert.equal(heatBand(6), "#c2a63d"); // >= 4
  assert.equal(heatBand(4), "#c2a63d");
  assert.equal(heatBand(3), "#34d399"); // else
  assert.equal(heatBand(1), "#34d399");
});

test("Governance panel: the two governance risks, in fixture order", () => {
  const p = buildRiskPanel("Governance");
  assert.equal(p.count, 2);
  assert.deepEqual(
    p.rows.map((r) => r.id),
    ["RSK-005", "RSK-009"],
  );
  // Colours come from the register's own maps.
  const guest = p.rows[0];
  assert.equal(guest.inherent, "Medium");
  assert.equal(guest.inherentColor, "#c2a63d");
  assert.equal(guest.status, "Accepted");
  assert.equal(guest.statusColor, "#a78bfa");
});

test("the grid is always 25 cells, likelihood 5 → 1 top to bottom", () => {
  const p = buildRiskPanel("Governance");
  assert.equal(p.cells.length, 25);
  // First cell is likelihood 5 × impact 1 — score 5, gold, empty here.
  assert.equal(p.cells[0].title, "Likelihood 5 × impact 1");
  assert.equal(p.cells[0].band, "#c2a63d");
  assert.equal(p.cells[0].filled, false);
  assert.equal(p.cells[0].n, "");
});

test("Governance's two risks stack on the SAME cell (both L4 × I3)", () => {
  const p = buildRiskPanel("Governance");
  // L=4 is the second row (index 1); I=3 is the third column (index 2) → 1*5+2 = 7.
  const cell = p.cells[7];
  assert.equal(cell.filled, true);
  assert.equal(cell.n, "2"); // RSK-005 and RSK-009 both sit at likelihood 4 × impact 3
  assert.equal(cell.band, "#fb923c"); // score 12 → the >= 9 band
  assert.match(cell.title, /RSK-005 · /);
  assert.match(cell.title, /RSK-009 · /);
  // Exactly one filled cell for Governance.
  assert.equal(p.cells.filter((c) => c.filled).length, 1);
});

test("Security panel: three risks, three distinct filled cells", () => {
  const p = buildRiskPanel("Security");
  assert.equal(p.count, 3);
  assert.deepEqual(
    p.rows.map((r) => r.id),
    ["RSK-001", "RSK-002", "RSK-012"],
  );
  const filled = p.cells.filter((c) => c.filled);
  assert.equal(filled.length, 3);
  // RSK-001 is L4×I5 = 20 (red); RSK-002 L3×I5 = 15 (red); RSK-012 L2×I5 = 10 (orange).
  assert.equal(p.cells[9].n, "1"); // L4 row1, I5 col4
  assert.equal(p.cells[9].band, "#f87171");
  assert.equal(p.cells[19].band, "#fb923c"); // L2 row3, I5 col4 → 10
});

test("detail score string and acceptance mirror the prototype (8225-8229)", () => {
  const d = buildRiskDetail("Governance", "RSK-005");
  assert.ok(d);
  assert.equal(d.score, "Likelihood 4 × impact 3 = 12");
  assert.equal(d.isAccepted, true);
  assert.equal(d.accRef, "RR-2026-016");
  assert.equal(d.accBy, "Jordan Diaz · IT Administrator");
  assert.ok(d.controls.length >= 1);
});

test("a row id from another pillar yields no detail (no cross-pillar leak)", () => {
  assert.equal(buildRiskDetail("Governance", "RSK-001"), null); // RSK-001 is Security
  assert.equal(buildRiskDetail("Security", null), null);
});
