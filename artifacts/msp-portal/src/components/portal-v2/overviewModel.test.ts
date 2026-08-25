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
import { toChangeRequest, type WireChangeRequest } from "./ccChangeControlWire";
import type { HoldWindow } from "./holds/useRunbooks";
import {
  CR_WINDOW,
  MC_WINDOW,
  acceptedRiskLanes,
  crLanes,
  crLanesFromLive,
  driftChips,
  flaggedPolicyCount,
  headlineMain,
  holdDecisionCount,
  holdLanes,
  holdLanesFromLive,
  lastScanLabel,
  mcLanes,
  ovBar,
  pdLanes,
  pillarDelta,
  pillarDeltaLabel,
  pillarDeltaTone,
  pillarsOpenFindingsTotal,
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

function wireCr(overrides: Partial<WireChangeRequest> = {}): WireChangeRequest {
  return {
    code: "CR-1000",
    title: "Test change",
    changeClass: "Standard",
    status: "Pending approval",
    workload: "Identity",
    target: "Tenant-wide",
    ticket: "",
    requester: "someone@example.com",
    window: "Thu 27 Aug · 07:00–09:00",
    risk: "Medium",
    impactedUsersCount: 10,
    rationale: "Because.",
    pre: "",
    post: "",
    approvals: [],
    canApprove: false,
    canRollback: false,
    executedAt: null,
    backupVerified: false,
    linkedFinding: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("live change-request lanes", () => {
  it("gives every real change request a lane", () => {
    const crs = [wireCr({ code: "CR-1000" }), wireCr({ code: "CR-1001" })].map(toChangeRequest);
    assert.equal(crLanesFromLive(crs).length, 2);
  });

  it("marks a real CR with no window booked as unscheduled, same as the fixture path", () => {
    const cr = toChangeRequest(wireCr({ window: "Awaiting approval — no window booked" }));
    const lane = crLanesFromLive([cr])[0];
    assert.equal(lane.bar.unscheduled, true);
    assert.equal(lane.dateLabel, "");
  });

  it("keeps a real window's date text once one is actually booked", () => {
    const cr = toChangeRequest(wireCr({ window: "Thu 27 Aug · 07:00–09:00" }));
    const lane = crLanesFromLive([cr])[0];
    assert.equal(lane.bar.unscheduled, false);
    assert.equal(lane.dateLabel, "Thu 27 Aug · 07:00–09:00");
  });

  it("colours a lane the same tone the Change Control record itself uses for that state", () => {
    const awaiting = toChangeRequest(wireCr({ status: "Pending approval" }));
    const lane = crLanesFromLive([awaiting])[0];
    assert.equal(lane.tone, "#fbbf24");
  });
});

function liveHold(overrides: Partial<HoldWindow> = {}): HoldWindow {
  return {
    id: 1,
    holdKey: "hold-test",
    title: "Test hold",
    gates: "Gates step 4",
    gatesStepPosition: 4,
    pillar: "security",
    why: "",
    state: "running",
    tone: "#60a5fa",
    badge: "",
    tMinus: "T-3d",
    daysLeft: 3,
    daysSaved: 0,
    hoursLeft: 72,
    totalDays: 7,
    waitDays: 7,
    extendedDays: 0,
    startedAt: "2026-08-13T00:00:00.000Z",
    closesAt: "2026-08-20T00:00:00.000Z",
    closedAt: null,
    ticks: [],
    scanVerdict: "clear",
    scanLabel: "",
    scanTone: "#34d399",
    scanLine: "",
    scanProvenance: "",
    primaryAction: { kind: "wait", label: "" },
    notificationsDue: [],
    ...overrides,
  };
}

describe("live hold-window lanes", () => {
  it("gives every real hold window a lane", () => {
    assert.equal(holdLanesFromLive([liveHold(), liveHold({ holdKey: "hold-2" })]).length, 2);
  });

  it("takes state, tone and tMinus straight off the server rather than re-deriving them", () => {
    const lane = holdLanesFromLive([liveHold({ state: "due", tone: "#f87171", tMinus: "Closed 2h ago" })])[0];
    assert.equal(lane.state, "due");
    assert.equal(lane.tone, "#f87171");
    assert.equal(lane.tMinus, "Closed 2h ago");
  });

  it("computes donePct from totalDays/hoursLeft, honouring a real extension", () => {
    // 7-day window extended to 10, with 24h left: 9/10 days done = 90%.
    const lane = holdLanesFromLive([liveHold({ totalDays: 10, hoursLeft: 24 })])[0];
    assert.equal(lane.donePct, 90);
  });

  it("floors donePct at 0 and caps it at 100", () => {
    const over = holdLanesFromLive([liveHold({ totalDays: 7, hoursLeft: 999 })])[0];
    assert.equal(over.donePct, 0);
    const under = holdLanesFromLive([liveHold({ totalDays: 7, hoursLeft: -999 })])[0];
    assert.equal(under.donePct, 100);
  });
});

describe("the headline's real total", () => {
  it("sums critical and warning findings across every pillar", () => {
    const pillars = [
      { findingCounts: { critical: 2, warning: 1 } },
      { findingCounts: { critical: 0, warning: 3 } },
    ];
    assert.equal(pillarsOpenFindingsTotal(pillars), 6);
  });

  it("sums to zero for a clean tenant", () => {
    assert.equal(pillarsOpenFindingsTotal([{ findingCounts: { critical: 0, warning: 0 } }]), 0);
  });
});

describe("headline copy", () => {
  it("shows a loading sentence while the total is not yet known", () => {
    assert.match(headlineMain(null), /^Reading/);
  });

  it("says nothing is at risk for a genuinely clean tenant", () => {
    assert.equal(headlineMain(0), "Nothing is putting your tenant at risk right now.");
  });

  it("pluralises correctly", () => {
    assert.equal(headlineMain(1), "1 thing is putting your tenant at risk.");
    assert.equal(headlineMain(14), "14 things are putting your tenant at risk.");
  });
});

describe("last-scan label", () => {
  it("shows an em-dash before the first response has landed", () => {
    assert.equal(lastScanLabel(null, false), "—");
    assert.equal(lastScanLabel("2026-08-24T00:00:00.000Z", false), "—");
  });

  it("says never once loaded with no scan on record", () => {
    assert.equal(lastScanLabel(null, true), "never");
  });

  it("renders a relative time once loaded with a real timestamp", () => {
    const recent = new Date(Date.now() - 5000).toISOString();
    assert.equal(lastScanLabel(recent, true), "just now");
  });
});

describe("drift chips", () => {
  it("shows the honest em-dash for fixed/new this week — no real producer exists yet", () => {
    const chips = driftChips({ fixedThisWeek: null, newThisWeek: null, acceptedAsRisk: 5 });
    assert.equal(chips[0].num, "—");
    assert.equal(chips[0].label, "fixed this week");
    assert.equal(chips[1].num, "—");
    assert.equal(chips[1].label, "new this week");
  });

  it("shows the real accepted-as-risk count when the register has loaded", () => {
    const chips = driftChips({ fixedThisWeek: null, newThisWeek: null, acceptedAsRisk: 5 });
    assert.equal(chips[2].num, "5");
    assert.equal(chips[2].label, "accepted as risk");
  });

  it("shows an em-dash for accepted-as-risk too while the register hasn't loaded", () => {
    const chips = driftChips({ fixedThisWeek: null, newThisWeek: null, acceptedAsRisk: null });
    assert.equal(chips[2].num, "—");
  });
});
