/**
 * secCaModel.test.ts — pins the Conditional Access counts and band grouping.
 *
 * The four stat cards are all derived from one array, so a mis-grouped band or a
 * wrong status filter shows a plausible-but-wrong count with nothing on the page
 * to contradict it. These cases pin the totals and one band's membership.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CA_POLICIES } from "./secCaData";
import { caBandsWithRows, caStatCards } from "./secCaModel";

describe("caStatCards", () => {
  it("derives the four counts from the fixture", () => {
    const cards = caStatCards();
    const by = Object.fromEntries(cards.map((c) => [c.label, c.value]));
    assert.equal(by["Baseline policies"], "21");
    assert.equal(by["In place"], "2");
    assert.equal(by["Needs attention"], "3");
    assert.equal(by["Missing"], "16");
  });

  it("the four counts sum to the policy total", () => {
    const by = Object.fromEntries(caStatCards().map((c) => [c.label, Number(c.value)]));
    assert.equal(by["In place"] + by["Needs attention"] + by["Missing"], CA_POLICIES.length);
  });
});

describe("caBandsWithRows", () => {
  it("groups every policy into exactly one of the six bands", () => {
    const bands = caBandsWithRows();
    assert.equal(bands.length, 6);
    assert.equal(bands.reduce((n, b) => n + b.count, 0), CA_POLICIES.length);
    assert.equal(bands.find((b) => b.label.startsWith("Foundation"))?.count, 5);
  });

  it("marks present policies non-actionable and flags P2 rows", () => {
    const rows = caBandsWithRows().flatMap((b) => b.rows);
    const ca004 = rows.find((r) => r.id.startsWith("CA004"));
    assert.equal(ca004?.actionable, false);
    const ca401 = rows.find((r) => r.id.startsWith("CA401"));
    assert.equal(ca401?.showP2, true);
    assert.equal(ca401?.fixKey, "ca-CA401-AllUsers-HighSignInsRisk-BlockAccess");
  });
});
