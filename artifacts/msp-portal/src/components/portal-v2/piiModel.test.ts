/**
 * piiModel.test.ts — pins the PII Governance derivations to the prototype.
 *
 * The fixture is a faithful transcription, so these assertions aim at the
 * computed values a reader checks by eye: the headline totals, the four stat
 * counts, and the finding filter. Two invariants matter most —
 *
 *   • the headline's "N files" is the SUM of every finding's file count, so a
 *     stat card that disagreed with the list beneath it would refute the page;
 *   • the nav badge the design hardcodes as "3 exposed" must equal the number of
 *     findings reachable from outside — otherwise the badge lies. The count is
 *     asserted here so the literal in portalV2Nav.ts stays honest.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { PII_GOVERNANCE } from "./piiData";
import {
  piiDriftVerdict,
  piiExposedCount,
  piiFilesText,
  piiFilterFindings,
  piiHeadSub,
  piiHeadline,
  piiHighCount,
  piiHitsText,
  piiLabelText,
  piiSourceBarPct,
  piiStats,
  piiTotalFiles,
  piiUnlabelledCount,
} from "./piiModel";

const PII = PII_GOVERNANCE;

describe("pii headline totals", () => {
  it("sums every finding's file count", () => {
    // 214 + 96 + 11 + 340 + 88 + 1240
    assert.equal(piiTotalFiles(PII), 1989);
  });

  it("renders the headline with the thousands separator and the exposed count", () => {
    assert.equal(
      piiHeadline(PII),
      "1,989 files hold personal data. 3 locations can be reached from outside.",
    );
  });

  it("lowercases the cadence into the sub-line", () => {
    assert.ok(piiHeadSub(PII).startsWith("Discovery runs daily across"));
  });
});

describe("pii stat counts", () => {
  it("counts High severity, exposed, unlabelled and the total", () => {
    assert.equal(piiHighCount(PII), 3);
    assert.equal(piiExposedCount(PII), 3);
    assert.equal(piiUnlabelledCount(PII), 6);
    assert.equal(PII.findings.length, 6);
  });

  it("builds the four cards in the prototype's order with computed values", () => {
    const stats = piiStats(PII);
    assert.deepEqual(
      stats.map((s) => s.key),
      ["High", "exposed", "unlabelled", "all"],
    );
    assert.deepEqual(
      stats.map((s) => s.value),
      ["3", "3", "6", "6"],
    );
  });

  it("keeps the hardcoded '3 exposed' nav badge honest", () => {
    // portalV2Nav.ts carries the design's literal badge "3 exposed"; it must
    // equal the number of findings reachable from outside.
    assert.equal(piiExposedCount(PII), 3);
  });
});

describe("pii finding filter", () => {
  it("shows all findings for null and for 'all'", () => {
    assert.equal(piiFilterFindings(PII, null).length, 6);
    assert.equal(piiFilterFindings(PII, "all").length, 6);
  });

  it("filters to High severity", () => {
    const rows = piiFilterFindings(PII, "High");
    assert.deepEqual(
      rows.map((f) => f.id),
      ["PII-01", "PII-02", "PII-03"],
    );
  });

  it("filters to reachable-outside", () => {
    const rows = piiFilterFindings(PII, "exposed");
    assert.deepEqual(
      rows.map((f) => f.id),
      ["PII-01", "PII-02", "PII-05"],
    );
  });

  it("filters to unlabelled — every finding, because no label is published", () => {
    assert.equal(piiFilterFindings(PII, "unlabelled").length, 6);
  });
});

describe("pii row text", () => {
  it("formats the file count with a separator", () => {
    assert.equal(piiFilesText(PII.findings[0]), "214 files");
    assert.equal(piiFilesText(PII.findings[5]), "1,240 files");
  });

  it("labels every finding as having no label", () => {
    assert.ok(PII.findings.every((f) => piiLabelText(f) === "No label"));
  });

  it("formats a hit count with a separator", () => {
    assert.equal(piiHitsText(1104), "1,104");
  });
});

describe("pii source bars", () => {
  it("scales each source against the busiest one (2,140)", () => {
    assert.equal(piiSourceBarPct(2140), 100);
    assert.equal(piiSourceBarPct(780), 36);
    assert.equal(piiSourceBarPct(361), 17);
    assert.equal(piiSourceBarPct(131), 6);
  });
});

describe("pii drift verdict", () => {
  it("reads the CR when there is one, and calls out when there is not", () => {
    assert.equal(piiDriftVerdict(""), "No change request behind it");
    assert.equal(piiDriftVerdict("CR-0087"), "Approved change");
  });
});
