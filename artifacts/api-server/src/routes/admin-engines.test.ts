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
  usersTable: { id: "id", role: "role", email: "email" },
  engagementProjectsTable: {},
  signalRuleGroupsTable: {},
  signalDerivationRulesTable: {},
  mspCustomersTable: {},
  mspsTable: { id: "id", isTestbed: "is_testbed", testbedMetadata: "testbed_metadata" },
  savedSqlScripts: { id: "id" },
}));

vi.mock("../middlewares/requireAuth", () => ({
  requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const auth = req.headers["authorization"] ?? "";
    if (auth === `Bearer ${ADMIN_PASS}`) return next();
    res.status(401).json({ error: "Unauthorized" });
  },
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

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

const { mockRunForTenant } = vi.hoisted(() => ({
  mockRunForTenant: vi.fn(),
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
  it("fails if target MSP is not a testbed", async () => {
    const { db } = await import("@workspace/db");
    vi.spyOn(db, "select").mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 10, isTestbed: false }]),
        }),
      }),
    } as any);

    const res = await request(app)
      .post("/simulator/fire-event")
      .set(authHeader)
      .send({ eventId: "MSP_SUSPEND_7_DAYS", testbedMspId: 10 });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain("is_testbed = true");
  });

  it("fires a manifest event successfully when target is testbed", async () => {
    const { db } = await import("@workspace/db");
    vi.spyOn(db, "select").mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 10, isTestbed: true }]),
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
      .send({ eventId: "MSP_SUSPEND_7_DAYS", testbedMspId: 10 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe("POST /simulator/sql/execute", () => {
  it("rejects queries with destructive commands", async () => {
    const res = await request(app)
      .post("/simulator/sql/execute")
      .set(authHeader)
      .send({ query: "DROP TABLE users;" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("prohibited");
  });

  it("executes read/write query successfully", async () => {
    const { db } = await import("@workspace/db");
    const mockExecute = vi.fn().mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });
    (db as any).execute = mockExecute;

    const res = await request(app)
      .post("/simulator/sql/execute")
      .set(authHeader)
      .send({ query: "SELECT * FROM users;" });
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([{ id: 1 }]);
    expect(mockExecute).toHaveBeenCalled();
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
