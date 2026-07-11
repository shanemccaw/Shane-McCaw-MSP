/**
 * Tests for MSP Portal routes — dashboard data accuracy and offboarding state machine.
 *
 * Run: pnpm --filter @workspace/api-server vitest run msp-portal
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

// ── Module mocks ────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => {
  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    execute: vi.fn(),
  };
  return {
    db: mockDb,
    mspsTable: { id: "id", name: "name", slug: "slug", status: "status", offboardingState: "offboarding_state", offboardingRequestedAt: "offboarding_requested_at", exportReadyAt: "export_ready_at", updatedAt: "updated_at" },
    mspCustomersTable: { id: "id", mspId: "msp_id", status: "status", name: "name", domain: "domain", industry: "industry", tenantId: "tenant_id", ownerType: "owner_type", createdAt: "created_at" },
    mspEventStoreTable: { id: "id", mspId: "msp_id", customerId: "customer_id", eventType: "event_type", occurredAt: "occurred_at", source: "source", actor: "actor", meta: "meta", payload: "payload", ownerType: "owner_type" },
    mspAuditLogsTable: { id: "id" },
  };
});

vi.mock("../lib/logger.ts", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Helpers ─────────────────────────────────────────────────────────────────────

const JWT_SECRET = "test-secret";
process.env.JWT_SECRET = JWT_SECRET;

function makeToken(overrides: Record<string, unknown> = {}): string {
  return jwt.sign(
    { id: 1, email: "test@msp.com", role: "client", mspRole: "MSPAdmin", mspId: 42, ...overrides },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

function makePlatformAdminToken(): string {
  return jwt.sign(
    { id: 99, email: "admin@platform.com", role: "admin" },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

// ── Dashboard tests ──────────────────────────────────────────────────────────────

describe("GET /api/msp/dashboard", () => {
  it("returns 401 when no auth token provided", async () => {
    const { default: router } = await import("./msp-portal.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const res = await request(app).get("/api/msp/dashboard");
    expect(res.status).toBe(401);
  });

  it("returns 403 for CustomerUser role (below MSPOperator)", async () => {
    const { default: router } = await import("./msp-portal.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const token = makeToken({ mspRole: "CustomerUser" });
    const res = await request(app)
      .get("/api/msp/dashboard")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("returns dashboard data for MSPAdmin", async () => {
    const { db } = await import("@workspace/db");
    const mockDb = db as unknown as Record<string, unknown>;

    const selectMock = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          groupBy: vi.fn().mockResolvedValue([
            { status: "active", n: 3 },
            { status: "onboarding", n: 1 },
          ]),
          limit: vi.fn().mockResolvedValue([
            {
              id: 42, name: "Test MSP", status: "active",
              offboardingState: null, offboardingRequestedAt: null, exportReadyAt: null,
            },
          ]),
        }),
      }),
    });

    mockDb.select = selectMock;

    const executeMock = vi.fn().mockResolvedValue({ rows: [{ total_cents: 50000 }] });
    mockDb.execute = executeMock;

    const { default: router } = await import("./msp-portal.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const token = makeToken();
    const res = await request(app)
      .get("/api/msp/dashboard")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("customers");
    expect(res.body).toHaveProperty("signalsFiredThisMonth");
    expect(res.body).toHaveProperty("offerAcceptanceRate");
    expect(res.body).toHaveProperty("revenueUsdThisMonth");
  });
});

// ── Offboarding state machine tests ──────────────────────────────────────────────

describe("POST /api/msp/offboarding/request", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without auth", async () => {
    const { default: router } = await import("./msp-portal.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const res = await request(app).post("/api/msp/offboarding/request").send({});
    expect(res.status).toBe(401);
  });

  it("returns 403 for MSPOperator (below MSPAdmin)", async () => {
    const { default: router } = await import("./msp-portal.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const token = makeToken({ mspRole: "MSPOperator" });
    const res = await request(app)
      .post("/api/msp/offboarding/request")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it("transitions null → cancellation_requested", async () => {
    const { db } = await import("@workspace/db");
    const mockDb = db as unknown as Record<string, unknown>;

    mockDb.select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            { id: 42, offboardingState: null },
          ]),
        }),
      }),
    });
    mockDb.update = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
    mockDb.insert = vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });

    const { default: router } = await import("./msp-portal.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const token = makeToken();
    const res = await request(app)
      .post("/api/msp/offboarding/request")
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.offboardingState).toBe("cancellation_requested");
  });

  it("returns 409 when offboarding already in progress", async () => {
    const { db } = await import("@workspace/db");
    const mockDb = db as unknown as Record<string, unknown>;

    mockDb.select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            { id: 42, offboardingState: "export_ready" },
          ]),
        }),
      }),
    });

    const { default: router } = await import("./msp-portal.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const token = makeToken();
    const res = await request(app)
      .post("/api/msp/offboarding/request")
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.offboardingState).toBe("export_ready");
  });
});

describe("POST /api/msp/offboarding/archive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 for MSPAdmin (PlatformAdmin only)", async () => {
    const { default: router } = await import("./msp-portal.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const token = makeToken({ mspRole: "MSPAdmin" });
    const res = await request(app)
      .post("/api/msp/offboarding/archive")
      .set("Authorization", `Bearer ${token}`)
      .send({ mspId: 42 });
    expect(res.status).toBe(403);
  });

  it("transitions export_ready → archival_flagged for PlatformAdmin", async () => {
    const { db } = await import("@workspace/db");
    const mockDb = db as unknown as Record<string, unknown>;

    mockDb.select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            { id: 42, name: "Test MSP", offboardingState: "export_ready" },
          ]),
        }),
      }),
    });
    mockDb.update = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
    mockDb.insert = vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });

    const { default: router } = await import("./msp-portal.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const token = makePlatformAdminToken();
    const res = await request(app)
      .post("/api/msp/offboarding/archive")
      .set("Authorization", `Bearer ${token}`)
      .send({ mspId: 42 });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.offboardingState).toBe("archival_flagged");
  });

  it("rejects archive when state is not export_ready", async () => {
    const { db } = await import("@workspace/db");
    const mockDb = db as unknown as Record<string, unknown>;

    mockDb.select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            { id: 42, name: "Test MSP", offboardingState: "cancellation_requested" },
          ]),
        }),
      }),
    });

    const { default: router } = await import("./msp-portal.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const token = makePlatformAdminToken();
    const res = await request(app)
      .post("/api/msp/offboarding/archive")
      .set("Authorization", `Bearer ${token}`)
      .send({ mspId: 42 });

    expect(res.status).toBe(409);
  });
});
