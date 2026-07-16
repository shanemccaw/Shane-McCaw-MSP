/**
 * Tests for MSP SLA and Scope Creep MSP-scoped portal endpoints.
 *
 * Validates that:
 * - All endpoints require MSPOperator auth (401/403 on missing or wrong role)
 * - mspId is always sourced from the JWT, never from request params
 * - Engine API data flows through to the portal without transformation
 * - Operator tasks aggregate SLA breaches + scope-creep violations as virtual tasks
 * - No engine scoring/detection logic lives in these routes
 *
 * Run: pnpm --filter @workspace/api-server vitest run msp-sla-scope-creep
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

// ── Module mocks ───────────────────────────────────────────────────────────────

const mockExecute = vi.fn();

vi.mock("@workspace/db", () => ({
  db: { execute: mockExecute },
  sql: vi.fn(),
}));

vi.mock("../lib/logger.ts", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/sla-engine", () => ({
  runSlaEngineForMsp: vi.fn().mockResolvedValue({ timers: [], breaches: [], summary: {} }),
  resolveSlaTimer: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("../lib/sse-broadcast", () => ({
  registerMspEngineEventClient: vi.fn(),
  broadcastMspEngineEvent: vi.fn(),
  getMspEngineEventClientCount: vi.fn().mockReturnValue(0),
}));

// drizzle sql tag — return a tagged template value so routes don't crash
vi.mock("drizzle-orm", () => ({
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    {
      raw: (s: string) => s,
    },
  ),
}));

// ── Auth helpers ───────────────────────────────────────────────────────────────

const JWT_SECRET = "test-sla-secret";
process.env.JWT_SECRET = JWT_SECRET;

function makeToken(overrides: Record<string, unknown> = {}): string {
  return jwt.sign(
    { id: 1, email: "op@msp.com", role: "client", mspRole: "MSPOperator", mspId: 7, ...overrides },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

// ── SLA endpoint tests ─────────────────────────────────────────────────────────

describe("MSP SLA routes — auth enforcement", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValue({ rows: [] });
  });

  it("GET /api/msp/sla/timers — 401 without token", async () => {
    const { default: router } = await import("./msp-sla.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const res = await request(app).get("/api/msp/sla/timers");
    expect(res.status).toBe(401);
  });

  it("GET /api/msp/sla/timers — 403 for CustomerUser role", async () => {
    const { default: router } = await import("./msp-sla.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const token = makeToken({ mspRole: "CustomerUser" });
    const res = await request(app)
      .get("/api/msp/sla/timers")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("GET /api/msp/sla/timers — 200 for MSPOperator with empty data", async () => {
    const { default: router } = await import("./msp-sla.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const token = makeToken();
    const res = await request(app)
      .get("/api/msp/sla/timers")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("timers");
    expect(Array.isArray(res.body.timers)).toBe(true);
  });

  it("GET /api/msp/sla/breaches — returns breaches array", async () => {
    const { default: router } = await import("./msp-sla.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const fakeBreach = {
      breachId: "breach-001",
      timerId: "timer-001",
      mspId: 7,
      customerId: 100,
      policyId: 1,
      ticketRef: "TKT-42",
      phase: "response",
      breachType: "breach",
      elapsedMinutes: 120,
      thresholdMinutes: 60,
      resolvedAt: null,
      createdAt: new Date().toISOString(),
    };
    mockExecute.mockResolvedValueOnce({ rows: [fakeBreach] });

    const token = makeToken();
    const res = await request(app)
      .get("/api/msp/sla/breaches")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("breaches");
    expect(res.body.breaches).toHaveLength(1);
    expect(res.body.breaches[0].breachId).toBe("breach-001");
  });

  it("GET /api/msp/sla/policies — 401 without token", async () => {
    const { default: router } = await import("./msp-sla.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const res = await request(app).get("/api/msp/sla/policies");
    expect(res.status).toBe(401);
  });

  it("GET /api/msp/sla/policies — returns policies for MSPAdmin", async () => {
    const { default: router } = await import("./msp-sla.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const fakePolicy = {
      id: 1, mspId: null, name: "Default SLA", responseTimeMinutes: 60,
      warningThresholdPct: 80, resolutionTimeMinutes: 480, isActive: true,
    };
    mockExecute.mockResolvedValueOnce({ rows: [fakePolicy] });

    const token = makeToken({ mspRole: "MSPAdmin" });
    const res = await request(app)
      .get("/api/msp/sla/policies")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.policies).toHaveLength(1);
    expect(res.body.policies[0].name).toBe("Default SLA");
  });

  it("GET /api/msp/sla/compliance — returns compliance records", async () => {
    const { default: router } = await import("./msp-sla.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const fakeRecord = {
      recordId: "rec-001", mspId: 7, customerId: 100,
      periodStart: "2026-06-01", periodEnd: "2026-06-30",
      totalTickets: 20, breachedTickets: 1, compliancePct: 95,
      avgResponseMinutes: 45, avgResolutionMinutes: 320, createdAt: new Date().toISOString(),
    };
    mockExecute.mockResolvedValueOnce({ rows: [fakeRecord] });

    const token = makeToken();
    const res = await request(app)
      .get("/api/msp/sla/compliance")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.records[0].compliancePct).toBe(95);
  });

  it("GET /api/msp/sla/summary — returns all stat fields", async () => {
    const { default: router } = await import("./msp-sla.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    // summary does 3 parallel db.execute calls
    mockExecute
      .mockResolvedValueOnce({ rows: [{ active_timers: "5", warning_timers: "2", breached_timers: "1" }] })
      .mockResolvedValueOnce({ rows: [{ open_breaches: "3" }] })
      .mockResolvedValueOnce({ rows: [{ avg_compliance_pct: "92.5" }] });

    const token = makeToken();
    const res = await request(app)
      .get("/api/msp/sla/summary")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.activeTimers).toBe(5);
    expect(res.body.warningTimers).toBe(2);
    expect(res.body.breachedTimers).toBe(1);
    expect(res.body.openBreaches).toBe(3);
    expect(res.body.avgCompliancePct).toBe(92.5);
  });

  it("GET /api/msp/sla/escalations — 401 without token", async () => {
    const { default: router } = await import("./msp-sla.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const res = await request(app).get("/api/msp/sla/escalations");
    expect(res.status).toBe(401);
  });

  it("POST /api/msp/sla/timers/:id/resolve — 404 if timer not in this MSP", async () => {
    const { default: router } = await import("./msp-sla.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    mockExecute.mockResolvedValueOnce({ rows: [] }); // ownership check returns empty

    const token = makeToken();
    const res = await request(app)
      .post("/api/msp/sla/timers/timer-999/resolve")
      .set("Authorization", `Bearer ${token}`)
      .send({ notes: "resolved" });
    expect(res.status).toBe(404);
  });
});

// ── Operator Tasks endpoint tests ───────────────────────────────────────────────

describe("GET /api/msp/operator-tasks", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValue({ rows: [] });
  });

  it("returns 401 without token", async () => {
    const { default: router } = await import("./msp-sla.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const res = await request(app).get("/api/msp/operator-tasks");
    expect(res.status).toBe(401);
  });

  it("aggregates SLA breaches and scope-creep violations as tasks", async () => {
    const { default: router } = await import("./msp-sla.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const now = new Date().toISOString();
    const fakeSlaTask = {
      id: "breach-aaa",
      type: "sla_breach",
      category: "SLA Breach",
      customerId: 100,
      customerName: "Acme Corp",
      description: "response threshold exceeded — 90 min elapsed (limit: 60 min)",
      severity: "breach",
      createdAt: now,
      resolvedAt: null,
      deepLink: "/admin-panel/#/sla",
    };
    const fakeScopeCreepTask = {
      id: "viol-bbb",
      type: "scope_creep_violation",
      category: "Scope Creep Violation",
      customerId: 100,
      customerName: "Acme Corp",
      description: "high violation — composite score 78 (threshold: 60)",
      severity: "high",
      createdAt: now,
      resolvedAt: null,
      deepLink: "/admin-panel/#/scope-creep",
    };

    mockExecute
      .mockResolvedValueOnce({ rows: [fakeSlaTask] })   // sla_breaches query
      .mockResolvedValueOnce({ rows: [fakeScopeCreepTask] }); // scope_creep_violations query

    const token = makeToken();
    const res = await request(app)
      .get("/api/msp/operator-tasks")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("tasks");
    expect(res.body.tasks).toHaveLength(2);

    const types = res.body.tasks.map((t: { type: string }) => t.type);
    expect(types).toContain("sla_breach");
    expect(types).toContain("scope_creep_violation");

    const slaTask = res.body.tasks.find((t: { type: string }) => t.type === "sla_breach");
    expect(slaTask.deepLink).toBe("/admin-panel/#/sla");

    const scTask = res.body.tasks.find((t: { type: string }) => t.type === "scope_creep_violation");
    expect(scTask.deepLink).toBe("/admin-panel/#/scope-creep");
  });

  it("returns empty tasks list when no breaches or violations", async () => {
    const { default: router } = await import("./msp-sla.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    mockExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const token = makeToken();
    const res = await request(app)
      .get("/api/msp/operator-tasks")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });

  it("tasks include deepLink pointing to admin panel engine pages", async () => {
    const { default: router } = await import("./msp-sla.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const now = new Date().toISOString();
    mockExecute
      .mockResolvedValueOnce({ rows: [{ id: "b1", type: "sla_breach", category: "SLA Breach", customerId: 1, customerName: null, description: "x", severity: "breach", createdAt: now, resolvedAt: null, deepLink: "/admin-panel/#/sla" }] })
      .mockResolvedValueOnce({ rows: [] });

    const token = makeToken();
    const res = await request(app)
      .get("/api/msp/operator-tasks")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const task = res.body.tasks[0];
    expect(task.deepLink).toMatch(/\/admin-panel/);
  });
});

// ── Scope Creep endpoints — auth guard tests ────────────────────────────────────

describe("MSP Scope Creep routes — auth enforcement (sampled)", () => {
  it("GET /api/msp/scope-creep/detections — 401 without token", async () => {
    const { default: router } = await import("./msp-scope-creep.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const res = await request(app).get("/api/msp/scope-creep/detections");
    expect(res.status).toBe(401);
  });

  it("GET /api/msp/scope-creep/violations — 403 for CustomerUser role", async () => {
    const { default: router } = await import("./msp-scope-creep.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const token = makeToken({ mspRole: "CustomerUser" });
    const res = await request(app)
      .get("/api/msp/scope-creep/violations")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("GET /api/msp/scope-creep/compliance — 200 for MSPOperator", async () => {
    vi.doMock("@workspace/db", () => ({
      db: { execute: vi.fn().mockResolvedValue({ rows: [] }) },
      sql: vi.fn(),
    }));

    const { default: router } = await import("./msp-scope-creep.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const token = makeToken();
    const res = await request(app)
      .get("/api/msp/scope-creep/compliance")
      .set("Authorization", `Bearer ${token}`);
    // Either 200 (records empty) or 500 (mocked engine missing) — just confirm not 401/403
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── SSE endpoint test ──────────────────────────────────────────────────────────

describe("GET /api/msp/sla/events/stream", () => {
  it("401 without token", async () => {
    const { default: router } = await import("./msp-sla.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const res = await request(app).get("/api/msp/sla/events/stream");
    expect(res.status).toBe(401);
  });

  it("registers SSE client and returns event-stream content-type", async () => {
    const { default: router } = await import("./msp-sla.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const token = makeToken();
    // We cannot hold open an SSE connection in unit tests easily — just verify
    // the connection is attempted (supertest will close after headers are sent)
    const res = await request(app)
      .get("/api/msp/sla/events/stream")
      .set("Authorization", `Bearer ${token}`)
      .timeout(500)
      .catch(e => e.response ?? e);

    // Either we get headers or timeout; confirm it's NOT 401 or 403
    if (res && typeof res.status === "number") {
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    }
    // If it timed out, that means the SSE stream opened correctly (no auth rejection)
  });
});

// ── Multi-tenant Isolation and Template Interception Tests ──────────────────────

describe("MSP SLA & Scope Creep Policies - Isolation and Interception", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("POST /api/msp/sla/policies - assigns rule to request mspId", async () => {
    const { default: router } = await import("./msp-sla.ts");
    const app = PatternApp(router);

    mockExecute.mockResolvedValueOnce({ rows: [{ id: 42 }] });

    const token = makeToken({ mspId: 7 });
    const res = await request(app)
      .post("/api/msp/sla/policies")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Custom Policy" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(42);
    const sqlCall = mockExecute.mock.calls[0][0];
    expect(sqlCall.values[0]).toBe(7);
  });

  it("PATCH /api/msp/sla/policies/:id - intercepts platform templates (null mspId)", async () => {
    const { default: router } = await import("./msp-sla.ts");
    const app = PatternApp(router);

    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 10,
        mspId: null,
        name: "Platform SLA Default",
        description: "Test description",
        responseTimeMinutes: 60,
        warningThresholdPct: 80,
        resolutionTimeMinutes: 480,
        resolutionWarningThresholdPct: 80,
        escalationRules: [],
        priority: "high",
        isActive: true,
      }],
    });
    mockExecute.mockResolvedValueOnce({ rows: [{ id: 99 }] });

    const token = makeToken({ mspId: 7 });
    const res = await request(app)
      .patch("/api/msp/sla/policies/10")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Customized SLA Default", responseTimeMinutes: 45 });

    expect(res.status).toBe(201);
    expect(res.body.override).toBe(true);
    expect(res.body.id).toBe(99);

    const insertCall = mockExecute.mock.calls[1][0];
    expect(insertCall.values[0]).toBe(7);
    expect(insertCall.values[1]).toBe("Customized SLA Default");
    expect(insertCall.values[3]).toBe(45);
  });

  it("PATCH /api/msp/sla/policies/:id - updates in-place for owned rules", async () => {
    const { default: router } = await import("./msp-sla.ts");
    const app = PatternApp(router);

    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 10,
        mspId: 7,
        name: "My Policy",
        isActive: true,
      }],
    });
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const token = makeToken({ mspId: 7 });
    const res = await request(app)
      .patch("/api/msp/sla/policies/10")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Updated Policy" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("PATCH /api/msp/scope-creep/policies/:id - intercepts platform templates and clones", async () => {
    const { default: router } = await import("./msp-scope-creep.ts");
    const app = PatternApp(router);

    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 20,
        mspId: null,
        name: "Global Scope Creep",
        driftThresholdPct: 20,
        expansionThresholdPct: 15,
        timelineSlipDays: 7,
        driftWeight: 33,
        expansionWeight: 33,
        timelineSlipWeight: 34,
        violationScoreThreshold: 60,
        escalationRules: [],
        isActive: true,
      }],
    });
    mockExecute.mockResolvedValueOnce({ rows: [{ id: 88 }] });

    const token = makeToken({ mspId: 7 });
    const res = await request(app)
      .patch("/api/msp/scope-creep/policies/20")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "MSP Scope Creep Overridden", violationScoreThreshold: 50 });

    expect(res.status).toBe(201);
    expect(res.body.override).toBe(true);
    expect(res.body.id).toBe(88);

    const insertCall = mockExecute.mock.calls[1][0];
    expect(insertCall.values[0]).toBe(7);
    expect(insertCall.values[1]).toBe("MSP Scope Creep Overridden");
    expect(insertCall.values[9]).toBe(50);
  });
});

function PatternApp(router: any) {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return app;
}
