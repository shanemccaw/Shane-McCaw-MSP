import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DRIFT_STATE_LABEL,
  driftNote,
  formatCents,
  formatPurchasedMultiple,
  ledgerExcludedReason,
  ledgerFootnote,
} from "./pillarDisplay.ts";

describe("Licensing SKU ledger display (Git #4578)", () => {
  it("formats the price column with cents and the waste column without", () => {
    assert.equal(formatCents(2300, true), "$23.00");
    assert.equal(formatCents(0, false), "$0");
    assert.equal(formatCents(84760800, false), "$847,608");
  });

  it("uses the design's chip wording for the server's real exclusion reasons", () => {
    assert.equal(ledgerExcludedReason("zero_price"), "zero price");
    assert.equal(ledgerExcludedReason("no_price_on_file"), "no price on file");
  });

  it("spells out a reason it has no authored copy for instead of hiding it", () => {
    assert.equal(ledgerExcludedReason("some_new_reason"), "some new reason");
  });

  it("formats the purchased multiple", () => {
    assert.equal(formatPurchasedMultiple(10000), "×10,000");
  });

  it("puts the tenant's real priced/total SKU counts in the footnote", () => {
    assert.match(ledgerFootnote(1, 4), /1 of 4 SKUs today/);
  });
});

describe("CONFIG DRIFT BASELINE display (Git #4578)", () => {
  const base = { domainKey: "ca-policy", baselineCapturedAt: "2026-09-16T12:54:01.648Z", deviationCount: 0 };

  it("uses the design's pill wording", () => {
    assert.equal(DRIFT_STATE_LABEL.tracked, "tracked");
    assert.equal(DRIFT_STATE_LABEL.not_comparable, "not comparable");
  });

  it("tracked note keeps the design's sentence and carries the real deviation count", () => {
    const note = driftNote({ ...base, state: "tracked", reason: null });
    assert.match(note, /^Baseline captured Sep 1[5-7], 2026 · 0 deviations since. A drift event appears the moment a tracked setting changes.$/);
    assert.match(driftNote({ ...base, state: "tracked", reason: null, deviationCount: 1 }), /1 deviation since/);
    assert.match(driftNote({ ...base, state: "tracked", reason: null, deviationCount: 3 }), /3 deviations since/);
  });

  it("not comparable keeps the design's honesty sentence and appends the collector's real reason", () => {
    const note = driftNote({ ...base, state: "not_comparable", reason: "gate_not_satisfied" });
    assert.match(note, /^The drift collector can't diff this shape yet — an honest limitation, reported as such rather than papered over./);
    assert.match(note, /Collector's reason: gate not satisfied.$/);
  });

  it("an errored collection is never worded as clean", () => {
    const note = driftNote({ ...base, state: "error", reason: "boom" });
    assert.match(note, /nothing was compared/);
    assert.doesNotMatch(note, /0 deviations/);
  });

  it("does not invent a reason the collector did not record", () => {
    assert.doesNotMatch(driftNote({ ...base, state: "not_comparable", reason: null }), /Collector's reason/);
  });
});
