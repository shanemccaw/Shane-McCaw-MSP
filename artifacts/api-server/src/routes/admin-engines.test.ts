/**
 * admin-engines.test.ts
 *
 * Unit tests for registry endpoints:
 *   GET /api/admin/engines       — lists Engine Registry definitions
 *   GET /api/admin/plan-features — lists Plan-Feature Registry definitions
 *
 * Run with: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

process.env["DATABASE_URL"] = "postgres://test";
process.env["ADMIN_PASSWORD"] = "test-admin-pass";

const ADMIN_PASS = "test-admin-pass";

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({ rowCount: 1 }),
      }),
    }),
  },
  // executeRawSql now runs each statement on a single pooled client
  // (pool.connect() → client.query() → client.release()) so BEGIN/COMMIT
  // scripts share one transaction; the SQL-execute tests stub this per-test.
  pool: {
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0, fields: [] }),
      release: vi.fn(),
    }),
  },
  usersTable: { id: "id", role: "role", email: "email", mspId: "msp_id", tenantId: "tenant_id", isActive: "is_active" },
  engagementProjectsTable: {},
  signalRuleGroupsTable: {},
  signalDerivationRulesTable: {},
  tenantsTable: {},
  mspsTable: { id: "id", isTestbed: "is_testbed", testbedMetadata: "testbed_metadata" },
  savedSqlScripts: { id: "id" },
}));

// requireAdmin AND requireAdminOrIngestToken are both exported by the real module;
// several routes here (e.g. /simulator/sql/execute, /simulator/ps-execution/cmdlet)
// gate with requireAdminOrIngestToken() — a factory returning the middleware — so the
// mock must expose it too, or importing the router throws at route-registration time.
vi.mock("../middlewares/requireAuth", () => {
  const gate = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const auth = req.headers["authorization"] ?? "";
    if (auth === `Bearer ${ADMIN_PASS}`) return next();
    res.status(401).json({ error: "Unauthorized" });
  };
  return {
    requireAdmin: gate,
    requireAdminOrIngestToken: () => gate,
  };
});

// The ps-execution container client is mocked so /simulator/ps-execution/cmdlet
// (#1404) never makes a real network call. A real PsExecutionError class is exported
// so the route's `err instanceof PsExecutionError` branch is exercised for real.
const mockCallPsExecution = vi.hoisted(() => vi.fn());
vi.mock("../lib/ps-execution-client", () => {
  class PsExecutionError extends Error {
    kind: string;
    cmdletKey: string;
    containerErrorKind?: string;
    rawBody?: string;
    constructor(kind: string, cmdletKey: string, message: string, opts?: { containerErrorKind?: string; rawBody?: string }) {
      super(message);
      this.name = "PsExecutionError";
      this.kind = kind;
      this.cmdletKey = cmdletKey;
      this.containerErrorKind = opts?.containerErrorKind;
      this.rawBody = opts?.rawBody;
    }
  }
  return { callPsExecution: mockCallPsExecution, PsExecutionError };
});

vi.mock("../lib/logger", () => ({
  // `child` included because lib/run-history.ts — which the SQL and migration
  // executors record every run through — binds its own channel at module load.
  logger: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, default: { ...original, readdir: mockReaddir, readFile: mockReadFile } };
});

vi.mock("../lib/engine-test-log-buffer", () => ({
  pushEngineTestLog: vi.fn(),
  listEngineTestLogs: vi.fn().mockReturnValue([]),
}));

vi.mock("./admin-signal-rules", () => ({
  getAllRules: vi.fn().mockResolvedValue([]),
  getAllGroups: vi.fn().mockResolvedValue([]),
  parseIntelligenceFields: vi.fn().mockReturnValue({}),
  saveSnapshot: vi.fn().mockResolvedValue(undefined),
}));

const { mockRunForTenant, mockReaddir, mockReadFile } = vi.hoisted(() => ({
  mockRunForTenant: vi.fn(),
  // GET /simulator/migrations/:filename/content reads real files off disk
  // (lib/db/migrations/manual/) — mocked here rather than pointed at a real
  // fixture directory, same reasoning every other admin-engines.ts dependency
  // in this file is mocked instead of hit for real.
  mockReaddir: vi.fn(),
  mockReadFile: vi.fn(),
}));

vi.mock("../lib/engine-registry", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/engine-registry")>();
  return {
    ...original,
    getEngineDef: vi.fn().mockReturnValue({
      runForTenant: mockRunForTenant,
    }),
  };
});

let app: Express;

beforeEach(async () => {
  vi.clearAllMocks();
  app = express();
  app.use(express.json());
  const { default: adminEnginesRouter } = await import("./admin-engines");
  app.use(adminEnginesRouter);
});

const authHeader = { Authorization: `Bearer ${ADMIN_PASS}` };

describe("GET /api/admin/engines", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).get("/admin/engines");
    expect(res.status).toBe(401);
  });

  it("returns engine list with key + label", async () => {
    const res = await request(app).get("/admin/engines").set(authHeader);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.engines)).toBe(true);
    expect(res.body.engines.length).toBeGreaterThan(0);
    const first = res.body.engines[0];
    expect(typeof first.key).toBe("string");
    expect(typeof first.label).toBe("string");
  });

  it("includes all known engine keys", async () => {
    const res = await request(app).get("/admin/engines").set(authHeader);
    const keys: string[] = res.body.engines.map((e: { key: string }) => e.key);
    for (const k of ["priority", "pricing", "health", "drift", "forecasting", "crm", "msp", "sla", "scope_creep", "monitoring", "sales_offer"]) {
      expect(keys, `engine key '${k}' missing from registry response`).toContain(k);
    }
  });
});

describe("GET /api/admin/plan-features", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).get("/admin/plan-features");
    expect(res.status).toBe(401);
  });

  it("returns features array with key + label + description", async () => {
    const res = await request(app).get("/admin/plan-features").set(authHeader);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.features)).toBe(true);
    expect(res.body.features.length).toBeGreaterThan(0);
    const first = res.body.features[0];
    expect(typeof first.key).toBe("string");
    expect(typeof first.label).toBe("string");
    expect(typeof first.description).toBe("string");
  });

  it("includes all canonical plan-feature keys", async () => {
    const res = await request(app).get("/admin/plan-features").set(authHeader);
    const keys: string[] = res.body.features.map((f: { key: string }) => f.key);
    for (const k of ["advanced_signals", "custom_workflows", "sla_scope_creep_custom_rules", "sales_offers", "custom_bundle_composition"]) {
      expect(keys, `plan-feature key '${k}' missing from registry response`).toContain(k);
    }
  });

  it("plan-feature keys are a superset of the TIER_RANK keys — no overlap required but no unknown keys in important spot", async () => {
    const res = await request(app).get("/admin/plan-features").set(authHeader);
    const keys: string[] = res.body.features.map((f: { key: string }) => f.key);
    expect(keys.length).toBeGreaterThanOrEqual(5);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("registry data integrity", () => {
  it("engines and plan-features have no key collisions", async () => {
    const [engRes, featRes] = await Promise.all([
      request(app).get("/admin/engines").set(authHeader),
      request(app).get("/admin/plan-features").set(authHeader),
    ]);
    const engineKeys = new Set<string>(engRes.body.engines.map((e: { key: string }) => e.key));
    const featureKeys: string[] = featRes.body.features.map((f: { key: string }) => f.key);
    for (const fk of featureKeys) {
      expect(engineKeys.has(fk), `key '${fk}' appears in both engines and plan-features`).toBe(false);
    }
  });
});

describe("GET /api/admin/testbeds", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).get("/admin/testbeds");
    expect(res.status).toBe(401);
  });

  it("lists all testbeds when authorized", async () => {
    const { db } = await import("@workspace/db");
    const mockTestbeds = [{ id: 1, name: "Testbed Customer", isTestbed: true }];
    vi.spyOn(db, "select").mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(mockTestbeds),
      }),
    } as any);

    const res = await request(app).get("/admin/testbeds").set(authHeader);
    expect(res.status).toBe(200);
    expect(res.body.testbeds).toEqual(mockTestbeds);
  });
});

describe("POST /api/admin/simulator/run", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).post("/admin/simulator/run").send({});
    expect(res.status).toBe(401);
  });

  it("fails with 400 when missing parameters", async () => {
    const res = await request(app).post("/admin/simulator/run").set(authHeader).send({});
    expect(res.status).toBe(400);
  });

  it("runs time compression simulation loop and returns traces", async () => {
    const { db } = await import("@workspace/db");
    const { getEngineDef } = await import("../lib/engine-registry");

    // Mock DB select to return testbed customer
    vi.spyOn(db, "select").mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 42, isTestbed: true }]),
        }),
      }),
    } as any);

    // Mock engine runForTenant
    mockRunForTenant.mockResolvedValue({ score: 99 });

    const res = await request(app)
      .post("/admin/simulator/run")
      .set(authHeader)
      .send({
        testbedCustomerId: 42,
        engineKey: "priority",
        startDate: "2026-06-01T00:00:00.000Z",
        endDate: "2026-06-03T00:00:00.000Z",
        stepDays: 1,
      });

    expect(res.status).toBe(200);
    expect(res.body.traces).toHaveLength(3); // June 1, 2, 3
    expect(res.body.traces[0].output).toEqual({ score: 99 });
    expect(mockRunForTenant).toHaveBeenCalledTimes(3);
  });
});

describe("GET /simulator/manifest", () => {
  it("returns manifest events when authorized", async () => {
    const res = await request(app)
      .get("/simulator/manifest")
      .set(authHeader);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(res.body.events.length).toBeGreaterThan(0);
  });
});

describe("POST /simulator/fire-event", () => {
  it("fails if target customer is not a testbed customer or not found", async () => {
    const { db } = await import("@workspace/db");
    vi.spyOn(db, "select").mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as any);

    const res = await request(app)
      .post("/simulator/fire-event")
      .set(authHeader)
      .send({ eventId: "MSP_SUSPEND_7_DAYS", testbedCustomerId: 10 });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Testbed customer not found");
  });

  it("fires a manifest event successfully when target is testbed customer", async () => {
    const { db } = await import("@workspace/db");
    vi.spyOn(db, "select").mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 10, isTestbed: true, mspId: 10 }]),
        }),
      }),
    } as any);
    // Mock db.update for event execution
    vi.spyOn(db, "update").mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({ rowCount: 1 }),
      }),
    } as any);

    const res = await request(app)
      .post("/simulator/fire-event")
      .set(authHeader)
      .send({ eventId: "MSP_SUSPEND_7_DAYS", testbedCustomerId: 10 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe("POST /simulator/sql/execute", () => {
  it("permits destructive commands — #702 is deliberately full read/write, no prohibition", async () => {
    // The route comment is explicit: "full read/write, no restrictions, by his own
    // explicit choice after being walked through the risk. Development server, not
    // production." There is no destructive-command guard, so a DROP runs like any
    // other statement (this assertion previously expected a guard that never existed;
    // it was only ever hidden because the whole file crashed at import — see the
    // requireAdminOrIngestToken mock).
    const { pool } = await import("@workspace/db");
    const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0, fields: [] });
    (pool as any).connect = vi.fn().mockResolvedValue({ query: mockQuery, release: vi.fn() });

    const res = await request(app)
      .post("/simulator/sql/execute")
      .set(authHeader)
      .send({ query: "DROP TABLE users;" });
    expect(res.status).toBe(200);
    expect(res.body.statements).toHaveLength(1);
    expect(res.body.statements[0].success).toBe(true);
  });

  it("executes a query and returns a per-statement result array", async () => {
    const { pool } = await import("@workspace/db");
    const mockQuery = vi.fn().mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1, fields: [{ name: "id" }] });
    const mockRelease = vi.fn();
    (pool as any).connect = vi.fn().mockResolvedValue({ query: mockQuery, release: mockRelease });

    const res = await request(app)
      .post("/simulator/sql/execute")
      .set(authHeader)
      .send({ query: "SELECT * FROM users;" });
    expect(res.status).toBe(200);
    expect(res.body.statements).toHaveLength(1);
    expect(res.body.statements[0]).toMatchObject({ statementIndex: 0, success: true, rows: [{ id: 1 }], rowCount: 1, fields: ["id"] });
    expect(mockQuery).toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalled();
  });

  it("runs each statement independently — a failure on one does not stop the rest", async () => {
    const { pool } = await import("@workspace/db");
    const mockQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1, fields: [{ name: "id" }] })
      .mockRejectedValueOnce(new Error("relation \"nope\" does not exist"))
      .mockResolvedValueOnce({ rows: [], rowCount: 2, fields: [] }) // the trailing ROLLBACK / next stmt
      .mockResolvedValue({ rows: [], rowCount: 0, fields: [] });
    (pool as any).connect = vi.fn().mockResolvedValue({ query: mockQuery, release: vi.fn() });

    const res = await request(app)
      .post("/simulator/sql/execute")
      .set(authHeader)
      .send({ query: "SELECT 1; SELECT * FROM nope; UPDATE users SET x = 1;" });
    expect(res.status).toBe(200);
    expect(res.body.statements).toHaveLength(3);
    expect(res.body.statements[0].success).toBe(true);
    expect(res.body.statements[1].success).toBe(false);
    expect(res.body.statements[1].error).toContain("does not exist");
    expect(res.body.statements[2].success).toBe(true);
  });
});

describe("GET /simulator/migrations/:filename/content", () => {
  it("returns a recognized manual migration file's real text", async () => {
    mockReaddir.mockResolvedValue([{ name: "0001_test.sql", isFile: () => true }]);
    mockReadFile.mockResolvedValue("create table foo (id serial primary key);");

    const res = await request(app).get("/simulator/migrations/0001_test.sql/content").set(authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ filename: "0001_test.sql", content: "create table foo (id serial primary key);" });
  });

  it("rejects a filename that is not in the real directory listing (allowlist, not just sanitization)", async () => {
    mockReaddir.mockResolvedValue([{ name: "0001_test.sql", isFile: () => true }]);

    const res = await request(app).get("/simulator/migrations/..%2F..%2Fetc%2Fpasswd/content").set(authHeader);
    expect(res.status).toBe(400);
    expect(mockReadFile).not.toHaveBeenCalled();
  });
});

describe("POST /simulator/session-lock", () => {
  it("updates MSP metadata with lock session ID", async () => {
    const { db } = await import("@workspace/db");
    const mockUpdate = vi.spyOn(db, "update").mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({ rowCount: 1 }),
      }),
    } as any);

    const res = await request(app)
      .post("/simulator/session-lock")
      .set(authHeader)
      .send({ testbedMspId: 10, lock: true });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.locked).toBe(true);
    expect(mockUpdate).toHaveBeenCalled();
  });
});

describe("POST /simulator/ps-execution/cmdlet (#1404)", () => {
  // Helper: point db.select(...).from(...).where(...).limit(...) at one tenant row.
  const stubTenant = async (row: Record<string, unknown> | null) => {
    const { db } = await import("@workspace/db");
    vi.spyOn(db, "select").mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(row ? [row] : []),
        }),
      }),
    } as any);
  };

  const TESTBED = {
    id: 1,
    name: "Testbed Co",
    tenantId: "11111111-1111-1111-1111-111111111111",
    domain: "mccawsoft2.onmicrosoft.com",
    isTestbed: true,
    status: "active",
  };

  it("returns 401 without auth", async () => {
    const res = await request(app).post("/simulator/ps-execution/cmdlet").send({ cmdletKey: "get-connection-info", tenantId: "1" });
    expect(res.status).toBe(401);
  });

  it("400 when cmdletKey is missing", async () => {
    const res = await request(app).post("/simulator/ps-execution/cmdlet").set(authHeader).send({ tenantId: "1" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("cmdletKey");
  });

  it("400 when tenantId is missing", async () => {
    const res = await request(app).post("/simulator/ps-execution/cmdlet").set(authHeader).send({ cmdletKey: "get-connection-info" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("tenantId");
  });

  it("404 when the tenant is not found", async () => {
    await stubTenant(null);
    const res = await request(app).post("/simulator/ps-execution/cmdlet").set(authHeader).send({ cmdletKey: "get-connection-info", tenantId: "999" });
    expect(res.status).toBe(404);
    expect(mockCallPsExecution).not.toHaveBeenCalled();
  });

  it("403 (#965 gate) when the tenant is not a testbed", async () => {
    await stubTenant({ ...TESTBED, isTestbed: false });
    const res = await request(app).post("/simulator/ps-execution/cmdlet").set(authHeader).send({ cmdletKey: "get-connection-info", tenantId: "1" });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain("isTestbed");
    expect(mockCallPsExecution).not.toHaveBeenCalled();
  });

  it("403 (#965 gate) when the tenant is testbed but not active", async () => {
    await stubTenant({ ...TESTBED, status: "onboarding" });
    const res = await request(app).post("/simulator/ps-execution/cmdlet").set(authHeader).send({ cmdletKey: "get-connection-info", tenantId: "1" });
    expect(res.status).toBe(403);
    expect(mockCallPsExecution).not.toHaveBeenCalled();
  });

  it("400 when a supplied organization does not match the gated testbed tenant", async () => {
    await stubTenant(TESTBED);
    const res = await request(app)
      .post("/simulator/ps-execution/cmdlet")
      .set(authHeader)
      .send({ cmdletKey: "get-connection-info", tenantId: "1", organization: "attacker.onmicrosoft.com" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("does not match");
    expect(mockCallPsExecution).not.toHaveBeenCalled();
  });

  it("200 runs the cmdlet, forces Organization to the gated tenant's domain, and returns its output", async () => {
    await stubTenant(TESTBED);
    mockCallPsExecution.mockResolvedValue({ items: [{ Name: "IPPS" }], rawResponse: [{ Name: "IPPS" }] });

    const res = await request(app)
      .post("/simulator/ps-execution/cmdlet")
      .set(authHeader)
      .send({ cmdletKey: "get-connection-info", tenantId: "1", params: { Foo: "bar" } });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.cmdletKey).toBe("get-connection-info");
    expect(res.body.organization).toBe(TESTBED.domain);
    expect(res.body.customerId).toBe(1);
    expect(res.body.itemCount).toBe(1);
    expect(res.body.items).toEqual([{ Name: "IPPS" }]);

    // Organization is FORCED to the gated tenant's domain (never overridable via params).
    expect(mockCallPsExecution).toHaveBeenCalledWith("get-connection-info", { Foo: "bar", Organization: TESTBED.domain });
  });

  it("a caller cannot override Organization through params", async () => {
    await stubTenant(TESTBED);
    mockCallPsExecution.mockResolvedValue({ items: [], rawResponse: [] });

    await request(app)
      .post("/simulator/ps-execution/cmdlet")
      .set(authHeader)
      .send({ cmdletKey: "get-connection-info", tenantId: "1", params: { Organization: "attacker.onmicrosoft.com" } });

    expect(mockCallPsExecution).toHaveBeenCalledWith("get-connection-info", { Organization: TESTBED.domain });
  });

  it("resolves by numeric customer id as well as tenant GUID", async () => {
    await stubTenant(TESTBED);
    mockCallPsExecution.mockResolvedValue({ items: [], rawResponse: [] });
    const res = await request(app)
      .post("/simulator/ps-execution/cmdlet")
      .set(authHeader)
      .send({ cmdletKey: "get-cs-online-user", tenantId: TESTBED.tenantId });
    expect(res.status).toBe(200);
  });

  it("502 maps a PsExecutionError auth_failed to an upstream failure with its kind", async () => {
    await stubTenant(TESTBED);
    const { PsExecutionError } = await import("../lib/ps-execution-client");
    mockCallPsExecution.mockRejectedValue(
      new PsExecutionError("auth_failed", "get-connection-info", "Could not establish a session", { containerErrorKind: "auth_failed" }),
    );
    const res = await request(app).post("/simulator/ps-execution/cmdlet").set(authHeader).send({ cmdletKey: "get-connection-info", tenantId: "1" });
    expect(res.status).toBe(502);
    expect(res.body.ok).toBe(false);
    expect(res.body.kind).toBe("auth_failed");
    expect(res.body.containerErrorKind).toBe("auth_failed");
  });

  it("400 maps a PsExecutionError script_error to a caller error", async () => {
    await stubTenant(TESTBED);
    const { PsExecutionError } = await import("../lib/ps-execution-client");
    mockCallPsExecution.mockRejectedValue(new PsExecutionError("script_error", "get-connection-info", "bad_request"));
    const res = await request(app).post("/simulator/ps-execution/cmdlet").set(authHeader).send({ cmdletKey: "get-connection-info", tenantId: "1" });
    expect(res.status).toBe(400);
    expect(res.body.kind).toBe("script_error");
  });
});
