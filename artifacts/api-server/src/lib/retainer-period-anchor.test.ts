/**
 * retainer-period-anchor.test.ts — Git #3473's own priority rule: which real
 * date decides a customer's retainer anniversary anchor day.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let mockSelectResultsQueue: any[][] = [];

vi.mock("@workspace/db", () => {
  const makeSelectChain = () => {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      orderBy: () => Promise.resolve(mockSelectResultsQueue.shift() ?? []),
      limit: () => Promise.resolve(mockSelectResultsQueue.shift() ?? []),
    };
    return chain;
  };
  const col = (name: string) => name;
  return {
    db: { select: vi.fn(() => makeSelectChain()) },
    tenantSubscriptionsTable: {
      tenantId: col("tenant_id"),
      status: col("status"),
      currentPeriodStart: col("current_period_start"),
      startedAt: col("started_at"),
      id: col("id"),
    },
    retainerSettingsTable: {
      customerId: col("customer_id"),
      createdAt: col("created_at"),
    },
  };
});

vi.mock("@workspace/db/schema", () => ({
  TENANT_SUBSCRIPTION_ACTIVE_STATUSES: ["trialing", "active", "past_due"],
}));

vi.mock("drizzle-orm", () => ({
  eq: (l: unknown, r: unknown) => ({ eq: [l, r] }),
  desc: (c: unknown) => ({ desc: c }),
}));

import { anchorDayFromRows, resolveRetainerAnchorDay } from "./retainer-period-anchor.ts";

beforeEach(() => {
  mockSelectResultsQueue = [];
});

describe("anchorDayFromRows — the pure priority rule", () => {
  it("prefers the ACTIVE subscription's real currentPeriodStart day", () => {
    const day = anchorDayFromRows(
      [
        { status: "active", currentPeriodStart: new Date("2026-08-14T00:00:00Z") },
        { status: "canceled", currentPeriodStart: new Date("2026-01-05T00:00:00Z") },
      ],
      null,
    );
    expect(day).toBe(14);
  });

  it("REGRESSION: a customer signed up mid-month (14th) anchors on the 14th, not the 1st", () => {
    const day = anchorDayFromRows([{ status: "active", currentPeriodStart: new Date("2026-08-14T00:00:00Z") }], null);
    expect(day).toBe(14);
    expect(day).not.toBe(1);
  });

  it("falls back to the most recent subscription of ANY status when none is active", () => {
    const day = anchorDayFromRows(
      [
        { status: "canceled", currentPeriodStart: new Date("2026-03-22T00:00:00Z") },
        { status: "canceled", currentPeriodStart: new Date("2026-01-05T00:00:00Z") },
      ],
      null,
    );
    // Rows are contracted to already be ordered most-recent-first.
    expect(day).toBe(22);
  });

  it("falls back to retainer_settings.createdAt when there is no subscription row at all", () => {
    const day = anchorDayFromRows([], new Date("2026-06-09T00:00:00Z"));
    expect(day).toBe(9);
  });

  it("falls back to day 1 (the old calendar-month shape) when nothing at all is known", () => {
    expect(anchorDayFromRows([], null)).toBe(1);
  });

  it("skips a subscription row with a null currentPeriodStart (not reported by Stripe yet)", () => {
    const day = anchorDayFromRows(
      [
        { status: "active", currentPeriodStart: null },
        { status: "canceled", currentPeriodStart: new Date("2026-05-17T00:00:00Z") },
      ],
      null,
    );
    expect(day).toBe(17);
  });
});

describe("resolveRetainerAnchorDay — DB-backed one-shot resolution", () => {
  it("uses the active subscription and skips the settings query when a settingsCreatedAt fallback is given", async () => {
    mockSelectResultsQueue = [[{ status: "active", currentPeriodStart: new Date("2026-08-14T00:00:00Z") }]];
    const day = await resolveRetainerAnchorDay(42, { settingsCreatedAt: new Date("2026-01-01T00:00:00Z") });
    expect(day).toBe(14);
  });

  it("fetches retainer_settings.createdAt itself when no fallback is passed and there is no subscription", async () => {
    mockSelectResultsQueue = [[], [{ createdAt: new Date("2026-06-09T00:00:00Z") }]];
    const day = await resolveRetainerAnchorDay(42);
    expect(day).toBe(9);
  });

  it("resolves to day 1 when there is neither a subscription nor a settings row", async () => {
    mockSelectResultsQueue = [[], []];
    const day = await resolveRetainerAnchorDay(42);
    expect(day).toBe(1);
  });
});
