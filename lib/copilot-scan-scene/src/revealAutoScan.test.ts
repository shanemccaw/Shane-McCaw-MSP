/**
 * revealAutoScan.test.ts — #367: a never-scanned tenant must not fall
 * through to the verdict scene, and a real tenant must never be handed a
 * self-serve trigger that doesn't exist for them.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { decideAutoScan, AUTO_SCAN_UNAVAILABLE_MESSAGE } from "./revealAutoScan.ts";

describe("decideAutoScan", () => {
  it("skips while the scan-status payload has not loaded yet", () => {
    assert.deepEqual(decideAutoScan(null), { kind: "skip" });
  });

  it("skips a returning tenant with results and nothing running (everScanned && !running)", () => {
    assert.deepEqual(
      decideAutoScan({ active: null, everScanned: true, isTestbed: false }),
      { kind: "skip" },
    );
  });

  it("skips a tenant currently mid-scan, testbed or not", () => {
    assert.deepEqual(
      decideAutoScan({ active: { runId: "r1" }, everScanned: false, isTestbed: false }),
      { kind: "skip" },
    );
    assert.deepEqual(
      decideAutoScan({ active: { runId: "r1" }, everScanned: true, isTestbed: true }),
      { kind: "skip" },
    );
  });

  it("triggers a real scan for a never-scanned TESTBED tenant", () => {
    assert.deepEqual(
      decideAutoScan({ active: null, everScanned: false, isTestbed: true }),
      { kind: "trigger" },
    );
  });

  it("reports unavailable for a never-scanned REAL tenant, rather than inventing a trigger", () => {
    assert.deepEqual(
      decideAutoScan({ active: null, everScanned: false, isTestbed: false }),
      { kind: "unavailable", message: AUTO_SCAN_UNAVAILABLE_MESSAGE },
    );
  });
});
