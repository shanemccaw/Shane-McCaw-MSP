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
  },
  usersTable: {},
  engagementProjectsTable: {},
  signalRuleGroupsTable: {},
  signalDerivationRulesTable: {},
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
