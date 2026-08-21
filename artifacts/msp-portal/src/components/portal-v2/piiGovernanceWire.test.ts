/**
 * piiGovernanceWire.test.ts — the pure normalisation + derivations behind the
 * PII Governance page's real-data view.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  toPiiGovernanceView,
  piiSignalStats,
  piiSignalHeadline,
  type WirePiiGovernance,
} from "./piiGovernanceWire";

const EMPTY_ERROR: WirePiiGovernance = {
  status: "Not collected",
  scanned: null,
  cadence: "Daily",
  findings: [],
  coverage: [
    {
      key: "compliance:missing-labels",
      label: "Sensitivity labels defined but disabled",
      kind: "Sensitivity labels",
      status: "error",
      reason: "Could not establish a Security & Compliance session for the target tenant.",
      count: null,
      collectedAt: null,
    },
  ],
};

const LIVE: WirePiiGovernance = {
  status: "At risk",
  scanned: "2026-08-19T08:04:00.000Z",
  cadence: "Daily",
  findings: [
    {
      id: "compliance:missing-labels",
      label: "Sensitivity labels defined but disabled",
      kind: "Sensitivity labels",
      sev: "High",
      count: 3,
      unit: "labels disabled",
      detail: "Multiple sensitivity labels are defined but disabled",
      names: ["Confidential", "Internal"],
      collectedAt: "2026-08-19T08:04:00.000Z",
    },
    {
      id: "compliance:weak-dlp-policies",
      label: "DLP policies not actively enforcing",
      kind: "Data loss prevention",
      sev: "Medium",
      count: 1,
      unit: "policies not enforcing",
      detail: "One or more DLP policies are not actively enforcing",
      names: [],
      collectedAt: "2026-08-19T08:04:00.000Z",
    },
  ],
  coverage: [],
};

describe("toPiiGovernanceView", () => {
  it("formats the scan timestamp as en-GB UTC long date and passes findings through", () => {
    const v = toPiiGovernanceView(LIVE);
    assert.equal(v.scanned, "19 August 2026");
    assert.equal(v.findings.length, 2);
    assert.equal(v.findings[0].collected, "19 August 2026");
    assert.deepEqual(v.findings[0].names, ["Confidential", "Internal"]);
  });

  it("null scan time stays null (never Invalid Date)", () => {
    const v = toPiiGovernanceView(EMPTY_ERROR);
    assert.equal(v.scanned, null);
    assert.equal(v.coverage[0].status, "error");
    assert.ok(v.coverage[0].reason?.includes("Security & Compliance"));
  });
});

describe("piiSignalStats", () => {
  it("counts High / Medium findings and unavailable checks", () => {
    const stats = piiSignalStats(toPiiGovernanceView(LIVE));
    const byKey = Object.fromEntries(stats.map((s) => [s.key, s.value]));
    assert.equal(byKey.high, "1");
    assert.equal(byKey.medium, "1");
    assert.equal(byKey.signals, "2");
    assert.equal(byKey.unavailable, "0");
  });

  it("counts every non-ok coverage entry as unavailable", () => {
    const stats = piiSignalStats(toPiiGovernanceView(EMPTY_ERROR));
    assert.equal(Object.fromEntries(stats.map((s) => [s.key, s.value])).unavailable, "1");
  });
});

describe("piiSignalHeadline", () => {
  it("names the high count when a high signal is present", () => {
    assert.equal(
      piiSignalHeadline(toPiiGovernanceView(LIVE)),
      "2 data-governance signals need attention, 1 of them high.",
    );
  });

  it("distinguishes 'none firing' (some ok) from 'none collected'", () => {
    const someOk = toPiiGovernanceView({
      ...EMPTY_ERROR,
      coverage: [{ ...EMPTY_ERROR.coverage[0], status: "ok", reason: null, count: 0 }],
    });
    assert.ok(piiSignalHeadline(someOk).includes("firing on this tenant right now"));

    const noneCollected = toPiiGovernanceView(EMPTY_ERROR);
    assert.ok(piiSignalHeadline(noneCollected).includes("have been collected for this tenant yet"));
  });
});
