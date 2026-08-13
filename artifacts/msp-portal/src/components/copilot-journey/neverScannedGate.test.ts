import { test } from "node:test";
import assert from "node:assert/strict";

import { shouldBlockNeverScanned } from "./neverScannedGate.ts";

const BASE = {
  loaded: true,
  isPreview: false,
  everScanned: false,
  running: false,
  awaitingAutoScan: false,
};

test("#539: never blocks before the first scan-status response has loaded", () => {
  // The exact reproduction: initial render, `scanData` is still `null`, so
  // `everScanned` and `running` both read `false` — indistinguishable from a
  // genuinely never-scanned tenant unless `loaded` is checked first.
  assert.equal(shouldBlockNeverScanned({ ...BASE, loaded: false }), false);
  assert.equal(
    shouldBlockNeverScanned({ ...BASE, loaded: false, everScanned: false, running: false }),
    false,
  );
});

test("#539: a customer with an active scan is never blocked, loaded or not", () => {
  assert.equal(shouldBlockNeverScanned({ ...BASE, loaded: false, running: true }), false);
  assert.equal(shouldBlockNeverScanned({ ...BASE, loaded: true, running: true }), false);
});

test("#539: a customer with a completed scan is never blocked, loaded or not", () => {
  assert.equal(shouldBlockNeverScanned({ ...BASE, loaded: false, everScanned: true }), false);
  assert.equal(shouldBlockNeverScanned({ ...BASE, loaded: true, everScanned: true }), false);
});

test("#536: a genuinely never-scanned real customer is blocked once loaded", () => {
  assert.equal(shouldBlockNeverScanned({ ...BASE, loaded: true }), true);
});

test("awaiting an auto-triggered scan is never blocked", () => {
  assert.equal(shouldBlockNeverScanned({ ...BASE, loaded: true, awaitingAutoScan: true }), false);
});

test("a design preview is never blocked, regardless of loaded", () => {
  assert.equal(shouldBlockNeverScanned({ ...BASE, loaded: true, isPreview: true }), false);
  assert.equal(shouldBlockNeverScanned({ ...BASE, loaded: false, isPreview: true }), false);
});
