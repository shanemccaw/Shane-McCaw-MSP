/**
 * portal-change-maintenance.test.ts — the Change Control maintenance-window
 * calendar derivations (#1504).
 *
 * Pure over a stored row plus a booked span, same discipline
 * `portal-change-freeze.test.ts` pins the freeze module's math with.
 */

import { describe, it, expect } from "vitest";

import {
  findMaintenanceCoverage,
  matchesMaintenanceScope,
  spanWithinMaintenanceWindow,
  type MaintenanceWindowCandidate,
} from "./portal-change-maintenance";

function windowFixture(overrides: Partial<MaintenanceWindowCandidate> = {}): MaintenanceWindowCandidate {
  return {
    id: 1,
    mspId: 10,
    scope: "global",
    tenantId: null,
    workload: null,
    name: "Saturday maintenance window",
    startsAt: new Date("2026-09-05T02:00:00Z"),
    endsAt: new Date("2026-09-05T06:00:00Z"),
    recurrence: "none",
    recurrenceUntil: null,
    active: true,
    ...overrides,
  };
}

describe("spanWithinMaintenanceWindow", () => {
  it("a span fully inside a one-off ('none') window is covered", () => {
    const w = windowFixture();
    expect(spanWithinMaintenanceWindow(w, new Date("2026-09-05T03:00:00Z"), new Date("2026-09-05T04:00:00Z"))).toBe(true);
  });

  it("a span that starts before the window is NOT covered", () => {
    const w = windowFixture();
    expect(spanWithinMaintenanceWindow(w, new Date("2026-09-05T01:00:00Z"), new Date("2026-09-05T04:00:00Z"))).toBe(false);
  });

  it("a span that ends after the window is NOT covered — containment, not mere overlap", () => {
    const w = windowFixture();
    expect(spanWithinMaintenanceWindow(w, new Date("2026-09-05T05:00:00Z"), new Date("2026-09-05T07:00:00Z"))).toBe(false);
  });

  it("end is exclusive: a span ending exactly at the window's end is covered", () => {
    const w = windowFixture();
    expect(spanWithinMaintenanceWindow(w, new Date("2026-09-05T05:00:00Z"), new Date("2026-09-05T06:00:00Z"))).toBe(true);
  });

  it("an inactive window covers nothing", () => {
    const w = windowFixture({ active: false });
    expect(spanWithinMaintenanceWindow(w, new Date("2026-09-05T03:00:00Z"), new Date("2026-09-05T04:00:00Z"))).toBe(false);
  });

  it("a start-only (null end) span is a point — covered only when inside the window", () => {
    const w = windowFixture();
    expect(spanWithinMaintenanceWindow(w, new Date("2026-09-05T03:00:00Z"), null)).toBe(true);
    expect(spanWithinMaintenanceWindow(w, new Date("2026-09-05T07:00:00Z"), null)).toBe(false);
  });

  it("weekly recurrence covers the anchored week and not the off week", () => {
    const w = windowFixture({
      startsAt: new Date("2026-08-01T02:00:00Z"), // a Saturday
      endsAt: new Date("2026-08-01T06:00:00Z"),
      recurrence: "weekly",
    });
    expect(spanWithinMaintenanceWindow(w, new Date("2026-08-08T03:00:00Z"), new Date("2026-08-08T04:00:00Z"))).toBe(true); // one week later
    expect(spanWithinMaintenanceWindow(w, new Date("2026-08-05T03:00:00Z"), new Date("2026-08-05T04:00:00Z"))).toBe(false); // off week
  });

  it("recurrenceUntil bounds how far the cadence covers", () => {
    const w = windowFixture({
      startsAt: new Date("2026-08-01T02:00:00Z"),
      endsAt: new Date("2026-08-01T06:00:00Z"),
      recurrence: "weekly",
      recurrenceUntil: new Date("2026-08-08T00:00:00Z"),
    });
    expect(spanWithinMaintenanceWindow(w, new Date("2026-08-15T03:00:00Z"), new Date("2026-08-15T04:00:00Z"))).toBe(false);
  });
});

describe("matchesMaintenanceScope", () => {
  const ctx = { mspId: 10, tenantId: "t-contoso", workload: "Exchange" };

  it("global matches any tenant/workload for the same MSP", () => {
    expect(matchesMaintenanceScope(windowFixture({ scope: "global" }), ctx)).toBe(true);
  });

  it("tenant scope matches only the named tenant", () => {
    expect(matchesMaintenanceScope(windowFixture({ scope: "tenant", tenantId: "t-contoso" }), ctx)).toBe(true);
    expect(matchesMaintenanceScope(windowFixture({ scope: "tenant", tenantId: "t-other" }), ctx)).toBe(false);
  });

  it("a different MSP never matches, regardless of scope", () => {
    expect(matchesMaintenanceScope(windowFixture({ scope: "global", mspId: 99 }), ctx)).toBe(false);
  });
});

describe("findMaintenanceCoverage", () => {
  const ctx = { mspId: 10, tenantId: "t-contoso", workload: "Exchange" };

  it("returns the covering window when one matches", () => {
    const found = findMaintenanceCoverage(
      [windowFixture({ id: 7 })],
      ctx,
      new Date("2026-09-05T03:00:00Z"),
      new Date("2026-09-05T04:00:00Z"),
    );
    expect(found?.id).toBe(7);
  });

  it("returns null — the violation case — when no candidate covers the span (including an empty candidate list)", () => {
    expect(findMaintenanceCoverage([], ctx, new Date("2026-09-05T03:00:00Z"), null)).toBeNull();
    expect(
      findMaintenanceCoverage(
        [windowFixture({ scope: "tenant", tenantId: "t-other" })],
        ctx,
        new Date("2026-09-05T03:00:00Z"),
        new Date("2026-09-05T04:00:00Z"),
      ),
    ).toBeNull();
  });
});
