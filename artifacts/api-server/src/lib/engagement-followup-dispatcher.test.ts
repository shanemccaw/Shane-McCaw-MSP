import { describe, it, expect, vi, beforeEach } from "vitest";

// fireWorkflowForDefinition is statically imported ("./workflow-executor") by the
// dispatcher, so the mock factory reads it at module-eval time — hoist above vi.mock.
const { fireWorkflowForDefinition } = vi.hoisted(() => ({
  fireWorkflowForDefinition: vi.fn(
    (_defId: number, _triggerType: string, _triggerRef: string, _payload: Record<string, unknown>) =>
      Promise.resolve<number | null>(501),
  ),
}));
vi.mock("./workflow-executor", () => ({ fireWorkflowForDefinition }));

vi.mock("./logger", () => {
  const noop = () => {};
  const child = { info: noop, warn: noop, error: noop, debug: noop };
  return { logger: { child: () => child, ...child } };
});

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => ({ type: "eq", args }),
  and: (...args: unknown[]) => ({ type: "and", args }),
  isNull: (...args: unknown[]) => ({ type: "isNull", args }),
  gte: (...args: unknown[]) => ({ type: "gte", args }),
  inArray: (...args: unknown[]) => ({ type: "inArray", args }),
  sql: (strings: TemplateStringsArray, ...vals: unknown[]) => ({ type: "sql", strings, vals }),
}));

// Chainable + thenable stub — every chain method (.from/.innerJoin/.where/.limit/
// .orderBy) returns the same object, and awaiting it resolves the next queued
// result. Lets one mock shape cover both join-then-where and where-then-limit chains.
function chainStub(queue: unknown[][]): Record<string, (...a: unknown[]) => unknown> {
  const obj: Record<string, (...a: unknown[]) => unknown> = {
    from: () => obj,
    innerJoin: () => obj,
    where: () => obj,
    limit: () => obj,
    orderBy: () => obj,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(queue.shift() ?? []).then(resolve, reject),
  };
  return obj;
}

let selectQueue: unknown[][] = [];
const updateSet = vi.fn((_v: unknown) => ({ where: () => Promise.resolve() }));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => chainStub(selectQueue),
    update: () => ({ set: (v: unknown) => updateSet(v) }),
  },
  engagementOfferFiringsTable: { id: "f.id", leadId: "f.lead_id", ruleId: "f.rule_id", firedAt: "f.fired_at", followUpDispatchedAt: "f.follow_up_dispatched_at", followUpRunId: "f.follow_up_run_id" },
  engagementOfferRulesTable: { id: "r.id", name: "r.name", eligibleServiceIds: "r.eligible_service_ids", discountPct: "r.discount_pct" },
  leadsTable: { id: "l.id", email: "l.email", name: "l.name" },
  servicesTable: { id: "s.id", name: "s.name" },
  wfDefinitionsTable: { id: "d.id", name: "d.name" },
}));

import { dispatchPendingEngagementFollowups } from "./engagement-followup-dispatcher";

beforeEach(() => {
  selectQueue = [];
  updateSet.mockClear();
  fireWorkflowForDefinition.mockClear();
  fireWorkflowForDefinition.mockResolvedValue(501);
});

describe("dispatchPendingEngagementFollowups", () => {
  it("does nothing when no firings are pending dispatch", async () => {
    selectQueue = [[]]; // firings query
    const result = await dispatchPendingEngagementFollowups();
    expect(result).toEqual({ checked: 0, dispatched: 0 });
    expect(fireWorkflowForDefinition).not.toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("skips dispatch entirely when the Delayed Follow-Up definition isn't found", async () => {
    selectQueue = [
      [{ id: 1, leadId: 10, ruleId: 1, ruleName: "Rule A", eligibleServiceIds: [14], discountPct: 15 }], // firings
      [], // def lookup — not found
    ];
    const result = await dispatchPendingEngagementFollowups();
    expect(result).toEqual({ checked: 1, dispatched: 0 });
    expect(fireWorkflowForDefinition).not.toHaveBeenCalled();
  });

  it("spawns a run per firing, resolves lead + service names, and marks the firing dispatched", async () => {
    selectQueue = [
      [{ id: 1, leadId: 10, ruleId: 1, ruleName: "Rule A", eligibleServiceIds: [14, 22], discountPct: 15 }], // firings
      [{ id: 900 }], // def lookup
      [{ email: "lead@example.com", name: "Jane Lead" }], // lead lookup
      [{ name: "M365 Security Baseline" }, { name: "Quick-Start Pack" }], // service names
    ];

    const result = await dispatchPendingEngagementFollowups();

    expect(result).toEqual({ checked: 1, dispatched: 1 });
    expect(fireWorkflowForDefinition).toHaveBeenCalledTimes(1);
    const [defId, triggerType, triggerRef, payload] = fireWorkflowForDefinition.mock.calls[0]!;
    expect(defId).toBe(900);
    expect(triggerType).toBe("manual");
    expect(triggerRef).toBe("engagement-firing:1");
    expect(payload).toMatchObject({
      leadId: 10,
      firingId: 1,
      ruleId: 1,
      ruleName: "Rule A",
      eligibleServiceIds: [14, 22],
      discountPct: 15,
      leadEmail: "lead@example.com",
      leadName: "Jane Lead",
      serviceNames: "M365 Security Baseline, Quick-Start Pack",
    });

    expect(updateSet).toHaveBeenCalledTimes(1);
    const updatedFields = updateSet.mock.calls[0]![0] as Record<string, unknown>;
    expect(updatedFields.followUpRunId).toBe(501);
    expect(updatedFields.followUpDispatchedAt).toBeInstanceOf(Date);
  });

  it("marks a firing dispatched without spawning a run when its lead can't be found", async () => {
    selectQueue = [
      [{ id: 2, leadId: 99, ruleId: 1, ruleName: "Rule A", eligibleServiceIds: [14], discountPct: 15 }], // firings
      [{ id: 900 }], // def lookup
      [], // lead lookup — not found
    ];

    const result = await dispatchPendingEngagementFollowups();

    expect(result).toEqual({ checked: 1, dispatched: 0 });
    expect(fireWorkflowForDefinition).not.toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledTimes(1);
    const updatedFields = updateSet.mock.calls[0]![0] as Record<string, unknown>;
    expect(updatedFields.followUpDispatchedAt).toBeInstanceOf(Date);
    expect(updatedFields.followUpRunId).toBeUndefined();
  });

  it("leaves followUpDispatchedAt unset (retry next cycle) when fireWorkflowForDefinition is concurrency-limited", async () => {
    fireWorkflowForDefinition.mockResolvedValueOnce(null);
    selectQueue = [
      [{ id: 3, leadId: 10, ruleId: 1, ruleName: "Rule A", eligibleServiceIds: [], discountPct: 15 }], // firings
      [{ id: 900 }], // def lookup
      [{ email: "lead@example.com", name: "Jane Lead" }], // lead lookup
      // eligibleServiceIds is [] so no services query is issued
    ];

    const result = await dispatchPendingEngagementFollowups();

    expect(result).toEqual({ checked: 1, dispatched: 0 });
    expect(fireWorkflowForDefinition).toHaveBeenCalledTimes(1);
    expect(updateSet).not.toHaveBeenCalled();
  });
});
