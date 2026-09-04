/**
 * msp-retention-queue.test.ts
 *
 * HTTP-level tests for the operator side of the accelerated-delete review queue
 * (#2764): GET /msp/retention/queue, POST .../decide, POST .../discuss.
 *
 * Covers:
 *   - 401 without auth, 403 below MSPOperator
 *   - GET returns the queue scoped to the caller's own mspId, with tenant names
 *     resolved and the delete reason surfaced alongside each item
 *   - a scoped operator (rows exist in mspStaffCustomerScopesTable) only sees their
 *     assigned customers' queue items, and gets a 404 (not a 403) reaching for a
 *     deletionId outside their scope — so a scoped operator cannot learn a queue
 *     item exists on a customer they are not assigned to
 *   - POST decide passes approve/note through to decideAcceleration and surfaces a
 *     RetentionError as its own real httpStatus rather than a generic 500
 *   - POST discuss enforces the required restore reason (via the real RetentionError
 *     restore() throws) and composes decline-then-restore, matching #1944 part 4's
 *     third outcome
 *
 * `../lib/retention` is mocked directly (not through @workspace/db) — the module
 * already has its own real DB-backed test coverage on the mechanism itself
 * (retention-clock.test.ts) and live verification against local Postgres (see the
 * #2764 bookend); this file is testing the ROUTE's own auth/scoping/error-mapping,
 * not re-deriving the lifecycle's own logic.
 *
 * Run: pnpm --filter @workspace/api-server run test -- msp-retention-queue
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const JWT_SECRET = "msp-retention-queue-test-secret";
process.env["JWT_SECRET"] = JWT_SECRET;

function mspToken(mspId: number, mspRole: "MSPOperator" | "MSPAdmin" | "CustomerUser" = "MSPOperator", userId = 1): string {
  return jwt.sign(
    { id: userId, email: "staff@test.com", name: "Staff Person", role: "client", mspRole, mspId },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn() },
  tenantsTable: { id: "id", customerName: "customerName", mspId: "mspId" },
  // Per-staff customer-access scoping table, read by resolveStaffScopedCustomerIds.
  mspStaffCustomerScopesTable: { customerId: "customerId", staffUserId: "staffUserId", mspId: "mspId" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (c: unknown, v: unknown) => ({ eq: [c, v] }),
  and: (...args: unknown[]) => ({ and: args }),
  inArray: (c: unknown, v: unknown) => ({ inArray: [c, v] }),
}));

vi.mock("../lib/logger", () => {
  const stub = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});

const h = vi.hoisted(() => {
  class FakeRetentionError extends Error {
    readonly httpStatus: number;
    constructor(message: string, httpStatus = 400) {
      super(message);
      this.name = "RetentionError";
      this.httpStatus = httpStatus;
    }
  }
  return {
    listAccelerationQueue: vi.fn(),
    decideAcceleration: vi.fn(),
    restore: vi.fn(),
    getDeletionById: vi.fn(),
    FakeRetentionError,
  };
});
const FakeRetentionError = h.FakeRetentionError;

vi.mock("../lib/retention", () => ({
  listAccelerationQueue: h.listAccelerationQueue,
  decideAcceleration: h.decideAcceleration,
  restore: h.restore,
  getDeletionById: h.getDeletionById,
  RetentionError: h.FakeRetentionError,
}));

import { db } from "@workspace/db";
import router from "./msp-retention-queue";

const mockSelect = (db as unknown as { select: ReturnType<typeof vi.fn> }).select;

/** Drizzle-style fluent chain, thenable at any point, resolving to `rows`. */
function buildChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain["then"] = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(rows).then(resolve, reject);
  return chain;
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

const MSP_ID = 900;

const queueItem = {
  deletionId: 42,
  recordType: "msp_risk_decisions",
  recordId: "17",
  recordLabel: "Legacy VPN risk",
  tenantId: 1,
  stage: "soft",
  deletedAt: new Date("2026-08-01T00:00:00Z"),
  deletedBy: "customer@acme.com",
  deletedBySide: "customer",
  deleteReason: "superseded by the new CA policy",
  accelerationState: "pending",
  accelerationRequestedAt: new Date("2026-08-02T00:00:00Z"),
  accelerationRequestedBy: "customer@acme.com",
  accelerationReasonKind: "superseded_by",
  accelerationReason: "Replaced by risk #23",
  supersededByRecordType: "msp_risk_decisions",
  supersededByRecordId: "23",
};

beforeEach(() => {
  mockSelect.mockReset();
  h.listAccelerationQueue.mockReset();
  h.decideAcceleration.mockReset();
  h.restore.mockReset();
  h.getDeletionById.mockReset();
});

describe("GET /msp/retention/queue", () => {
  it("401s without auth", async () => {
    const res = await request(makeApp()).get("/msp/retention/queue");
    expect(res.status).toBe(401);
  });

  it("403s below MSPOperator", async () => {
    const res = await request(makeApp())
      .get("/msp/retention/queue")
      .set("Authorization", `Bearer ${mspToken(MSP_ID, "CustomerUser")}`);
    expect(res.status).toBe(403);
  });

  it("returns the queue scoped to the caller's own mspId, delete reason surfaced, tenant name resolved", async () => {
    h.listAccelerationQueue.mockResolvedValue([queueItem]);
    mockSelect.mockReturnValueOnce(buildChain([])); // scope lookup (unrestricted — no scope rows)
    mockSelect.mockReturnValueOnce(buildChain([{ id: 1, name: "Acme Corp" }])); // tenant name lookup

    const res = await request(makeApp())
      .get("/msp/retention/queue")
      .set("Authorization", `Bearer ${mspToken(MSP_ID)}`);

    expect(res.status).toBe(200);
    expect(h.listAccelerationQueue).toHaveBeenCalledWith(MSP_ID, { tenantIds: null });
    expect(res.body.total).toBe(1);
    expect(res.body.queue[0].deleteReason).toBe("superseded by the new CA policy");
    expect(res.body.queue[0].accelerationReasonKind).toBe("superseded_by");
    expect(res.body.queue[0].tenantName).toBe("Acme Corp");
  });

  it("restricts a scoped operator to their assigned customers", async () => {
    h.listAccelerationQueue.mockResolvedValue([]);
    mockSelect.mockReturnValueOnce(buildChain([{ customerId: 1 }, { customerId: 5 }])); // scoped rows

    const res = await request(makeApp())
      .get("/msp/retention/queue")
      .set("Authorization", `Bearer ${mspToken(MSP_ID)}`);

    expect(res.status).toBe(200);
    expect(h.listAccelerationQueue).toHaveBeenCalledWith(MSP_ID, { tenantIds: [1, 5] });
  });
});

describe("POST /msp/retention/queue/:deletionId/decide", () => {
  it("passes approve/note through and returns the updated row", async () => {
    h.getDeletionById.mockResolvedValue({ id: 42, mspId: MSP_ID, tenantId: 1, accelerationState: "pending" });
    mockSelect.mockReturnValueOnce(buildChain([])); // unrestricted scope
    h.decideAcceleration.mockResolvedValue({ ...queueItem, accelerationState: "approved", stage: "purged" });

    const res = await request(makeApp())
      .post("/msp/retention/queue/42/decide")
      .set("Authorization", `Bearer ${mspToken(MSP_ID)}`)
      .send({ approve: true, note: "Agreed — proceeding" });

    expect(res.status).toBe(200);
    expect(h.decideAcceleration).toHaveBeenCalledWith(
      expect.objectContaining({ deletionId: 42, approve: true, note: "Agreed — proceeding" }),
    );
    expect(res.body.deletion.stage).toBe("purged");
  });

  it("404s a deletion belonging to a different MSP rather than leaking it", async () => {
    h.getDeletionById.mockResolvedValue({ id: 42, mspId: 999999, tenantId: 1, accelerationState: "pending" });

    const res = await request(makeApp())
      .post("/msp/retention/queue/42/decide")
      .set("Authorization", `Bearer ${mspToken(MSP_ID)}`)
      .send({ approve: true });

    expect(res.status).toBe(404);
    expect(h.decideAcceleration).not.toHaveBeenCalled();
  });

  it("404s a deletion outside a scoped operator's assigned customers", async () => {
    h.getDeletionById.mockResolvedValue({ id: 42, mspId: MSP_ID, tenantId: 7, accelerationState: "pending" });
    mockSelect.mockReturnValueOnce(buildChain([{ customerId: 1 }])); // scoped to tenant 1 only

    const res = await request(makeApp())
      .post("/msp/retention/queue/42/decide")
      .set("Authorization", `Bearer ${mspToken(MSP_ID)}`)
      .send({ approve: false });

    expect(res.status).toBe(404);
    expect(h.decideAcceleration).not.toHaveBeenCalled();
  });

  it("maps a RetentionError to its own real httpStatus, not a generic 500", async () => {
    h.getDeletionById.mockResolvedValue({ id: 42, mspId: MSP_ID, tenantId: 1, accelerationState: "none" });
    mockSelect.mockReturnValueOnce(buildChain([]));
    h.decideAcceleration.mockRejectedValue(new FakeRetentionError("There is no acceleration request awaiting review for this record.", 409));

    const res = await request(makeApp())
      .post("/msp/retention/queue/42/decide")
      .set("Authorization", `Bearer ${mspToken(MSP_ID)}`)
      .send({ approve: true });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/no acceleration request awaiting review/);
  });
});

describe("POST /msp/retention/queue/:deletionId/discuss", () => {
  it("declines the pending acceleration, then restores with the given reason (#1944 part 4's third outcome)", async () => {
    h.getDeletionById.mockResolvedValue({ id: 42, mspId: MSP_ID, tenantId: 1, accelerationState: "pending" });
    mockSelect.mockReturnValueOnce(buildChain([]));
    h.decideAcceleration.mockResolvedValue({ ...queueItem, accelerationState: "declined" });
    h.restore.mockResolvedValue({ ...queueItem, stage: "restored", restoreReason: "Customer needs it back, amended" });

    const res = await request(makeApp())
      .post("/msp/retention/queue/42/discuss")
      .set("Authorization", `Bearer ${mspToken(MSP_ID)}`)
      .send({ reason: "Customer needs it back, amended" });

    expect(res.status).toBe(200);
    expect(h.decideAcceleration).toHaveBeenCalledWith(expect.objectContaining({ deletionId: 42, approve: false }));
    expect(h.restore).toHaveBeenCalledWith(
      expect.objectContaining({ deletionId: 42, reason: "Customer needs it back, amended" }),
    );
    expect(res.body.deletion.stage).toBe("restored");
  });

  it("skips the decline when nothing is actually pending, and still restores", async () => {
    h.getDeletionById.mockResolvedValue({ id: 42, mspId: MSP_ID, tenantId: 1, accelerationState: "none" });
    mockSelect.mockReturnValueOnce(buildChain([]));
    h.restore.mockResolvedValue({ ...queueItem, stage: "restored" });

    const res = await request(makeApp())
      .post("/msp/retention/queue/42/discuss")
      .set("Authorization", `Bearer ${mspToken(MSP_ID)}`)
      .send({ reason: "Restoring directly" });

    expect(res.status).toBe(200);
    expect(h.decideAcceleration).not.toHaveBeenCalled();
    expect(h.restore).toHaveBeenCalled();
  });

  it("surfaces the required-restore-reason RetentionError as its own httpStatus", async () => {
    h.getDeletionById.mockResolvedValue({ id: 42, mspId: MSP_ID, tenantId: 1, accelerationState: "none" });
    mockSelect.mockReturnValueOnce(buildChain([]));
    h.restore.mockRejectedValue(new FakeRetentionError("A restore reason is required.", 400));

    const res = await request(makeApp())
      .post("/msp/retention/queue/42/discuss")
      .set("Authorization", `Bearer ${mspToken(MSP_ID)}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("A restore reason is required.");
  });
});
