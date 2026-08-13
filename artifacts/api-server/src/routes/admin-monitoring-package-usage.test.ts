/**
 * admin-monitoring-package-usage.test.ts
 *
 * Covers `GET /api/admin/monitoring-packages/usage` — the read that turns
 * Simulator Studio's Monitoring Packages screen from definitions into
 * evidence: what each package has actually executed, from `msp_diagnostic_runs`.
 *
 * The load-bearing assertion here is the boring one: **route order**. Express
 * matches in registration order, so declaring `/usage` after
 * `/monitoring-packages/:key` would make `:key` swallow the literal string
 * "usage" and answer with a 404 for a package that does not exist. That is
 * exactly the bug `/admin/monitor-checks/profiles` already has further down the
 * same file, and it is invisible in a unit test that only exercises the handler
 * in isolation — so this file drives the real router.
 *
 * Run with: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

process.env["DATABASE_URL"] = "postgres://test";
process.env["ADMIN_PASSWORD"] = "test-admin-pass";

const ADMIN_PASS = "test-admin-pass";

/** Result sets `db.execute` resolves, in call order: totals, then latest. */
let executeQueue: Array<Array<Record<string, unknown>>> = [];
/** Every SQL fragment `db.execute` was handed, for asserting which table was read. */
const executed: unknown[] = [];
/** Set when the `:key` handler runs — it is the only path that calls db.select. */
const selectCalls: unknown[] = [];

vi.mock("@workspace/db", () => {
  return {
    db: {
      execute: vi.fn((q: unknown) => {
        executed.push(q);
        return Promise.resolve({ rows: executeQueue.shift() ?? [] });
      }),
      select: vi.fn(() => {
        selectCalls.push(true);
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve([])),
              orderBy: vi.fn(() => Promise.resolve([])),
              then: (resolve: (v: unknown) => unknown) => resolve([]),
            })),
            orderBy: vi.fn(() => Promise.resolve([])),
            limit: vi.fn(() => Promise.resolve([])),
          })),
        };
      }),
      insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([])), then: (r: (v: unknown) => unknown) => r(undefined) })) })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([])) })) })) })),
      delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve({ rowCount: 0 })) })),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
    },
    monitorChecksTable: { key: "key", status: "status" },
    monitoringPackagesTable: { key: "key", status: "status" },
    monitoringPackageChecksTable: { packageKey: "package_key", checkKey: "check_key", sortOrder: "sort_order" },
    monitorCheckAuditLogTable: { createdAt: "created_at" },
    tenantMonitorProfilesTable: { collectedAt: "collected_at", tenantId: "tenant_id" },
    usersTable: { id: "id" },
    tenantsTable: { tenantId: "tenant_id", customerName: "customer_name", domain: "domain" },
  };
});

vi.mock("../middlewares/requireAuth", () => ({
  requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.headers["authorization"] === `Bearer ${ADMIN_PASS}`) return next();
    res.status(401).json({ error: "Unauthorized" });
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

vi.mock("../lib/monitor-executor", () => ({
  applyMapping: vi.fn(() => ({})),
  classifySeverity: vi.fn(() => null),
  validateOutputShape: vi.fn(() => ({ valid: true, errors: [] })),
}));

import router from "./admin-monitor-checks";

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return app;
}

const auth = (r: request.Test) => r.set("Authorization", `Bearer ${ADMIN_PASS}`);

const TOTALS = [
  { packageKey: "core:security-baseline", runs: 12, tenants: 4, lastRunAt: "2026-08-07T06:00:00.000Z" },
  { packageKey: "core:copilot-readiness", runs: 1, tenants: 1, lastRunAt: "2026-07-02T22:00:00.000Z" },
];

const LATEST = [
  {
    packageKey: "core:security-baseline",
    runId: "run-1",
    status: "completed",
    runStatus: null,
    checksTotal: 41,
    checksOk: 38,
    checksError: 1,
    checksLicenseGap: 2,
    tenantId: "tenant-a",
    completedAt: "2026-08-07T06:04:00.000Z",
    createdAt: "2026-08-07T06:00:00.000Z",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  executeQueue = [];
  executed.length = 0;
  selectCalls.length = 0;
});

describe("GET /admin/monitoring-packages/usage", () => {
  it("requires auth", async () => {
    const res = await request(makeApp()).get("/api/admin/monitoring-packages/usage");
    expect(res.status).toBe(401);
  });

  it("is matched before /:key, so it is never treated as a package named 'usage'", async () => {
    executeQueue = [TOTALS, LATEST];

    const res = await auth(request(makeApp()).get("/api/admin/monitoring-packages/usage"));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("usage");
    // The `:key` handler is the only one that reaches for db.select. If route
    // order regressed, this would be a 404 from that handler instead.
    expect(selectCalls.length).toBe(0);
    expect(res.body.error).toBeUndefined();
  });

  it("joins the per-package totals to that package's most recent run", async () => {
    executeQueue = [TOTALS, LATEST];

    const res = await auth(request(makeApp()).get("/api/admin/monitoring-packages/usage"));

    expect(res.status).toBe(200);
    const byKey = Object.fromEntries(
      (res.body.usage as Array<Record<string, unknown>>).map(u => [u["packageKey"], u]),
    );

    expect(byKey["core:security-baseline"]).toMatchObject({
      runs: 12,
      tenants: 4,
      lastRunAt: "2026-08-07T06:00:00.000Z",
    });
    expect((byKey["core:security-baseline"] as { lastRun: Record<string, unknown> }).lastRun).toMatchObject({
      runId: "run-1",
      checksTotal: 41,
      checksOk: 38,
      checksLicenseGap: 2,
    });
  });

  it("reports a package that has runs but no resolvable latest row as lastRun: null rather than dropping it", async () => {
    // Deliberately asymmetric: totals know about copilot-readiness, the
    // DISTINCT ON result does not. Dropping the package here would make a
    // package that HAS run look like one that never has.
    executeQueue = [TOTALS, LATEST];

    const res = await auth(request(makeApp()).get("/api/admin/monitoring-packages/usage"));

    const copilot = (res.body.usage as Array<Record<string, unknown>>).find(
      u => u["packageKey"] === "core:copilot-readiness",
    );
    expect(copilot).toBeTruthy();
    expect(copilot!["runs"]).toBe(1);
    expect(copilot!["lastRun"]).toBeNull();
  });

  it("returns an empty list rather than an error when nothing has ever run", async () => {
    executeQueue = [[], []];

    const res = await auth(request(makeApp()).get("/api/admin/monitoring-packages/usage"));

    expect(res.status).toBe(200);
    expect(res.body.usage).toEqual([]);
  });

  it("500s with a stated error rather than a partial body when the query fails", async () => {
    executeQueue = [];
    const { db } = (await import("@workspace/db")) as unknown as { db: { execute: ReturnType<typeof vi.fn> } };
    db.execute.mockRejectedValueOnce(new Error("relation does not exist"));

    const res = await auth(request(makeApp()).get("/api/admin/monitoring-packages/usage"));

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to load monitoring package usage");
  });

  it("reads msp_diagnostic_runs and nothing else", async () => {
    executeQueue = [TOTALS, LATEST];
    await auth(request(makeApp()).get("/api/admin/monitoring-packages/usage"));

    expect(executed.length).toBe(2);
    for (const fragment of executed) {
      const text = JSON.stringify(fragment);
      expect(text).toContain("msp_diagnostic_runs");
    }
  });
});
