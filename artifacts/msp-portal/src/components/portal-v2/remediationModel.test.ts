/**
 * remediationModel.test.ts — pins the Round Four Remediation Tracker's fixture,
 * its nine-state resolver, the point scoring, the phase grouping and — the
 * load-bearing part — its wiring to the customer's REAL tracker rows.
 *
 * The guard that must never regress: DONE, VERIFIED and ACCEPTED are read off
 * the wire (a task's `stepId` into the `RtLiveState` the useRemediationTracker
 * hook returns), never asserted by the fixture and never derived from a tick or
 * a filter. If a future edit ever makes a task read done/verified/accepted from
 * anything other than the real rows (or an explicit session override), these
 * tests go red — which is the whole point of keeping the hook connected.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  RT_PHASES,
  RT_SEV_WEIGHT,
  RT_TASKS,
} from "./remediationData";
import { RT_ACCEPTED_STATUSES, RT_FIXED_STATUSES, type RtLiveState } from "./remediationLive";
import { RT_SCORES_EMPTY, type RtLiveScores, type RtPillarScore } from "./remediationScores";
import {
  RT_CTX_EMPTY,
  RT_OV_EMPTY,
  rtAcceptedOf,
  rtCanTick,
  rtDoneOf,
  rtDriftItems,
  rtGate,
  rtGroups,
  rtHeadline,
  rtPillarCells,
  rtPillarLive,
  rtStateChips,
  rtStateKeyOf,
  rtTaskPoints,
  rtVerOf,
  type RtCtx,
  type RtOverrides,
} from "./remediationModel";

/** Build an RtLiveState the way the route's payload would arrive. */
function live(statuses: Record<string, string>, verification: Record<string, string> = {}): RtLiveState {
  return {
    statuses: new Map(Object.entries(statuses)) as RtLiveState["statuses"],
    verification: new Map(Object.entries(verification).map(([k, v]) => [k, { state: v }])) as RtLiveState["verification"],
  };
}
const ctxOf = (l: RtLiveState, ov: Partial<RtOverrides> = {}): RtCtx => ({ live: l, ov: { ...RT_OV_EMPTY, ...ov }, scores: RT_SCORES_EMPTY });

/** A full pillar-score row with sensible defaults, for the score-consuming tests. */
function pillarScore(partial: Partial<RtPillarScore>): RtPillarScore {
  return {
    before: null,
    now: null,
    dayOne: null,
    delta: null,
    status: "insufficient_data",
    capturedAt: null,
    scanCount: 0,
    ...partial,
  };
}

/** An RtCtx carrying real per-pillar scores (Git #1381), empty wire + overrides. */
const scoresCtx = (scores: Partial<RtLiveScores>): RtCtx => ({
  live: { statuses: new Map(), verification: new Map() },
  ov: RT_OV_EMPTY,
  scores: { ...RT_SCORES_EMPTY, loaded: true, ...scores },
});
const task = (id: string) => RT_TASKS.find((t) => t.id === id)!;

describe("fixture", () => {
  it("is 31 tasks across seven phases in dependency order", () => {
    assert.equal(RT_TASKS.length, 31);
    assert.deepEqual(
      RT_PHASES.map((p) => p.k),
      ["discovery", "stabilization", "baseline", "hardening", "copilot", "drift", "identity"],
    );
    assert.deepEqual(
      RT_PHASES.map((p) => RT_TASKS.filter((t) => t.ph === p.k).length),
      [3, 5, 4, 4, 4, 4, 7],
    );
  });

  it("carries NO fixture done or verified field — both are wire facts", () => {
    for (const t of RT_TASKS) {
      assert.ok(!("done" in t), `${t.id} still carries a fixture done flag`);
      assert.ok(!("verified" in t), `${t.id} still carries a fixture verified flag`);
    }
  });
});

describe("the real-data seam (stepId)", () => {
  it("maps 25 tasks to real platform steps and leaves 6 unmapped", () => {
    const mapped = RT_TASKS.filter((t) => t.stepId !== null).map((t) => t.stepId as string);
    const unmapped = RT_TASKS.filter((t) => t.stepId === null).map((t) => t.id);
    assert.equal(mapped.length, 25);
    assert.equal(new Set(mapped).size, 25, "a real step id is claimed by two tasks");
    assert.deepEqual(unmapped.sort(), ["d1", "d2", "d3", "dr1", "i3", "i8"].sort());
  });

  it("only ever draws real step ids from the platform's own set", () => {
    const platform = new Set([
      ...Array.from({ length: 23 }, (_, i) => `s${i + 1}`),
      ...Array.from({ length: 5 }, (_, i) => `s${i + 26}`),
    ]);
    for (const t of RT_TASKS) {
      if (t.stepId !== null) assert.ok(platform.has(t.stepId), `${t.id} → ${t.stepId} is not a platform step`);
    }
  });
});

describe("done / verified / accepted come off the wire", () => {
  it("a task is done when its real step reports completed/already_handled", () => {
    // s3's stepId is s1.
    assert.equal(rtDoneOf(task("s3"), ctxOf(live({ s1: "completed" }))), true);
    assert.equal(rtDoneOf(task("s3"), ctxOf(live({ s1: "already_handled" }))), true);
    assert.equal(rtDoneOf(task("s3"), RT_CTX_EMPTY), false);
  });

  it("shane_handles leaves a task NOT done", () => {
    assert.equal(rtDoneOf(task("s3"), ctxOf(live({ s1: "shane_handles" }))), false);
  });

  it("verified needs done AND a real scan verdict — never a status alone", () => {
    // h2's stepId is s8, evidence seed approved.
    assert.equal(rtVerOf(task("h2"), ctxOf(live({ s8: "completed" }))), false);
    assert.equal(rtVerOf(task("h2"), ctxOf(live({ s8: "completed" }, { s8: "verified" }))), true);
    // verified verdict on an unclaimed step never reads verified.
    assert.equal(rtVerOf(task("h2"), ctxOf(live({}, { s8: "verified" }))), false);
  });

  it("accepted comes from a real not_applicable/deferred decision", () => {
    // s5's stepId is s4.
    assert.equal(rtAcceptedOf(task("s5"), ctxOf(live({ s4: "not_applicable" }))), true);
    assert.equal(rtAcceptedOf(task("s5"), ctxOf(live({ s4: "deferred" }))), true);
    assert.equal(rtAcceptedOf(task("s5"), RT_CTX_EMPTY), false);
  });

  it("an unmapped task can never read done off the wire", () => {
    // d1 has no stepId; nothing on the wire can make it done.
    assert.equal(rtDoneOf(task("d1"), ctxOf(live({ s1: "completed", s7: "completed" }))), false);
  });

  it("splits the resolved statuses the same way the server's pricing does", () => {
    assert.deepEqual([...RT_FIXED_STATUSES].sort(), ["already_handled", "completed"]);
    assert.deepEqual([...RT_ACCEPTED_STATUSES].sort(), ["deferred", "not_applicable"]);
  });
});

describe("session overrides win over the baseline", () => {
  it("a session tick makes a task done even with an empty wire", () => {
    assert.equal(rtDoneOf(task("s3"), ctxOf(live({}), { ticked: { s3: true } })), true);
  });
  it("a session skip accepts a task", () => {
    assert.equal(rtAcceptedOf(task("s3"), ctxOf(live({}), { skipped: { s3: true } })), true);
    assert.equal(rtStateKeyOf(task("s3"), ctxOf(live({}), { skipped: { s3: true } })), "accepted");
  });
});

describe("state resolution", () => {
  it("holds a task whose hold window is running", () => {
    assert.equal(rtStateKeyOf(task("s3"), RT_CTX_EMPTY), "held"); // s3 seeds a running hold
  });
  it("blocks a task on an unmet dependency", () => {
    assert.equal(rtStateKeyOf(task("s5"), RT_CTX_EMPTY), "blocked"); // s5 depends on s3
  });
  it("reads CR stages as waiting-for-CR / approval / in-progress", () => {
    assert.equal(rtStateKeyOf(task("s4"), RT_CTX_EMPTY), "wcr"); // crs 1
    assert.equal(rtStateKeyOf(task("s2"), RT_CTX_EMPTY), "wapp"); // crs 4
    assert.equal(rtStateKeyOf(task("h4"), RT_CTX_EMPTY), "progress"); // crs 5, no hold/dep
  });
  it("reads a done task as waiting-for-evidence until its evidence is approved", () => {
    // s3 is done on the wire but seeds missing evidence.
    assert.equal(rtStateKeyOf(task("s3"), ctxOf(live({ s1: "completed" }))), "evidence");
  });
  it("reads a done, evidence-approved, verified task as completed", () => {
    assert.equal(rtStateKeyOf(task("h2"), ctxOf(live({ s8: "completed" }, { s8: "verified" }))), "completed");
  });
});

describe("the CR tick gate", () => {
  it("a CR-gated task cannot be ticked before its CR reaches execute (crs≥5)", () => {
    assert.equal(rtCanTick(task("s4"), RT_CTX_EMPTY), false); // crs 1
    assert.equal(rtCanTick(task("s4"), ctxOf(live({}), { cr: { s4: 5 } })), true);
  });
  it("a held task cannot be ticked until the hold is released", () => {
    assert.equal(rtCanTick(task("s3"), ctxOf(live({}), { cr: { s3: 5 } })), false); // hold still running
    assert.equal(rtCanTick(task("s3"), ctxOf(live({}), { cr: { s3: 5 }, hold: { s3: "released" } })), true);
  });
});

describe("per-task points come from the real finding severity (#1381)", () => {
  it("uses the live severity weight when the API supplies one for the task's step", () => {
    // s1 (task) → stepId s7. A live critical finding weighs 3.
    const ctx = scoresCtx({ taskPoints: { s7: { severity: "critical", weight: 3 } } });
    assert.equal(rtTaskPoints(task("s1"), ctx), 3);
  });
  it("falls back to the design severity weight when there is no live finding", () => {
    // s1 is a Critical design task; with no live taskPoints it reads the design weight.
    assert.equal(rtTaskPoints(task("s1"), RT_CTX_EMPTY), RT_SEV_WEIGHT[task("s1").sv]);
  });
  it("an unmapped task (no stepId) always reads the design severity weight", () => {
    // d1 has no stepId, so no live finding can ever back it.
    const ctx = scoresCtx({ taskPoints: { s7: { severity: "critical", weight: 3 } } });
    assert.equal(rtTaskPoints(task("d1"), ctx), RT_SEV_WEIGHT[task("d1").sv]);
  });
});

describe("pillar live scoring — rolling before/now + permanent day-one (#1381)", () => {
  it("reads a pillar's real before/now/dayOne straight off the score API", () => {
    const ctx = scoresCtx({
      pillars: { security: pillarScore({ before: 30, now: 32, dayOne: 28, delta: 2, status: "scored", scanCount: 3 }) },
    });
    const l = rtPillarLive("security", ctx);
    assert.equal(l.before, 30);
    assert.equal(l.now, 32);
    assert.equal(l.dayOne, 28);
    assert.equal(l.delta, 2);
    assert.equal(l.status, "scored");
  });
  it("a single-scan pillar has now but no before to compare", () => {
    const ctx = scoresCtx({
      pillars: { governance: pillarScore({ before: null, now: 41, dayOne: 41, delta: null, status: "single_scan", scanCount: 1 }) },
    });
    const l = rtPillarLive("governance", ctx);
    assert.equal(l.now, 41);
    assert.equal(l.before, null);
    assert.equal(l.delta, null);
    assert.equal(l.status, "single_scan");
  });
  it("a pillar with no snapshot at all reads insufficient_data, never a fabricated number", () => {
    const l = rtPillarLive("compliance", RT_CTX_EMPTY);
    assert.equal(l.now, null);
    assert.equal(l.status, "insufficient_data");
  });
  it("maps health → the engine's architecture snapshot via the API's own keying", () => {
    // The API returns the tracker key `health`; the model reads it directly.
    const ctx = scoresCtx({ pillars: { health: pillarScore({ before: 44, now: 50, dayOne: 40, delta: 6, status: "scored", scanCount: 2 }) } });
    assert.equal(rtPillarLive("health", ctx).now, 50);
  });
});

describe("pillar cells surface the honest state (#1381)", () => {
  it("shows a dash and a no-data note for an unscored pillar", () => {
    const cells = rtPillarCells(RT_CTX_EMPTY);
    for (const c of cells) {
      assert.equal(c.hasScore, false);
      assert.equal(c.score, "—");
      assert.equal(c.statusNote, "not enough data yet");
    }
  });
  it("renders the rolling delta and the day-one label when scored", () => {
    const ctx = scoresCtx({
      pillars: { security: pillarScore({ before: 30, now: 32, dayOne: 28, delta: 2, status: "scored", scanCount: 3 }) },
    });
    const cell = rtPillarCells(ctx).find((c) => c.key === "security")!;
    assert.equal(cell.score, "32");
    assert.equal(cell.delta, "+2");
    assert.equal(cell.deltaPositive, true);
    assert.equal(cell.dayOneLabel, "day 1 · 28");
  });
});

describe("gate summary — real tenant score + real Copilot gate (#1381)", () => {
  it("has no score at all before any snapshot lands", () => {
    const g = rtGate(RT_CTX_EMPTY);
    assert.equal(g.hasScore, false);
    assert.equal(g.now, "—");
    assert.equal(g.copilotGate, "not evaluated yet");
    assert.equal(g.copilotEvaluated, false);
  });
  it("averages the real pillar scores and reports the rolling movement", () => {
    const ctx = scoresCtx({
      pillars: {
        governance: pillarScore({ before: 34, now: 40, dayOne: 28, delta: 6, status: "scored", scanCount: 3 }),
        security: pillarScore({ before: 30, now: 34, dayOne: 26, delta: 4, status: "scored", scanCount: 3 }),
      },
    });
    const g = rtGate(ctx);
    assert.equal(g.hasScore, true);
    assert.equal(g.now, "37"); // mean(40,34)
    assert.equal(g.before, "32"); // mean(34,30)
    assert.equal(g.delta, "+5");
    assert.equal(g.dayOne, "27"); // mean(28,26)
  });
  it("surfaces the real Copilot gate go/no-go, not a guess off the tenant score", () => {
    const ctx = scoresCtx({
      pillars: { security: pillarScore({ before: 30, now: 34, dayOne: 26, delta: 4, status: "scored", scanCount: 2 }) },
      copilotGate: { score: 74, threshold: 82, status: "no_go", evaluation: { status: "scored", reason: "scored" } },
    });
    const g = rtGate(ctx);
    assert.equal(g.copilotGate, "74 of 82");
    assert.equal(g.copilotOk, false);
    assert.equal(g.copilotEvaluated, true);
  });
  it("says the Copilot gate is not evaluated when the score is null", () => {
    const ctx = scoresCtx({
      copilotGate: { score: null, threshold: 82, status: null, evaluation: { status: "not_evaluated", reason: "no coverage" } },
    });
    assert.equal(rtGate(ctx).copilotGate, "not evaluated yet");
  });
});

describe("headline — real rolling before → now (#1381)", () => {
  it("says the score is not available yet with no snapshot", () => {
    assert.ok(rtHeadline(RT_CTX_EMPTY).headline.startsWith("Tenant score not available yet"));
  });
  it("reads before → now when the tenant has moved", () => {
    const ctx = scoresCtx({
      pillars: {
        governance: pillarScore({ before: 34, now: 40, dayOne: 28, delta: 6, status: "scored", scanCount: 3 }),
        security: pillarScore({ before: 30, now: 34, dayOne: 26, delta: 4, status: "scored", scanCount: 3 }),
      },
    });
    assert.ok(rtHeadline(ctx).headline.startsWith("Tenant score 32 → 37,"));
  });
});

describe("grouping and filters", () => {
  it("groups the phases that have visible tasks, in phase order", () => {
    const g = rtGroups(null, null, RT_CTX_EMPTY);
    assert.deepEqual(
      g.map((x) => x.key),
      ["discovery", "stabilization", "baseline", "hardening", "copilot", "drift", "identity"],
    );
  });
  it("filters to a single phase", () => {
    const g = rtGroups("stabilization", null, RT_CTX_EMPTY);
    assert.equal(g.length, 1);
    assert.equal(g[0].items.length, 5);
  });
  it("composes phase and state filters", () => {
    const g = rtGroups("stabilization", "blocked", RT_CTX_EMPTY);
    assert.deepEqual(g.flatMap((x) => x.items.map((i) => i.id)), ["s5"]); // s5 is the blocked one
  });
});

describe("state chips", () => {
  it("only shows a chip for a state something is in", () => {
    const chips = rtStateChips(null, RT_CTX_EMPTY);
    assert.ok(chips.every((c) => Number(c.n) > 0));
    // With an empty wire nothing is completed, so no completed chip.
    assert.ok(!chips.some((c) => c.key === "completed"));
  });
});

describe("drift", () => {
  it("lists the two re-remediation tasks against their originals", () => {
    const d = rtDriftItems();
    assert.deepEqual(d.map((x) => x.id).sort(), ["dr1", "dr2"]);
    assert.ok(d.find((x) => x.id === "dr1")!.origin.includes("Close org-wide sharing"));
  });
});
