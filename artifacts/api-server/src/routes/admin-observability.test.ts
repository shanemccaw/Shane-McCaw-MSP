import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

// ── pool mock (vi.hoisted avoids the "before initialization" hoisting trap) ──
const mockPoolQuery = vi.hoisted(() => vi.fn());
vi.mock("@workspace/db", () => ({
  pool: { query: mockPoolQuery },
  db: {},
}));

// ── auth mock ────────────────────────────────────────────────────────────────
vi.mock("../middlewares/requireAuth", () => ({
  requireAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
  requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
}));

// ── alert-engine mock ────────────────────────────────────────────────────────
vi.mock("../lib/alert-engine", () => ({
  evaluateAllRules: vi.fn().mockResolvedValue(undefined),
  ensureAlertEngineReady: vi.fn(),
}));

import adminObservabilityRouter from "./admin-observability";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(adminObservabilityRouter);
  return app;
}

// ── helpers ──────────────────────────────────────────────────────────────────
function stubQuery(rows: unknown[]) {
  mockPoolQuery.mockResolvedValueOnce({ rows });
}

// Provide a default "fallthrough" for any extra pool.query calls (avoids
// "mockResolvedValueOnce called with no more values" errors).
function stubMany(...rowsets: unknown[][]) {
  for (const rows of rowsets) {
    mockPoolQuery.mockResolvedValueOnce({ rows });
  }
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("GET /api/admin/observability/service-health", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it("returns correct shape with zeros when tables are empty", async () => {
    // The route fires 4 queries: job-queue, DLQ, webhooks, portal-workflows
    stubMany(
      // job queue aggregates
      [{ status: "completed", n: "3" }, { status: "failed", n: "0" }],
      // dlq
      [{ unresolved: "0", resolved_last7d: "0" }],
      // webhooks
      [],
      // portal workflows
      [],
      // db size
      [{ size: "1 GB", bytes: "1073741824" }],
      // db conn
      [{ saturation: 0.1, active: "10", max: "100" }],
    );

    const res = await request(app).get("/admin/observability/service-health");
    expect(res.status).toBe(200);

    const body = res.body as {
      jobQueue: Record<string, number>;
      dlq: Record<string, number>;
      webhooks: Record<string, number>;
      portalWorkflows: Record<string, number>;
    };
    expect(body).toHaveProperty("jobQueue");
    expect(body).toHaveProperty("dlq");
    expect(body).toHaveProperty("webhooks");
    expect(body).toHaveProperty("portalWorkflows");
    expect(body.dlq.unresolved).toBe(0);
    expect(typeof body.jobQueue.completed).toBe("number");
  });
});

describe("GET /api/admin/observability/event-bus", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it("returns totalEvents and byType array", async () => {
    // Route fires 3 queries: total count, byType, hourly time series
    stubMany(
      [{ n: "5" }],
      [{ event_type: "msp.customer.created", n: "5" }],
      [],
    );

    const res = await request(app).get("/admin/observability/event-bus?hours=24");
    expect(res.status).toBe(200);

    const body = res.body as { totalEvents: number; byType: Array<{ eventType: string; count: number }> };
    expect(body.byType).toBeInstanceOf(Array);
    expect(typeof body.totalEvents).toBe("number");
  });
});

describe("GET /api/admin/observability/platform-revenue", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it("returns MRR, churn count, subscriptionsByStatus, mspsByStatus, and perMsp", async () => {
    // The route uses Promise.all([subStats, mspCount, churned30d, mspRevenue])
    stubMany(
      // 1) subStats: status, n, total_cents
      [{ status: "active", n: "3", total_cents: "30000" }],
      // 2) mspCount: status, n
      [{ status: "active", n: "3" }],
      // 3) churned30d: n
      [{ n: "1" }],
      // 4) per-MSP list
      [{ msp_name: "Acme IT", plan_name: "Pro", status: "active", price_cents: "9900" }],
      // 5) daily AI spend
      [{ day: "2026-07-01", cost_cents: "5000" }],
      // 6) monthly AI spend
      [{ month: "2026-07-01", cost_cents: "15000" }],
    );

    const res = await request(app).get("/admin/observability/platform-revenue");
    expect(res.status).toBe(200);

    const body = res.body as {
      mrrCents: number;
      churned30d: number;
      subscriptionsByStatus: unknown[];
      mspsByStatus: Record<string, number>;
      perMsp: Array<{ mspName: string }>;
    };
    expect(body.mrrCents).toBe(30000);
    expect(body.churned30d).toBe(1);
    expect(body.subscriptionsByStatus).toHaveLength(1);
    expect(body.mspsByStatus).toHaveProperty("active");
    expect(body.perMsp[0]?.mspName).toBe("Acme IT");
  });
});

describe("GET /api/admin/observability/alert-rules", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it("returns rules array from DB", async () => {
    stubQuery([
      {
        id: 1,
        rule_key: "dlq_backlog_high",
        label: "High DLQ Backlog",
        description: "Test",
        condition_type: "dlq_backlog",
        threshold: 10,
        window_minutes: 60,
        severity: "warning",
        enabled: true,
        delivery_email: true,
        delivery_push: true,
        cooldown_minutes: 60,
        deep_link_path: "/system/observability",
        updated_at: new Date().toISOString(),
      },
    ]);

    const res = await request(app).get("/admin/observability/alert-rules");
    expect(res.status).toBe(200);

    // Route now normalises to camelCase
    const body = res.body as { rules: Array<{ ruleKey: string; enabled: boolean; conditionType: string }> };
    expect(body.rules).toHaveLength(1);
    expect(body.rules[0]?.ruleKey).toBe("dlq_backlog_high");
    expect(body.rules[0]?.enabled).toBe(true);
    expect(body.rules[0]?.conditionType).toBe("dlq_backlog");
  });
});

describe("PATCH /api/admin/observability/alert-rules/:id", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it("toggles a rule and returns ok:true", async () => {
    // PATCH returns { ok: true } after UPDATE ... RETURNING id
    stubQuery([{ id: 1 }]);

    const res = await request(app)
      .patch("/admin/observability/alert-rules/1")
      .send({ enabled: false });
    expect(res.status).toBe(200);

    expect((res.body as { ok: boolean }).ok).toBe(true);
  });
});

describe("GET /api/admin/observability/alert-events", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it("returns events array", async () => {
    stubQuery([
      {
        id: 1,
        alert_event_id: "evt-123",
        rule_key: "dlq_backlog_high",
        rule_label: "High DLQ Backlog",
        condition_type: "dlq_backlog",
        severity: "warning",
        condition_value: 15,
        summary: "DLQ has 15 unresolved messages",
        deep_link_path: null,
        delivered_email: false,
        delivered_push: false,
        resolved_at: null,
        fired_at: new Date().toISOString(),
      },
    ]);

    const res = await request(app).get("/admin/observability/alert-events?limit=10");
    expect(res.status).toBe(200);

    // Route now normalises to camelCase
    const body = res.body as { events: Array<{ ruleKey: string; severity: string; deliveredEmail: boolean; firedAt: string }> };
    expect(body.events).toHaveLength(1);
    expect(body.events[0]?.severity).toBe("warning");
    expect(body.events[0]?.ruleKey).toBe("dlq_backlog_high");
    expect(typeof body.events[0]?.firedAt).toBe("string");
  });
});

describe("PATCH /api/admin/observability/alert-events/:id/resolve", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it("returns ok:true after resolving an event", async () => {
    stubQuery([{ id: 1 }]);

    const res = await request(app).patch("/admin/observability/alert-events/1/resolve");
    expect(res.status).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);
  });
});

describe("POST /api/admin/observability/alert-rules/:id/test", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it("returns emailOk and pushOk booleans", async () => {
    // Fetch rule
    stubQuery([
      {
        id: 1,
        rule_key: "dlq_backlog_high",
        label: "High DLQ Backlog",
        description: null,
        condition_type: "dlq_backlog",
        threshold: 10,
        window_minutes: 60,
        severity: "warning",
        enabled: true,
        delivery_email: true,
        delivery_push: true,
        cooldown_minutes: 60,
        deep_link_path: null,
        updated_at: new Date().toISOString(),
      },
    ]);
    // Insert event
    stubQuery([{ id: 99 }]);

    const res = await request(app).post("/admin/observability/alert-rules/1/test");
    expect(res.status).toBe(200);

    const body = res.body as { ok: boolean; emailOk: boolean; pushOk: boolean };
    expect(body.ok).toBe(true);
    expect(typeof body.emailOk).toBe("boolean");
    expect(typeof body.pushOk).toBe("boolean");
  });
});
