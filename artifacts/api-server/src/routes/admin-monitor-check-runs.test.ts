/**
 * admin-monitor-check-runs.test.ts
 *
 * Regression tests for the M365 Endpoints node: single-endpoint execution
 * (phase 1), the engine trace (phase 2), and persistent run history, bulk run
 * and run diff (phase 3).
 *
 * KEY TESTING RULE HONORED HERE: monitor-executor's `executeMonitorCheck` is
 * MOCKED, never reimplemented. These tests assert that the run route CALLS the
 * real shared function with the right arguments and faithfully maps its returned
 * status — they deliberately do not re-encode request building, pagination,
 * CSV parsing or placeholder resolution, which belong to monitor-executor and
 * are covered by its own suite. A test that reimplemented that logic would pass
 * against a forked copy, which is exactly the failure mode this route avoids.
 *
 * PHASE 3 TESTING NOTE — the db mock is a genuine in-memory TABLE, not a queue
 * of canned result sets. Rows written by an insert are the rows a later select
 * reads back, filtered/ordered by the real conditions the store builds. That is
 * what makes the "survives a restart" test meaningful: it clears every
 * process-local reference and re-reads the run through the same store path a
 * fresh api-server process would use. A queue-shaped mock would have made that
 * test pass without proving anything.
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

// ── The fake DB ───────────────────────────────────────────────────────────────
//
// `simulator_check_runs` is backed by a real in-memory row array so writes are
// readable. `monitor_checks` / `msp_customers` stay queue-driven — they are
// read-only lookups in these routes, and a queue keeps each test's fixtures
// explicit.

/** Rows the mocked lookup selects should resolve, in call order. */
let selectQueue: unknown[][] = [];
/** The stand-in `simulator_check_runs` table. */
let runRows: Record<string, any>[] = [];

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: any, val: unknown) => ({ __op: "eq", col, val }),
    and: (...cs: any[]) => ({ __op: "and", cs: cs.filter(Boolean) }),
    like: (col: any, val: string) => ({ __op: "like", col, val }),
    lt: (col: any, val: unknown) => ({ __op: "lt", col, val }),
    inArray: (col: any, vals: unknown[]) => ({ __op: "in", col, vals }),
    desc: (col: any) => ({ __op: "desc", col }),
  };
});

vi.mock("@workspace/db", () => {
  const col = (name: string) => ({ __col: name });
  const table = (name: string, cols: string[]) => ({
    __table: name,
    ...Object.fromEntries(cols.map((c) => [c, col(c)])),
  });

  const simulatorCheckRunsTable = table("simulator_check_runs", [
    "id", "runId", "batchId", "checkKey", "checkLabel", "customerId", "tenantId",
    "status", "statusText", "progress", "resultStatus", "itemCount", "pageCount",
    "severityMatched", "licenseFeature", "errorMessage", "request", "result",
    "items", "itemsOmitted", "itemsOmittedReason", "mapping", "properties",
    "trace", "tracedAt", "startedAt", "completedAt", "createdAt",
  ]);

  const value = (row: Record<string, any>, c: any) => row[c?.__col];

  const matches = (row: Record<string, any>, cond: any): boolean => {
    if (!cond) return true;
    switch (cond.__op) {
      case "and":
        return cond.cs.every((c: any) => matches(row, c));
      case "eq":
        return value(row, cond.col) === cond.val;
      case "lt":
        return (value(row, cond.col) as any) < (cond.val as any);
      case "in":
        return cond.vals.includes(value(row, cond.col));
      case "like": {
        const pattern = String(cond.val).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*");
        return new RegExp(`^${pattern}$`).test(String(value(row, cond.col)));
      }
      default:
        return true;
    }
  };

  const compare = (a: any, b: any): number => {
    const norm = (v: any) => (v instanceof Date ? v.getTime() : v);
    const x = norm(a);
    const y = norm(b);
    if (x == null && y == null) return 0;
    if (x == null) return -1;
    if (y == null) return 1;
    return x < y ? -1 : x > y ? 1 : 0;
  };

  let nextId = 1;

  /** Chain over the in-memory simulator_check_runs rows. */
  function runsSelectChain(projection: Record<string, any> | undefined) {
    let cond: any = null;
    let order: any[] = [];
    let lim: number | null = null;
    const exec = () => {
      let rows = runRows.filter((r) => matches(r, cond));
      if (order.length > 0) {
        rows = [...rows].sort((a, b) => {
          for (const spec of order) {
            const dir = spec?.__op === "desc" ? -1 : 1;
            const c = spec?.__op === "desc" ? spec.col : spec;
            const r = compare(value(a, c), value(b, c)) * dir;
            if (r !== 0) return r;
          }
          return 0;
        });
      }
      if (lim != null) rows = rows.slice(0, lim);
      return rows.map((r) => {
        if (!projection) return { ...r };
        return Object.fromEntries(Object.entries(projection).map(([alias, c]) => [alias, value(r, c)]));
      });
    };
    const chain: any = {
      where: (c: any) => ((cond = c), chain),
      orderBy: (...o: any[]) => ((order = o), chain),
      limit: (n: number) => ((lim = n), chain),
      then: (ok: any, err: any) => Promise.resolve(exec()).then(ok, err),
    };
    return chain;
  }

  /** Chain over the queue-driven lookup tables. */
  function queueSelectChain() {
    const chain: any = {
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (ok: any, err: any) => Promise.resolve(selectQueue.shift() ?? []).then(ok, err),
    };
    return chain;
  }

  const isRuns = (t: any) => t?.__table === "simulator_check_runs";

  const mockDb = {
    select: vi.fn((projection?: Record<string, any>) => ({
      from: (t: any) => (isRuns(t) ? runsSelectChain(projection) : queueSelectChain()),
    })),
    insert: vi.fn((t: any) => ({
      values: (row: Record<string, any>) => {
        const inserted = { id: nextId++, itemsOmitted: false, ...row };
        if (isRuns(t)) runRows.push(inserted);
        const result = [{ id: inserted.id }];
        return {
          returning: () => Promise.resolve(result),
          then: (ok: any, err: any) => Promise.resolve(result).then(ok, err),
        };
      },
    })),
    update: vi.fn((t: any) => ({
      set: (patch: Record<string, any>) => ({
        where: (cond: any) => {
          if (isRuns(t)) for (const row of runRows) if (matches(row, cond)) Object.assign(row, patch);
          return Promise.resolve([]);
        },
      }),
    })),
    delete: vi.fn((t: any) => ({
      where: (cond: any) => {
        if (isRuns(t)) runRows = runRows.filter((r) => !matches(r, cond));
        return Promise.resolve([]);
      },
    })),
  };

  return {
    db: mockDb,
    simulatorCheckRunsTable,
    monitorChecksTable: table("monitor_checks", ["key", "status"]),
    mspCustomersTable: table("msp_customers", ["id", "tenantId"]),
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

// The reuse point under test — mocked, not reimplemented.
//
// `executeMonitorCheck` is the ONLY export stubbed here: it is the network
// boundary, and stubbing it is what lets these tests assert that "Re-evaluate"
// never crosses it. `applyMapping` is deliberately re-exported REAL (via
// importActual) because the trace and diff routes run it for real — replacing it
// with a stub would let a mapping regression pass unnoticed, which is the exact
// failure mode these phases are meant to prevent.
const executeMonitorCheck = vi.fn();
vi.mock("../lib/monitor-executor", async () => {
  const actual = await vi.importActual<typeof import("../lib/monitor-executor")>("../lib/monitor-executor");
  return {
    ...actual,
    executeMonitorCheck: (...args: unknown[]) => executeMonitorCheck(...args),
  };
});

// The rule fetch the trace/diff routes use. Mocked because it is a DB read (an
// INPUT to the trace), not part of the trace's logic — `evaluateRule` stays real.
const getAllRules = vi.fn(() => Promise.resolve([] as unknown[]));
vi.mock("./admin-signal-rules", () => ({
  getAllRules: () => getAllRules(),
}));

import router from "./admin-monitor-check-runs";

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return app;
}

const auth = (r: request.Test) => r.set("Authorization", `Bearer ${ADMIN_PASS}`);

/** Poll the run until it reaches a terminal state (the async run resolves on the microtask queue). */
async function waitForTerminal(app: Express, runId: string) {
  for (let i = 0; i < 40; i++) {
    const res = await auth(request(app).get(`/api/admin/monitor-check-runs/${runId}`));
    if (res.body.run?.status === "completed" || res.body.run?.status === "failed") return res.body.run;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("run never reached a terminal state");
}

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue = [];
  runRows = [];
  getAllRules.mockResolvedValue([]);
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

  it("rejects an unauthenticated bulk run", async () => {
    const res = await request(makeApp()).post("/api/admin/monitor-checks/bulk-run").send({ customerId: 42, domain: "identity" });
    expect(res.status).toBe(401);
    expect(executeMonitorCheck).not.toHaveBeenCalled();
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

/** The same users after the third one registered — a real changed value. */
const MFA_ITEMS_ALL = [
  { id: "u1", isMfaRegistered: true },
  { id: "u2", isMfaRegistered: true },
  { id: "u3", isMfaRegistered: true },
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

  it("persists the trace against the run so the history list can show it was traced", async () => {
    const app = makeApp();
    const runId = await startCompletedRun(app, MFA_ITEMS, MAPPED_CHECK);

    let history = await auth(request(app).get(`/api/admin/monitor-check-runs?checkKey=${MAPPED_CHECK.key}`));
    expect(history.body.runs[0].hasTrace).toBe(false);

    await auth(request(app).post(`/api/admin/monitor-check-runs/${runId}/trace`)).send({});

    history = await auth(request(app).get(`/api/admin/monitor-check-runs?checkKey=${MAPPED_CHECK.key}`));
    expect(history.body.runs[0].hasTrace).toBe(true);
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

// ── Phase 3: persistence survives a restart ───────────────────────────────────

describe("run persistence", () => {
  it("a completed run is readable after a simulated api-server restart", async () => {
    const app = makeApp();
    const runId = await startCompletedRun(app, MFA_ITEMS, MAPPED_CHECK);

    // THE RESTART. A brand-new Express app over the same router, and nothing
    // process-local carried across — the only thing that survives is the row in
    // the table. Under the old in-memory Map this read returned 404.
    const restarted = makeApp();

    const res = await auth(request(restarted).get(`/api/admin/monitor-check-runs/${runId}`));
    expect(res.status).toBe(200);
    expect(res.body.run.status).toBe("completed");
    expect(res.body.run.checkKey).toBe(MAPPED_CHECK.key);
    expect(res.body.run.result.itemCount).toBe(3);
    expect(res.body.run.request.endpoint).toBe(MAPPED_CHECK.endpoint);
  });

  it("the captured response survives the restart too, so a run can still be traced", async () => {
    const app = makeApp();
    const runId = await startCompletedRun(app, MFA_ITEMS, MAPPED_CHECK);

    const restarted = makeApp();
    const res = await auth(request(restarted).post(`/api/admin/monitor-check-runs/${runId}/trace`)).send({});

    expect(res.status).toBe(200);
    // The real mapping re-applied to the response read back out of the table.
    expect(res.body.trace.keys.find((k: any) => k.key === "mfaRegisteredCount").value).toBe(2);
    // And still no network call — the response came from storage, not Graph.
    expect(executeMonitorCheck).toHaveBeenCalledTimes(1);
  });

  it("lists run history newest-first for the requested check only", async () => {
    const app = makeApp();
    const older = await startCompletedRun(app, MFA_ITEMS, MAPPED_CHECK);
    const newer = await startCompletedRun(app, MFA_ITEMS_ALL, MAPPED_CHECK);
    await startCompletedRun(app, MFA_ITEMS, { ...MAPPED_CHECK, key: "identity:guest-accounts" });

    const res = await auth(request(makeApp()).get(`/api/admin/monitor-check-runs?checkKey=${MAPPED_CHECK.key}`));
    expect(res.status).toBe(200);
    // The other check's run is not in this check's history.
    expect(res.body.runs).toHaveLength(2);
    expect(res.body.runs.every((r: any) => r.checkKey === MAPPED_CHECK.key)).toBe(true);
    // Newest first.
    expect(res.body.runs.map((r: any) => r.runId)).toEqual([newer, older]);
    // The history list never drags the item payload along.
    expect(res.body.runs[0].items).toBeUndefined();
    expect(res.body.runs[0].result).toBeUndefined();
  });

  it("400s a history request with no checkKey rather than listing every run ever", async () => {
    const res = await auth(request(makeApp()).get("/api/admin/monitor-check-runs"));
    expect(res.status).toBe(400);
  });
});

// ── Phase 3: bulk run ─────────────────────────────────────────────────────────

const IDENTITY_CHECKS = [
  { ...CHECK, id: 1, key: "identity:mfa-registration", label: "MFA" },
  { ...CHECK, id: 2, key: "identity:guest-accounts", label: "Guests" },
  { ...CHECK, id: 3, key: "identity:stale-users", label: "Stale users" },
];

/** Waits until every run in the batch reaches a terminal state. */
async function waitForBatch(app: Express, batchId: string) {
  for (let i = 0; i < 60; i++) {
    const res = await auth(request(app).get(`/api/admin/monitor-check-batches/${batchId}`));
    if (res.body.summary?.finished) return res.body;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("batch never finished");
}

describe("POST /admin/monitor-checks/bulk-run", () => {
  it("400s without a domain", async () => {
    const res = await auth(request(makeApp()).post("/api/admin/monitor-checks/bulk-run")).send({ customerId: 42 });
    expect(res.status).toBe(400);
    expect(executeMonitorCheck).not.toHaveBeenCalled();
  });

  it("404s when no runnable check exists under the domain", async () => {
    selectQueue = [[CUSTOMER], []];
    const res = await auth(request(makeApp()).post("/api/admin/monitor-checks/bulk-run")).send({
      customerId: 42,
      domain: "nothing",
    });
    expect(res.status).toBe(404);
    expect(executeMonitorCheck).not.toHaveBeenCalled();
  });

  it("runs every check under the domain through the same single-run execution path", async () => {
    selectQueue = [[CUSTOMER], IDENTITY_CHECKS];
    executeMonitorCheck.mockImplementation(async (opts: any) => ({
      checkKey: opts.check.key,
      status: "ok",
      extractedProperties: {},
      severityMatched: null,
      itemCount: 1,
      pageCount: 1,
      items: [{ id: "x" }],
    }));

    const app = makeApp();
    const res = await auth(request(app).post("/api/admin/monitor-checks/bulk-run")).send({ customerId: 42, domain: "identity" });

    expect(res.status).toBe(202);
    expect(res.body.total).toBe(3);
    expect(res.body.checkKeys).toEqual(IDENTITY_CHECKS.map((c) => c.key));

    const batch = await waitForBatch(app, res.body.batchId);
    expect(batch.summary.total).toBe(3);
    expect(batch.summary.ok).toBe(3);
    expect(batch.summary.completed).toBe(3);
    // Every check went through executeMonitorCheck — the same reuse point the
    // single-run route uses, with the same simulator arguments.
    expect(executeMonitorCheck).toHaveBeenCalledTimes(3);
    for (const call of executeMonitorCheck.mock.calls) {
      expect((call[0] as any).skipIdempotency).toBe(true);
      expect((call[0] as any).includeItems).toBe(true);
      expect((call[0] as any).tenantId).toBe("tenant-guid-abc");
    }
  });

  it("aggregates per-check results without one check's failure blocking the others", async () => {
    selectQueue = [[CUSTOMER], IDENTITY_CHECKS];
    executeMonitorCheck.mockImplementation(async (opts: any) => {
      // One check throws outright, one comes back license-gapped, one is fine.
      if (opts.check.key === "identity:guest-accounts") throw new Error("socket hang up");
      if (opts.check.key === "identity:stale-users") {
        return {
          checkKey: opts.check.key,
          status: "license_gap",
          extractedProperties: {},
          severityMatched: null,
          errorMessage: "Requires Entra ID P2",
          licenseFeature: "Entra ID P2",
          itemCount: 0,
          pageCount: 0,
        };
      }
      return {
        checkKey: opts.check.key,
        status: "ok",
        extractedProperties: {},
        severityMatched: null,
        itemCount: 2,
        pageCount: 1,
        items: [{ id: "a" }, { id: "b" }],
      };
    });

    const app = makeApp();
    const res = await auth(request(app).post("/api/admin/monitor-checks/bulk-run")).send({ customerId: 42, domain: "identity" });
    const batch = await waitForBatch(app, res.body.batchId);

    // All three ran. The thrown one did not abort the batch.
    expect(batch.summary.total).toBe(3);
    expect(batch.runs).toHaveLength(3);
    expect(batch.summary.ok).toBe(1);
    expect(batch.summary.licenseGap).toBe(1);
    expect(batch.summary.licenseGapFeatures).toEqual(["Entra ID P2"]);

    const thrown = batch.runs.find((r: any) => r.checkKey === "identity:guest-accounts");
    expect(thrown.status).toBe("failed");
    expect(thrown.errorMessage).toBe("socket hang up");

    const okRun = batch.runs.find((r: any) => r.checkKey === "identity:mfa-registration");
    expect(okRun.status).toBe("completed");
    expect(okRun.itemCount).toBe(2);
  });

  it("skips script-collected checks explicitly instead of running them as failures", async () => {
    selectQueue = [[CUSTOMER], [IDENTITY_CHECKS[0], { ...SCRIPT_CHECK, id: 9 }]];
    executeMonitorCheck.mockResolvedValue({
      checkKey: IDENTITY_CHECKS[0]!.key,
      status: "ok",
      extractedProperties: {},
      severityMatched: null,
      itemCount: 0,
      pageCount: 1,
      items: [],
    });

    const app = makeApp();
    const res = await auth(request(app).post("/api/admin/monitor-checks/bulk-run")).send({ customerId: 42, domain: "identity" });

    expect(res.body.total).toBe(1);
    expect(res.body.skipped).toHaveLength(1);
    expect(res.body.skipped[0].checkKey).toBe(SCRIPT_CHECK.key);

    const batch = await waitForBatch(app, res.body.batchId);
    expect(batch.summary.total).toBe(1);
    expect(executeMonitorCheck).toHaveBeenCalledTimes(1);
  });

  it("404s an unknown batch", async () => {
    const res = await auth(request(makeApp()).get("/api/admin/monitor-check-batches/nope"));
    expect(res.status).toBe(404);
  });
});

// ── Phase 3: diff ─────────────────────────────────────────────────────────────

describe("GET /admin/monitor-check-runs/:runId/diff", () => {
  it("400s without an `against` run", async () => {
    const app = makeApp();
    const runId = await startCompletedRun(app, MFA_ITEMS, MAPPED_CHECK);
    const res = await auth(request(app).get(`/api/admin/monitor-check-runs/${runId}/diff`));
    expect(res.status).toBe(400);
  });

  it("404s when the compared-against run does not exist", async () => {
    const app = makeApp();
    const runId = await startCompletedRun(app, MFA_ITEMS, MAPPED_CHECK);
    const res = await auth(request(app).get(`/api/admin/monitor-check-runs/${runId}/diff?against=missing`));
    expect(res.status).toBe(404);
  });

  it("409s when the two runs are of different checks", async () => {
    const app = makeApp();
    const a = await startCompletedRun(app, MFA_ITEMS, MAPPED_CHECK);
    const b = await startCompletedRun(app, MFA_ITEMS, { ...MAPPED_CHECK, key: "identity:guest-accounts" });

    const res = await auth(request(app).get(`/api/admin/monitor-check-runs/${a}/diff?against=${b}`));
    expect(res.status).toBe(409);
  });

  it("identifies a real changed value between two persisted runs", async () => {
    getAllRules.mockResolvedValue([
      {
        id: 77,
        signalKey: "security:mfa-gap",
        groupId: null,
        ruleType: "profile_key_lt",
        sourceKey: "mfaRegisteredCount",
        compareValue: "3",
        description: null,
        sortOrder: 0,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    ]);

    const app = makeApp();
    const first = await startCompletedRun(app, MFA_ITEMS, MAPPED_CHECK);
    const second = await startCompletedRun(app, MFA_ITEMS_ALL, MAPPED_CHECK);

    const res = await auth(request(app).get(`/api/admin/monitor-check-runs/${second}/diff?against=${first}`));
    expect(res.status).toBe(200);

    const diff = res.body.diff;
    expect(diff.before.runId).toBe(first);
    expect(diff.after.runId).toBe(second);

    const changed = diff.keyChanges.find((k: any) => k.key === "mfaRegisteredCount");
    // The REAL countTruthy over each run's own stored response: 2 → 3.
    expect(changed.change).toBe("changed");
    expect(changed.before).toBe(2);
    expect(changed.after).toBe(3);

    // And the rule that read it stopped firing, per the REAL evaluateRule.
    const rule = diff.ruleChanges.find((r: any) => r.ruleId === 77);
    expect(rule.change).toBe("stopped_firing");
    expect(rule.before).toBe(true);
    expect(rule.after).toBe(false);
  });

  it("diffs runs read back after a restart", async () => {
    const app = makeApp();
    const first = await startCompletedRun(app, MFA_ITEMS, MAPPED_CHECK);
    const second = await startCompletedRun(app, MFA_ITEMS_ALL, MAPPED_CHECK);

    // Nothing process-local survives; both responses come out of the table.
    const restarted = makeApp();
    const res = await auth(request(restarted).get(`/api/admin/monitor-check-runs/${first}/diff?against=${second}`));

    expect(res.status).toBe(200);
    expect(res.body.diff.keyChanges.find((k: any) => k.key === "mfaRegisteredCount").after).toBe(3);
  });

  it("409s rather than diffing a run that captured no usable response", async () => {
    const app = makeApp();
    const good = await startCompletedRun(app, MFA_ITEMS, MAPPED_CHECK);

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
    const start = await auth(request(app).post(`/api/admin/monitor-checks/${MAPPED_CHECK.key}/run`)).send({ customerId: 42 });
    await waitForTerminal(app, start.body.runId);

    const res = await auth(request(app).get(`/api/admin/monitor-check-runs/${good}/diff?against=${start.body.runId}`));
    expect(res.status).toBe(409);
  });
});

// ── Phase 4: failure classification rides on the READ routes ──────────────────
//
// These assert the WIRING only. The categories themselves, the permission-name
// extraction and the refusal-to-guess behaviour are covered by the classifier's
// own suite (lib/__tests__/monitor-failure-classifier.test.ts) against the same
// real error signatures; re-encoding them here would test a forked copy.

describe("Phase 4 — failure classification on the read routes", () => {
  /** A real 403 body, wrapped the way monitor-executor really wraps it. */
  const REAL_403 =
    'Graph API error 403: {"error":{"code":"Forbidden","message":"The token doesn\'t have the required permissions. Required permission: SecurityEvents.Read.All."}}';

  /** Starts a run whose executor result is a real failure, and returns its runId. */
  async function startFailedRun(app: Express): Promise<string> {
    selectQueue = [[CHECK], [CUSTOMER]];
    executeMonitorCheck.mockResolvedValue({
      checkKey: CHECK.key,
      status: "error",
      extractedProperties: {},
      severityMatched: null,
      errorMessage: REAL_403,
      itemCount: 0,
      pageCount: 0,
    });
    const start = await auth(request(app).post(`/api/admin/monitor-checks/${CHECK.key}/run`)).send({ customerId: 42 });
    await waitForTerminal(app, start.body.runId);
    return start.body.runId as string;
  }

  it("attaches a classification to a FAILED single run's poll response", async () => {
    const app = makeApp();
    const runId = await startFailedRun(app);

    const res = await auth(request(app).get(`/api/admin/monitor-check-runs/${runId}`));
    expect(res.body.run.status).toBe("failed");
    expect(res.body.classification.category).toBe("missing_scope");
    // The real named permission, surfaced without anyone reading the raw text.
    expect(res.body.classification.permissions).toContain("SecurityEvents.Read.All");
    // Display only — nothing here offers to add it.
    expect(res.body.classification.action.kind).toBe("show_permission");
  });

  it("returns a NULL classification for a run that succeeded", async () => {
    const app = makeApp();
    const runId = await startCompletedRun(app, MFA_ITEMS);
    const res = await auth(request(app).get(`/api/admin/monitor-check-runs/${runId}`));
    expect(res.body.run.status).toBe("completed");
    expect(res.body.classification).toBeNull();
  });

  it("attaches classifications to the run-history list", async () => {
    const app = makeApp();
    await startFailedRun(app);

    const res = await auth(request(app).get(`/api/admin/monitor-check-runs?checkKey=${CHECK.key}`));
    expect(res.body.runs[0].classification.category).toBe("missing_scope");
    // The endpoint is projected onto the summary so a list row classifies the
    // same way its detail view does.
    expect(res.body.runs[0].requestEndpoint).toBe(CHECK.endpoint);
  });

  it("aggregates a batch's failures into grouped triage with the distinct permissions", async () => {
    selectQueue = [[CUSTOMER], IDENTITY_CHECKS];
    executeMonitorCheck.mockImplementation(async (opts: any) => {
      // Two of the three fail for the SAME real reason — the case the roll-up exists for.
      if (opts.check.key === "identity:stale-users") {
        return {
          checkKey: opts.check.key,
          status: "ok",
          extractedProperties: {},
          severityMatched: null,
          itemCount: 1,
          pageCount: 1,
          items: [{ id: "a" }],
        };
      }
      return {
        checkKey: opts.check.key,
        status: "error",
        extractedProperties: {},
        severityMatched: null,
        errorMessage: REAL_403,
        itemCount: 0,
        pageCount: 0,
      };
    });

    const app = makeApp();
    const res = await auth(request(app).post("/api/admin/monitor-checks/bulk-run")).send({ customerId: 42, domain: "identity" });
    const batch = await waitForBatch(app, res.body.batchId);

    expect(batch.triage.totalFailures).toBe(2);
    expect(batch.triage.classifiedCount).toBe(2);
    const scope = batch.triage.groups.find((g: any) => g.category === "missing_scope");
    expect(scope.count).toBe(2);
    expect(scope.checkKeys).toEqual(["identity:mfa-registration", "identity:guest-accounts"]);
    // Two failing checks collapse to ONE real permission to go and look at.
    expect(batch.triage.permissionsNeeded).toEqual(["SecurityEvents.Read.All"]);
    // The successful run carries no classification.
    expect(batch.runs.find((r: any) => r.checkKey === "identity:stale-users").classification).toBeNull();
  });
});
