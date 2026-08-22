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
  RT_PILLAR_BASE,
  RT_PILLAR_ORDER,
  RT_PILLAR_TARGET,
  RT_TASKS,
} from "./remediationData";
import { RT_ACCEPTED_STATUSES, RT_FIXED_STATUSES, type RtLiveState } from "./remediationLive";
import {
  RT_CTX_EMPTY,
  RT_OV_EMPTY,
  RT_POINTS,
  rtAcceptedOf,
  rtCanTick,
  rtDoneOf,
  rtDriftItems,
  rtGate,
  rtGroups,
  rtPillarLive,
  rtStateChips,
  rtStateKeyOf,
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
const ctxOf = (l: RtLiveState, ov: Partial<RtOverrides> = {}): RtCtx => ({ live: l, ov: { ...RT_OV_EMPTY, ...ov } });
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

describe("severity-weighted points", () => {
  it("each pillar's task points sum to its base→target gap", () => {
    for (const k of RT_PILLAR_ORDER) {
      const sum = RT_TASKS.filter((t) => t.pl === k).reduce((a, t) => a + RT_POINTS[t.id], 0);
      assert.equal(sum, RT_PILLAR_TARGET[k] - RT_PILLAR_BASE[k], `${k} points do not sum to its gap`);
    }
  });
});

describe("pillar live scoring", () => {
  it("banks points as CONFIRMED only when done, evidence-approved AND verified", () => {
    const base = RT_PILLAR_BASE.security;
    // h2 is a security task. Done + approved evidence (seed) + verified.
    const scored = rtPillarLive("security", ctxOf(live({ s8: "completed" }, { s8: "verified" })));
    assert.equal(scored.now, base + RT_POINTS.h2);
    assert.equal(scored.pending, 0);
  });
  it("holds points as PENDING when done but not yet verified", () => {
    const base = RT_PILLAR_BASE.security;
    const pending = rtPillarLive("security", ctxOf(live({ s8: "completed" })));
    assert.equal(pending.now, base);
    assert.equal(pending.pending, RT_POINTS.h2);
  });
});

describe("gate summary", () => {
  it("reports the base as the average of the pillar bases before anything is scored", () => {
    const g = rtGate(RT_CTX_EMPTY);
    const avgBase = Math.round(RT_PILLAR_ORDER.reduce((a, k) => a + RT_PILLAR_BASE[k], 0) / RT_PILLAR_ORDER.length);
    assert.equal(g.now, String(avgBase));
    assert.equal(g.base, String(avgBase));
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
