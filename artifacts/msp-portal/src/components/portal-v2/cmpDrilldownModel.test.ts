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
  cmpObligationColor,
  cmpObligationScopeMuted,
  cmpSevMeta,
} from "./cmpDrilldownModel";

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
