/**
 * Git #1947 — the freeze-safe retention clock, and the referential delete guard.
 *
 * These are the two mechanisms #1944 makes irreversible decisions on, so they are
 * tested against the epic's own literal requirements rather than against the
 * implementation's shape:
 *
 *   - a clock must survive a freeze of up to SEVEN YEARS and resume from exactly the
 *     remainder it froze with (part 7). The `deleted_at + 90d` implementation #1947
 *     warns against fails this, in the direction that destroys data early — so that
 *     failure is written out as its own test.
 *   - a soft-deleted dependant STILL blocks (part 5), because otherwise deleting a
 *     POA&M and then its risk defeats the guard in two clicks.
 *   - provenance and references are independent gates and both must pass.
 *
 * Pure functions and in-memory registries only — no database.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  SECONDS_PER_DAY,
  advanceStageClock,
  dueAt,
  freezeClock,
  isDue,
  isFrozen,
  nextStage,
  remainingSeconds,
  resumeClock,
  stageDurations,
  stageSeconds,
  startClock,
} from "./clock";
import {
  __resetReferenceEdgesForTest,
  blockerStillBlocks,
  checkDeleteAllowed,
  formatRefusal,
  listReferenceEdges,
  registerReferenceEdge,
  type DeleteBlocker,
} from "./reference-guard";
import {
  __resetOriginResolversForTest,
  isHardDeleteBypassEligible,
  isManualOrigin,
  registerOriginResolver,
} from "./origin-registry";

const T0 = new Date("2026-01-01T00:00:00.000Z");
const day = (n: number) => new Date(T0.getTime() + n * SECONDS_PER_DAY * 1000);

describe("retention clock — the 90/30 defaults", () => {
  it("counts down in real time while running", () => {
    const clock = startClock(90 * SECONDS_PER_DAY, T0);
    expect(remainingSeconds(clock, T0)).toBe(90 * SECONDS_PER_DAY);
    expect(remainingSeconds(clock, day(30))).toBe(60 * SECONDS_PER_DAY);
    expect(isDue(clock, day(89))).toBe(false);
    expect(isDue(clock, day(90))).toBe(true);
  });

  it("never reports negative remaining time", () => {
    const clock = startClock(90 * SECONDS_PER_DAY, T0);
    expect(remainingSeconds(clock, day(400))).toBe(0);
  });

  it("resolves the stage durations from a policy, not from literals", () => {
    const defaults = stageDurations();
    expect(defaults.softSeconds).toBe(90 * SECONDS_PER_DAY);
    expect(defaults.semiHardSeconds).toBe(30 * SECONDS_PER_DAY);

    // A customer with their own rules — the whole point of a per-customer policy.
    const custom = stageDurations(14, 7);
    expect(stageSeconds("soft", custom)).toBe(14 * SECONDS_PER_DAY);
    expect(stageSeconds("semi_hard", custom)).toBe(7 * SECONDS_PER_DAY);
  });

  it("walks soft → semi_hard → purged and then stops", () => {
    expect(nextStage("soft")).toBe("semi_hard");
    expect(nextStage("semi_hard")).toBe("purged");
    expect(nextStage("purged")).toBeNull();
    expect(nextStage("restored")).toBeNull();
  });
});

describe("retention clock — freeze and resume (#1944 part 7)", () => {
  it("holds the remainder constant across a SEVEN YEAR freeze and resumes from it exactly", () => {
    // Deleted on day 0, frozen on day 89 with one day left.
    let clock = startClock(90 * SECONDS_PER_DAY, T0);
    clock = freezeClock(clock, day(89), "subscription_inactive");

    expect(isFrozen(clock)).toBe(true);
    expect(remainingSeconds(clock, day(89))).toBe(1 * SECONDS_PER_DAY);

    // Seven years pass with the customer gone. The remainder does not move.
    const sevenYearsLater = day(89 + 365 * 7);
    expect(remainingSeconds(clock, sevenYearsLater)).toBe(1 * SECONDS_PER_DAY);
    expect(isDue(clock, sevenYearsLater)).toBe(false);
    expect(dueAt(clock, sevenYearsLater)).toBeNull();

    // They come back. The record is still ghosted with exactly one day left — it did
    // not silently resolve itself and it did not restart.
    clock = resumeClock(clock, sevenYearsLater);
    expect(isFrozen(clock)).toBe(false);
    expect(remainingSeconds(clock, sevenYearsLater)).toBe(1 * SECONDS_PER_DAY);
    expect(isDue(clock, new Date(sevenYearsLater.getTime() + SECONDS_PER_DAY * 1000))).toBe(true);
  });

  it("is exactly what a `deleted_at + 90d` implementation would have got wrong", () => {
    // The failure #1947 names, written out so the regression is visible. A record
    // deleted the day before a three-year cancellation, under a computed target,
    // returns already past its purge date and is swept on the first pass — having
    // spent none of its recoverable window recoverable.
    const deletedAt = T0;
    const naivePurgeAt = new Date(deletedAt.getTime() + 90 * SECONDS_PER_DAY * 1000);
    const returnDate = day(1 + 365 * 3);
    expect(naivePurgeAt.getTime()).toBeLessThan(returnDate.getTime()); // the naive clock says "purge now"

    let clock = startClock(90 * SECONDS_PER_DAY, deletedAt);
    clock = freezeClock(clock, day(1), "subscription_inactive");
    clock = resumeClock(clock, returnDate);
    expect(remainingSeconds(clock, returnDate)).toBe(89 * SECONDS_PER_DAY); // the real clock says "89 days left"
    expect(isDue(clock, returnDate)).toBe(false);
  });

  it("null stage_due_at while frozen keeps the row out of the sweep index", () => {
    let clock = startClock(90 * SECONDS_PER_DAY, T0);
    expect(clock.stageDueAt).toEqual(day(90));
    clock = freezeClock(clock, day(10), "subscription_inactive");
    expect(clock.stageDueAt).toBeNull();
    clock = resumeClock(clock, day(1000));
    expect(clock.stageDueAt).toEqual(day(1080)); // 80 days of remainder, replayed from the resume instant
  });

  it("is idempotent in both directions, so a repeated sweep cannot extend a record's life", () => {
    let clock = startClock(90 * SECONDS_PER_DAY, T0);
    clock = freezeClock(clock, day(10), "subscription_inactive");
    const frozenAt = clock.frozenAt;
    const again = freezeClock(clock, day(50), "subscription_inactive");
    expect(again.frozenAt).toEqual(frozenAt);
    expect(again.stageRemainingSeconds).toBe(80 * SECONDS_PER_DAY);
    expect(again.freezeCount).toBe(1);

    const resumed = resumeClock(again, day(60));
    expect(resumeClock(resumed, day(70))).toEqual(resumed);
  });

  it("accumulates frozen time across several freezes so a long ghost can be explained", () => {
    let clock = startClock(90 * SECONDS_PER_DAY, T0);
    clock = freezeClock(clock, day(10), "subscription_inactive");
    clock = resumeClock(clock, day(40)); // 30 days frozen
    clock = freezeClock(clock, day(50), "subscription_inactive");
    clock = resumeClock(clock, day(60)); // 10 more
    expect(clock.totalFrozenSeconds).toBe(40 * SECONDS_PER_DAY);
    expect(clock.freezeCount).toBe(2);
    // 10 days ran, then 10 more after the first resume: 70 left.
    expect(remainingSeconds(clock, day(60))).toBe(70 * SECONDS_PER_DAY);
  });
});

describe("retention clock — stage advance starts at the boundary, not at the sweep", () => {
  it("does not hand a record extra tier-2 life because the sweep ran late", () => {
    const clock = startClock(90 * SECONDS_PER_DAY, T0); // due day 90
    const sweptAt = day(90.25); // sweep ran six hours late
    const advanced = advanceStageClock(clock, 30 * SECONDS_PER_DAY, sweptAt);

    expect(advanced.stageEnteredAt).toEqual(day(90)); // the real boundary
    expect(advanced.stageDueAt).toEqual(day(120)); // NOT day(120.25)
    expect(remainingSeconds(advanced, sweptAt)).toBe(30 * SECONDS_PER_DAY - 6 * 3600);
  });

  it("leaves a very late record already due, rather than giving its window back", () => {
    const clock = startClock(90 * SECONDS_PER_DAY, T0);
    const advanced = advanceStageClock(clock, 30 * SECONDS_PER_DAY, day(200));
    expect(isDue(advanced, day(200))).toBe(true);
  });
});

describe("referential delete guard (#1944 — H answered: refuse, do not hold)", () => {
  beforeEach(() => {
    __resetReferenceEdgesForTest();
  });

  const target = { recordType: "risks", recordId: "42", tenantId: 1, mspId: 1, label: "Legacy auth still enabled" };

  const blocker = (over: Partial<DeleteBlocker> = {}): DeleteBlocker => ({
    edgeId: "risk-has-open-poam",
    recordType: "poams",
    recordId: "1234",
    label: "POA&M #1234",
    state: "open",
    becauseClause: "is open against it",
    ...over,
  });

  it("allows a delete when no edges are registered for the type", async () => {
    const result = await checkDeleteAllowed(target);
    expect(result.allowed).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it("refuses and NAMES the blocker rather than returning a generic error", async () => {
    registerReferenceEdge({
      id: "risk-has-open-poam",
      protects: "risks",
      blockerType: "poams",
      description: "A risk with an open POA&M against it",
      findBlockers: async () => [blocker()],
    });

    const result = await checkDeleteAllowed(target);
    expect(result.allowed).toBe(false);
    expect(result.message).toBe(
      '"Legacy auth still enabled" cannot be deleted: POA&M #1234 is open against it.',
    );
  });

  it("reports the whole chain, not just the first blocker", async () => {
    registerReferenceEdge({
      id: "risk-has-open-poam",
      protects: "risks",
      blockerType: "poams",
      description: "open POA&M",
      findBlockers: async () => [blocker()],
    });
    registerReferenceEdge({
      id: "risk-signed-into-rbd",
      protects: "risks",
      blockerType: "msp_rbd_versions",
      description: "signed RBD",
      findBlockers: async () => [
        blocker({ edgeId: "risk-signed-into-rbd", recordType: "msp_rbd_versions", recordId: "7", label: "RBD v7", state: "signed", becauseClause: "is signed and references it" }),
      ],
    });

    const result = await checkDeleteAllowed(target);
    expect(result.blockers).toHaveLength(2);
    expect(result.message).toContain("POA&M #1234 is open against it");
    expect(result.message).toContain("RBD v7 is signed and references it");
  });

  it("treats a failing edge as blocking, never as passing", async () => {
    registerReferenceEdge({
      id: "risk-has-open-poam",
      protects: "risks",
      blockerType: "poams",
      description: "open POA&M",
      findBlockers: async () => {
        throw new Error("db unreachable");
      },
    });

    const result = await checkDeleteAllowed(target);
    expect(result.allowed).toBe(false);
    expect(result.blockers[0].state).toBe("check_failed");
  });

  it("refuses duplicate edge ids", () => {
    const edge = {
      id: "dup",
      protects: "risks",
      blockerType: "poams",
      description: "x",
      findBlockers: async () => [],
    };
    registerReferenceEdge(edge);
    expect(() => registerReferenceEdge(edge)).toThrow(/duplicate edge id/);
    expect(listReferenceEdges("risks")).toHaveLength(1);
  });

  it("formats a refusal for an unlabelled record without inventing a name", () => {
    expect(formatRefusal({ recordType: "risks", recordId: "42", tenantId: 1, mspId: 1 }, [blocker()])).toBe(
      "risks 42 cannot be deleted: POA&M #1234 is open against it.",
    );
  });
});

describe("blockerStillBlocks — only purged or genuinely closed stops blocking (#1944 part 5)", () => {
  it("a SOFT-DELETED dependant still blocks — the two-click defeat is the reason", () => {
    expect(blockerStillBlocks({ purged: false, closed: false, softDeleted: true })).toBe(true);
  });

  it("a live, open dependant blocks", () => {
    expect(blockerStillBlocks({ purged: false, closed: false })).toBe(true);
  });

  it("a purged dependant no longer blocks", () => {
    expect(blockerStillBlocks({ purged: true, closed: false })).toBe(false);
  });

  it("a genuinely closed dependant no longer blocks", () => {
    expect(blockerStillBlocks({ purged: false, closed: true })).toBe(false);
  });
});

describe("provenance gate — the hard-delete bypass (#1944 part 1)", () => {
  beforeEach(() => {
    __resetOriginResolversForTest();
  });

  it("offers no bypass for an unregistered record type — an unknown provenance may be evidence", () => {
    expect(isManualOrigin("anything", "manual")).toBe(false);
    expect(isHardDeleteBypassEligible("anything", "manual")).toBe(false);
  });

  it("lets each record class answer with its OWN vocabulary — the enum does not generalize", () => {
    // #1556's four values.
    registerOriginResolver({
      recordType: "msp_sop_runs",
      column: "origin",
      vocabulary: ["policy", "lifecycle", "remediation", "manual"],
      isManual: (raw) => raw === "manual",
    });
    // A completely different real vocabulary on a different class.
    registerOriginResolver({
      recordType: "msp_diagnostic_findings",
      column: "finding_source",
      vocabulary: ["baseline", "policy"],
      isManual: () => false, // every finding is generated; none is a mistake-create
    });

    expect(isHardDeleteBypassEligible("msp_sop_runs", "manual")).toBe(true);
    expect(isHardDeleteBypassEligible("msp_sop_runs", "remediation")).toBe(false);
    expect(isHardDeleteBypassEligible("msp_sop_runs", "policy")).toBe(false);
    // "policy" means something different here, and the shared-enum answer would have
    // had to pretend otherwise.
    expect(isHardDeleteBypassEligible("msp_diagnostic_findings", "policy")).toBe(false);
    expect(isHardDeleteBypassEligible("msp_diagnostic_findings", "baseline")).toBe(false);
  });

  it("treats a null provenance as not-manual", () => {
    registerOriginResolver({
      recordType: "msp_sop_runs",
      column: "origin",
      isManual: (raw) => raw === "manual",
    });
    expect(isManualOrigin("msp_sop_runs", null)).toBe(false);
  });

  it("refuses a second resolver for one class rather than letting import order decide", () => {
    registerOriginResolver({ recordType: "x", column: null, isManual: () => true });
    expect(() => registerOriginResolver({ recordType: "x", column: null, isManual: () => false })).toThrow(
      /already has an origin resolver/,
    );
  });
});

describe("the two gates are independent (#1944 — both must pass)", () => {
  beforeEach(() => {
    __resetOriginResolversForTest();
    __resetReferenceEdgesForTest();
  });

  it("a manual-origin record with a live dependant is still undeletable", async () => {
    registerOriginResolver({ recordType: "risks", column: "origin", isManual: (raw) => raw === "manual" });
    registerReferenceEdge({
      id: "risk-has-open-poam",
      protects: "risks",
      blockerType: "poams",
      description: "open POA&M",
      findBlockers: async () => [
        {
          edgeId: "risk-has-open-poam",
          recordType: "poams",
          recordId: "1234",
          label: "POA&M #1234",
          state: "open",
          becauseClause: "is open against it",
        },
      ],
    });

    // Gate 2 says the bypass may be offered...
    expect(isHardDeleteBypassEligible("risks", "manual")).toBe(true);
    // ...and gate 1 still refuses the delete outright.
    const result = await checkDeleteAllowed({ recordType: "risks", recordId: "42", tenantId: 1, mspId: 1 });
    expect(result.allowed).toBe(false);
  });
});
