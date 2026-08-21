/**
 * alertPrefsModel.test.ts — pins the presets, the "Balanced is the seed"
 * invariant, and the dest/custom derivations against the prototype's numbers.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ALERT_CATS, ALERT_CUSTOM_DESC, ALERT_PRESETS } from "./alertPrefsData";
import {
  ALERT_PREFS_SEED,
  ALERT_SELECT_OPTIONS,
  applyPreset,
  catDestValue,
  patchPref,
  presetDesc,
  presetLabel,
} from "./alertPrefsModel";

describe("fixture", () => {
  it("has 7 categories and 3 presets", () => {
    assert.equal(ALERT_CATS.length, 7);
    assert.equal(ALERT_PRESETS.length, 3);
  });

  it("marks only support as always-email", () => {
    assert.deepEqual(ALERT_CATS.filter((c) => c.alwaysEmail).map((c) => c.key), ["support"]);
  });
});

describe("seed == Balanced", () => {
  it("opens on the Balanced preset exactly", () => {
    assert.deepEqual(ALERT_PREFS_SEED, applyPreset("balanced"));
    assert.equal(ALERT_PREFS_SEED.findings.threshold, "high");
    assert.equal(ALERT_PREFS_SEED.remediation.email, false);
  });
});

describe("presets", () => {
  it("close turns email on for every category at the lowest threshold", () => {
    const p = applyPreset("close");
    assert.ok(Object.values(p).every((x) => x.on && x.email));
    assert.equal(p.findings.threshold, "any");
  });

  it("quiet turns remediation off entirely", () => {
    const p = applyPreset("quiet");
    assert.equal(p.remediation.on, false);
    assert.equal(p.billing.threshold, "money");
  });
});

describe("posture select", () => {
  it("lists the three presets then Custom", () => {
    assert.deepEqual(
      ALERT_SELECT_OPTIONS.map((o) => o.value),
      ["close", "balanced", "quiet", "custom"],
    );
  });

  it("describes a preset and falls back to the custom copy", () => {
    assert.equal(presetDesc("balanced"), ALERT_PRESETS[1].desc);
    assert.equal(presetDesc("custom"), ALERT_CUSTOM_DESC);
    assert.equal(presetLabel("quiet"), "Only when something is wrong");
    assert.equal(presetLabel("custom"), "Custom");
  });
});

describe("category derivations", () => {
  it("reads the dest select off the email flag", () => {
    assert.equal(catDestValue({ on: true, email: true, mode: "daily", threshold: "all" }), "email");
    assert.equal(catDestValue({ on: true, email: false, mode: "daily", threshold: "all" }), "inapp");
  });

  it("patching one category leaves the others untouched", () => {
    const next = patchPref(ALERT_PREFS_SEED, "findings", { on: false });
    assert.equal(next.findings.on, false);
    assert.deepEqual(next.drift, ALERT_PREFS_SEED.drift);
    // original not mutated
    assert.equal(ALERT_PREFS_SEED.findings.on, true);
  });
});
