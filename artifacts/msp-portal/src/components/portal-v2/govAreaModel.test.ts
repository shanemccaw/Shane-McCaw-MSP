/**
 * govAreaModel.test.ts — pins the Governance area drill-down resolution.
 *
 * The three shapes share one URL space (`/portal-v2/governance/<slug>`), so the
 * one thing that must not drift is: the right slug resolves to the right shape,
 * and an unknown slug resolves to nothing rather than the wrong template.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { govAreaFor, govInventoryRows, govListRows } from "./govAreaModel";
import { GOV_INVENTORY_PAGES, GOV_LIST_PAGES } from "./govAreaData";

describe("govAreaFor", () => {
  it("resolves a list slug to the list shape", () => {
    const r = govAreaFor("orphaned-teams");
    assert.equal(r?.kind, "list");
    assert.equal(r?.kind === "list" && r.rows.length, 5);
    assert.equal(r?.kind === "list" && r.page.title, "5 Teams have no active members");
  });

  it("resolves an inventory slug to the inventory shape with stats", () => {
    const r = govAreaFor("device-inventory");
    assert.equal(r?.kind, "inventory");
    assert.equal(r?.kind === "inventory" && r.page.stats.length, 3);
    assert.equal(r?.kind === "inventory" && r.rows.length, 3);
  });

  it("resolves the drift slug to the drift shape", () => {
    const r = govAreaFor("sharing-drift-legacy");
    assert.equal(r?.kind, "drift");
    assert.equal(r?.kind === "drift" && r.page.events.length, 3);
  });

  it("returns null for an unknown or absent slug", () => {
    assert.equal(govAreaFor("not-a-real-area"), null);
    assert.equal(govAreaFor(undefined), null);
    // A rich GOV_PAGES key must NOT resolve here — that page is gov-detail's.
    assert.equal(govAreaFor("sharing-drift"), null);
  });
});

describe("govListRows", () => {
  it("marks every open item as actionable and un-accepted", () => {
    const rows = govListRows(GOV_LIST_PAGES["governance-orphaned-teams"]);
    assert.ok(rows.every((r) => r.showActions && !r.accepted && r.acceptedMeta === ""));
  });
});

describe("govInventoryRows", () => {
  it("labels only flagged rows", () => {
    const rows = govInventoryRows(GOV_INVENTORY_PAGES["governance-device-inventory"]);
    assert.deepEqual(
      rows.map((r) => r.flagLabel),
      ["", "Flagged", "Flagged"],
    );
  });
});
