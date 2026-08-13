import { describe, it, expect, vi } from "vitest";

// sla-uptime.ts imports { db, m365ServiceHealthSamplesTable } from "@workspace/db"
// at module scope, which throws immediately in this environment (no
// DATABASE_URL — see CLAUDE.md, no live DB access here). These tests only
// exercise the pure computeWeightedUptime/isUpStatus helpers, so the DB
// client itself is never called — a minimal mock is enough to let the
// module import succeed.
vi.mock("@workspace/db", () => ({ db: {}, m365ServiceHealthSamplesTable: {} }));
vi.mock("drizzle-orm", () => ({
  and: () => ({}), asc: () => ({}), desc: () => ({}), eq: () => ({}), gt: () => ({}), lte: () => ({}),
}));

import { computeWeightedUptime, isUpStatus, SLA_TARGET_UPTIME_PERCENT } from "./sla-uptime";

describe("sla-uptime: isUpStatus mapping", () => {
  it("treats the baseline healthy statuses as up", () => {
    expect(isUpStatus("serviceOperational")).toBe(true);
    expect(isUpStatus("serviceRestored")).toBe(true);
    expect(isUpStatus("resolved")).toBe(true);
    expect(isUpStatus("falsePositive")).toBe(true);
  });

  it("treats the ambiguous-but-resolved statuses as up (aligned with public-status.ts)", () => {
    expect(isUpStatus("postIncidentReviewPublished")).toBe(true);
    expect(isUpStatus("resolvedExternal")).toBe(true);
    expect(isUpStatus("investigationSuspended")).toBe(true);
  });

  it("treats active-impact and unresolved statuses as down", () => {
    expect(isUpStatus("investigating")).toBe(false);
    expect(isUpStatus("restoringService")).toBe(false);
    expect(isUpStatus("verifyingService")).toBe(false);
    expect(isUpStatus("serviceDegradation")).toBe(false);
    expect(isUpStatus("serviceInterruption")).toBe(false);
    expect(isUpStatus("extendedRecovery")).toBe(false);
    expect(isUpStatus("confirmed")).toBe(false);
    expect(isUpStatus("reported")).toBe(false);
  });

  it("treats mitigated (but not resolved) as down — impact reduced, not confirmed over", () => {
    expect(isUpStatus("mitigated")).toBe(false);
    expect(isUpStatus("mitigatedExternal")).toBe(false);
  });

  it("defaults unknown/future values to down, not silently up", () => {
    expect(isUpStatus("unknownFutureValue")).toBe(false);
    expect(isUpStatus("someBrandNewGraphStatus")).toBe(false);
  });
});

describe("sla-uptime: computeWeightedUptime (time-weighted, not sample-averaged)", () => {
  const HOUR_MS = 60 * 60 * 1000;
  const windowStart = new Date("2026-06-01T00:00:00Z");

  it("weights a single degraded hour out of a 720-hour (30-day) window to ~99.86%, not a flat per-sample average", () => {
    const windowEnd = new Date(windowStart.getTime() + 720 * HOUR_MS);
    const points = [
      { status: "serviceOperational", at: windowStart },
      { status: "serviceInterruption", at: new Date(windowStart.getTime() + 100 * HOUR_MS) },
      { status: "serviceRestored", at: new Date(windowStart.getTime() + 101 * HOUR_MS) },
    ];

    const { totalMs, upMs } = computeWeightedUptime(points, windowStart, windowEnd);
    const uptimePercent = (upMs / totalMs) * 100;

    expect(totalMs).toBe(720 * HOUR_MS);
    expect(uptimePercent).toBeCloseTo(99.8611, 3);
    expect(uptimePercent).toBeLessThan(SLA_TARGET_UPTIME_PERCENT);
    // A flat per-sample average (2 of 3 samples "up") would wrongly read ~66.7%.
    expect(uptimePercent).not.toBeCloseTo((2 / 3) * 100, 1);
  });

  it("clamps the first sample's effective start to windowStart, never crediting time before the window", () => {
    const beforeWindow = new Date(windowStart.getTime() - 10 * HOUR_MS);
    const windowEnd = new Date(windowStart.getTime() + 10 * HOUR_MS);
    const points = [{ status: "serviceOperational", at: beforeWindow }];

    const { totalMs } = computeWeightedUptime(points, windowStart, windowEnd);
    expect(totalMs).toBe(10 * HOUR_MS);
  });

  it("extends the last sample's status through to windowEnd", () => {
    const windowEnd = new Date(windowStart.getTime() + 10 * HOUR_MS);
    const points = [
      { status: "serviceInterruption", at: windowStart },
      { status: "serviceOperational", at: new Date(windowStart.getTime() + 2 * HOUR_MS) },
    ];

    const { totalMs, upMs } = computeWeightedUptime(points, windowStart, windowEnd);
    expect(totalMs).toBe(10 * HOUR_MS);
    // Down for 2h, then up for the remaining 8h through windowEnd.
    expect(upMs).toBe(8 * HOUR_MS);
  });

  it("returns zero duration for an empty points array", () => {
    const windowEnd = new Date(windowStart.getTime() + 10 * HOUR_MS);
    const { totalMs, upMs } = computeWeightedUptime([], windowStart, windowEnd);
    expect(totalMs).toBe(0);
    expect(upMs).toBe(0);
  });
});
