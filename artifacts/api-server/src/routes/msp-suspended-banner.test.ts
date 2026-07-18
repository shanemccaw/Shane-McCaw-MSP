/**
 * Acceptance tests for GAP-16: Day 7 MSP-suspended customer banner.
 *
 * Tests the GET /api/portal/msp-suspension endpoint which powers the
 * informational banner shown to customers whose MSP has been suspended ≥ 7 days.
 *
 * Run: pnpm --filter @workspace/api-server vitest run msp-suspended-banner
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

// ── Module mocks ───────────────────────────────────────────────────────────────

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
};

vi.mock("@workspace/db", () => ({
  db: mockDb,
  mspsTable: {
    id: "id",
    status: "status",
    suspendedAt: "suspended_at",
  },
  mspUsersTable: {
    userId: "user_id",
    mspId: "msp_id",
  },
  mspCustomersTable: { id: "id", mspId: "msp_id" },
  mspEventStoreTable: { id: "id" },
  mspAuditLogsTable: { id: "id" },
  salesOffersTable: { id: "id" },
  mspSalesBundlesTable: { id: "id" },
}));

vi.mock("../lib/ai-billing.ts", () => ({
  getAiBalance: vi.fn().mockResolvedValue({ alertThreshold: 80, periodUsagePct: 10, balanceCents: 5000, periodKey: "2026-07" }),
}));

vi.mock("../lib/logger.ts", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../lib/resolve-msp-id.ts", () => ({
  resolveMspId: vi.fn().mockResolvedValue(1),
  resolveMspIdOrZero: vi.fn().mockResolvedValue(1),
  resolveMspIdStrict: vi.fn().mockReturnValue(1),
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

const JWT_SECRET = "test-secret";
process.env.JWT_SECRET = JWT_SECRET;

function makeCustomerToken(overrides: Record<string, unknown> = {}): string {
  return jwt.sign(
    { id: 10, email: "customer@acme.com", role: "client", mspRole: "CustomerUser", mspId: 5, customerId: 99, ...overrides },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

function makeMspAdminToken(): string {
  return jwt.sign(
    { id: 20, email: "admin@msp.com", role: "client", mspRole: "MSPAdmin", mspId: 5 },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

// Days ago → ISO date string
function daysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return d.toISOString();
}

// ── App setup ─────────────────────────────────────────────────────────────────

async function buildApp() {
  const app = express();
  app.use(express.json());
  const { default: mspPortalRouter } = await import("./msp-portal.ts");
  app.use("/api", mspPortalRouter);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/portal/msp-suspension", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it("returns suspended=true with daysSuspended≥7 when MSP was suspended 8 days ago", async () => {
    // First call: mspUsersTable lookup skipped (mspId on token)
    // Only call: mspsTable lookup
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([
      { status: "suspended", suspendedAt: daysAgo(8) },
    ]);

    const res = await request(app)
      .get("/api/portal/msp-suspension")
      .set("Authorization", `Bearer ${makeCustomerToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.suspended).toBe(true);
    expect(res.body.daysSuspended).toBeGreaterThanOrEqual(7);
  });

  it("returns suspended=true with daysSuspended=7 exactly on day 7", async () => {
    mockDb.limit.mockResolvedValueOnce([
      { status: "suspended", suspendedAt: daysAgo(7) },
    ]);

    const res = await request(app)
      .get("/api/portal/msp-suspension")
      .set("Authorization", `Bearer ${makeCustomerToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.suspended).toBe(true);
    expect(res.body.daysSuspended).toBeGreaterThanOrEqual(7);
  });

  it("returns suspended=false when MSP was suspended only 6 days ago (no banner)", async () => {
    mockDb.limit.mockResolvedValueOnce([
      { status: "suspended", suspendedAt: daysAgo(6) },
    ]);

    const res = await request(app)
      .get("/api/portal/msp-suspension")
      .set("Authorization", `Bearer ${makeCustomerToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.suspended).toBe(false);
    expect(res.body.daysSuspended).toBe(null);
  });

  it("returns suspended=false when MSP status is active", async () => {
    mockDb.limit.mockResolvedValueOnce([
      { status: "active", suspendedAt: null },
    ]);

    const res = await request(app)
      .get("/api/portal/msp-suspension")
      .set("Authorization", `Bearer ${makeCustomerToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.suspended).toBe(false);
    expect(res.body.daysSuspended).toBe(null);
  });

  it("returns suspended=false when MSP is suspended but suspendedAt is null", async () => {
    mockDb.limit.mockResolvedValueOnce([
      { status: "suspended", suspendedAt: null },
    ]);

    const res = await request(app)
      .get("/api/portal/msp-suspension")
      .set("Authorization", `Bearer ${makeCustomerToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.suspended).toBe(false);
  });

  it("returns suspended=false when no MSP row is found", async () => {
    mockDb.limit.mockResolvedValueOnce([]);

    const res = await request(app)
      .get("/api/portal/msp-suspension")
      .set("Authorization", `Bearer ${makeCustomerToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.suspended).toBe(false);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/portal/msp-suspension");
    expect(res.status).toBe(401);
  });

  it("also allows MSPAdmin to call the endpoint (role ≥ CustomerUser)", async () => {
    mockDb.limit.mockResolvedValueOnce([
      { status: "active", suspendedAt: null },
    ]);

    const res = await request(app)
      .get("/api/portal/msp-suspension")
      .set("Authorization", `Bearer ${makeMspAdminToken()}`);

    expect(res.status).toBe(200);
  });

  it("banner remains visible after access_revoked escalation (suspendedAt not reset)", async () => {
    // Day 10: MSP was first suspended 10 days ago, then access_revoked today.
    // suspendedAt should NOT be reset to now — clock must keep running from day 1.
    // The endpoint sees suspendedAt = 10 days ago → daysSuspended=10 → banner on.
    mockDb.limit.mockResolvedValueOnce([
      { status: "suspended", suspendedAt: daysAgo(10) },
    ]);

    const res = await request(app)
      .get("/api/portal/msp-suspension")
      .set("Authorization", `Bearer ${makeCustomerToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.suspended).toBe(true);
    expect(res.body.daysSuspended).toBeGreaterThanOrEqual(7);
  });

  it("resolves mspId via DB lookup when it is absent from JWT claims", async () => {
    // Token has no mspId
    const tokenWithoutMspId = makeCustomerToken({ mspId: undefined });

    // First limit() call: mspUsersTable lookup returning mspId=5
    mockDb.limit
      .mockResolvedValueOnce([{ mspId: 5 }])
      // Second limit() call: mspsTable lookup returning suspended 10 days ago
      .mockResolvedValueOnce([{ status: "suspended", suspendedAt: daysAgo(10) }]);

    const res = await request(app)
      .get("/api/portal/msp-suspension")
      .set("Authorization", `Bearer ${tokenWithoutMspId}`);

    expect(res.status).toBe(200);
    expect(res.body.suspended).toBe(true);
    expect(res.body.daysSuspended).toBeGreaterThanOrEqual(7);
  });
});
