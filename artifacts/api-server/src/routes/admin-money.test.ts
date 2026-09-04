/**
 * admin-money.test.ts
 *
 * The load-bearing assertions here are:
 *   - every route is requireAdmin-gated;
 *   - `getDirectBusinessMspId` reads `msps.is_direct_business`, not
 *     `req.user.mspId` — this is an admin-only screen, not an MSP operator's
 *     own portal, and a 404 surfaces honestly when that row doesn't exist;
 *   - the summary's revenue/cost/profit/MRR/streak arithmetic reconciles to
 *     the rows the mocked db hands back, so a schema-shape regression shows
 *     up as a wrong number here rather than only in production;
 *   - goals round-trip through the generic `settingsTable` upsert pattern;
 *   - a manually-logged sale ("Log a sale") is validated, persisted through
 *     the same upsert pattern, and actually folds into revenue/sales/streak
 *     rather than living in a separate, easy-to-forget pile.
 *
 * `@workspace/db` is mocked with a generic chainable query builder (same
 * shape as admin-ai-billing-analytics.test.ts) — each `db.select()...` call
 * resolves the next array queued in `selectQueue`, in the exact order the
 * route issues its queries.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

/** Flattens a drizzle `and()`/`sql` condition tree down to its literal/column
 * text fragments, so a test can assert a `where()` call embeds a given
 * column/keyword without depending on drizzle's internal SQL AST shape. */
function flattenCondition(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === "string") {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((n) => flattenCondition(n, out));
    return out;
  }
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (obj["queryChunks"]) {
      flattenCondition(obj["queryChunks"], out);
      return out;
    }
    if ("value" in obj) {
      flattenCondition(obj["value"], out);
      return out;
    }
    Object.values(obj).forEach((v) => flattenCondition(v, out));
  }
  return out;
}

process.env["DATABASE_URL"] = "postgres://test";

let selectQueue: unknown[][] = [];
const insertCalls: { table: string; values: unknown }[] = [];
const whereCalls: unknown[] = [];

vi.mock("@workspace/db", () => {
  const makeSelectChain = (): Record<string, unknown> => {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      leftJoin: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      where: vi.fn((cond: unknown) => {
        whereCalls.push(cond);
        return chain;
      }),
      orderBy: vi.fn(() => chain),
      groupBy: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      then: (resolve: (v: unknown) => unknown) => resolve(selectQueue.shift() ?? []),
    };
    return chain;
  };

  const makeInsertChain = (table: string): Record<string, unknown> => {
    const chain: Record<string, unknown> = {
      values: vi.fn((v: unknown) => {
        insertCalls.push({ table, values: v });
        return chain;
      }),
      onConflictDoUpdate: vi.fn(() => Promise.resolve()),
    };
    return chain;
  };

  return {
    db: {
      select: vi.fn(() => makeSelectChain()),
      insert: vi.fn(() => makeInsertChain("settings")),
    },
    mspsTable: { id: "id", isDirectBusiness: "is_direct_business" },
    mspChargesTable: {
      id: "id",
      mspId: "msp_id",
      amountCents: "amount_cents",
      chargedAt: "charged_at",
      status: "status",
      sowId: "sow_id",
    },
    mspSowsTable: { title: "title", customerId: "customer_id", sowId: "sow_id" },
    tenantsTable: { id: "id", mspId: "msp_id", customerName: "customer_name", isTestbed: "is_testbed" },
    usersTable: { id: "id", tenantId: "tenant_id" },
    clientServicesTable: { id: "id", clientUserId: "client_user_id", serviceId: "service_id", status: "status", billingInterval: "billing_interval" },
    servicesTable: { id: "id", name: "name", priceCents: "price_cents" },
    aiUsageEventsTable: { mspId: "msp_id", occurredAt: "occurred_at", feature: "feature", nodeType: "node_type", costCents: "cost_cents" },
    settingsTable: { key: "key", value: "value", updatedAt: "updated_at" },
  };
});

vi.mock("../middlewares/requireAuth", () => ({
  requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.headers["x-test-admin"] !== "1") {
      res.status(403).json({ error: "not admin" });
      return;
    }
    req.user = { id: 1, email: "admin@test", role: "admin" };
    next();
  },
}));

vi.mock("../lib/logger", () => ({
  logger: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import router, { __resetMoneyCacheForTests } from "./admin-money";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return app;
}

const admin = (r: request.Test) => r.set("x-test-admin", "1");

beforeEach(() => {
  // Every fixture below (chargedAt/monthTrunc/manual-sale timestamps) is
  // written against "now" being inside August 2026 — pin the clock there so
  // the "this month" arithmetic in admin-money.ts doesn't silently drift as
  // real wall-clock time moves past the month the fixtures were authored for.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
  selectQueue = [];
  insertCalls.length = 0;
  whereCalls.length = 0;
  __resetMoneyCacheForTests();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("requireAdmin gating", () => {
  it("rejects an unauthenticated caller on every GET route", async () => {
    const app = buildApp();
    const paths = ["/api/admin/money/summary", "/api/admin/money/goals", "/api/admin/money/ramp", "/api/admin/money/business"];
    for (const path of paths) {
      const res = await request(app).get(path);
      expect(res.status).toBe(403);
    }
  });

  it("rejects an unauthenticated caller on Log a sale", async () => {
    const res = await request(buildApp()).post("/api/admin/money/sales").send({ who: "x", what: "y", amountCents: 100 });
    expect(res.status).toBe(403);
    expect(insertCalls).toHaveLength(0);
  });
});

describe("no direct-business MSP row", () => {
  it("summary reports 404 rather than guessing an mspId", async () => {
    selectQueue.push([]); // the is_direct_business lookup finds nothing
    const res = await admin(request(buildApp()).get("/api/admin/money/summary"));
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/is_direct_business/);
  });
});

describe("GET /admin/money/summary", () => {
  it("reconciles revenue, AI cost, profit, MRR and streak to the mocked rows", async () => {
    selectQueue.push([{ id: 7 }]); // getDirectBusinessMspId
    selectQueue.push([
      // salesRows — two charges this month
      { id: 101, amountCents: 450000, chargedAt: new Date("2026-08-06T00:00:00Z"), sowTitle: "M365 Security Assessment", customerName: "Northwind Traders" },
      { id: 102, amountCents: 320000, chargedAt: new Date("2026-08-04T00:00:00Z"), sowTitle: "Copilot Readiness Assessment", customerName: "Fabrikam Inc" },
    ]);
    selectQueue.push([]); // readManualSales — none logged
    selectQueue.push([{ cents: 8640000 }]); // lifetimeRow
    selectQueue.push([{ feature: "generate_document", cents: 118000 }]); // aiRows
    selectQueue.push([
      // retainers
      { id: 1, customerName: "Contoso Ltd", serviceName: "Architect Retainer", priceCents: 240000, billingInterval: "month" },
      { id: 2, customerName: "Adventure Works", serviceName: "Architect Retainer", priceCents: 240000, billingInterval: "month" },
    ]);
    selectQueue.push([{ monthTrunc: "2026-08-01T00:00:00.000Z", cents: 770000 }]); // trendRowsRaw
    selectQueue.push([
      // countRowsRaw — trailing 12 months, one prior month meeting a 3-sale goal
      { monthTrunc: "2026-07-01T00:00:00.000Z", n: 3 },
    ]);
    selectQueue.push([{ key: "admin.money.goals", value: JSON.stringify({ goalSales: 3, mrrGoalCents: 600000, ramp: [] }) }]); // readGoals

    const res = await admin(request(buildApp()).get("/api/admin/money/summary"));

    expect(res.status).toBe(200);
    expect(res.body.mspId).toBe(7);
    expect(res.body.revenue.cents).toBe(770000);
    expect(res.body.cost.cents).toBe(118000);
    expect(res.body.cost.byFeature).toEqual([{ label: "generate_document", cents: 118000 }]);
    expect(res.body.profit.cents).toBe(770000 - 118000);
    expect(res.body.lifetimeRevenue.cents).toBe(8640000);
    expect(res.body.sales.count).toBe(2);
    expect(res.body.sales.goal).toBe(3);
    expect(res.body.sales.items).toHaveLength(2);
    expect(res.body.sales.items[0]).toMatchObject({ who: "Northwind Traders", what: "M365 Security Assessment", amountCents: 450000 });
    expect(res.body.retainers).toHaveLength(2);
    expect(res.body.mrr.cents).toBe(480000);
    expect(res.body.mrr.goalCents).toBe(600000);
    expect(res.body.streak).toBe(1); // July hit its 3-sale goal; August itself is excluded (in progress)
    expect(res.body.trend).toHaveLength(6);
    expect(res.body.trend[5]).toMatchObject({ month: "2026-08", cents: 770000 });
  });

  it("annualises a yearly retainer into MRR", async () => {
    selectQueue.push([{ id: 7 }]);
    selectQueue.push([]); // no sales this month
    selectQueue.push([]); // readManualSales — none logged
    selectQueue.push([{ cents: 0 }]);
    selectQueue.push([]); // no AI usage
    selectQueue.push([{ id: 3, customerName: "Tailspin Toys", serviceName: "Retainer", priceCents: 1200000, billingInterval: "year" }]);
    selectQueue.push([]); // trend
    selectQueue.push([]); // counts
    selectQueue.push([]); // goals — defaults

    const res = await admin(request(buildApp()).get("/api/admin/money/summary"));
    expect(res.status).toBe(200);
    expect(res.body.mrr.cents).toBe(100000); // 1,200,000 / 12
    expect(res.body.sales.goal).toBe(3); // default goal, no settings row
  });
});

describe("GET/PUT /admin/money/goals", () => {
  it("returns defaults when no settings row exists", async () => {
    selectQueue.push([]);
    const res = await admin(request(buildApp()).get("/api/admin/money/goals"));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, goalSales: 3, mrrGoalCents: 600_000, ramp: [] });
  });

  it("merges and persists a partial update through the settingsTable upsert", async () => {
    selectQueue.push([{ key: "admin.money.goals", value: JSON.stringify({ goalSales: 3, mrrGoalCents: 600000, ramp: [] }) }]);
    const res = await admin(
      request(buildApp())
        .put("/api/admin/money/goals")
        .send({ goalSales: 5, ramp: [{ month: "2026-09", target: 4 }] }),
    );
    expect(res.status).toBe(200);
    expect(res.body.goalSales).toBe(5);
    expect(res.body.mrrGoalCents).toBe(600000); // untouched field carried over
    expect(res.body.ramp).toEqual([{ month: "2026-09", target: 4 }]);
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].table).toBe("settings");
  });
});

describe("GET /admin/money/ramp", () => {
  it("projects target months using the real trailing-average sale value", async () => {
    selectQueue.push([{ id: 7 }]); // mspId
    selectQueue.push([{ key: "admin.money.goals", value: JSON.stringify({ goalSales: 3, mrrGoalCents: 600000, ramp: [{ month: "2026-08", target: 3 }] }) }]); // goals
    selectQueue.push([]); // readManualSales — none logged
    selectQueue.push([{ monthTrunc: "2026-08-01T00:00:00.000Z", n: 2 }]); // countRowsRaw
    selectQueue.push([{ cents: 1600000, n: 4 }]); // computeAvgSaleCents trailing-90d: sum/count = 400,000

    const res = await admin(request(buildApp()).get("/api/admin/money/ramp"));
    expect(res.status).toBe(200);
    expect(res.body.avgSaleCents).toBe(400000);
    expect(res.body.rows).toHaveLength(6);
    expect(res.body.rows[0]).toMatchObject({ month: "2026-08", target: 3, actual: 2, worthCents: 1200000 });
    expect(res.body.projectedYearCents).toBe(res.body.rows.reduce((s: number, r: { worthCents: number }) => s + r.worthCents, 0));
  });
});

describe("GET /admin/money/business", () => {
  it("computes verdicts against the disclosed reference benchmarks", async () => {
    selectQueue.push([{ id: 7 }]); // mspId
    selectQueue.push([{ customerName: "Northwind Traders", cents: 100000 }]); // byClientRows (100% concentration)
    selectQueue.push([]); // readManualSales — none logged
    selectQueue.push([{ id: 1, customerName: "Contoso Ltd", serviceName: "Retainer", priceCents: 500000, billingInterval: "month" }]); // retainers
    selectQueue.push([{ cents: 5000 }]); // ai cost over the window

    const res = await admin(request(buildApp()).get("/api/admin/money/business"));
    expect(res.status).toBe(200);
    expect(res.body.clientConcentrationPct).toBe(100);
    expect(res.body.mrrCents).toBe(500000);
    expect(res.body.benchmarks).toHaveLength(3);
    const concentration = res.body.benchmarks.find((b: { key: string }) => b.key === "clientConcentration");
    expect(concentration.verdict).toBe("below"); // 100% >> the 20% "at most" target
    expect(res.body.benchmarkNote).toMatch(/not a live industry-benchmark feed/);
  });
});

describe("POST /admin/money/sales — Log a sale", () => {
  it("rejects a missing/invalid payload without writing anything", async () => {
    selectQueue.push([{ id: 7 }]); // mspId
    const res = await admin(request(buildApp()).post("/api/admin/money/sales").send({ who: "", what: "", amountCents: 0 }));
    expect(res.status).toBe(400);
    expect(insertCalls).toHaveLength(0);
  });

  it("persists a real, disclosed manual sale through the settingsTable upsert", async () => {
    selectQueue.push([{ id: 7 }]); // mspId
    selectQueue.push([]); // readManualSales — starts empty
    const res = await admin(
      request(buildApp())
        .post("/api/admin/money/sales")
        .send({ who: "Tailspin Toys", what: "Cash deal, off-platform", amountCents: 150000 }),
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.sale).toMatchObject({ who: "Tailspin Toys", what: "Cash deal, off-platform", amountCents: 150000 });
    expect(res.body.sale.id).toMatch(/^manual-/);
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].table).toBe("settings");
    const written = JSON.parse((insertCalls[0].values as { value: string }).value);
    expect(written).toHaveLength(1);
    expect(written[0].amountCents).toBe(150000);
  });
});

describe("Testbed tenant exclusion (Git #661)", () => {
  it("every real revenue/cost query on /admin/money/summary excludes testbed tenants", async () => {
    selectQueue.push([{ id: 7 }]); // getDirectBusinessMspId
    selectQueue.push([]); // salesRows
    selectQueue.push([]); // readManualSales
    selectQueue.push([{ cents: 0 }]); // lifetimeRow
    selectQueue.push([]); // aiRows
    selectQueue.push([]); // retainers
    selectQueue.push([]); // trendRowsRaw
    selectQueue.push([]); // countRowsRaw
    selectQueue.push([]); // readGoals

    const res = await admin(request(buildApp()).get("/api/admin/money/summary"));
    expect(res.status).toBe(200);

    // getDirectBusinessMspId's own lookup and the generic settingsTable reads
    // (goals/manual sales) have no charge/tenant condition to check — every
    // where() call that actually queries msp_charges/ai_usage_events must
    // embed the testbed exclusion.
    const chargeOrAiWheres = whereCalls.map((cond) => flattenCondition(cond).join("|")).filter((text) => /msp_id/.test(text));
    expect(chargeOrAiWheres.length).toBeGreaterThan(0);
    for (const text of chargeOrAiWheres) {
      expect(text).toMatch(/is_testbed/);
    }
  });

  it("filters testbed tenants out of retainers directly via tenantsTable.isTestbed", async () => {
    selectQueue.push([{ id: 7 }]); // mspId
    selectQueue.push([]); // byClientRows
    selectQueue.push([]); // readManualSales
    selectQueue.push([]); // retainers
    selectQueue.push([{ cents: 0 }]); // ai cost

    await admin(request(buildApp()).get("/api/admin/money/business"));

    // retainers is the 4th select call (mspId, byClientRows, readManualSales, retainers)
    const retainersWhere = whereCalls[3];
    const text = flattenCondition(retainersWhere).join("|");
    expect(text).toMatch(/is_testbed/);
  });
});

describe("Manual sales merge into real figures", () => {
  it("folds a manually-logged sale into this month's revenue, sales list and streak", async () => {
    const thisMonthManual = { id: "manual-1", when: "2026-08-05T12:00:00.000Z", who: "Proseware", what: "Cash deal", amountCents: 200000 };
    const lastMonthManual = { id: "manual-2", when: "2026-07-10T12:00:00.000Z", who: "Proseware", what: "Cash deal", amountCents: 100000 };

    selectQueue.push([{ id: 7 }]); // mspId
    selectQueue.push([]); // salesRows — no real Stripe charges this month
    selectQueue.push([{ key: "admin.money.manual_sales", value: JSON.stringify([thisMonthManual, lastMonthManual]) }]); // readManualSales
    selectQueue.push([{ cents: 0 }]); // lifetimeRow (real)
    selectQueue.push([]); // aiRows
    selectQueue.push([]); // retainers
    selectQueue.push([]); // trendRowsRaw
    // countRowsRaw: real charge count for July is 2, short of a 3-sale goal on its own —
    // the manual sale that same month has to be what pushes it over for the streak to hold.
    selectQueue.push([{ monthTrunc: "2026-07-01T00:00:00.000Z", n: 2 }]);
    selectQueue.push([{ key: "admin.money.goals", value: JSON.stringify({ goalSales: 3, mrrGoalCents: 600000, ramp: [] }) }]); // readGoals

    const res = await admin(request(buildApp()).get("/api/admin/money/summary"));
    expect(res.status).toBe(200);
    expect(res.body.revenue.cents).toBe(200000);
    expect(res.body.lifetimeRevenue.cents).toBe(300000); // 0 real + both manual sales, ever
    expect(res.body.sales.count).toBe(1);
    expect(res.body.sales.items).toEqual([
      { id: "manual-1", when: "2026-08-05T12:00:00.000Z", who: "Proseware", what: "Cash deal", amountCents: 200000, manual: true },
    ]);
    expect(res.body.trend[5]).toMatchObject({ month: "2026-08", cents: 200000 });
    expect(res.body.trend[4]).toMatchObject({ month: "2026-07", cents: 100000 });
    expect(res.body.streak).toBe(1); // 2 real + 1 manual = 3, meets July's goal
  });
});
