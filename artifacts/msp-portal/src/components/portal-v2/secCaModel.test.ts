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
import { caBandsWithRows, caBandsWithRowsLive, caStatCards, caStatCardsLive } from "./secCaModel";
import { type LiveCaPolicy } from "./useCaBaselineLive";

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

describe("caBandsWithRowsLive", () => {
  it("reports every baseline as missing, honestly, when the tenant has no matching real policies", () => {
    const bands = caBandsWithRowsLive([], null);
    const rows = bands.flatMap((b) => b.rows);
    assert.equal(rows.length, CA_POLICIES.length);
    assert.ok(rows.every((r) => r.statusLabel === "Missing"));
    assert.ok(rows.every((r) => r.note === "No matching policy was found in your tenant."));
  });

  it("matches a real enabled policy by exact displayName and reports it in place", () => {
    const live: LiveCaPolicy[] = [
      { id: "g1", displayName: "CA004-AllUsers-DeviceRegistration-RequireMFA", state: "enabled" },
    ];
    const rows = caBandsWithRowsLive(live, null).flatMap((b) => b.rows);
    const ca004 = rows.find((r) => r.id.startsWith("CA004"));
    assert.equal(ca004?.statusLabel, "In place");
    assert.equal(ca004?.actionable, false);
    assert.match(ca004?.note ?? "", /is enabled and enforced in your tenant/);
  });

  it("matches by numeric prefix when the real policy was hand-renamed", () => {
    const live: LiveCaPolicy[] = [{ id: "g2", displayName: "CA004 - MFA for device join (renamed)", state: "enabledForReportingButNotEnforced" }];
    const rows = caBandsWithRowsLive(live, null).flatMap((b) => b.rows);
    const ca004 = rows.find((r) => r.id.startsWith("CA004"));
    assert.equal(ca004?.statusLabel, "Needs attention");
    assert.match(ca004?.note ?? "", /report-only mode/);
  });

  it("appends a real licensing-gap note only for P2 baselines when the tenant lacks P2", () => {
    const rows = caBandsWithRowsLive([], false).flatMap((b) => b.rows);
    const ca401 = rows.find((r) => r.id.startsWith("CA401"));
    assert.match(ca401?.note ?? "", /Entra ID P2 licence, which this tenant does not currently have/);
    const ca004 = rows.find((r) => r.id.startsWith("CA004"));
    assert.doesNotMatch(ca004?.note ?? "", /Entra ID P2/);
  });

  it("caStatCardsLive counts sum to the row total", () => {
    const bands = caBandsWithRowsLive([], null);
    const by = Object.fromEntries(caStatCardsLive(bands).map((c) => [c.label, Number(c.value)]));
    assert.equal(by["In place"] + by["Needs attention"] + by["Missing"], CA_POLICIES.length);
    assert.equal(by["Missing"], CA_POLICIES.length);
  });
});
