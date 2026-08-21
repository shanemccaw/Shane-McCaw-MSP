/**
 * projectsModel.test.ts — pins the Projects page's derivations.
 *
 * The gantt bar geometry itself (pjRows/pjPct) is pinned in
 * overviewModel.test.ts, since this page reuses those functions. These cases
 * cover what is NEW here: the task-lane split, the two card counts, and the
 * milestone diamond placement — the arithmetic that would render as a plausible
 * wrong answer nothing else on the page contradicts.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { PJ_MILESTONES, PJ_MINE, PJ_TASKS, PJ_WIN } from "./projectsData";
import {
  pjMilestones,
  pjMineCount,
  pjOwnerShort,
  pjPct,
  pjRows,
  pjTaskTotal,
  pjTasksInLane,
  pjWaitingCount,
  pjWaitingTasks,
} from "./projectsModel";

describe("task-lane split", () => {
  it("puts every one of the 18 tasks in exactly one lane", () => {
    const lanes = ["backlog", "progress", "waiting", "review", "done"] as const;
    const counted = lanes.reduce((sum, k) => sum + pjTasksInLane(k).length, 0);
    assert.equal(counted, PJ_TASKS.length);
    assert.equal(counted, 18);
  });

  it("splits the lanes the way the design's board is drawn", () => {
    assert.equal(pjTasksInLane("backlog").length, 4);
    assert.equal(pjTasksInLane("progress").length, 4);
    assert.equal(pjTasksInLane("waiting").length, 3);
    assert.equal(pjTasksInLane("review").length, 2);
    assert.equal(pjTasksInLane("done").length, 5);
  });

  it("names the three tasks the customer is the blocker on", () => {
    const waiting = pjWaitingTasks();
    assert.deepEqual(
      waiting.map((t) => t.id),
      ["t1", "t2", "t3"],
    );
    assert.ok(waiting.every((t) => t.lane === "waiting"));
  });
});

describe("card counts", () => {
  it("counts the waiting items for the 'Waiting on you' card", () => {
    assert.equal(pjWaitingCount(), 3);
  });

  it("counts the in-flight items for the 'With us' card", () => {
    assert.equal(pjMineCount(), 4);
    assert.equal(pjMineCount(), PJ_MINE.length);
  });

  it("counts every task on the board", () => {
    assert.equal(pjTaskTotal(), 18);
  });
});

describe("waiting-item owner label", () => {
  it("drops the 'You · ' prefix the design strips off the card", () => {
    assert.equal(pjOwnerShort("You · IT"), "IT");
    assert.equal(pjOwnerShort("You · IT + Legal"), "IT + Legal");
  });

  it("leaves an owner without the prefix untouched", () => {
    assert.equal(pjOwnerShort("Priya Raman"), "Priya Raman");
  });
});

describe("milestone diamonds", () => {
  it("draws all four milestones", () => {
    assert.equal(pjMilestones().length, PJ_MILESTONES.length);
    assert.equal(pjMilestones().length, 4);
  });

  it("places each diamond at its day's percentage of the window", () => {
    const inventory = pjMilestones().find((m) => m.label === "Inventory");
    assert.ok(inventory);
    assert.equal(inventory.left, pjPct(9));
  });

  it("flips ONLY the final milestone to the right of its dot so its label fits", () => {
    // The last fifth of the window (day > 50.4) draws its label reversed; the
    // report & handover milestone at day 53 is the only one there.
    const nearEnd = pjMilestones().filter((m) => m.nearEnd).map((m) => m.label);
    assert.deepEqual(nearEnd, ["Report & handover"]);
    // The threshold is day 50.4 (63 * 0.8). Compared to one decimal place
    // because 63 * 0.8 is 50.400000000000006 in IEEE-754, not exactly 50.4.
    assert.equal(Number((PJ_WIN * 0.8).toFixed(1)), 50.4);
  });

  it("carries the design's own tones through", () => {
    const tones = pjMilestones().map((m) => m.tone);
    assert.deepEqual(tones, ["met", "met", "next", "risk"]);
  });
});

describe("gantt geometry is the SAME as the Overview's mini-gantt", () => {
  it("reuses pjRows — five phases, blocked phase says 'Blocked', not '0/3 tasks'", () => {
    const rows = pjRows();
    assert.equal(rows.length, 5);
    const p4 = rows.find((r) => r.n === 4);
    assert.equal(p4?.status, "blocked");
    assert.equal(p4?.barText, "Blocked");
  });

  it("gives the two slipped phases a slip band and no others", () => {
    const slipped = pjRows().filter((r) => r.slip !== null).map((r) => r.n);
    assert.deepEqual(slipped, [4, 5]);
  });
});
