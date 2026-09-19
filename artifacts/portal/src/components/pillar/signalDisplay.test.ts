import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PillarSignalCardWire } from "./types.ts";
import {
  SIGNAL_TIER_DISPLAY,
  relativeTime,
  signalBars,
  signalDeltaText,
  signalSubText,
  signalValueFontSize,
  signalValueText,
  unavailableCopy,
} from "./pillarDisplay.ts";

const card = (over: Partial<PillarSignalCardWire> = {}): PillarSignalCardWire => ({
  checkKey: "a:b",
  label: "A card",
  icon: "users",
  span: 4,
  tier: "good",
  format: "count",
  value: 5,
  text: null,
  delta: null,
  history: 2,
  collectedAt: null,
  ...over,
});

describe("SIGNALS card display (Git #4578)", () => {
  it("shows the real number or text, and a dash only for an unmeasurable card", () => {
    assert.equal(signalValueText(card({ value: 1204 })), "1,204");
    assert.equal(signalValueText(card({ value: 38, format: "percent" })), "38%");
    assert.equal(signalValueText(card({ value: 18, text: "18 / 18" })), "18 / 18");
    assert.equal(signalValueText(card({ value: null, text: "on" })), "on");
    assert.equal(signalValueText(card({ tier: "na", value: null, unavailableReason: "license_gap" })), "—");
  });

  it("a REAL zero renders as 0, not as the unmeasurable dash", () => {
    assert.equal(signalValueText(card({ value: 0 })), "0");
  });

  it("names the licence feature or Microsoft service the scan reported, not a bare 'unavailable'", () => {
    assert.equal(
      signalSubText(card({ tier: "na", value: null, unavailableReason: "license_gap", licenseFeature: "Microsoft Entra ID P1" })),
      "Needs Microsoft Entra ID P1",
    );
    assert.equal(
      signalSubText(card({ tier: "na", value: null, unavailableReason: "service_not_configured", serviceName: "Microsoft Intune" })),
      "Microsoft Intune did not answer for this tenant",
    );
    assert.equal(signalSubText(card({ tier: "na", value: null, unavailableReason: "inactive_in_catalog" })), "inactive in catalog — can never run");
    assert.equal(signalSubText(card({ tier: "na", value: null, unavailableReason: "check_error" })), "the check errored — no data, never zero");
  });

  it("a measured card shows its own caption, and none when it has none", () => {
    assert.equal(signalSubText(card({ sub: "of 18 teams" })), "of 18 teams");
    assert.equal(signalSubText(card()), null);
  });

  it("delta: +n, ±0, -n, and nothing without a real previous value", () => {
    assert.deepEqual(signalDeltaText(card({ delta: 2 })), { text: "+2", flat: false });
    assert.deepEqual(signalDeltaText(card({ delta: 0 })), { text: "±0", flat: true });
    assert.deepEqual(signalDeltaText(card({ delta: -1 })), { text: "-1", flat: false });
    assert.equal(signalDeltaText(card({ delta: null })), null);
  });

  it("history bars: one filled bar per stored observation, dashes for the rest and for an unmeasurable card", () => {
    assert.deepEqual(signalBars(card({ history: 2 })).map((b) => b.filled), [true, true, false, false, false]);
    assert.equal(signalBars(card({ history: 9 })).filter((b) => b.filled).length, 5);
    assert.equal(signalBars(card({ tier: "na", value: null, history: 4 })).some((b) => b.filled), false);
  });

  it("has a presentation for every tier; unmeasured and ungraded are never worded as covered", () => {
    for (const tier of ["good", "meh", "bad", "na", "ungraded"] as const) assert.ok(SIGNAL_TIER_DISPLAY[tier].status);
    assert.equal(SIGNAL_TIER_DISPLAY.good.status, "Fully covered");
    assert.equal(SIGNAL_TIER_DISPLAY.na.status, "Can't be measured");
    assert.notEqual(SIGNAL_TIER_DISPLAY.ungraded.status, "Fully covered");
  });

  it("uses the design's three figure sizes", () => {
    assert.equal(signalValueFontSize("18"), "22px");
    assert.equal(signalValueFontSize("18 / 18"), "15px");
    assert.equal(signalValueFontSize("12,345"), "18px");
  });

  it("has authored copy for the signals grid's own reasons", () => {
    for (const r of [
      "inactive_in_catalog",
      "never_run",
      "check_error",
      "gate_skipped",
      "security_defaults_active",
      "no_scalar_defined",
      "non_numeric_value",
    ]) {
      assert.notEqual(unavailableCopy(r), r.replace(/_/g, " "), r);
    }
  });

  it("relative time reads like the design's '2 hours ago'", () => {
    const now = Date.parse("2026-09-18T12:00:00Z");
    assert.equal(relativeTime("2026-09-18T10:00:00Z", now), "2 hours ago");
    assert.equal(relativeTime("2026-09-18T11:59:30Z", now), "just now");
    assert.equal(relativeTime("2026-09-17T12:00:00Z", now), "1 day ago");
  });
});
