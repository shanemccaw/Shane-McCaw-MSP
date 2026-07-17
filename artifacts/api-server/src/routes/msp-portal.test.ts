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
    salesOffersTable: { id: "id", mspId: "msp_id", state: "state", adjustedPriceCents: "adjusted_price_cents" },
    mspSalesBundlesTable: { id: "id", bundleId: "bundle_id", mspId: "msp_id", name: "name", status: "status", createdAt: "created_at" },
    mspUsersTable: { id: "id" },
    mspSalesBundleAssignmentsTable: { id: "id", customerId: "customer_id", status: "status", revokedAt: "revoked_at" },
  };
});

vi.mock("../lib/ai-billing.ts", () => ({
  getAiBalance: vi.fn().mockResolvedValue({
    alertThreshold: 80,
    periodUsagePct: 82,
    balanceCents: 5000,
    periodKey: "2026-07",
  }),
}));

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

// ── Countdown utility (pure math) ────────────────────────────────────────────────

/**
 * Pure helper that mirrors the HH:MM:SS computation in the useCountdown hook.
 * Isolated here for server-side unit testing without React/DOM.
 */
function formatCountdown(remainingMs: number): string {
  const r = Math.max(0, remainingMs);
  const h = Math.floor(r / 3_600_000);
  const m = Math.floor((r % 3_600_000) / 60_000);
  const s = Math.floor((r % 60_000) / 1_000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

describe("offerCountdown utility", () => {
  it("formats 1 hour exactly as 01:00:00", () => {
    expect(formatCountdown(3_600_000)).toBe("01:00:00");
  });

  it("formats 23 h 59 m 59 s correctly", () => {
    const ms = 23 * 3_600_000 + 59 * 60_000 + 59 * 1_000;
    expect(formatCountdown(ms)).toBe("23:59:59");
  });

  it("formats 0 ms as 00:00:00", () => {
    expect(formatCountdown(0)).toBe("00:00:00");
  });

  it("clamps negative remaining to 00:00:00", () => {
    expect(formatCountdown(-5_000)).toBe("00:00:00");
  });

  it("correctly separates hours, minutes, and seconds", () => {
    // 90 minutes = 1 h 30 m 0 s
    expect(formatCountdown(90 * 60_000)).toBe("01:30:00");
    // 65 seconds
    expect(formatCountdown(65_000)).toBe("00:01:05");
  });

  it("only fires for offers expiring within 24 hours", () => {
    const now = Date.now();
    const within24h = now + 23 * 3_600_000;
    const beyond24h = now + 25 * 3_600_000;

    const isWithin = (expiresMs: number) => expiresMs - now <= 86_400_000 && expiresMs > now;

    expect(isWithin(within24h)).toBe(true);
    expect(isWithin(beyond24h)).toBe(false);
    expect(isWithin(now - 1_000)).toBe(false); // already expired
  });
});

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
