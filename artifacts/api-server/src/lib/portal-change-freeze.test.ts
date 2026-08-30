/**
 * portal-change-freeze.test.ts — the Change Control freeze / blackout
 * calendar derivations (#1500).
 *
 * These decide whether a submission is blocked. They are pure over a stored
 * row plus a clock reading, so the recurrence math and scope matching are
 * pinned here rather than eyeballed against the DB.
 */

import { describe, it, expect } from "vitest";

import {
  findActiveFreeze,
  isWindowActiveAt,
  matchesFreezeScope,
  type FreezeWindowCandidate,
} from "./portal-change-freeze";

function windowFixture(overrides: Partial<FreezeWindowCandidate> = {}): FreezeWindowCandidate {
  return {
    id: 1,
    mspId: 10,
    scope: "global",
    tenantId: null,
    workload: null,
    name: "Quarter close",
    startsAt: new Date("2026-09-01T00:00:00Z"),
    endsAt: new Date("2026-09-03T00:00:00Z"),
    recurrence: "none",
    recurrenceUntil: null,
    active: true,
    ...overrides,
  };
}

describe("isWindowActiveAt", () => {
  it("a one-off ('none') window is active only inside its literal span", () => {
    const w = windowFixture();
    expect(isWindowActiveAt(w, new Date("2026-08-31T23:59:59Z"))).toBe(false);
    expect(isWindowActiveAt(w, new Date("2026-09-01T00:00:00Z"))).toBe(true);
    expect(isWindowActiveAt(w, new Date("2026-09-02T12:00:00Z"))).toBe(true);
    expect(isWindowActiveAt(w, new Date("2026-09-03T00:00:00Z"))).toBe(false); // end is exclusive
  });

  it("an inactive window is never active, regardless of the date", () => {
    const w = windowFixture({ active: false });
    expect(isWindowActiveAt(w, new Date("2026-09-02T00:00:00Z"))).toBe(false);
  });

  it("weekly recurrence matches on the anchored week and not the off week", () => {
    const w = windowFixture({
      startsAt: new Date("2026-08-03T00:00:00Z"), // a Monday
      endsAt: new Date("2026-08-04T00:00:00Z"),
      recurrence: "weekly",
    });
    expect(isWindowActiveAt(w, new Date("2026-08-10T12:00:00Z"))).toBe(true); // one week later
    expect(isWindowActiveAt(w, new Date("2026-08-24T12:00:00Z"))).toBe(true); // three weeks later
    expect(isWindowActiveAt(w, new Date("2026-08-11T12:00:00Z"))).toBe(false); // one day after that week's window closed
    expect(isWindowActiveAt(w, new Date("2026-08-06T12:00:00Z"))).toBe(false); // mid-week, off cadence
  });

  it("monthly recurrence anchors on the same day-of-month each month", () => {
    const w = windowFixture({
      startsAt: new Date("2026-01-28T00:00:00Z"),
      endsAt: new Date("2026-01-29T00:00:00Z"),
      recurrence: "monthly",
    });
    expect(isWindowActiveAt(w, new Date("2026-03-28T12:00:00Z"))).toBe(true);
    expect(isWindowActiveAt(w, new Date("2026-03-15T12:00:00Z"))).toBe(false);
  });

  it("quarterly recurrence steps three months at a time", () => {
    const w = windowFixture({
      startsAt: new Date("2026-01-01T00:00:00Z"),
      endsAt: new Date("2026-01-02T00:00:00Z"),
      recurrence: "quarterly",
    });
    expect(isWindowActiveAt(w, new Date("2026-04-01T12:00:00Z"))).toBe(true);
    expect(isWindowActiveAt(w, new Date("2026-10-01T12:00:00Z"))).toBe(true);
    expect(isWindowActiveAt(w, new Date("2026-07-15T12:00:00Z"))).toBe(false);
  });

  it("annually recurrence anchors on the same date every year", () => {
    const w = windowFixture({
      startsAt: new Date("2026-12-22T00:00:00Z"),
      endsAt: new Date("2027-01-02T00:00:00Z"),
      recurrence: "annually",
    });
    expect(isWindowActiveAt(w, new Date("2028-12-25T12:00:00Z"))).toBe(true);
    expect(isWindowActiveAt(w, new Date("2028-06-01T12:00:00Z"))).toBe(false);
  });

  it("recurrenceUntil bounds how far the cadence repeats", () => {
    const w = windowFixture({
      startsAt: new Date("2026-01-01T00:00:00Z"),
      endsAt: new Date("2026-01-02T00:00:00Z"),
      recurrence: "monthly",
      recurrenceUntil: new Date("2026-03-01T00:00:00Z"),
    });
    expect(isWindowActiveAt(w, new Date("2026-02-01T12:00:00Z"))).toBe(true); // last occurrence within bound
    expect(isWindowActiveAt(w, new Date("2026-04-01T12:00:00Z"))).toBe(false); // past the bound
  });
});

describe("matchesFreezeScope", () => {
  const ctx = { mspId: 10, tenantId: "t-contoso", workload: "Exchange / mail" };

  it("a global window always matches this MSP's changes", () => {
    expect(matchesFreezeScope(windowFixture({ scope: "global" }), ctx)).toBe(true);
  });
  it("a global window never matches a different MSP", () => {
    expect(matchesFreezeScope(windowFixture({ scope: "global", mspId: 99 }), ctx)).toBe(false);
  });
  it("a tenant window matches only its named tenant", () => {
    expect(matchesFreezeScope(windowFixture({ scope: "tenant", tenantId: "t-contoso" }), ctx)).toBe(true);
    expect(matchesFreezeScope(windowFixture({ scope: "tenant", tenantId: "t-fabrikam" }), ctx)).toBe(false);
  });
  it("a workload window matches only its named workload", () => {
    expect(matchesFreezeScope(windowFixture({ scope: "workload", workload: "Exchange / mail" }), ctx)).toBe(true);
    expect(matchesFreezeScope(windowFixture({ scope: "workload", workload: "Identity" }), ctx)).toBe(false);
  });
});

describe("findActiveFreeze", () => {
  const ctx = { mspId: 10, tenantId: "t-contoso", workload: "Exchange / mail" };
  const now = new Date("2026-09-02T12:00:00Z");

  it("returns null when nothing matches", () => {
    expect(findActiveFreeze([], ctx, now)).toBeNull();
    expect(findActiveFreeze([windowFixture({ scope: "tenant", tenantId: "t-other" })], ctx, now)).toBeNull();
  });

  it("returns the first matching+active candidate in the order given", () => {
    const tenantWindow = windowFixture({ id: 2, scope: "tenant", tenantId: "t-contoso", name: "Tenant freeze" });
    const globalWindow = windowFixture({ id: 3, scope: "global", name: "Global freeze" });
    // Caller orders most-specific-first — tenant wins over global here.
    expect(findActiveFreeze([tenantWindow, globalWindow], ctx, now)?.name).toBe("Tenant freeze");
    expect(findActiveFreeze([globalWindow, tenantWindow], ctx, now)?.name).toBe("Global freeze");
  });

  it("skips a matching-scope window whose date range does not cover now", () => {
    const expired = windowFixture({ startsAt: new Date("2026-07-01T00:00:00Z"), endsAt: new Date("2026-08-01T00:00:00Z") });
    expect(findActiveFreeze([expired], ctx, now)).toBeNull();
  });
});
