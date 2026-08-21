/**
 * remediationModel.test.ts — pins the Remediation Tracker's counts, states,
 * grouping, and its wiring to the customer's real tracker rows.
 *
 * The load-bearing assertion is "verified is only ever read off the wire". A
 * step reaches the `verified` state in exactly one circumstance — the server
 * said `verificationState === "verified"` for it — and the fixture no longer
 * carries a field anything could set instead. Every other status, tick or
 * filter must leave it unverified. If a future edit ever promotes a step to
 * verified off UI state, this file goes red, which is the whole point of the
 * status / verificationState separation.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { RT_PHASES } from "./remediationData";
import {
  RT_ACCEPTED_STATUSES,
  RT_FIXED_STATUSES,
  RT_LIVE_EMPTY,
  RT_STEP_ID,
  rtLiveStep,
  type RtLiveState,
} from "./remediationLive";
import {
  RT_ALL_TASKS,
  rtAllRows,
  rtCounters,
  rtCrNumber,
  rtGroups,
  rtProgress,
  rtStateCounts,
  rtTaskRoute,
  rtTaskState,
} from "./remediationModel";

/** Build an RtLiveState the way the route's payload would arrive. */
function live(
  statuses: Record<string, string>,
  verification: Record<string, string> = {},
): RtLiveState {
  return {
    statuses: new Map(Object.entries(statuses)) as RtLiveState["statuses"],
    verification: new Map(
      Object.entries(verification).map(([k, v]) => [k, { state: v }]),
    ) as RtLiveState["verification"],
  };
}

const task = (id: string) => RT_ALL_TASKS.find((t) => t.id === id)!;

describe("fixture", () => {
  it("flattens to 30 tasks across three phases", () => {
    assert.equal(RT_ALL_TASKS.length, 30);
    assert.deepEqual(
      RT_PHASES.map((p) => p.tasks.length),
      [13, 9, 8],
    );
  });

  it("carries NO done or verified field at all — both are wire facts now", () => {
    for (const t of RT_ALL_TASKS) {
      assert.ok(!("done" in t), `${t.id} still carries a fixture done flag`);
      assert.ok(!("verified" in t), `${t.id} still carries a fixture verified flag`);
    }
  });
});

describe("step id mapping", () => {
  it("maps every design task, and only p3b/p3c to null (the steps #757 removed)", () => {
    assert.equal(Object.keys(RT_STEP_ID).length, 30);
    for (const t of RT_ALL_TASKS) assert.ok(t.id in RT_STEP_ID, `${t.id} has no mapping`);
    const unmapped = Object.entries(RT_STEP_ID)
      .filter(([, v]) => v === null)
      .map(([k]) => k);
    assert.deepEqual(unmapped, ["p3b", "p3c"]);
  });

  it("covers exactly the platform's own 28 step ids, one task each", () => {
    const expected = [
      ...Array.from({ length: 23 }, (_, i) => `s${i + 1}`),
      ...Array.from({ length: 5 }, (_, i) => `s${i + 26}`),
    ];
    const mapped = Object.values(RT_STEP_ID).filter((v): v is string => v !== null);
    assert.equal(mapped.length, 28);
    assert.equal(new Set(mapped).size, 28, "a step id is claimed by two tasks");
    assert.deepEqual([...mapped].sort(), [...expected].sort());
  });

  it("resolves an unmapped task to no step, permanently not_started", () => {
    assert.deepEqual(rtLiveStep("p3b", live({ s24: "completed" })), {
      stepId: null,
      status: "not_started",
      verification: "unverified",
    });
  });
});

describe("state counts — no rows yet", () => {
  it("reads every step as open, none done, none verified", () => {
    assert.deepEqual(rtStateCounts(), { verified: 0, done: 0, open: 30, accepted: 0 });
    assert.deepEqual(rtStateCounts(RT_LIVE_EMPTY), { verified: 0, done: 0, open: 30, accepted: 0 });
  });
});

describe("state counts — real rows", () => {
  it("counts claimed-but-unverified steps as awaiting re-scan", () => {
    // s1 = p1a, s7 = p1g, s8 = p1h
    const counts = rtStateCounts(live({ s1: "completed", s7: "completed", s8: "already_handled" }));
    assert.deepEqual(counts, { verified: 0, done: 3, open: 27, accepted: 0 });
  });

  it("counts a step ONLY as verified when a real scan verified it", () => {
    const counts = rtStateCounts(
      live({ s1: "completed", s7: "completed" }, { s1: "verified" }),
    );
    assert.deepEqual(counts, { verified: 1, done: 1, open: 28, accepted: 0 });
  });

  it("moves decisions into accepted", () => {
    const counts = rtStateCounts(live({ s2: "not_applicable", s3: "deferred" }));
    assert.deepEqual(counts, { verified: 0, done: 0, open: 28, accepted: 2 });
  });

  it("leaves a step handed to Shane outstanding, not done", () => {
    const counts = rtStateCounts(live({ s4: "shane_handles" }));
    assert.deepEqual(counts, { verified: 0, done: 0, open: 30, accepted: 0 });
  });

  it("still honours an explicitly skipped task id", () => {
    const counts = rtStateCounts(RT_LIVE_EMPTY, new Set(["p1b", "p1c"]));
    assert.equal(counts.accepted, 2);
    assert.equal(counts.open, 28);
  });
});

describe("verified is never derived", () => {
  it("no status alone reaches verified — verification must say so", () => {
    for (const status of [
      "not_started",
      "completed",
      "already_handled",
      "not_applicable",
      "deferred",
      "shane_handles",
    ]) {
      const rows = rtAllRows(live({ s1: status }));
      assert.ok(
        rows.every((r) => r.state.key !== "verified"),
        `status ${status} reached verified with no verification on the wire`,
      );
    }
  });

  it("a filter cannot promote anything to verified", () => {
    assert.equal(rtGroups("verified", live({ s1: "completed" })).length, 0);
    assert.equal(rtCounters("verified", live({ s1: "completed" }))[0].value, "0");
  });

  it("a verified verification on an unclaimed step does NOT read verified", () => {
    // Defence in depth: the server resets verification on every status write,
    // so this pairing should not exist — if it ever does, the row must not
    // claim a fix nobody said they made.
    const state = rtTaskState(task("p1a"), live({}, { s1: "verified" }));
    assert.equal(state.key, "open");
    assert.equal(state.label, "Not started");
  });
});

describe("drift", () => {
  it("reads a contradicted claim as Drifted, in the critical tone", () => {
    const state = rtTaskState(task("p1a"), live({ s1: "completed" }, { s1: "drift" }));
    assert.equal(state.label, "Drifted");
    assert.equal(state.tone, "#f87171");
    assert.equal(state.drifted, true);
  });

  it("counts it as still to do, and keeps it out of the fixed numerator", () => {
    const l = live({ s1: "completed" }, { s1: "drift" });
    assert.deepEqual(rtStateCounts(l), { verified: 0, done: 0, open: 30, accepted: 0 });
    assert.equal(rtProgress(l).done, "0");
  });

  it("withdraws the CR badge along with the claim", () => {
    const l = live({ s1: "completed" }, { s1: "drift" });
    assert.equal(rtAllRows(l)[0].cr, null);
  });
});

describe("progress", () => {
  it("is 0 of 30 before any step is actioned", () => {
    const p = rtProgress();
    assert.equal(p.total, "30");
    assert.equal(p.done, "0");
    assert.equal(p.pct, 0);
    assert.equal(p.headline, "0 of 30 things fixed since the first scan.");
  });

  it("counts verified and awaiting-re-scan together, off real rows", () => {
    const p = rtProgress(live({ s1: "completed", s7: "completed", s8: "completed" }, { s1: "verified" }));
    assert.equal(p.done, "3");
    assert.equal(p.pct, 10);
    assert.equal(p.headline, "3 of 30 things fixed since the first scan.");
  });
});

describe("counters", () => {
  it("labels the four states in order", () => {
    const c = rtCounters(null);
    assert.deepEqual(
      c.map((x) => x.key),
      ["verified", "done", "open", "accepted"],
    );
    assert.deepEqual(
      c.map((x) => x.value),
      ["0", "0", "30", "0"],
    );
    assert.equal(c[0].label, "Fixed and verified");
  });

  it("reads real values off the wire", () => {
    const c = rtCounters(null, live({ s1: "completed", s2: "deferred" }, { s1: "verified" }));
    assert.deepEqual(
      c.map((x) => x.value),
      ["1", "0", "28", "1"],
    );
  });

  it("marks the filtered counter active", () => {
    assert.deepEqual(
      rtCounters("open")
        .filter((x) => x.active)
        .map((x) => x.key),
      ["open"],
    );
  });
});

describe("task state", () => {
  it("reads a claimed, unverified step as awaiting re-scan", () => {
    assert.deepEqual(rtTaskState(task("p1a"), live({ s1: "completed" })), {
      key: "done",
      label: "Awaiting re-scan",
      tone: "#5eead4",
    });
  });

  it("reads a scan-verified step as Verified", () => {
    assert.deepEqual(rtTaskState(task("p1a"), live({ s1: "completed" }, { s1: "verified" })), {
      key: "verified",
      label: "Verified",
      tone: "#34d399",
    });
  });

  it("treats already_handled as a claim too", () => {
    assert.equal(rtTaskState(task("p1a"), live({ s1: "already_handled" })).key, "done");
  });

  it("colours an open critical task red and an open attention task amber", () => {
    assert.equal(rtTaskState(task("p1d")).tone, "#f87171"); // Critical
    assert.equal(rtTaskState(task("p1b")).tone, "#fbbf24"); // Attention
    assert.equal(rtTaskState(task("p1d")).label, "Not started");
    assert.equal(rtTaskState(task("p1b")).label, "Not started");
  });

  it("reads a skipped task as accepted", () => {
    assert.equal(rtTaskState(task("p1b"), RT_LIVE_EMPTY, new Set(["p1b"])).key, "accepted");
  });

  it("splits the resolved statuses the same way the server's pricing does", () => {
    assert.deepEqual([...RT_FIXED_STATUSES].sort(), ["already_handled", "completed"]);
    assert.deepEqual([...RT_ACCEPTED_STATUSES].sort(), ["deferred", "not_applicable"]);
  });
});

describe("route", () => {
  it("routes a Shane task, a critical task and everything else", () => {
    assert.deepEqual(rtTaskRoute(task("p1a")), { label: "We run it", tone: "#60a5fa" }); // shane
    assert.deepEqual(rtTaskRoute(task("p1d")), { label: "Runbook", tone: "#22d3ee" }); // Critical
    assert.deepEqual(rtTaskRoute(task("p1b")), { label: "Your team", tone: "#94a3b8" }); // Attention
  });

  it("routes a step the customer handed to Shane to us, off the real status", () => {
    // p1b (s2) is the customer's own by default.
    assert.deepEqual(rtTaskRoute(task("p1b"), live({ s2: "shane_handles" })), {
      label: "We run it",
      tone: "#60a5fa",
    });
  });
});

describe("change-request numbers", () => {
  it("gives a CR to a Shane-run step only once it is really claimed done", () => {
    const l = live({ s1: "completed", s7: "completed", s8: "completed" });
    const rows = rtAllRows(l);
    assert.equal(rows[0].cr, "CR-0100"); // p1a, index 0
    assert.equal(rows[6].cr, "CR-0106"); // p1g, index 6
    assert.equal(rows[7].cr, "CR-0107"); // p1h, index 7
    assert.equal(rows.filter((r) => r.cr).length, 3);
  });

  it("gives none when nothing has been actioned", () => {
    assert.equal(rtAllRows().filter((r) => r.cr).length, 0);
  });

  it("gives none to a done step that is not Shane-run", () => {
    // p1b (s2) is not Shane-run.
    const state = rtTaskState(task("p1b"), live({ s2: "completed" }));
    assert.equal(rtCrNumber(task("p1b"), 1, state), null);
  });
});

describe("groups", () => {
  it("groups all six pillars in order when unfiltered", () => {
    const g = rtGroups(null);
    assert.deepEqual(
      g.map((x) => x.key),
      ["governance", "security", "compliance", "licensing", "adoption", "health"],
    );
    assert.deepEqual(
      g.map((x) => x.n),
      ["6", "7", "5", "4", "4", "4"],
    );
  });

  it("drops empty groups under a filter, off real rows", () => {
    // s1 = p1a (governance), s7/s8 = p1g/p1h (security).
    const g = rtGroups("done", live({ s1: "completed", s7: "completed", s8: "completed" }));
    assert.deepEqual(
      g.map((x) => x.key),
      ["governance", "security"],
    );
    assert.deepEqual(
      g.map((x) => x.n),
      ["1", "2"],
    );
  });

  it("returns no groups for a state nothing is in", () => {
    assert.equal(rtGroups("verified").length, 0);
  });
});

describe("rows", () => {
  it("carries each task's real step id, and null for the two #757 dropped", () => {
    const rows = rtAllRows();
    assert.equal(rows.find((r) => r.id === "p1a")!.stepId, "s1");
    assert.equal(rows.find((r) => r.id === "p3h")!.stepId, "s30");
    assert.equal(rows.find((r) => r.id === "p3b")!.stepId, null);
    assert.equal(rows.find((r) => r.id === "p3c")!.stepId, null);
  });
});

describe("owner", () => {
  it("resolves each pillar's responsible RACI owner onto its rows", () => {
    const rows = rtAllRows();
    const gov = rows.find((r) => r.pillarKey === "governance")!;
    assert.deepEqual(gov.owner, { init: "SM", name: "Shane McCaw", tone: "#38bdf8" });
    const sec = rows.find((r) => r.pillarKey === "security")!;
    assert.deepEqual(sec.owner, { init: "RC", name: "R. Court", tone: "#f87171" });
  });
});
