/**
 * remediationModel.test.ts — pins the Remediation Tracker's counts, states and
 * grouping.
 *
 * The load-bearing assertion is "verified is never derived here": the fixture
 * asserts no `verified` flag, so the Fixed-and-verified counter must read 0 and
 * no row may reach the `verified` state. If a future edit ever promotes a step
 * to verified off tick or filter state, this file goes red — which is the whole
 * point of the status / verificationState separation.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { RT_PHASES } from "./remediationData";
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

describe("fixture", () => {
  it("flattens to 30 tasks across three phases", () => {
    assert.equal(RT_ALL_TASKS.length, 30);
    assert.deepEqual(
      RT_PHASES.map((p) => p.tasks.length),
      [13, 9, 8],
    );
  });

  it("carries no `verified` flag — only a real scan may set it", () => {
    assert.ok(RT_ALL_TASKS.every((t) => t.verified === undefined));
  });
});

describe("state counts", () => {
  it("counts the three done tasks as awaiting re-scan, the rest open, none verified", () => {
    assert.deepEqual(rtStateCounts(), { verified: 0, done: 3, open: 27, accepted: 0 });
  });

  it("NEVER derives verified from state — every row is unverified off the fixture", () => {
    assert.equal(rtStateCounts().verified, 0);
    assert.ok(rtAllRows().every((r) => r.state.key !== "verified"));
  });

  it("moves tasks into accepted only when explicitly skipped", () => {
    const counts = rtStateCounts(new Set(["p1b", "p1c"]));
    assert.equal(counts.accepted, 2);
    assert.equal(counts.open, 25);
  });
});

describe("progress", () => {
  it("is 3 of 30, 10 percent, with the prototype headline", () => {
    const p = rtProgress();
    assert.equal(p.total, "30");
    assert.equal(p.done, "3");
    assert.equal(p.pct, 10);
    assert.equal(p.headline, "3 of 30 things fixed since the first scan.");
  });
});

describe("counters", () => {
  it("labels the four states and reads the fixture counts", () => {
    const c = rtCounters(null);
    assert.deepEqual(
      c.map((x) => x.key),
      ["verified", "done", "open", "accepted"],
    );
    assert.deepEqual(
      c.map((x) => x.value),
      ["0", "3", "27", "0"],
    );
    assert.equal(c[0].label, "Fixed and verified");
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
  it("reads a done, unverified task as awaiting re-scan", () => {
    const p1a = RT_ALL_TASKS.find((t) => t.id === "p1a")!;
    assert.deepEqual(rtTaskState(p1a), { key: "done", label: "Awaiting re-scan", tone: "#5eead4" });
  });

  it("colours an open critical task red and an open attention task amber", () => {
    const p1d = RT_ALL_TASKS.find((t) => t.id === "p1d")!; // Critical, not done
    const p1b = RT_ALL_TASKS.find((t) => t.id === "p1b")!; // Attention, not done
    assert.equal(rtTaskState(p1d).tone, "#f87171");
    assert.equal(rtTaskState(p1b).tone, "#fbbf24");
    assert.equal(rtTaskState(p1d).label, "Not started");
    assert.equal(rtTaskState(p1b).label, "Not started");
  });

  it("reads a skipped task as accepted", () => {
    const p1b = RT_ALL_TASKS.find((t) => t.id === "p1b")!;
    assert.equal(rtTaskState(p1b, new Set(["p1b"])).key, "accepted");
  });
});

describe("route", () => {
  it("routes a Shane task, a critical task and everything else", () => {
    const p1a = RT_ALL_TASKS.find((t) => t.id === "p1a")!; // shane
    const p1d = RT_ALL_TASKS.find((t) => t.id === "p1d")!; // Critical, not shane
    const p1b = RT_ALL_TASKS.find((t) => t.id === "p1b")!; // Attention, not shane
    assert.deepEqual(rtTaskRoute(p1a), { label: "We run it", tone: "#60a5fa" });
    assert.deepEqual(rtTaskRoute(p1d), { label: "Runbook", tone: "#22d3ee" });
    assert.deepEqual(rtTaskRoute(p1b), { label: "Your team", tone: "#94a3b8" });
  });
});

describe("change-request numbers", () => {
  it("gives a CR to a Shane-run done task, numbered off its flat index", () => {
    const rows = rtAllRows();
    assert.equal(rows[0].cr, "CR-0100"); // p1a, index 0
    assert.equal(rows[6].cr, "CR-0106"); // p1g, index 6
    assert.equal(rows[7].cr, "CR-0107"); // p1h, index 7
  });

  it("gives none to anything not both Shane-run and done", () => {
    const p1b = RT_ALL_TASKS.find((t) => t.id === "p1b")!; // not shane, not done
    assert.equal(rtCrNumber(p1b, 1), null);
    // a synthetic Shane task that is NOT done gets none either
    assert.equal(rtCrNumber({ ...p1b, shane: true, done: false }, 1), null);
    // exactly three rows carry a CR
    assert.equal(rtAllRows().filter((r) => r.cr).length, 3);
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

  it("drops empty groups under a filter", () => {
    // Only the three done tasks: p1a (governance), p1g + p1h (security).
    const g = rtGroups("done");
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

describe("owner", () => {
  it("resolves each pillar's responsible RACI owner onto its rows", () => {
    const rows = rtAllRows();
    const gov = rows.find((r) => r.pillarKey === "governance")!;
    assert.deepEqual(gov.owner, { init: "SM", name: "Shane McCaw", tone: "#38bdf8" });
    const sec = rows.find((r) => r.pillarKey === "security")!;
    assert.deepEqual(sec.owner, { init: "RC", name: "R. Court", tone: "#f87171" });
  });
});
