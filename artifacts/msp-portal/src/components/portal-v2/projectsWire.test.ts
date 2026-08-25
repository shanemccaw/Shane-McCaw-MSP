/**
 * projectsWire.test.ts — pins the Projects page's live mapping (Git #1241).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  formatShortDate,
  toLiveProjectGeometry,
  toMineItems,
  toProjectTasks,
  toScopeBars,
  type WireKanbanTask,
  type WireProjectStep,
  type WireProjectSummary,
} from "./projectsWire";

const PROJECT: WireProjectSummary = { id: 1, title: "Copilot Readiness Assessment", startDate: "2026-08-04T00:00:00.000Z", endDate: "2026-09-26T00:00:00.000Z" };

const STEPS: readonly WireProjectStep[] = [
  { id: 10, title: "Discovery", description: "Inventory everything.", status: "completed", order: 0, notes: "Signed off.", dueDate: "2026-08-13T00:00:00.000Z" },
  { id: 11, title: "Pilot config", description: "Configure the pilot.", status: "in_progress", order: 1, notes: null, dueDate: "2026-09-05T00:00:00.000Z" },
  { id: 12, title: "Enablement", description: null, status: "blocked", order: 2, notes: "Waiting on training dates.", dueDate: "2026-09-12T00:00:00.000Z" },
];

function task(overrides: Partial<WireKanbanTask>): WireKanbanTask {
  return {
    id: 1,
    title: "Task",
    description: null,
    column: "backlog",
    assignedTo: null,
    dueDate: null,
    updatedAt: null,
    workflowStepId: null,
    waitingReason: null,
    completionNotes: null,
    publicNotes: null,
    priority: "medium",
    ...overrides,
  };
}

const NOW = "2026-08-23T00:00:00.000Z";

describe("formatShortDate", () => {
  it("renders a UTC day/short-month label", () => {
    assert.equal(formatShortDate("2026-08-13T00:00:00.000Z"), "13 Aug");
  });
  it("returns an empty string for no date", () => {
    assert.equal(formatShortDate(null), "");
  });
});

describe("toLiveProjectGeometry", () => {
  const g = toLiveProjectGeometry(STEPS, [], PROJECT, NOW);

  it("assigns phase numbers by order, 1-based", () => {
    assert.deepEqual(g.phases.map((p) => p.n), [1, 2, 3]);
    assert.equal(g.phaseNByStepId.get(10), 1);
    assert.equal(g.phaseNByStepId.get(11), 2);
    assert.equal(g.phaseNByStepId.get(12), 3);
  });

  it("maps DB step status to the page's PhaseStatus", () => {
    assert.deepEqual(g.phases.map((p) => p.status), ["complete", "active", "blocked"]);
  });

  it("never draws a slip band for live phases — the schema has no planned-vs-actual pair", () => {
    assert.ok(g.rows.every((r) => r.slip === null));
  });

  it("keeps every bar inside the window", () => {
    for (const r of g.rows) {
      assert.ok(r.left >= 0 && r.left <= 100);
      assert.ok(r.left + r.width <= 100.001);
    }
  });

  it("places today's line inside the window", () => {
    assert.ok(g.todayPct >= 0 && g.todayPct <= 100);
  });

  it("labels a blocked bar 'Blocked' rather than a task count, same rule as the fixture", () => {
    const blocked = g.rows.find((r) => r.status === "blocked");
    assert.equal(blocked?.barText, "Blocked");
  });
});

describe("toProjectTasks", () => {
  const phaseNByStepId = new Map([[10, 1]]);

  it("maps DB columns to the board's five lanes", () => {
    const tasks = toProjectTasks(
      [
        task({ id: 1, column: "backlog" }),
        task({ id: 2, column: "in_progress" }),
        task({ id: 3, column: "waiting_on_customer" }),
        task({ id: 4, column: "review" }),
        task({ id: 5, column: "completed" }),
      ],
      phaseNByStepId,
      NOW,
    );
    assert.deepEqual(tasks.map((t) => t.lane), ["backlog", "progress", "waiting", "review", "done"]);
  });

  it("marks a past-due task red and overdue", () => {
    const [t] = toProjectTasks([task({ dueDate: "2026-08-20T00:00:00.000Z" })], phaseNByStepId, NOW);
    assert.equal(t.dueTone, "red");
    assert.equal(t.dueLabel, "3 days overdue");
  });

  it("marks a completed task done, using its own due date when there is no updatedAt", () => {
    const [t] = toProjectTasks([task({ column: "completed", dueDate: "2026-08-11T00:00:00.000Z" })], phaseNByStepId, NOW);
    assert.equal(t.dueTone, "done");
    assert.equal(t.dueLabel, "done 11 Aug");
  });

  it("prefixes a waiting task's owner with 'You · ', matching pjOwnerShort's strip", () => {
    const [t] = toProjectTasks([task({ column: "waiting_on_customer", assignedTo: "IT" })], phaseNByStepId, NOW);
    assert.equal(t.owner, "You · IT");
  });

  it("resolves phase from workflowStepId through the map, defaulting to 0 when unset", () => {
    const [withStep, withoutStep] = toProjectTasks([task({ workflowStepId: 10 }), task({ workflowStepId: null })], phaseNByStepId, NOW);
    assert.equal(withStep.phase, 1);
    assert.equal(withoutStep.phase, 0);
  });
});

describe("toMineItems", () => {
  it("lists only the in-progress tasks", () => {
    const items = toMineItems([task({ column: "in_progress", title: "A", dueDate: "2026-08-27T00:00:00.000Z" }), task({ column: "backlog", title: "B" })]);
    assert.deepEqual(items, [{ title: "A", due: "27 Aug" }]);
  });
});

describe("toScopeBars", () => {
  it("counts real phases and tasks closed, and elapsed time as a percentage", () => {
    const g = toLiveProjectGeometry(STEPS, [], PROJECT, NOW);
    const tasks = [task({ column: "completed" }), task({ column: "backlog" })];
    const bars = toScopeBars(g.phases, tasks, g.todayDay, g.winDays);
    assert.equal(bars[0].value, "1 of 3");
    assert.equal(bars[1].value, "1 of 2");
    assert.equal(bars[2].pct, Math.round((g.todayDay / g.winDays) * 100));
  });
});
