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
 *
 * Also covers `statusReports` (Git #1410, id-space corrected by #1923 — #1589's
 * "stays user-scoped" decision was reversed). `status_reports.customerId`
 * (tenants.id) is the authoritative scope now; `clientUserId` membership in
 * the customer's own linked logins (via `resolveCustomerUserIds(customerId)`
 * — one tenant resolution for the whole route, not a second independent one
 * off `req.user!.id`) stays only as an OR fallback for pre-#1923 rows.
 * Filtered to `reportStatus: "sent"` only.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
    statusReportsTable: {
      id: col("id"),
      customerId: col("customer_id"),
      clientUserId: col("client_user_id"),
      reportStatus: col("report_status"),
      sentAt: col("sent_at"),
    },
    RETAINER_WORK_STATES: ["in_progress", "closed", "in_review", "scheduled"],
  };
});

vi.mock("../middlewares/requireAuth.ts", () => ({
  requireAuth: (_req: any, _res: any, next: () => void) => next(),
  requireAdmin: (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock("../lib/portal-customer-scope.ts", () => ({
  resolveCustomerId: (req: any) => req.user?.customerId ?? null,
}));

const mockResolveCustomerUserIds = vi.fn(async (customerId: number) => [customerId]);
vi.mock("../lib/tenant-signals.ts", () => ({
  resolveCustomerUserIds: (customerId: number) => mockResolveCustomerUserIds(customerId),
}));

// Git #3473 — anniversary-based period bucketing. Its own DB-backed priority
// rule (active subscription → latest subscription → retainer_settings
// .createdAt → day 1) is covered in retainer-period-anchor.test.ts; this route
// pins it to anchor day 1 (the plain calendar-month shape) so the existing
// "August 2026" fixtures below stay meaningful without re-deriving them.
const mockResolveRetainerAnchorDay = vi.fn(async () => 1);
vi.mock("../lib/retainer-period-anchor.ts", () => ({
  resolveRetainerAnchorDay: (...args: unknown[]) => (mockResolveRetainerAnchorDay as (...a: unknown[]) => unknown)(...args),
}));

vi.mock("../lib/logger.ts", () => {
  const child = vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child }));
  return { logger: { child, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

vi.mock("drizzle-orm", () => ({
  eq: (l: unknown, r: unknown) => ({ eq: [l, r] }),
  and: (...conds: unknown[]) => ({ and: conds }),
  or: (...conds: unknown[]) => ({ or: conds }),
  inArray: (l: unknown, r: unknown) => ({ inArray: [l, r] }),
  desc: (c: unknown) => ({ desc: c }),
}));

import router from "./portal-retainer.ts";

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
  // The ledger fixtures below are all written against "now" being inside
  // August 2026 (periodMonth: "2026-08-01" — anchor day 1, pinned via the
  // resolveRetainerAnchorDay mock above) — pin the clock there so
  // portal-retainer.ts's `periodKeyOf(anchorDay, new Date())` "current period"
  // bucket doesn't silently drift as real wall-clock time moves past that month.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
  mockSelectResultsQueue = [];
  mockResolveCustomerUserIds.mockClear();
  mockResolveCustomerUserIds.mockImplementation(async (customerId: number) => [customerId]);
  mockResolveRetainerAnchorDay.mockClear();
  mockResolveRetainerAnchorDay.mockImplementation(async () => 1);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/portal/retainer", () => {
  it("400s when the session carries no customerId claim", async () => {
    const res = await request(makeApp({ id: 1 })).get("/api/portal/retainer");
    expect(res.status).toBe(400);
  });

  it("reports configured:false with an honest empty ledger when no retainer row exists", async () => {
    mockSelectResultsQueue = [[], [], []]; // settings, entries, statusReports
    const res = await request(makeApp({ id: 1, customerId: 42 })).get("/api/portal/retainer");
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.settings).toBeNull();
    expect(res.body.entries).toEqual([]);
    // default 8.0h allotment, nothing used
    expect(res.body.bucket.retainedHours).toBe(8);
    expect(res.body.bucket.usedHours).toBe(0);
    expect(res.body.statusReports).toEqual([]);
  });

  it("reports configured:true with the real bucket and entries, minutes converted to hours", async () => {
    mockSelectResultsQueue = [
      [{ customerId: 42, retainedMinutesPerMonth: 480, hourlyRateCents: 30000, architectName: "Priya Raman", active: true }],
      [
        {
          id: 9,
          customerId: 42,
          periodMonth: "2026-08-01",
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
      [], // statusReports
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

  it("REGRESSION #3473: a customer signed up mid-month (anchor day 14) buckets against THEIR real anniversary, not the calendar month", async () => {
    // Pin the anchor to the 14th — as if this customer's real Stripe
    // currentPeriodStart falls on the 14th, resolved by resolveRetainerAnchorDay
    // (its own DB-backed priority rule is covered in retainer-period-anchor.test.ts).
    mockResolveRetainerAnchorDay.mockImplementation(async () => 14);
    // "now" is pinned to 2026-08-15 (beforeEach) — one day AFTER this
    // customer's real August anniversary (the 14th), so their real "current
    // period" is 2026-08-14..09-13, keyed "2026-08-14".
    mockSelectResultsQueue = [
      [{ customerId: 42, retainedMinutesPerMonth: 480, hourlyRateCents: 30000, architectName: "Priya Raman", active: true }],
      [
        // Logged 2026-08-13 — one day BEFORE this customer's real anniversary,
        // so it belongs to their PRIOR period ("2026-07-14"), not the current
        // one. Under the old shared calendar-month bug this would have wrongly
        // counted as "2026-08" usage alongside a same-calendar-month entry.
        {
          id: 10,
          customerId: 42,
          periodMonth: "2026-07-14",
          weekLabel: "W33",
          item: "Pre-anniversary work",
          minutes: 120,
          pillar: null,
          finding: null,
          outcome: null,
          state: "closed",
          source: "unscoped",
          sourceRefId: null,
          occurredAt: new Date("2026-08-13T00:00:00Z"),
        },
        // Logged 2026-08-20 — inside the current real anniversary period.
        {
          id: 11,
          customerId: 42,
          periodMonth: "2026-08-14",
          weekLabel: "W34",
          item: "Post-anniversary work",
          minutes: 90,
          pillar: "Health",
          finding: null,
          outcome: null,
          state: "closed",
          source: "unscoped",
          sourceRefId: null,
          occurredAt: new Date("2026-08-20T00:00:00Z"),
        },
      ],
      [], // statusReports
    ];
    const res = await request(makeApp({ id: 1, customerId: 42 })).get("/api/portal/retainer");
    expect(res.status).toBe(200);
    // Only the post-anniversary 1.5h counts as THIS period's usage.
    expect(res.body.bucket.usedHours).toBe(1.5);
    // The pre-anniversary period retained 8h, used only 2h → 6h rolls forward.
    expect(res.body.bucket.rolledHours).toBe(6);
    expect(res.body.bucket.period).toBe("2026-08-14");
    expect(res.body.entries).toHaveLength(2);
  });

  it("does not surface an inactive retainer as configured", async () => {
    mockSelectResultsQueue = [
      [{ customerId: 42, retainedMinutesPerMonth: 480, hourlyRateCents: 30000, architectName: null, active: false }],
      [],
      [],
    ];
    const res = await request(makeApp({ id: 1, customerId: 42 })).get("/api/portal/retainer");
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
  });
});

describe("GET /api/portal/retainer — statusReports (Git #1410, id-space corrected by #1923)", () => {
  it("scopes status_reports via resolveCustomerUserIds(customerId) — the SAME tenants.id that scopes the ledger, fanned out to its users.id set, NOT a second resolution off req.user.id", async () => {
    mockResolveCustomerUserIds.mockImplementation(async (customerId: number) => {
      expect(customerId).toBe(42); // the JWT's customerId (tenants.id), NOT the caller's users.id=7
      return [7, 8]; // every login linked to that tenant
    });
    mockSelectResultsQueue = [
      [], // settings
      [], // entries
      [
        {
          id: 5,
          title: "August status report",
          period: "monthly",
          executiveSummary: "Good month.",
          completedActivities: [{ title: "Cleared sync errors", description: "" }],
          keyOutcomes: "Compliance score up",
          reportDate: new Date("2026-08-20T00:00:00Z"),
          sentAt: new Date("2026-08-22T00:00:00Z"),
          clientStatus: "pending",
          clientQuestion: null,
          adminReply: null,
          replyThread: [],
        },
      ],
    ];
    const res = await request(makeApp({ id: 7, customerId: 42 })).get("/api/portal/retainer");
    expect(res.status).toBe(200);
    expect(mockResolveCustomerUserIds).toHaveBeenCalledWith(42);
    expect(res.body.statusReports).toHaveLength(1);
    expect(res.body.statusReports[0]).toMatchObject({
      id: 5,
      title: "August status report",
      keyOutcomes: "Compliance score up",
      clientStatus: "pending",
    });
    expect(res.body.statusReports[0].sentAt).toBe("2026-08-22T00:00:00.000Z");
  });

  it("returns statusReports independently of configured — a customer can have sent reports with no active retainer row", async () => {
    mockSelectResultsQueue = [
      [], // settings — no retainer row
      [], // entries
      [
        {
          id: 6,
          title: "Report without a retainer",
          period: "other",
          executiveSummary: null,
          completedActivities: [],
          keyOutcomes: null,
          reportDate: null,
          sentAt: new Date("2026-08-10T00:00:00Z"),
          clientStatus: "accepted",
          clientQuestion: null,
          adminReply: null,
          replyThread: [],
        },
      ],
    ];
    const res = await request(makeApp({ id: 1, customerId: 42 })).get("/api/portal/retainer");
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.statusReports).toHaveLength(1);
  });

  it("#1923: an unclaimed customer (empty users.id set) still gets its own customerId-scoped reports, not []", async () => {
    mockResolveCustomerUserIds.mockImplementation(async () => []); // customer has no linked logins
    // Unlike pre-#1923 (which short-circuited to [] when customerUserIds was
    // empty), the status_reports query still runs — customerId alone is now
    // enough to find reports, exactly the case clientUserId-only scoping made
    // invisible: a customer with no linked portal login can still have real
    // published reports.
    mockSelectResultsQueue = [
      [], // settings
      [], // entries
      [
        {
          id: 9,
          title: "Report for an unclaimed customer",
          period: "other",
          executiveSummary: null,
          completedActivities: [],
          keyOutcomes: null,
          reportDate: null,
          sentAt: new Date("2026-08-05T00:00:00Z"),
          clientStatus: "pending",
          clientQuestion: null,
          adminReply: null,
          replyThread: [],
        },
      ],
    ];
    const res = await request(makeApp({ id: 1, customerId: 42 })).get("/api/portal/retainer");
    expect(res.status).toBe(200);
    expect(mockResolveCustomerUserIds).toHaveBeenCalledWith(42);
    expect(res.body.statusReports).toHaveLength(1);
    expect(res.body.statusReports[0]).toMatchObject({ id: 9, title: "Report for an unclaimed customer" });
  });
});
