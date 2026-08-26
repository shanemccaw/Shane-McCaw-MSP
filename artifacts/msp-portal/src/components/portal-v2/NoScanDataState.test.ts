/**
 * NoScanDataState.test.ts — pins the honest "no scan data" convention (Git
 * #1339): the em dash, the canonical phrase, and the pure predicate/formatter
 * every numeric slot routes through. Guards that a missing value can never
 * render as a real-looking 0 / NaN, and that the copy is not reworded.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  NO_DATA_DASH,
  NO_SCAN_DATA_LABEL,
  hasScanValue,
  noScanValue,
} from "./NoScanDataState";

describe("no-scan-data constants", () => {
  it("uses the em dash (U+2014), not a hyphen or en dash", () => {
    assert.equal(NO_DATA_DASH, "—");
  });

  it("keeps the canonical phrase verbatim — copy is final", () => {
    assert.equal(NO_SCAN_DATA_LABEL, "No scan data available");
  });
});

describe("hasScanValue", () => {
  it("is true only for a real, finite number", () => {
    assert.equal(hasScanValue(0), true);
    assert.equal(hasScanValue(62), true);
    assert.equal(hasScanValue(-3), true);
  });

  it("is false for null / undefined / NaN / Infinity", () => {
    assert.equal(hasScanValue(null), false);
    assert.equal(hasScanValue(undefined), false);
    assert.equal(hasScanValue(Number.NaN), false);
    assert.equal(hasScanValue(Number.POSITIVE_INFINITY), false);
  });
});

describe("noScanValue", () => {
  it("prints the em dash for a missing value — never 0 or NaN", () => {
    assert.equal(noScanValue(null), NO_DATA_DASH);
    assert.equal(noScanValue(undefined), NO_DATA_DASH);
    assert.equal(noScanValue(Number.NaN), NO_DATA_DASH);
  });

  it("renders a real 0 as '0', not as the dash — 0 is a genuine measurement", () => {
    assert.equal(noScanValue(0), "0");
  });

  it("thousands-groups a real number by default", () => {
    assert.equal(noScanValue(1940), (1940).toLocaleString());
  });

  it("honours a custom formatter for a real value only", () => {
    const pct = (n: number) => `${n}%`;
    assert.equal(noScanValue(99, pct), "99%");
    assert.equal(noScanValue(null, pct), NO_DATA_DASH);
  });
});
