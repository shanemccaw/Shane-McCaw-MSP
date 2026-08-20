/**
 * overviewModel.test.ts — pins the Overview's bar geometry.
 *
 * Every bar on this page is a percentage over a day window. A wrong one renders
 * as a plausible bar in the wrong place, and nothing else on the page
 * contradicts it — the same class of silent-wrong-answer the risk register's
 * weights carry. These cases pin the two behaviours that are easy to lose in a
 * port: unscheduled must stay unscheduled, and a same-day bar must stay visible.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { OV_CR_PIPELINE, OV_POLICY_DECISIONS, PJ_WIN } from "./overviewData";
import { RR_RISKS } from "./riskRegisterData";
import {
  CR_WINDOW,
  MC_WINDOW,
  acceptedRiskLanes,
  crLanes,
  flaggedPolicyCount,
  holdDecisionCount,
  holdLanes,
  mcLanes,
  ovBar,
  pdLanes,
  pillarDelta,
  pillarDeltaLabel,
  pillarDeltaTone,
  pillarStripSub,
  pjPct,
  pjRows,
  sectionCount,
  slippedPhaseCount,
} from "./overviewModel";

describe("ovBar — unscheduled", () => {
  it("treats a null start as unscheduled rather than day zero", () => {
    // CR-0149 is blocked with nobody accountable, so it has no date at all.
    // Drawing it at day 0 would put a blocked change on today's line.
    const bar = ovBar(null, null, -10, 26);
    assert.equal(bar.unscheduled, true);
    assert.equal(bar.width, 0);
  });

  it("marks the one seeded blocked CR unscheduled and nothing else", () => {
    const lanes = crLanes();
    const unscheduled = lanes.filter((l) => l.bar.unscheduled).map((l) => l.key);
    assert.deepEqual(unscheduled, ["CR-0149"]);
  });
});

describe("ovBar — minimum width", () => {
  it("keeps a SAME-DAY bar visible instead of collapsing it to nothing", () => {
    // start === end is the common case (most items land on one day). A naive
    // (end-start) width would be 0 and the bar would disappear.
    const bar = ovBar(5, 5, -10, 26);
    assert.ok(bar.width >= 1.5, `same-day bar must have width, got ${bar.width}`);
  });

  it("floors the width at 1.5% even on a very long window", () => {
    const bar = ovBar(1, 1, 0, 10_000);
    assert.equal(bar.width, 1.5);
  });

  it("still grows a genuinely long bar beyond the floor", () => {
    const bar = ovBar(0, 20, 0, 40);
    assert.ok(bar.width > 40, `a half-window bar should be ~50%, got ${bar.width}`);
  });
});

describe("ovBar — placement", () => {
  it("puts today at the window's own zero point", () => {
    // CR window starts at -10 of 26 days, so today sits at 10/26.
    const bar = ovBar(0, 1, CR_WINDOW.start, CR_WINDOW.len);
    assert.equal(Math.round(bar.todayLeft), Math.round((10 / 26) * 100));
  });

  it("puts today at the left edge on a window that starts today", () => {
    const bar = ovBar(6, 6, MC_WINDOW.start, MC_WINDOW.len);
    assert.equal(bar.todayLeft, 0);
  });

  it("clamps anything before the window to the left edge", () => {
    const bar = ovBar(-500, -400, -10, 26);
    assert.equal(bar.left, 0);
  });

  it("clamps anything past the window to the right edge", () => {
    const bar = ovBar(900, 950, 0, 45);
    assert.equal(bar.left, 100);
  });

  it("spaces the gridlines one per week of the window", () => {
    const bar = ovBar(1, 2, 0, 45);
    assert.equal(bar.weekStepPct, Number(((7 / 45) * 100).toFixed(2)));
  });
});

describe("lanes", () => {
  it("leads a change request's note with its STAGE, so blocked reads as blocked first", () => {
    const blocked = crLanes().find((l) => l.key === "CR-0149");
    assert.ok(blocked);
    assert.match(blocked.note, /^Blocked · /);
  });

  it("omits the separator when a change request has no note", () => {
    const draft = crLanes().find((l) => l.key === "CR-0147");
    assert.ok(draft);
    assert.equal(draft.note, "Draft");
  });

  it("gives every seeded CR a lane", () => {
    assert.equal(crLanes().length, OV_CR_PIPELINE.length);
  });

  it("places the three Microsoft changes in date order across the window", () => {
    const lanes = mcLanes();
    const lefts = lanes.map((l) => l.bar.left);
    assert.deepEqual(lefts, [...lefts].sort((a, b) => a - b));
  });

  it("marks an unsigned policy decision as awaiting approval, not as a date range", () => {
    const proposed = pdLanes().find((l) => l.key === "SEC-A3");
    assert.ok(proposed);
    assert.equal(proposed.dateLabel, "Awaiting approval");
    assert.equal(proposed.bar.unscheduled, true);
  });

  it("gives a signed decision a from-to label", () => {
    const live = pdLanes().find((l) => l.key === "CMP-A1");
    assert.ok(live);
    assert.equal(live.dateLabel, "14 March 2026 → 14 March 2027");
  });

  it("uses the design's FIXED policy bar rather than a to-scale one", () => {
    // These span months to years; a true-to-scale bar on one shared window
    // would collapse them all into the same sliver.
    const live = pdLanes().find((l) => l.key === "CMP-A1");
    assert.ok(live);
    assert.equal(live.bar.left, 56);
    assert.equal(live.bar.width, 34);
  });
});

describe("project gantt", () => {
  it("scales a day to a percentage of the 63-day window", () => {
    assert.equal(pjPct(0), 0);
    assert.equal(Math.round(pjPct(PJ_WIN)), 100);
  });

  it("draws all five phases", () => {
    assert.equal(pjRows().length, 5);
  });

  it("says 'Signed off' on a complete phase rather than counting its tasks", () => {
    const p1 = pjRows().find((r) => r.n === 1);
    assert.equal(p1?.barText, "Signed off");
  });

  it("says 'Blocked' on a blocked phase — NOT '0/3 tasks', which reads as no-progress-yet", () => {
    const p4 = pjRows().find((r) => r.n === 4);
    assert.equal(p4?.status, "blocked");
    assert.equal(p4?.barText, "Blocked");
  });

  it("counts tasks only on a live phase", () => {
    const p3 = pjRows().find((r) => r.n === 3);
    assert.equal(p3?.barText, "2/6 tasks");
    assert.equal(p3?.donePct, 33);
  });

  it("gives a slip band to exactly the two phases that have slipped", () => {
    const slipped = pjRows().filter((r) => r.slip !== null).map((r) => r.n);
    assert.deepEqual(slipped, [4, 5]);
    assert.equal(slippedPhaseCount(), 2);
  });

  it("orders the phases left to right without overlap gaps in the sequence", () => {
    const rows = pjRows();
    for (let i = 1; i < rows.length; i++) {
      assert.ok(rows[i].left >= rows[i - 1].left, "phase bars must run left to right");
    }
  });
});

describe("counts", () => {
  it("flags only the decisions that need someone to look", () => {
    // CMP-A2 is due, GOV-A4 expired. Live and proposed are not flagged.
    assert.equal(flaggedPolicyCount(), 2);
    assert.equal(OV_POLICY_DECISIONS.length, 4);
  });

  it("builds a section count label", () => {
    assert.equal(sectionCount(5, "CRs"), "5 CRs");
    assert.equal(sectionCount(3, "posts"), "3 posts");
  });
});

describe("hold-window lanes", () => {
  // A fixed clock so these assert the derivation, not the wall clock.
  const NOW = new Date("2026-08-20T08:00:00Z");

  it("draws every seeded window", () => {
    assert.equal(holdLanes(NOW).length, 4);
  });

  it("reads a window that has already closed as due", () => {
    const ca01 = holdLanes(NOW).find((l) => l.key === "hold-ca01");
    assert.equal(ca01?.state, "due");
    assert.match(ca01?.tMinus ?? "", /^Closed \d+h ago$/);
  });

  it("offers an early close only on a CLEAR verdict with a day left to save", () => {
    const guest = holdLanes(NOW).find((l) => l.key === "hold-guest");
    assert.equal(guest?.state, "early");
    // The other future window has a `watch` verdict, so it keeps running even
    // though it has far longer left.
    const priv = holdLanes(NOW).find((l) => l.key === "hold-private");
    assert.equal(priv?.state, "running");
  });

  it("floors the progress at 0 and caps it at 100", () => {
    for (const l of holdLanes(NOW)) {
      assert.ok(l.donePct >= 0 && l.donePct <= 100, `${l.key} was ${l.donePct}`);
    }
  });

  it("shows a closed window as fully elapsed", () => {
    const ca01 = holdLanes(NOW).find((l) => l.key === "hold-ca01");
    assert.equal(ca01?.donePct, 100);
  });

  it("counts the windows actually needing a decision", () => {
    // Two due plus one early. The running one is not a decision.
    assert.equal(holdDecisionCount(holdLanes(NOW)), 3);
  });

  it("stays in the same states as the clock moves, because the fixture is relative", () => {
    // The offsets are hours-from-now, so a run a month later reads identically.
    const later = new Date("2026-09-20T08:00:00Z");
    assert.deepEqual(
      holdLanes(later).map((l) => l.state),
      holdLanes(NOW).map((l) => l.state),
    );
  });
});

describe("accepted-risk lanes", () => {
  it("reads the SAME register fixture the Risk Register page renders", () => {
    const lanes = acceptedRiskLanes();
    const acceptedInRegister = RR_RISKS.filter((r) => r.status === "Accepted");
    assert.equal(lanes.length, acceptedInRegister.length);
    assert.equal(lanes.length, 5);
  });

  it("names who accepted it and until when", () => {
    const lane = acceptedRiskLanes()[0];
    assert.match(lane.note, /^Accepted by .+ until .+$/);
  });

  it("labels the acceptance as a date range", () => {
    const lane = acceptedRiskLanes()[0];
    assert.match(lane.dateLabel, / → /);
  });

  it("uses the design's FIXED bar, not a to-scale one", () => {
    // Acceptances run months to years; to-scale on one window collapses them.
    const lane = acceptedRiskLanes()[0];
    assert.equal(lane.bar.left, 6);
    assert.equal(lane.bar.width, 80);
  });
});

describe("the pillar strip is derived from LIVE data", () => {
  it("takes the delta from the last two real checkpoints", () => {
    assert.equal(pillarDelta([70, 66, 62]), -4);
    assert.equal(pillarDelta([60, 63]), 3);
  });

  it("returns NULL rather than 0 when there is no trend to read", () => {
    // One checkpoint is not a trend. Printing "±0" would claim a stable score
    // we have never actually observed.
    assert.equal(pillarDelta([62]), null);
    assert.equal(pillarDelta([]), null);
    assert.equal(pillarDelta(null), null);
    assert.equal(pillarDelta(undefined), null);
  });

  it("formats the delta the way the design does", () => {
    assert.equal(pillarDeltaLabel(3), "+3");
    assert.equal(pillarDeltaLabel(0), "±0");
    assert.equal(pillarDeltaLabel(-4), "-4");
  });

  it("prints nothing at all when there is no delta", () => {
    assert.equal(pillarDeltaLabel(null), "");
  });

  it("colours improving green, worsening red, flat and unknown grey", () => {
    assert.equal(pillarDeltaTone(3), "#22C55E");
    assert.equal(pillarDeltaTone(-4), "#f43f5e");
    assert.equal(pillarDeltaTone(0), "#64748b");
    assert.equal(pillarDeltaTone(null), "#64748b");
  });

  it("derives the sub-line from the real finding counts", () => {
    assert.equal(pillarStripSub({ critical: 2, warning: 0 }), "2 open findings");
    assert.equal(pillarStripSub({ critical: 1, warning: 2 }), "3 open findings");
  });

  it("singularises one finding", () => {
    assert.equal(pillarStripSub({ critical: 1, warning: 0 }), "1 open finding");
  });

  it("says 'On track' when a pillar is clean, matching the design's own word", () => {
    assert.equal(pillarStripSub({ critical: 0, warning: 0 }), "On track");
  });
});
