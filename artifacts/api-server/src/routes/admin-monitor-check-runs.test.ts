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
//
// `executeMonitorCheck` is the ONLY export stubbed here: it is the network
// boundary, and stubbing it is what lets these tests assert that "Re-evaluate"
// never crosses it. `applyMapping` is deliberately re-exported REAL (via
// importActual) because the trace route runs it for real — replacing it with a
// stub would let a mapping regression pass unnoticed, which is the exact failure
// mode this phase is meant to prevent.
const executeMonitorCheck = vi.fn();
vi.mock("../lib/monitor-executor", async () => {
  const actual = await vi.importActual<typeof import("../lib/monitor-executor")>("../lib/monitor-executor");
  return {
    ...actual,
    executeMonitorCheck: (...args: unknown[]) => executeMonitorCheck(...args),
  };
});

// The rule fetch the trace route uses. Mocked because it is a DB read (an INPUT
// to the trace), not part of the trace's logic — `evaluateRule` itself stays real.
const getAllRules = vi.fn(() => Promise.resolve([] as unknown[]));
vi.mock("./admin-signal-rules", () => ({
  getAllRules: () => getAllRules(),
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
  getAllRules.mockResolvedValue([]);
  _resetMonitorCheckRuns();
});

/** Starts a run that completes ok with the given captured items, and returns its runId. */
async function startCompletedRun(
  app: Express,
  items: unknown[],
  check: Record<string, unknown> = CHECK,
): Promise<string> {
  selectQueue = [[check], [CUSTOMER]];
  executeMonitorCheck.mockResolvedValue({
    checkKey: check.key,
    status: "ok",
    extractedProperties: {},
    severityMatched: null,
    itemCount: items.length,
    pageCount: 1,
    items,
  });
  const res = await auth(request(app).post(`/api/admin/monitor-checks/${check.key}/run`)).send({ customerId: 42 });
  await waitForTerminal(app, res.body.runId);
  return res.body.runId as string;
}

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

// ── Phase 2: engine trace ─────────────────────────────────────────────────────

const MAPPED_CHECK = {
  ...CHECK,
  key: "identity:mfa-registration",
  properties: [],
  mapping: [{ sourceField: "isMfaRegistered", targetField: "mfaRegisteredCount", transform: "countTruthy" }],
};

const MFA_ITEMS = [
  { id: "u1", isMfaRegistered: true },
  { id: "u2", isMfaRegistered: true },
  { id: "u3", isMfaRegistered: false },
];

describe("POST /admin/monitor-check-runs/:runId/trace — RE-EVALUATE", () => {
  it("rejects an unauthenticated trace", async () => {
    const res = await request(makeApp()).post("/api/admin/monitor-check-runs/whatever/trace").send({});
    expect(res.status).toBe(401);
  });

  it("404s for an unknown run", async () => {
    const res = await auth(request(makeApp()).post("/api/admin/monitor-check-runs/nope/trace")).send({});
    expect(res.status).toBe(404);
  });

  it("does NOT trigger a new network call — the whole point of Re-evaluate", async () => {
    const app = makeApp();
    const runId = await startCompletedRun(app, MFA_ITEMS, MAPPED_CHECK);

    // One call so far: the run itself.
    expect(executeMonitorCheck).toHaveBeenCalledTimes(1);

    // Re-evaluate, repeatedly.
    for (let i = 0; i < 3; i++) {
      const res = await auth(request(app).post(`/api/admin/monitor-check-runs/${runId}/trace`)).send({});
      expect(res.status).toBe(200);
    }

    // STILL one call. Re-evaluate never reaches the executor, so it never
    // reaches Graph — it re-reads the response the run already captured.
    expect(executeMonitorCheck).toHaveBeenCalledTimes(1);
  });

  it("traces the captured response through the REAL applyMapping", async () => {
    const app = makeApp();
    const runId = await startCompletedRun(app, MFA_ITEMS, MAPPED_CHECK);

    const res = await auth(request(app).post(`/api/admin/monitor-check-runs/${runId}/trace`)).send({});
    expect(res.status).toBe(200);

    const key = res.body.trace.keys.find((k: any) => k.key === "mfaRegisteredCount");
    expect(key).toBeDefined();
    // countTruthy over the real captured items: 2 of 3.
    expect(key.value).toBe(2);
    expect(key.transform).toBe("countTruthy");
  });

  it("evaluates real rules returned by the msp_id-IS-NULL-scoped fetch", async () => {
    getAllRules.mockResolvedValue([
      {
        id: 55,
        signalKey: "security:mfa-gap",
        groupId: null,
        ruleType: "profile_key_lt",
        sourceKey: "mfaRegisteredCount",
        compareValue: "5",
        description: null,
        sortOrder: 0,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    ]);

    const app = makeApp();
    const runId = await startCompletedRun(app, MFA_ITEMS, MAPPED_CHECK);
    const res = await auth(request(app).post(`/api/admin/monitor-check-runs/${runId}/trace`)).send({});

    const key = res.body.trace.keys.find((k: any) => k.key === "mfaRegisteredCount");
    expect(key.uncovered).toBe(false);
    expect(key.rules).toHaveLength(1);
    // 2 < 5 — the real evaluateRule result and its own reason string.
    expect(key.rules[0].result).toBe(true);
    expect(key.rules[0].reason).toBe("profile[mfaRegisteredCount] = 2 < 5");
  });

  it("409s rather than tracing a run that never produced a usable response", async () => {
    selectQueue = [[MAPPED_CHECK], [CUSTOMER]];
    executeMonitorCheck.mockResolvedValue({
      checkKey: MAPPED_CHECK.key,
      status: "error",
      extractedProperties: {},
      severityMatched: null,
      errorMessage: "Graph API error 503",
      itemCount: 0,
      pageCount: 0,
    });
    const app = makeApp();
    const start = await auth(request(app).post(`/api/admin/monitor-checks/${MAPPED_CHECK.key}/run`)).send({ customerId: 42 });
    await waitForTerminal(app, start.body.runId);

    const res = await auth(request(app).post(`/api/admin/monitor-check-runs/${start.body.runId}/trace`)).send({});
    // Never a confident "this response produces no keys" over a failed run.
    expect(res.status).toBe(409);
    expect(res.body.runStatus).toBe("failed");
  });

  it("asks the executor to hand back the untruncated item list", async () => {
    const app = makeApp();
    await startCompletedRun(app, MFA_ITEMS, MAPPED_CHECK);
    const arg = executeMonitorCheck.mock.calls[0]![0] as Record<string, any>;
    // Without this the trace would have to re-read the persisted rawResponse,
    // which holds only page 1 (and only 5 rows of a CSV report).
    expect(arg.includeItems).toBe(true);
  });

  it("keeps the item payload off the one-second poll response", async () => {
    const app = makeApp();
    const runId = await startCompletedRun(app, MFA_ITEMS, MAPPED_CHECK);
    const res = await auth(request(app).get(`/api/admin/monitor-check-runs/${runId}`));
    expect(res.status).toBe(200);
    expect(res.body.run.items).toBeUndefined();
  });
});

describe("RE-RUN is a genuinely different action from RE-EVALUATE", () => {
  it("re-running DOES trigger a new execution, while re-evaluating does not", async () => {
    const app = makeApp();
    const runId = await startCompletedRun(app, MFA_ITEMS, MAPPED_CHECK);
    expect(executeMonitorCheck).toHaveBeenCalledTimes(1);

    // Re-evaluate: no new execution.
    await auth(request(app).post(`/api/admin/monitor-check-runs/${runId}/trace`)).send({});
    expect(executeMonitorCheck).toHaveBeenCalledTimes(1);

    // Re-run: a real second execution against the live tenant.
    const secondRunId = await startCompletedRun(app, MFA_ITEMS, MAPPED_CHECK);
    expect(executeMonitorCheck).toHaveBeenCalledTimes(2);
    expect(secondRunId).not.toBe(runId);
  });
});
