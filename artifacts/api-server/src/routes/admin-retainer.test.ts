/**
 * admin-retainer.test.ts — Git #3473's anniversary wiring in the AdminV2
 * Retainer module. Focused on proving all three read/write paths that key a
 * period bucket route the customer's real anchor day through, rather than a
 * shared calendar month — the underlying priority rule itself is covered
 * exhaustively in retainer-period-anchor.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

let mockSelectResultsQueue: any[][] = [];
let mockInsertedValues: Record<string, unknown> | null = null;

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
  const insertChain: any = {
    values: (v: Record<string, unknown>) => {
      mockInsertedValues = v;
      return insertChain;
    },
    onConflictDoUpdate: () => Promise.resolve(),
    // Real inserted values, given a fake auto id — proves the route's OWN
    // computed periodMonth (not a canned fixture) reaches the wire.
    returning: () => Promise.resolve([{ id: 1, ...mockInsertedValues }]),
  };
  const col = (name: string) => name;
  return {
    db: { select: vi.fn(() => makeSelectChain()), insert: vi.fn(() => insertChain) },
    retainerSettingsTable: {
      customerId: col("customer_id"),
      createdAt: col("created_at"),
    },
    retainerWorkLogTable: {
      customerId: col("customer_id"),
      occurredAt: col("occurred_at"),
      source: col("source"),
      sourceRefId: col("source_ref_id"),
    },
    tenantsTable: {
      id: col("id"),
      customerName: col("customer_name"),
      mspId: col("msp_id"),
    },
    tenantSubscriptionsTable: {
      tenantId: col("tenant_id"),
      status: col("status"),
      currentPeriodStart: col("current_period_start"),
      startedAt: col("started_at"),
      id: col("id"),
    },
    RETAINER_WORK_STATES: ["in_progress", "closed", "in_review", "scheduled"],
  };
});

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (_req: any, _res: any, next: () => void) => next(),
  requireAdmin: (_req: any, _res: any, next: () => void) => next(),
}));

const mockResolveTenantScope = vi.fn(async (customerId: number) => ({
  mspId: 1,
  tenantId: customerId,
  tenantName: "Acme Co",
}));
vi.mock("../lib/portal-customer-scope", () => ({
  resolveTenantScope: (customerId: number) => mockResolveTenantScope(customerId),
}));

vi.mock("../lib/logger", () => {
  const child = vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child }));
  return { logger: { child, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

const mockResolveRetainerAnchorDay = vi.fn(async () => 14);
const mockAnchorDayFromRows = vi.fn(() => 14);
vi.mock("../lib/retainer-period-anchor", () => ({
  resolveRetainerAnchorDay: (...args: unknown[]) => (mockResolveRetainerAnchorDay as (...a: unknown[]) => unknown)(...args),
  anchorDayFromRows: (...args: unknown[]) => (mockAnchorDayFromRows as (...a: unknown[]) => unknown)(...args),
}));

vi.mock("drizzle-orm", () => ({
  eq: (l: unknown, r: unknown) => ({ eq: [l, r] }),
  and: (...conds: unknown[]) => ({ and: conds }),
  desc: (c: unknown) => ({ desc: c }),
}));

import router from "./admin-retainer";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return app;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
  mockSelectResultsQueue = [];
  mockInsertedValues = null;
  mockResolveTenantScope.mockClear();
  mockResolveRetainerAnchorDay.mockClear();
  mockResolveRetainerAnchorDay.mockImplementation(async () => 14);
  mockAnchorDayFromRows.mockClear();
  mockAnchorDayFromRows.mockImplementation(() => 14);
});

describe("GET /api/admin/retainer/customers — Git #3473 bulk anniversary wiring", () => {
  it("resolves each customer's anchor day from bulk-fetched subscription rows, not a shared calendar period", async () => {
    mockSelectResultsQueue = [
      [{ id: 42, name: "Acme Co", mspId: 1 }], // tenants
      [{ customerId: 42, retainedMinutesPerMonth: 480, active: true, architectName: null, createdAt: new Date("2026-01-01Z") }], // settings
      [{ customerId: 42, periodMonth: "2026-08-14", minutes: 90 }], // work log
      [{ tenantId: 42, status: "active", currentPeriodStart: new Date("2026-08-14T00:00:00Z"), startedAt: new Date("2026-01-14T00:00:00Z"), id: 1 }], // subscriptions
    ];
    const res = await request(makeApp()).get("/api/admin/retainer/customers");
    expect(res.status).toBe(200);
    // The bulk route never calls the one-shot resolver — it uses the pure,
    // pre-fetched-rows version instead (no N+1 round trip per customer).
    expect(mockResolveRetainerAnchorDay).not.toHaveBeenCalled();
    expect(mockAnchorDayFromRows).toHaveBeenCalledWith(
      [{ status: "active", currentPeriodStart: new Date("2026-08-14T00:00:00Z") }],
      new Date("2026-01-01Z"),
    );
    expect(res.body.customers[0].bucket.period).toBe("2026-08-14");
    expect(res.body.customers[0].bucket.usedHours).toBe(1.5);
  });
});

describe("GET /api/admin/retainer/:customerId — Git #3473 anniversary wiring", () => {
  it("resolves the anchor day via the one-shot resolver, passing the already-loaded settings.createdAt", async () => {
    const settingsCreatedAt = new Date("2026-02-01Z");
    mockSelectResultsQueue = [
      [{ customerId: 42, retainedMinutesPerMonth: 480, hourlyRateCents: 30000, architectName: null, active: true, createdAt: settingsCreatedAt }], // settings
      [{ customerId: 42, periodMonth: "2026-08-14", minutes: 60, occurredAt: new Date("2026-08-20Z") }], // entries
    ];
    const res = await request(makeApp()).get("/api/admin/retainer/42");
    expect(res.status).toBe(200);
    expect(mockResolveRetainerAnchorDay).toHaveBeenCalledWith(42, { settingsCreatedAt });
    expect(res.body.bucket.period).toBe("2026-08-14");
  });
});

describe("POST /api/admin/retainer/:customerId/unscoped — Git #3473 anniversary wiring", () => {
  it("keys the new entry's periodMonth off the resolved anchor day, not the calendar date it was logged on", async () => {
    mockResolveRetainerAnchorDay.mockImplementation(async () => 14);
    const res = await request(makeApp())
      .post("/api/admin/retainer/42/unscoped")
      .send({ item: "ad-hoc", hours: 1, occurredAt: "2026-08-13T00:00:00.000Z" });
    expect(res.status).toBe(201);
    expect(mockResolveRetainerAnchorDay).toHaveBeenCalledWith(42);
    // 2026-08-13 is before this customer's real 14th anniversary — the entry's
    // period is keyed for the PRIOR period, not "2026-08".
    expect(res.body.entry.periodMonth).toBe("2026-07-14");
  });
});
