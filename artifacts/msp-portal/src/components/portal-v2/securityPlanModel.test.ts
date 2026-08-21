/**
 * securityPlanModel.test.ts — pins the Security Plan derivations to the prototype.
 *
 * The page's argument is that the plan reflects the tenant, so its headline
 * numbers are derived, not stated. These assertions guard the arithmetic that a
 * reader checks against the coloured rows: the met/partly/not-met split, the
 * percentage, the verdict sentence, and the per-section gap badge. If any of
 * these drifted from the rows, the plan would visibly contradict itself.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { SECURITY_PLAN } from "./securityPlanData";
import {
  spAllRows,
  spCounts,
  spPct,
  spSectionGaps,
  spSelectedSection,
  spVerdict,
} from "./securityPlanModel";

const PLAN = SECURITY_PLAN;

describe("security plan tallies", () => {
  it("flattens to 39 requirements across ten sections", () => {
    assert.equal(spAllRows(PLAN).length, 39);
    assert.equal(PLAN.sections.length, 9); // sections 02..10
  });

  it("counts met, partly met, and not met so they sum to the total", () => {
    const c = spCounts(PLAN);
    assert.deepEqual(c, { met: 20, partial: 7, gap: 12, total: 39 });
    assert.equal(c.met + c.partial + c.gap, c.total);
  });

  it("computes the met percentage the prototype's way", () => {
    // round(20 / 39 * 100) = 51
    assert.equal(spPct(PLAN), 51);
  });

  it("states the verdict from the gap and partial counts", () => {
    assert.equal(
      spVerdict(PLAN),
      "12 requirements in this plan are not met, and 7 are only partly met.",
    );
  });
});

describe("security plan section gaps", () => {
  it("counts not-met rows per section for the nav badge", () => {
    const byKey = Object.fromEntries(PLAN.sections.map((s) => [s.k, spSectionGaps(s)]));
    assert.deepEqual(byKey, {
      governance: 1,
      architecture: 3,
      risk: 1,
      change: 2,
      pii: 2,
      ops: 1,
      release: 2,
      audit: 0,
      ai: 0,
    });
  });
});

describe("security plan section selection", () => {
  it("selects by key and defaults an unknown key to the first section", () => {
    assert.equal(spSelectedSection(PLAN, "pii").label, "PII governance");
    assert.equal(spSelectedSection(PLAN, "does-not-exist").k, "governance");
  });
});
