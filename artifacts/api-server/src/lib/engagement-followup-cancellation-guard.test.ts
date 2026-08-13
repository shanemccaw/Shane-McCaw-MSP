import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./logger", () => {
  const noop = () => {};
  const child = { info: noop, warn: noop, error: noop, debug: noop };
  return { logger: { child: () => child, ...child } };
});

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => ({ type: "eq", args }),
  and: (...args: unknown[]) => ({ type: "and", args }),
  isNotNull: (...args: unknown[]) => ({ type: "isNotNull", args }),
  desc: (...args: unknown[]) => ({ type: "desc", args }),
}));

// Chainable + thenable stub — every chain method returns the same object, and
// awaiting it resolves the next queued result.
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
  usersTable: { id: "u.id", email: "u.email" },
  leadsTable: { id: "l.id", email: "l.email" },
  engagementOfferFiringsTable: { id: "f.id", leadId: "f.lead_id", followUpRunId: "f.follow_up_run_id", firedAt: "f.fired_at" },
  engagementOfferRulesTable: { id: "r.id", eligibleServiceIds: "r.eligible_service_ids" },
  wfRunsTable: { id: "wr.id", status: "wr.status" },
}));

import { cancelConflictingEngagementFollowup } from "./engagement-followup-cancellation-guard";

beforeEach(() => {
  selectQueue = [];
  updateSet.mockClear();
});

describe("cancelConflictingEngagementFollowup", () => {
  it("no-ops when clientId is missing from the payload", async () => {
    const result = await cancelConflictingEngagementFollowup({ serviceIds: "14" });
    expect(result).toMatchObject({ checked: false, matched: false, cancelledCount: 0, reason: "missing_client_id" });
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("no-ops on the packageKey-only purchase shape (no serviceIds in payload)", async () => {
    const result = await cancelConflictingEngagementFollowup({ clientId: 5 });
    expect(result).toMatchObject({ checked: false, matched: false, cancelledCount: 0, reason: "no_service_ids_in_payload" });
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("no-ops when the purchaser user has no matching lead by email", async () => {
    selectQueue = [
      [{ email: "buyer@example.com" }], // user lookup
      [], // lead lookup — no match
    ];
    const result = await cancelConflictingEngagementFollowup({ clientId: 5, serviceIds: "14" });
    expect(result).toMatchObject({ checked: true, matched: false, cancelledCount: 0, reason: "no_matching_lead" });
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("no-ops when the lead has a pending run but its rule's eligibleServiceIds doesn't overlap the purchase", async () => {
    selectQueue = [
      [{ email: "buyer@example.com" }], // user lookup
      [{ id: 10 }], // lead lookup
      [{ firingId: 1, runId: 501, eligibleServiceIds: [99] }], // candidates
    ];
    const result = await cancelConflictingEngagementFollowup({ clientId: 5, serviceIds: "14,22" });
    expect(result).toMatchObject({ checked: true, matched: false, cancelledCount: 0, leadId: 10, cancelledRunIds: [] });
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("cancels the overlapping pending run", async () => {
    selectQueue = [
      [{ email: "buyer@example.com" }], // user lookup
      [{ id: 10 }], // lead lookup
      [{ firingId: 1, runId: 501, eligibleServiceIds: [14, 30] }], // candidates
      [{ status: "running" }], // run status check
    ];
    const result = await cancelConflictingEngagementFollowup({ clientId: 5, serviceIds: "14,22" });

    expect(result).toMatchObject({ checked: true, matched: true, cancelledCount: 1, leadId: 10, cancelledRunIds: [501] });
    expect(updateSet).toHaveBeenCalledTimes(1);
    const updatedFields = updateSet.mock.calls[0]![0] as Record<string, unknown>;
    expect(updatedFields.status).toBe("cancelled");
    expect(updatedFields.finishedAt).toBeInstanceOf(Date);
  });

  it("does not re-cancel a matching run that already finished", async () => {
    selectQueue = [
      [{ email: "buyer@example.com" }], // user lookup
      [{ id: 10 }], // lead lookup
      [{ firingId: 1, runId: 501, eligibleServiceIds: [14] }], // candidates
      [{ status: "completed" }], // run already completed
    ];
    const result = await cancelConflictingEngagementFollowup({ clientId: 5, serviceIds: "14" });

    expect(result).toMatchObject({ checked: true, matched: true, cancelledCount: 0, cancelledRunIds: [] });
    expect(updateSet).not.toHaveBeenCalled();
  });
});
