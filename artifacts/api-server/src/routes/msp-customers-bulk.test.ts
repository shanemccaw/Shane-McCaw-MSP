/**
 * msp-customers-bulk.test.ts
 *
 * Tests for POST /api/msp/customers/bulk covering:
 *   1. assign_bundle — N customers produce N individual assignment DB rows + N*packageCount events
 *   2. Idempotency — duplicate submissions for the same customer are deduplicated (skipped)
 *   3. Input validation — missing / invalid body fields are rejected
 *   4. tag — tags are merged into each customer row
 *   5. archive — each customer status is updated to "archived"
 *
 * Run: pnpm --filter @workspace/api-server vitest run msp-customers-bulk
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

// ── DB mock ───────────────────────────────────────────────────────────────────

const mockDbInsert = vi.fn();
const mockDbSelect = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbExecute = vi.fn();

const mockDb = {
  insert: mockDbInsert,
  select: mockDbSelect,
  update: mockDbUpdate,
  execute: mockDbExecute,
};

vi.mock("@workspace/db", () => ({
  db: mockDb,
  mspsTable: { id: "id", slug: "slug" },
  mspCustomersTable: {
    id: "id",
    mspId: "msp_id",
    name: "name",
    domain: "domain",
    status: "status",
    industry: "industry",
    tenantId: "tenant_id",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  mspEventStoreTable: { mspId: "msp_id", customerId: "customer_id", eventType: "event_type" },
  mspAuditLogsTable: { id: "id" },
  salesOffersTable: { id: "id", mspId: "msp_id", state: "state" },
  mspSalesBundlesTable: {
    bundleId: "bundle_id",
    mspId: "msp_id",
    name: "name",
    status: "status",
    monitoringPackageKeys: "monitoring_package_keys",
    trialDays: "trial_days",
  },
  mspSalesBundleAssignmentsTable: {
    bundleId: "bundle_id",
    mspId: "msp_id",
    customerId: "customer_id",
    assignmentId: "assignment_id",
    status: "status",
    assignedByUserId: "assigned_by_user_id",
  },
}));

// ── Middleware mocks ───────────────────────────────────────────────────────────

vi.mock("../middlewares/requireAuth.ts", () => ({
  requireAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireRole: (_role: string) => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../lib/logger.ts", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../lib/ai-billing.ts", () => ({
  getAiBalance: vi.fn().mockResolvedValue({ alertThreshold: 80, periodUsagePct: 10, balanceCents: 5000, periodKey: "2026-07" }),
}));

// ── Idempotency mock ───────────────────────────────────────────────────────────

const mockCheckIdempotency = vi.fn();
const mockRecordIdempotency = vi.fn();
const mockHashBody = vi.fn((x: unknown) => JSON.stringify(x));

vi.mock("../lib/idempotency.ts", () => ({
  checkIdempotency: (key: string, mspId: number | null, hash: string) =>
    mockCheckIdempotency(key, mspId, hash),
  recordIdempotency: (key: string, mspId: number | null, hash: string, status: number, body: Record<string, unknown>, ttl?: number) =>
    mockRecordIdempotency(key, mspId, hash, status, body, ttl),
  hashBody: (x: unknown) => mockHashBody(x),
}));

vi.mock("../lib/resolve-msp-id.ts", () => ({
  resolveMspId: vi.fn().mockResolvedValue(42),
  resolveMspIdOrZero: vi.fn().mockResolvedValue(42),
}));

// ── App setup ─────────────────────────────────────────────────────────────────

const JWT_SECRET = "test-secret";
process.env.JWT_SECRET = JWT_SECRET;

function makeToken(overrides: Record<string, unknown> = {}): string {
  return jwt.sign(
    { id: 1, email: "admin@msp.com", role: "client", mspRole: "MSPAdmin", mspId: 42, ...overrides },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

function makeApp() {
  const app = express();
  app.use(express.json());

  // Inject user from JWT (simplified)
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      try {
        req.user = jwt.verify(auth.slice(7), JWT_SECRET) as typeof req.user;
      } catch {
        // ignore
      }
    }
    next();
  });

  // Import and mount the router
  return import("./msp-portal.ts").then(({ default: router }) => {
    app.use("/api", router);
    return app;
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockSelectChain(rows: unknown[]) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
  };
  // The chain resolves to rows when awaited (make it a thenable)
  const promise = Promise.resolve(rows);
  Object.assign(chain, {
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  });
  (mockDbSelect as Mock).mockReturnValueOnce(chain);
  return chain;
}

function mockInsertChain(returning: unknown[]) {
  const chain = {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(returning),
    onConflictDoNothing: vi.fn().mockResolvedValue(returning),
  };
  (mockDbInsert as Mock).mockReturnValueOnce(chain);
  return chain;
}

function mockUpdateChain() {
  const chain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  };
  (mockDbUpdate as Mock).mockReturnValueOnce(chain);
  return chain;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/msp/customers/bulk", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockCheckIdempotency.mockResolvedValue(null);
    mockRecordIdempotency.mockResolvedValue(undefined);
    app = await makeApp();
  });

  // ── Input validation ────────────────────────────────────────────────────────

  it("returns 400 when customerIds is absent", async () => {
    const res = await request(app)
      .post("/api/msp/customers/bulk")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ action: "archive", payload: {} });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/customerIds/i);
  });

  it("returns 400 when customerIds is an empty array", async () => {
    const res = await request(app)
      .post("/api/msp/customers/bulk")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ customerIds: [], action: "archive", payload: {} });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-empty/i);
  });

  it("returns 400 for assign_bundle when bundleId is missing", async () => {
    // Owned-customers ownership check passes
    mockSelectChain([{ id: 1, tenantId: null, name: "Acme", domain: "acme.com", status: "active", industry: null, createdAt: new Date() }]);

    const res = await request(app)
      .post("/api/msp/customers/bulk")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ customerIds: [1], action: "assign_bundle", payload: {} });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/bundleId/i);
  });

  it("returns 400 for tag when tags array is empty", async () => {
    mockSelectChain([{ id: 1, tenantId: null, name: "Acme", domain: "acme.com", status: "active", industry: null, createdAt: new Date() }]);

    const res = await request(app)
      .post("/api/msp/customers/bulk")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ customerIds: [1], action: "tag", payload: { tags: [] } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tags/i);
  });

  // ── assign_bundle: N customers → N individual events ───────────────────────

  it("assign_bundle: assigns to 3 customers producing 3 assignment rows", async () => {
    const customers = [
      { id: 1, tenantId: "t1", name: "Acme", domain: "acme.com", status: "active", industry: null, createdAt: new Date() },
      { id: 2, tenantId: "t2", name: "Beta", domain: "beta.com", status: "active", industry: null, createdAt: new Date() },
      { id: 3, tenantId: null, name: "Gamma", domain: null, status: "onboarding", industry: null, createdAt: new Date() },
    ];

    // 1. Ownership check
    mockSelectChain(customers);

    // 2. Bundle lookup
    mockSelectChain([{
      bundleId: "bundle-xyz",
      mspId: 42,
      status: "active",
      monitoringPackageKeys: ["pkg-a", "pkg-b"],
      trialDays: null,
    }]);

    // 3–5. One insert per customer: assignment insert + event insert (x3 customers)
    const insertedAssignments: string[] = [];
    for (const cust of customers) {
      const assignmentId = `asgn-${cust.id}`;
      insertedAssignments.push(assignmentId);
      // assignment row insert
      mockInsertChain([{ assignmentId, bundleId: "bundle-xyz", customerId: cust.id, status: "active" }]);
      // events batch insert
      mockInsertChain([]);
    }

    const res = await request(app)
      .post("/api/msp/customers/bulk")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ customerIds: [1, 2, 3], action: "assign_bundle", payload: { bundleId: "bundle-xyz" } });

    expect(res.status).toBe(200);
    expect(res.body.action).toBe("assign_bundle");
    expect(res.body.assignedCount).toBe(3);
    expect(res.body.skippedCount).toBe(0);
    expect(res.body.results).toHaveLength(3);
    expect(res.body.results.every((r: { status: string }) => r.status === "assigned")).toBe(true);

    // Verify N individual assignment inserts were made (one per customer)
    const assignmentInsertCalls = (mockDbInsert as Mock).mock.calls.filter(
      (_: unknown[], i: number) => {
        const chain = (mockDbInsert as Mock).mock.results[i];
        return chain?.value?.values !== undefined;
      },
    );
    // At least 3 insert calls (one per customer for assignment, plus event inserts)
    expect((mockDbInsert as Mock).mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("assign_bundle: N customers produce N*packageCount activation events", async () => {
    const customers = [
      { id: 10, tenantId: "t10", name: "Alpha", domain: null, status: "active", industry: null, createdAt: new Date() },
      { id: 11, tenantId: "t11", name: "Bravo", domain: null, status: "active", industry: null, createdAt: new Date() },
    ];

    mockSelectChain(customers); // ownership check
    mockSelectChain([{
      bundleId: "bundle-abc",
      mspId: 42,
      status: "active",
      monitoringPackageKeys: ["pkg-x", "pkg-y", "pkg-z"], // 3 packages
      trialDays: null,
    }]);

    // For each of 2 customers: 1 assignment insert + 1 event batch insert (3 events each)
    const eventInsertValues: unknown[][] = [];
    for (const cust of customers) {
      mockInsertChain([{ assignmentId: `asgn-${cust.id}`, bundleId: "bundle-abc", customerId: cust.id, status: "active" }]);
      // Capture the event insert to check how many events were created
      const evtChain = {
        values: vi.fn((v: unknown[]) => { eventInsertValues.push(v); return evtChain; }),
        returning: vi.fn().mockResolvedValue([]),
        onConflictDoNothing: vi.fn().mockResolvedValue([]),
      };
      const evtPromise = Promise.resolve([]);
      Object.assign(evtChain, {
        then: evtPromise.then.bind(evtPromise),
        catch: evtPromise.catch.bind(evtPromise),
        finally: evtPromise.finally.bind(evtPromise),
      });
      (mockDbInsert as Mock).mockReturnValueOnce(evtChain);
    }

    const res = await request(app)
      .post("/api/msp/customers/bulk")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ customerIds: [10, 11], action: "assign_bundle", payload: { bundleId: "bundle-abc" } });

    expect(res.status).toBe(200);
    expect(res.body.assignedCount).toBe(2);

    // Each customer should have had 3 events emitted (one per package)
    expect(eventInsertValues).toHaveLength(2); // 2 customers
    for (const evts of eventInsertValues) {
      expect(evts).toHaveLength(3); // 3 packages per customer
      expect((evts as Array<{ eventType: string }>).every((e) => e.eventType === "bundle.package.activated")).toBe(true);
    }
  });

  // ── Idempotency deduplication ───────────────────────────────────────────────

  it("assign_bundle: already-cached customers are skipped (idempotency)", async () => {
    const customers = [
      { id: 20, tenantId: null, name: "Acme", domain: null, status: "active", industry: null, createdAt: new Date() },
      { id: 21, tenantId: null, name: "Beta", domain: null, status: "active", industry: null, createdAt: new Date() },
    ];

    mockSelectChain(customers); // ownership check
    mockSelectChain([{
      bundleId: "bundle-dup",
      mspId: 42,
      status: "active",
      monitoringPackageKeys: ["pkg-1"],
      trialDays: null,
    }]);

    // Customer 20: cache HIT → skip
    mockCheckIdempotency.mockResolvedValueOnce({ statusCode: 201, responseBody: { assignmentId: "existing-asgn-20" } });
    // Customer 21: cache MISS → assign
    mockCheckIdempotency.mockResolvedValueOnce(null);
    mockInsertChain([{ assignmentId: "asgn-21", bundleId: "bundle-dup", customerId: 21, status: "active" }]);
    mockInsertChain([]); // events for customer 21

    const res = await request(app)
      .post("/api/msp/customers/bulk")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ customerIds: [20, 21], action: "assign_bundle", payload: { bundleId: "bundle-dup" } });

    expect(res.status).toBe(200);
    expect(res.body.assignedCount).toBe(1);
    expect(res.body.skippedCount).toBe(1);

    const skipped = res.body.results.find((r: { customerId: number }) => r.customerId === 20);
    const assigned = res.body.results.find((r: { customerId: number }) => r.customerId === 21);

    expect(skipped?.status).toBe("skipped");
    expect(skipped?.assignmentId).toBe("existing-asgn-20");
    expect(assigned?.status).toBe("assigned");
    expect(assigned?.assignmentId).toBe("asgn-21");
  });

  it("assign_bundle: idempotency is recorded after a successful assignment", async () => {
    const customers = [{ id: 30, tenantId: null, name: "Corp", domain: null, status: "active", industry: null, createdAt: new Date() }];

    mockSelectChain(customers);
    mockSelectChain([{
      bundleId: "bundle-rec",
      mspId: 42,
      status: "active",
      monitoringPackageKeys: ["pkg-rec"],
      trialDays: null,
    }]);

    mockCheckIdempotency.mockResolvedValueOnce(null);
    mockInsertChain([{ assignmentId: "asgn-rec-30", bundleId: "bundle-rec", customerId: 30, status: "active" }]);
    mockInsertChain([]);

    await request(app)
      .post("/api/msp/customers/bulk")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ customerIds: [30], action: "assign_bundle", payload: { bundleId: "bundle-rec" } });

    // Verify recordIdempotency was called once with status 201 and the assignmentId
    expect(mockRecordIdempotency).toHaveBeenCalledTimes(1);
    const [_key, _mspId, _hash, statusCode, body] = mockRecordIdempotency.mock.calls[0] as [string, number, string, number, Record<string, unknown>];
    expect(statusCode).toBe(201);
    expect(body.assignmentId).toBe("asgn-rec-30");
  });

  // ── archive ─────────────────────────────────────────────────────────────────

  it("archive: updates all selected customers' status to archived", async () => {
    const customers = [
      { id: 40, tenantId: null, name: "X", domain: null, status: "active", industry: null, createdAt: new Date() },
      { id: 41, tenantId: null, name: "Y", domain: null, status: "onboarding", industry: null, createdAt: new Date() },
    ];

    mockSelectChain(customers);
    mockUpdateChain();

    const res = await request(app)
      .post("/api/msp/customers/bulk")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ customerIds: [40, 41], action: "archive", payload: {} });

    expect(res.status).toBe(200);
    expect(res.body.action).toBe("archive");
    expect(res.body.updated).toBe(2);
    expect(mockDbUpdate).toHaveBeenCalledTimes(1);
  });

  // ── tag ─────────────────────────────────────────────────────────────────────

  it("tag: executes a SQL update and returns the tag list", async () => {
    const customers = [
      { id: 50, tenantId: null, name: "Alpha", domain: null, status: "active", industry: null, createdAt: new Date() },
    ];

    mockSelectChain(customers);
    mockDbExecute.mockResolvedValueOnce({});

    const res = await request(app)
      .post("/api/msp/customers/bulk")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ customerIds: [50], action: "tag", payload: { tags: ["vip", "renewal"] } });

    expect(res.status).toBe(200);
    expect(res.body.action).toBe("tag");
    expect(res.body.updated).toBe(1);
    expect(res.body.tags).toEqual(["vip", "renewal"]);
    expect(mockDbExecute).toHaveBeenCalledTimes(1);
  });

  // ── unknown action ──────────────────────────────────────────────────────────

  it("returns 400 for an unknown action", async () => {
    mockSelectChain([{ id: 1, tenantId: null, name: "X", domain: null, status: "active", industry: null, createdAt: new Date() }]);

    const res = await request(app)
      .post("/api/msp/customers/bulk")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ customerIds: [1], action: "nuke_everything", payload: {} });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown action/i);
  });
});
