/**
 * billingModel.test.ts — pins the billing maths against the prototype's numbers:
 * the monthly total, the yearly saving, the streams, and the tier-card deltas.
 * Also guards the #1128 decision — the third tier is Premier, never Command.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { BILL_ADDONS, BILL_TIER_CARDS } from "./billingData";
import {
  BILL_STATE_SEED,
  billAddonCards,
  billAddonTotal,
  billMonthly,
  billReceipts,
  billSaving,
  billSavingLabel,
  billStreams,
  billTierCards,
  billYearPrice,
  fmt$,
} from "./billingModel";

describe("tier naming (#1128)", () => {
  it("names the third tier Premier and never Command", () => {
    assert.deepEqual(BILL_TIER_CARDS.map((t) => t.name), ["Foundation", "Growth", "Premier"]);
    assert.ok(!BILL_TIER_CARDS.some((t) => /command/i.test(t.name)));
  });
});

describe("fmt$", () => {
  it("groups thousands", () => {
    assert.equal(fmt$(4590), "$4,590");
    assert.equal(fmt$(45900), "$45,900");
  });
});

describe("monthly total", () => {
  it("is tier + retainer + on add-ons = $4,590 in the seed state", () => {
    // Growth 1180 + retainer 2400 + Change Control 320 + White-Glove 690
    assert.equal(billAddonTotal(BILL_STATE_SEED.addons), 1010);
    assert.equal(billMonthly(BILL_STATE_SEED), 4590);
  });

  it("moves when an add-on is toggled", () => {
    const withCopilot = { ...BILL_STATE_SEED, addons: { copilot: true } };
    assert.equal(billMonthly(withCopilot), 4590 + 540);
  });

  it("moves when the tier changes", () => {
    const premier = { ...BILL_STATE_SEED, tier: "premier" as const };
    assert.equal(billMonthly(premier), 1980 + 2400 + 1010);
  });
});

describe("yearly saving", () => {
  it("is two months free on the monthly total", () => {
    const m = billMonthly(BILL_STATE_SEED);
    assert.equal(billYearPrice(m), 45900);
    assert.equal(billSaving(m), 9180);
    assert.equal(billSavingLabel(false, 9180), "Pay yearly and save $9,180");
    assert.equal(billSavingLabel(true, 9180), "Saving $9,180 a year");
  });
});

describe("streams", () => {
  it("prices the four streams and counts the add-ons on", () => {
    const s = billStreams(BILL_STATE_SEED);
    assert.deepEqual(s.map((x) => x.price), ["$1,180/mo", "$2,400/mo", "$1,010/mo", "$4,500"]);
    assert.equal(s[0].sub, "Growth · tenant-wide, not per seat");
    assert.equal(s[2].sub, "2 of 5 switched on");
  });
});

describe("tier cards", () => {
  it("badges the current plan and prices the deltas from it", () => {
    const cards = billTierCards(BILL_STATE_SEED);
    assert.deepEqual(cards.map((c) => c.badge), ["Downgrade", "Your plan", "Upgrade"]);
    assert.deepEqual(cards.map((c) => c.deltaLabel), [
      "−$490/mo from today, prorated",
      "",
      "+$800/mo from today, prorated",
    ]);
    assert.deepEqual(cards.map((c) => c.per), ["/month", "/month", "/month"]);
  });

  it("switches to yearly pricing", () => {
    const cards = billTierCards({ ...BILL_STATE_SEED, yearly: true });
    assert.deepEqual(cards.map((c) => c.price), ["$6,900", "$11,800", "$19,800"]);
    assert.ok(cards.every((c) => c.per === "/year"));
  });
});

describe("add-on cards", () => {
  it("labels on add-ons On and off ones Add it", () => {
    const cards = billAddonCards(BILL_STATE_SEED);
    const byKey = Object.fromEntries(cards.map((c) => [c.key, c.stateLabel]));
    assert.equal(byKey.cc, "On");
    assert.equal(byKey.copilot, "Add it");
    assert.equal(cards.length, BILL_ADDONS.length);
  });
});

describe("receipts", () => {
  it("fills the recurring rows with the live monthly total", () => {
    const r = billReceipts(4590);
    assert.equal(r[0].amount, "$4,590");
    assert.equal(r[3].amount, "$4,500"); // the one-time assessment stays fixed
    assert.equal(r[4].amount, "$3,580");
  });
});
