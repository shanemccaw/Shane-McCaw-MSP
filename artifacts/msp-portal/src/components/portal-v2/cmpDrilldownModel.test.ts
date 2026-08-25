/**
 * cmpDrilldownModel.test.ts — pins the Compliance drill-down derivations.
 *
 * The header counts and the tone→colour map are the two things a port silently
 * gets wrong: an off-by-one count reads as "one gap already fixed", and a wrong
 * obligation colour turns an out-of-scope row into a red finding.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CMP_ACCEPTED, CMP_FINDINGS } from "./cmpDrilldownData";
import {
  CMP_ACCEPTED_COUNT,
  CMP_OPEN_COUNT,
  cmpAcceptedMeta,
  cmpFindingRowFromLive,
  cmpFindingRowsFromLive,
  cmpObligationColor,
  cmpObligationScopeMuted,
  cmpSevMeta,
} from "./cmpDrilldownModel";
import type { PortalV2Finding } from "./portalV2Model";

describe("compliance counts", () => {
  it("match the fixture lengths", () => {
    assert.equal(CMP_OPEN_COUNT, 6);
    assert.equal(CMP_OPEN_COUNT, CMP_FINDINGS.length);
    assert.equal(CMP_ACCEPTED_COUNT, 2);
    assert.equal(CMP_ACCEPTED_COUNT, CMP_ACCEPTED.length);
  });
});

describe("cmpSevMeta", () => {
  it("labels high as a Material gap and medium as a Gap", () => {
    assert.equal(cmpSevMeta("high").label, "Material gap");
    assert.equal(cmpSevMeta("medium").label, "Gap");
    assert.equal(cmpSevMeta("high").c, "#f87171");
  });
});

describe("cmpAcceptedMeta", () => {
  it("produces the four ordered meta pairs from a decision", () => {
    const meta = cmpAcceptedMeta(CMP_ACCEPTED[0]);
    assert.deepEqual(
      meta.map((m) => m.k),
      ["Approved by", "Approved", "Next review", "Risk register"],
    );
    assert.equal(meta[0].v, "General Counsel");
    assert.equal(meta[3].v, "RR-2026-011");
  });
});

describe("cmpObligation tone", () => {
  it("maps tones to their state colour", () => {
    assert.equal(cmpObligationColor("red"), "#f87171");
    assert.equal(cmpObligationColor("green"), "#34d399");
    assert.equal(cmpObligationColor("slate"), "#64748b");
  });
  it("only the slate tone is the muted out-of-scope style", () => {
    assert.equal(cmpObligationScopeMuted("slate"), true);
    assert.equal(cmpObligationScopeMuted("red"), false);
  });
});

describe("cmpFindingRowFromLive (#1255 widened finding -> Open gaps row)", () => {
  it("maps a fully-populated live finding, including its curated evidence", () => {
    const finding: PortalV2Finding = {
      severity: "critical",
      checkKey: "compliance:missing-labels",
      title: "No sensitivity labels are published",
      rankWeight: 40,
      description: "0 of 4 labels are published to any user.",
      recommendation: { action: "Publish the four labels", estimatedEffort: "2 hours" },
      evidence: { disabledLabelNames: ["Public", "Internal", "Confidential", "Highly Confidential"] },
      obligation: "Sensitivity labels should be published and enabled.",
      whyItMatters: "A disabled label can't classify or protect anything.",
    };
    const row = cmpFindingRowFromLive(finding);
    assert.equal(row.id, "compliance:missing-labels");
    assert.equal(row.sev, "high");
    assert.equal(row.obligation, "Sensitivity labels should be published and enabled.");
    assert.equal(row.why, "A disabled label can't classify or protect anything.");
    assert.deepEqual(row.evidence, [
      { k: "Disabled labels", v: "Public, Internal, Confidential, Highly Confidential" },
    ]);
    assert.equal(row.fixKey, "compliance:missing-labels");
    assert.equal(row.fixLabel, "Publish the four labels");
    assert.equal(row.fixSub, "Estimated effort: 2 hours");
  });

  it("maps warning severity to the Gap (medium) label", () => {
    const finding: PortalV2Finding = {
      severity: "warning",
      checkKey: "compliance:dlp-incidents",
      title: "DLP incidents have gone unreviewed",
    };
    assert.equal(cmpFindingRowFromLive(finding).sev, "medium");
  });

  it("never fabricates a narrative for a checkKey with no authored obligation copy", () => {
    const finding: PortalV2Finding = {
      severity: "warning",
      checkKey: "compliance:eeeu-site-sharing",
      title: "Partial coverage — some items could not be scanned",
    };
    const row = cmpFindingRowFromLive(finding);
    assert.equal(row.obligation, "No obligation citation authored for this check yet");
    assert.match(row.obligationText, /has been authored for this check yet/);
    assert.equal(row.why, "No further narrative is available for this finding yet.");
    assert.deepEqual(row.evidence, [
      { k: "Where this comes from", v: "Detected by the last scan; no further detail captured." },
    ]);
    assert.equal(row.fixKey, "compliance:eeeu-site-sharing");
    assert.equal(row.fixLabel, "Apply the recommended change");
  });

  it("prefers the finding's own description as evidence context over a bare placeholder", () => {
    const finding: PortalV2Finding = {
      severity: "critical",
      checkKey: "compliance:some-future-check",
      title: "A future check",
      description: "12 of 40 policies fail this check.",
    };
    const row = cmpFindingRowFromLive(finding);
    assert.equal(row.why, "12 of 40 policies fail this check.");
    assert.deepEqual(row.evidence, [
      { k: "Where this comes from", v: "12 of 40 policies fail this check." },
    ]);
  });

  it("humanises an evidence key outside the curated label catalogue rather than dropping it", () => {
    const finding: PortalV2Finding = {
      severity: "critical",
      checkKey: "compliance:some-future-check",
      title: "A future check",
      evidence: { someNewFieldNames: ["A", "B"] },
    };
    const row = cmpFindingRowFromLive(finding);
    assert.deepEqual(row.evidence, [{ k: "Some new field names", v: "A, B" }]);
  });

  it("cmpFindingRowsFromLive maps every finding in server order", () => {
    const findings: PortalV2Finding[] = [
      { severity: "critical", checkKey: "compliance:missing-labels", title: "A" },
      { severity: "warning", checkKey: "compliance:label-errors", title: "B" },
    ];
    const rows = cmpFindingRowsFromLive(findings);
    assert.deepEqual(rows.map((r) => r.id), ["compliance:missing-labels", "compliance:label-errors"]);
  });
});
