/**
 * portal-retainer.test.ts — the customer-facing read for "My Architect" (#1285).
 *
 * Covers the two states `useRetainerLive.ts` distinguishes:
 *   1. No active `retainer_settings` row — `configured: false`, honest empty
 *      bucket/entries so the page falls back to its design fixture.
 *   2. An active row with ledger entries — `configured: true`, the bucket
 *      arithmetic (retained/rolled/used) and every entry mapped to the same
 *      wire shape `admin-retainer.ts` already proves out, MINUTES converted
 *      to decimal HOURS.
 * And the scope guard: a session with no `customerId` claim gets 400, never a
 * DB read for someone else's ledger.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

let mockSelectResultsQueue: any[][] = [];

vi.mock("@workspace/db", () => {
  const makeSelectChain = () => {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(mockSelectResultsQueue.shift() ?? []),
      then: (onfulfilled: any, onrejected?: any) =>
        Promise.resolve(mockSelectResultsQueue.shift() ?? []).then(onfulfilled, onrejected),
    };
    return chain;
  };
  const col = (name: string) => name;
  return {
    db: { select: vi.fn(() => makeSelectChain()) },
    retainerSettingsTable: {
      customerId: col("customer_id"),
      retainedMinutesPerMonth: col("retained_minutes_per_month"),
      hourlyRateCents: col("hourly_rate_cents"),
      architectName: col("architect_name"),
      active: col("active"),
    },
    retainerWorkLogTable: {
      customerId: col("customer_id"),
      occurredAt: col("occurred_at"),
    },
    RETAINER_WORK_STATES: ["in_progress", "closed", "in_review", "scheduled"],
  };
});

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (_req: any, _res: any, next: () => void) => next(),
  requireAdmin: (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock("../lib/portal-customer-scope", () => ({
  resolveCustomerId: (req: any) => req.user?.customerId ?? null,
}));

vi.mock("../lib/logger", () => {
  const child = vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child }));
  return { logger: { child, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

vi.mock("drizzle-orm", () => ({
  eq: (l: unknown, r: unknown) => ({ eq: [l, r] }),
  desc: (c: unknown) => ({ desc: c }),
}));

import router from "./portal-retainer";

function makeApp(user: Record<string, unknown> | null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (user) (req as any).user = user;
    next();
  });
  app.use("/api", router);
  return app;
}

beforeEach(() => {
  mockSelectResultsQueue = [];
});

describe("GET /api/portal/retainer", () => {
  it("400s when the session carries no customerId claim", async () => {
    const res = await request(makeApp({ id: 1 })).get("/api/portal/retainer");
    expect(res.status).toBe(400);
  });

  it("reports configured:false with an honest empty ledger when no retainer row exists", async () => {
    mockSelectResultsQueue = [[], []]; // settings, entries
    const res = await request(makeApp({ id: 1, customerId: 42 })).get("/api/portal/retainer");
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.settings).toBeNull();
    expect(res.body.entries).toEqual([]);
    // default 8.0h allotment, nothing used
    expect(res.body.bucket.retainedHours).toBe(8);
    expect(res.body.bucket.usedHours).toBe(0);
  });

  it("reports configured:true with the real bucket and entries, minutes converted to hours", async () => {
    mockSelectResultsQueue = [
      [{ customerId: 42, retainedMinutesPerMonth: 480, hourlyRateCents: 30000, architectName: "Priya Raman", active: true }],
      [
        {
          id: 9,
          customerId: 42,
          periodMonth: "2026-08",
          weekLabel: "W34",
          item: "Cleared sync errors",
          minutes: 90,
          pillar: "Health",
          finding: "HLT-02",
          outcome: "Fixed",
          state: "closed",
          source: "unscoped",
          sourceRefId: null,
          occurredAt: new Date("2026-08-20T00:00:00Z"),
        },
      ],
    ];
    const res = await request(makeApp({ id: 1, customerId: 42 })).get("/api/portal/retainer");
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.settings.retainedHours).toBe(8);
    expect(res.body.bucket.usedHours).toBe(1.5);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0]).toMatchObject({
      item: "Cleared sync errors",
      hours: 1.5,
      pillar: "Health",
      finding: "HLT-02",
      state: "Closed",
    });
  });

  it("does not surface an inactive retainer as configured", async () => {
    mockSelectResultsQueue = [
      [{ customerId: 42, retainedMinutesPerMonth: 480, hourlyRateCents: 30000, architectName: null, active: false }],
      [],
    ];
    const res = await request(makeApp({ id: 1, customerId: 42 })).get("/api/portal/retainer");
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
  });
});
