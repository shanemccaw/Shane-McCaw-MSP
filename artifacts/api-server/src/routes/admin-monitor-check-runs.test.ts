/**
 * admin-monitor-check-runs.test.ts
 *
 * Regression tests for the M365 Endpoints node's single-endpoint execution
 * (phase 1) and for the monitor-check CRUD routes it sits alongside.
 *
 * KEY TESTING RULE HONORED HERE: monitor-executor's `executeMonitorCheck` is
 * MOCKED, never reimplemented. These tests assert that the run route CALLS the
 * real shared function with the right arguments and faithfully maps its returned
 * status — they deliberately do not re-encode request building, pagination,
 * CSV parsing or placeholder resolution, which belong to monitor-executor and
 * are covered by its own suite. A test that reimplemented that logic would pass
 * against a forked copy, which is exactly the failure mode this route avoids.
 *
 * Run with: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

process.env["DATABASE_URL"] = "postgres://test";
process.env["ADMIN_PASSWORD"] = "test-admin-pass";

const ADMIN_PASS = "test-admin-pass";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CHECK = {
  id: 1,
  key: "identity:mfa-registration",
  label: "MFA registration coverage",
  description: "Who has registered an MFA method",
  endpoint: "/reports/authenticationMethods/userRegistrationDetails",
  method: "GET",
  selectParams: null,
  requestBody: null,
  properties: ["isMfaRegistered"],
  mapping: [],
  severityRules: [],
  outputSchema: null,
  engines: [],
  frequency: "daily",
  requiresCustomerScript: false,
  schemaVersion: 3,
  status: "active",
};

const SCRIPT_CHECK = { ...CHECK, key: "identity:local-admins", requiresCustomerScript: true };

const CUSTOMER = { id: 42, tenantId: "tenant-guid-abc" };
const CUSTOMER_NO_TENANT = { id: 43, tenantId: null };

/** Rows the mocked db.select() chain should resolve, in call order. */
let selectQueue: unknown[][] = [];

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(selectQueue.shift() ?? [])),
        })),
      })),
    })),
  },
  monitorChecksTable: { key: "key" },
  mspCustomersTable: { id: "id", tenantId: "tenant_id" },
}));

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

// The reuse point under test — mocked, not reimplemented.
const executeMonitorCheck = vi.fn();
vi.mock("../lib/monitor-executor", () => ({
  executeMonitorCheck: (...args: unknown[]) => executeMonitorCheck(...args),
}));

import router, { _resetMonitorCheckRuns } from "./admin-monitor-check-runs";

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return app;
}

const auth = (r: request.Test) => r.set("Authorization", `Bearer ${ADMIN_PASS}`);

/** Poll the run until it reaches a terminal state (the async run resolves on the microtask queue). */
async function waitForTerminal(app: Express, runId: string) {
  for (let i = 0; i < 20; i++) {
    const res = await auth(request(app).get(`/api/admin/monitor-check-runs/${runId}`));
    if (res.body.run?.status === "completed" || res.body.run?.status === "failed") return res.body.run;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("run never reached a terminal state");
}

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue = [];
  _resetMonitorCheckRuns();
});

// ── Auth ──────────────────────────────────────────────────────────────────────

describe("auth gating", () => {
  it("rejects an unauthenticated run request", async () => {
    const res = await request(makeApp())
      .post("/api/admin/monitor-checks/identity:mfa-registration/run")
      .send({ customerId: 42 });
    expect(res.status).toBe(401);
    expect(executeMonitorCheck).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated poll", async () => {
    const res = await request(makeApp()).get("/api/admin/monitor-check-runs/whatever");
    expect(res.status).toBe(401);
  });
});

// ── Validation ────────────────────────────────────────────────────────────────

describe("POST /admin/monitor-checks/:key/run — validation", () => {
  it("400s without a customerId", async () => {
    const res = await auth(request(makeApp()).post("/api/admin/monitor-checks/identity:mfa-registration/run")).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/customerId/i);
    expect(executeMonitorCheck).not.toHaveBeenCalled();
  });

  it("404s for an unknown check key", async () => {
    selectQueue = [[]];
    const res = await auth(request(makeApp()).post("/api/admin/monitor-checks/nope:missing/run")).send({ customerId: 42 });
    expect(res.status).toBe(404);
    expect(executeMonitorCheck).not.toHaveBeenCalled();
  });

  it("404s for an unknown customer", async () => {
    selectQueue = [[CHECK], []];
    const res = await auth(request(makeApp()).post("/api/admin/monitor-checks/identity:mfa-registration/run")).send({ customerId: 999 });
    expect(res.status).toBe(404);
    expect(executeMonitorCheck).not.toHaveBeenCalled();
  });

  it("400s when the customer has no connected tenant", async () => {
    selectQueue = [[CHECK], [CUSTOMER_NO_TENANT]];
    const res = await auth(request(makeApp()).post("/api/admin/monitor-checks/identity:mfa-registration/run")).send({ customerId: 43 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no connected M365 tenant/i);
    expect(executeMonitorCheck).not.toHaveBeenCalled();
  });

  it("400s for a requires-customer-script check instead of starting a hollow run", async () => {
    selectQueue = [[SCRIPT_CHECK]];
    const res = await auth(request(makeApp()).post("/api/admin/monitor-checks/identity:local-admins/run")).send({ customerId: 42 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/PowerShell script/i);
    expect(executeMonitorCheck).not.toHaveBeenCalled();
  });
});

// ── Reuse of monitor-executor ─────────────────────────────────────────────────

describe("POST /admin/monitor-checks/:key/run — delegates to monitor-executor", () => {
  it("calls the real executeMonitorCheck with the stored check, tenant and a fresh triggerId", async () => {
    selectQueue = [[CHECK], [CUSTOMER]];
    executeMonitorCheck.mockResolvedValue({
      checkKey: CHECK.key,
      status: "ok",
      extractedProperties: { isMfaRegistered_count: 12 },
      severityMatched: null,
      itemCount: 12,
      pageCount: 2,
    });

    const app = makeApp();
    const res = await auth(request(app).post("/api/admin/monitor-checks/identity:mfa-registration/run")).send({ customerId: 42 });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe("pending");
    const runId = res.body.runId as string;

    const run = await waitForTerminal(app, runId);

    expect(executeMonitorCheck).toHaveBeenCalledTimes(1);
    const arg = executeMonitorCheck.mock.calls[0]![0] as Record<string, any>;
    expect(arg.tenantId).toBe("tenant-guid-abc");
    expect(arg.triggerId).toBe(runId);
    // Ad-hoc simulator re-runs must not be short-circuited by the idempotency cache.
    expect(arg.skipIdempotency).toBe(true);
    // The check handed to the executor is the real stored row.
    expect(arg.check.key).toBe(CHECK.key);
    expect(arg.check.endpoint).toBe(CHECK.endpoint);
    expect(arg.check.mapping).toEqual(CHECK.mapping);
    expect(arg.check.severityRules).toEqual(CHECK.severityRules);

    expect(run.status).toBe("completed");
    expect(run.progress).toBe(100);
    expect(run.result.itemCount).toBe(12);
    expect(run.statusText).toMatch(/12 item/);
  });

  it("passes per-run endpoint/method/body overrides through without mutating the catalog", async () => {
    selectQueue = [[CHECK], [CUSTOMER]];
    executeMonitorCheck.mockResolvedValue({
      checkKey: CHECK.key,
      status: "ok",
      extractedProperties: {},
      severityMatched: null,
      itemCount: 0,
      pageCount: 1,
    });

    const app = makeApp();
    const res = await auth(request(app).post("/api/admin/monitor-checks/identity:mfa-registration/run")).send({
      customerId: 42,
      endpoint: "/users?$select=id",
      method: "post",
      requestBody: { foo: "bar" },
    });
    expect(res.status).toBe(202);
    await waitForTerminal(app, res.body.runId);

    const arg = executeMonitorCheck.mock.calls[0]![0] as Record<string, any>;
    expect(arg.check.endpoint).toBe("/users?$select=id");
    expect(arg.check.method).toBe("POST");
    expect(arg.check.requestBody).toEqual({ foo: "bar" });
    // Everything not overridden still comes from the stored row.
    expect(arg.check.properties).toEqual(CHECK.properties);
    expect(arg.check.schemaVersion).toBe(CHECK.schemaVersion);
  });

  it.each([
    ["error", "Graph API error 503: unavailable"],
    ["consent_revoked", "consent revoked"],
    ["license_gap", "Requires Entra ID P2"],
  ])("maps a non-ok executor status (%s) onto a failed run", async (status, errorMessage) => {
    selectQueue = [[CHECK], [CUSTOMER]];
    executeMonitorCheck.mockResolvedValue({
      checkKey: CHECK.key,
      status,
      extractedProperties: {},
      severityMatched: null,
      errorMessage,
      itemCount: 0,
      pageCount: 0,
    });

    const app = makeApp();
    const res = await auth(request(app).post("/api/admin/monitor-checks/identity:mfa-registration/run")).send({ customerId: 42 });
    const run = await waitForTerminal(app, res.body.runId);

    // Never a green "completed" over a non-ok result.
    expect(run.status).toBe("failed");
    expect(run.result.status).toBe(status);
    expect(run.statusText).toContain(errorMessage);
  });

  it("marks the run failed when the executor throws", async () => {
    selectQueue = [[CHECK], [CUSTOMER]];
    executeMonitorCheck.mockRejectedValue(new Error("socket hang up"));

    const app = makeApp();
    const res = await auth(request(app).post("/api/admin/monitor-checks/identity:mfa-registration/run")).send({ customerId: 42 });
    const run = await waitForTerminal(app, res.body.runId);

    expect(run.status).toBe("failed");
    expect(run.error).toBe("socket hang up");
  });
});

// ── Poll route ────────────────────────────────────────────────────────────────

describe("GET /admin/monitor-check-runs/:runId", () => {
  it("404s for an unknown run id", async () => {
    const res = await auth(request(makeApp()).get("/api/admin/monitor-check-runs/does-not-exist"));
    expect(res.status).toBe(404);
  });

  it("reports the real resolved request the executor was asked to run", async () => {
    selectQueue = [[CHECK], [CUSTOMER]];
    executeMonitorCheck.mockResolvedValue({
      checkKey: CHECK.key,
      status: "ok",
      extractedProperties: {},
      severityMatched: null,
      itemCount: 1,
      pageCount: 1,
    });

    const app = makeApp();
    const start = await auth(request(app).post("/api/admin/monitor-checks/identity:mfa-registration/run")).send({ customerId: 42 });
    await waitForTerminal(app, start.body.runId);

    const res = await auth(request(app).get(`/api/admin/monitor-check-runs/${start.body.runId}`));
    expect(res.status).toBe(200);
    expect(res.body.run.request.endpoint).toBe(CHECK.endpoint);
    expect(res.body.run.request.method).toBe("GET");
    expect(res.body.run.checkKey).toBe(CHECK.key);
    expect(res.body.run.tenantId).toBe("tenant-guid-abc");
  });
});
