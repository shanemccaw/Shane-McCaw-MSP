import { describe, it, expect } from "vitest";
import { evaluateChangeRequestAuthorization } from "./change-control-write-gate";

/**
 * The pure authorization rule decides what may be written to a live tenant, so it
 * is tested in isolation — no DB, no request — the same discipline
 * portal-change-approvals.test.ts follows. Every branch must FAIL CLOSED: the
 * only path to `authorized: true` is an approved, unconsumed, non-terminal CR.
 */
describe("evaluateChangeRequestAuthorization — fail-closed CR gate (#1497)", () => {
  const approvedUnconsumed = {
    found: true,
    status: "pending_approval",
    executorRunId: null,
    approvalComplete: true,
  } as const;

  it("authorizes an approved, unconsumed, pending_approval CR", () => {
    expect(evaluateChangeRequestAuthorization(approvedUnconsumed)).toEqual({ authorized: true });
  });

  it("authorizes an approved, unconsumed, scheduled CR", () => {
    expect(
      evaluateChangeRequestAuthorization({ ...approvedUnconsumed, status: "scheduled" }),
    ).toEqual({ authorized: true });
  });

  it("refuses when no CR is scoped to the tenant (found: false)", () => {
    const v = evaluateChangeRequestAuthorization({
      found: false,
      status: "",
      executorRunId: null,
      approvalComplete: false,
    });
    expect(v.authorized).toBe(false);
  });

  it("refuses a CR whose approval is not complete", () => {
    const v = evaluateChangeRequestAuthorization({ ...approvedUnconsumed, approvalComplete: false });
    expect(v.authorized).toBe(false);
  });

  it("refuses a CR already consumed by a run (executorRunId set) — no double execution", () => {
    const v = evaluateChangeRequestAuthorization({ ...approvedUnconsumed, executorRunId: 42 });
    expect(v).toEqual({ authorized: false, reason: "change request is already executing under run 42" });
  });

  it("refuses a CR already in a terminal state", () => {
    for (const status of ["completed", "rolled_back", "rejected"]) {
      const v = evaluateChangeRequestAuthorization({ ...approvedUnconsumed, status });
      expect(v.authorized, `status=${status}`).toBe(false);
    }
  });

  it("refuses a CR whose status is not an authorizable state even if approvalComplete is true", () => {
    // in_progress means another run already claimed it; complete-but-in_progress
    // must not re-authorize.
    const v = evaluateChangeRequestAuthorization({ ...approvedUnconsumed, status: "in_progress" });
    expect(v.authorized).toBe(false);
  });

  it("evaluates consumption BEFORE state — a consumed CR reports the run, not the state", () => {
    // Ordering matters: a CR that is both in_progress AND has an executorRunId
    // should surface the 'already executing under run N' reason.
    const v = evaluateChangeRequestAuthorization({
      found: true,
      status: "in_progress",
      executorRunId: 7,
      approvalComplete: true,
    });
    expect(v).toEqual({ authorized: false, reason: "change request is already executing under run 7" });
  });
});
