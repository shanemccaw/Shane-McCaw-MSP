/**
 * journeyPricing.test.ts — the scope arithmetic the customer signs.
 *
 * The load-bearing assertion in here is the one about the sticky header: the
 * handoff calls out that an unlabelled figure which silently drops a line item
 * on a screen the customer signs is misleading, so `upfrontUsd` and `monthlyUsd`
 * must always account for the same set of selections. That is a correctness
 * property, not a styling one, which is why it is tested rather than reviewed.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computeTotals,
  defaultSelection,
  depositAmountUsd,
  isPhaseIncluded,
  money,
  monthlyLabel,
  payInFullOfferFromWire,
  phaseCountLabel,
  phasedSchedule,
  pickTier,
  recurringLabel,
  toggleAddon,
  togglePhase,
  weeksLabel,
} from "./journeyPricing.ts";
import {
  PREVIEW_DEPOSIT_PCT,
  PREVIEW_SCOPE,
} from "./journeyPreviewFixture.ts";

const scope = PREVIEW_SCOPE;

describe("default selection", () => {
  it("starts with every phase on and the designed add-on defaults", () => {
    const sel = defaultSelection(scope);
    scope.phases.forEach((p) => assert.equal(sel.phases[p.id], true));
    assert.equal(sel.addons["tenant-monitoring"], true, "monitoring defaults on");
    assert.equal(sel.addons["white-glove-adoption"], false, "adoption defaults off");
    assert.equal(sel.addons["architect-retainer"], false, "retainer defaults off");
    assert.equal(sel.tiers["tenant-monitoring"], "growth");
    assert.equal(sel.tiers["white-glove-adoption"], "growth", "pre-selected even while off");
  });
});

describe("Phase 1 is genuinely locked", () => {
  it("cannot be toggled off", () => {
    const sel = defaultSelection(scope);
    const after = togglePhase(scope, sel, "identity-access-hardening");
    assert.equal(after, sel, "the call is a no-op, not a state change");
    assert.equal(isPhaseIncluded(scope, after, "identity-access-hardening"), true);
  });

  it("stays included even if a caller forges the selection map", () => {
    const forged = {
      ...defaultSelection(scope),
      phases: { ...defaultSelection(scope).phases, "identity-access-hardening": false },
    };
    assert.equal(isPhaseIncluded(scope, forged, "identity-access-hardening"), true);
    assert.ok(
      computeTotals(scope, forged).oneOffUsd >= 6400,
      "its price is still in the total",
    );
  });

  it("an unlocked phase does toggle", () => {
    const sel = defaultSelection(scope);
    const off = togglePhase(scope, sel, "adoption-enablement");
    assert.equal(isPhaseIncluded(scope, off, "adoption-enablement"), false);
    const on = togglePhase(scope, off, "adoption-enablement");
    assert.equal(isPhaseIncluded(scope, on, "adoption-enablement"), true);
  });

  it("ignores an unknown phase id", () => {
    const sel = defaultSelection(scope);
    assert.equal(togglePhase(scope, sel, "no-such-phase"), sel);
    assert.equal(isPhaseIncluded(scope, sel, "no-such-phase"), false);
  });
});

describe("totals", () => {
  it("sums the full default scope", () => {
    const t = computeTotals(scope, defaultSelection(scope));
    // 6400 + 9800 + 8600 + 3200 + 5400 + 2800
    assert.equal(t.oneOffUsd, 36200);
    assert.equal(t.includedPhaseCount, 6);
    assert.equal(t.totalPhaseCount, 6);
    assert.equal(t.weeks, 12);
    assert.equal(t.monthlyUsd, 1480, "monitoring Growth only");
    assert.equal(t.upfrontUsd, 36200, "no one-off add-on selected by default");
  });

  it("drops a phase's price, weeks and score when it is removed", () => {
    const sel = togglePhase(scope, defaultSelection(scope), "sharing-exposure-remediation");
    const t = computeTotals(scope, sel);
    assert.equal(t.oneOffUsd, 36200 - 9800);
    assert.equal(t.includedPhaseCount, 5);
    assert.equal(t.weeks, 9);
  });

  it("removing a phase visibly costs readiness points", () => {
    const full = computeTotals(scope, defaultSelection(scope));
    const trimmed = computeTotals(
      scope,
      togglePhase(scope, defaultSelection(scope), "sharing-exposure-remediation"),
    );
    assert.ok(full.projectedScore !== null && trimmed.projectedScore !== null);
    assert.ok(
      (trimmed.projectedScore as number) < (full.projectedScore as number),
      "the summary must show the cost of the scope decision",
    );
  });

  it("projects 68 on the full designed scope", () => {
    // mean(72, 61, 58, 79, 68, 70) = 68
    assert.equal(computeTotals(scope, defaultSelection(scope)).projectedScore, 68);
  });

  it("falls back to today's score for every dropped phase", () => {
    let sel = defaultSelection(scope);
    scope.phases.forEach((p) => {
      sel = togglePhase(scope, sel, p.id);
    });
    // Only the locked Phase 1 remains: mean(72, 34, 29, 57, 46, 44) = 47
    assert.equal(computeTotals(scope, sel).projectedScore, 47);
  });
});

describe("the sticky header cannot drop a line item", () => {
  it("upfront includes the adoption one-off setup fee", () => {
    const sel = pickTier(
      toggleAddon(defaultSelection(scope), "white-glove-adoption"),
      "white-glove-adoption",
      "growth",
    );
    const t = computeTotals(scope, sel);
    assert.equal(t.oneOffUsd, 36200, "remediation total is unchanged");
    assert.equal(t.upfrontUsd, 36200 + 6800, "but what leaves the account today is not");
    assert.equal(t.monthlyUsd, 1480 + 400, "and the recurring half is counted too");
    assert.equal(t.addonLines.length, 1);
    assert.equal(t.addonLines[0].tier.id, "growth");
  });

  it("both figures reflect the same selection set at every step", () => {
    let sel = defaultSelection(scope);
    const steps = [
      () => toggleAddon(sel, "white-glove-adoption"),
      () => pickTier(sel, "white-glove-adoption", "enterprise"),
      () => toggleAddon(sel, "architect-retainer"),
      () => toggleAddon(sel, "tenant-monitoring"),
      () => togglePhase(scope, sel, "drift-baseline-handover"),
    ];
    for (const step of steps) {
      sel = step();
      const t = computeTotals(scope, sel);
      const expectedUpfront =
        t.oneOffUsd + t.addonLines.reduce((s, l) => s + l.tier.upfrontUsd, 0);
      assert.equal(t.upfrontUsd, expectedUpfront);
      assert.ok(t.monthlyUsd >= 0 && Number.isFinite(t.monthlyUsd));
    }
  });

  it("picking a tier switches the service on — clicking a price is intent to buy", () => {
    const sel = pickTier(defaultSelection(scope), "white-glove-adoption", "essential");
    assert.equal(sel.addons["white-glove-adoption"], true);
    assert.equal(computeTotals(scope, sel).upfrontUsd, 36200 + 2400);
  });

  it("a switched-off service contributes nothing even with a tier selected", () => {
    const sel = toggleAddon(defaultSelection(scope), "tenant-monitoring");
    const t = computeTotals(scope, sel);
    assert.equal(t.monthlyUsd, 0);
    assert.equal(t.recurringNames.length, 0);
  });
});

describe("phased schedule", () => {
  it("deposits the configured share and spreads the rest evenly", () => {
    const sel = defaultSelection(scope);
    const rows = phasedSchedule(scope, sel, PREVIEW_DEPOSIT_PCT);
    const t = computeTotals(scope, sel);

    assert.equal(rows[0].when, "Deposit — today");
    assert.equal(rows[0].amountUsd, 36200 * 0.4);

    const total = rows.reduce((s, r) => s + r.amountUsd, 0);
    assert.ok(
      Math.abs(total - t.oneOffUsd) < 0.01,
      `the schedule must add back up to the remediation total (got ${total})`,
    );
  });

  it("details the first three phases and groups the tail", () => {
    const rows = phasedSchedule(scope, defaultSelection(scope), 40);
    assert.equal(rows.length, 5, "deposit + 3 detailed + 1 grouped");
    assert.match(rows[1].when, /^On Phase 1 sign-off — Identity & Access Hardening$/);
    assert.match(rows[4].when, /^On Phases 4–6 sign-off$/);
  });

  it("names a single trailing phase rather than grouping one row", () => {
    let sel = defaultSelection(scope);
    sel = togglePhase(scope, sel, "adoption-enablement");
    sel = togglePhase(scope, sel, "drift-baseline-handover");
    const rows = phasedSchedule(scope, sel, 40);
    assert.equal(rows.length, 5, "deposit + 4 phases, the last named individually");
    assert.match(rows[4].when, /^On Phase 4 sign-off — Licence Rationalisation$/);
  });

  it("nothing charges ahead of delivered work — every later row is price x (1-pct)", () => {
    const rows = phasedSchedule(scope, defaultSelection(scope), 40);
    assert.ok(Math.abs(rows[1].amountUsd - 6400 * 0.6) < 0.01);
    assert.ok(Math.abs(rows[2].amountUsd - 9800 * 0.6) < 0.01);
    assert.ok(Math.abs(rows[3].amountUsd - 8600 * 0.6) < 0.01);
    assert.ok(Math.abs(rows[4].amountUsd - (3200 + 5400 + 2800) * 0.6) < 0.01);
  });

  it("clamps a nonsense deposit percentage", () => {
    const t = computeTotals(scope, defaultSelection(scope));
    assert.equal(depositAmountUsd(t, -20), 0);
    assert.equal(depositAmountUsd(t, 400), t.oneOffUsd);
  });

  it("a 100% deposit leaves nothing to invoice later", () => {
    const rows = phasedSchedule(scope, defaultSelection(scope), 100);
    assert.equal(rows[0].amountUsd, 36200);
    rows.slice(1).forEach((r) => assert.equal(r.amountUsd, 0));
  });
});

describe("formatting", () => {
  it("renders whole-dollar totals", () => {
    assert.equal(money(36200), "$36,200");
    assert.equal(money(14480), "$14,480");
    assert.equal(money(3840.4), "$3,840");
  });

  it("says something honest when nothing recurs", () => {
    assert.equal(monthlyLabel(0), "nothing recurring");
    assert.equal(monthlyLabel(1480), "$1,480/mo");
    assert.equal(recurringLabel([]), "No optional services added");
    assert.equal(
      recurringLabel(["Tenant Monitoring", "Architect Retainer · 8 hours a month"]),
      "Tenant Monitoring + Architect Retainer · 8 hours a month, cancel with 30 days",
    );
  });

  it("labels the scope count and duration", () => {
    assert.equal(phaseCountLabel(4, 6), "4 of 6 phases");
    assert.equal(weeksLabel(12), "approx. 12 weeks");
  });
});

describe("the live pay-in-full discount", () => {
  const ACTIVE = {
    active: true,
    discountedTotal: 34390,
    savings: 1810,
    variant: "percentage_off",
    discountPct: 5,
  } as const;

  it("reads a live offer straight off the wire, recomputing nothing", () => {
    // Every figure is the server's. If this function ever derives one instead of
    // reading it, the screen can quote a total Stripe will not charge.
    const offer = payInFullOfferFromWire(ACTIVE, 36200, false);
    assert.deepEqual(offer, {
      originalUsd: 36200,
      discountedUsd: 34390,
      savingsUsd: 1810,
      variant: "percentage_off",
      discountPct: 5,
    });
  });

  it("carries the waiver variant through as itself, never as a percentage", () => {
    const offer = payInFullOfferFromWire(
      { active: true, discountedTotal: 34000, savings: 2200, variant: "adjustments_waived", discountPct: null },
      36200,
      false,
    );
    assert.equal(offer?.variant, "adjustments_waived");
    assert.equal(offer?.discountPct, null);
  });

  it("never offers a discount on the design preview", () => {
    // The preview has no coupon row and no SOW window behind it — a saving shown
    // there is a number no customer will ever be charged.
    assert.equal(payInFullOfferFromWire(ACTIVE, 36200, true), null);
  });

  it("refuses anything the server did not mark active", () => {
    assert.equal(payInFullOfferFromWire({ ...ACTIVE, active: false }, 36200, false), null);
    assert.equal(payInFullOfferFromWire({ ...ACTIVE, active: undefined }, 36200, false), null);
    assert.equal(payInFullOfferFromWire(null, 36200, false), null);
    assert.equal(payInFullOfferFromWire(undefined, 36200, false), null);
  });

  it("refuses a malformed or zero saving rather than printing a fake one", () => {
    assert.equal(payInFullOfferFromWire({ ...ACTIVE, savings: 0 }, 36200, false), null);
    assert.equal(payInFullOfferFromWire({ ...ACTIVE, savings: -50 }, 36200, false), null);
    assert.equal(payInFullOfferFromWire({ ...ACTIVE, savings: null }, 36200, false), null);
    assert.equal(payInFullOfferFromWire({ ...ACTIVE, discountedTotal: null }, 36200, false), null);
    assert.equal(payInFullOfferFromWire({ ...ACTIVE, savings: Number.NaN }, 36200, false), null);
  });

  it("refuses an unrecognised variant instead of defaulting to the percentage copy", () => {
    // Defaulting here would describe an adjustments waiver — or some future
    // third kind — as a straight percentage off, which is a different promise.
    assert.equal(payInFullOfferFromWire({ ...ACTIVE, variant: "something_new" }, 36200, false), null);
    assert.equal(payInFullOfferFromWire({ ...ACTIVE, variant: null }, 36200, false), null);
  });
});
