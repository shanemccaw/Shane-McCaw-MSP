/**
 * MSP Foundation Tests
 *
 * Covers:
 *   1. Tenant isolation — requireMspScope enforces mspId fence
 *   2. Role hierarchy — requireRole allows/blocks based on ROLE_ORDER
 *   3. Event envelope — dispatchUnsafe stores all canonical fields
 *   4. Idempotency — checkIdempotency caches and dedupes correctly
 *   5. DLQ — enqueueDlq / resolveDlqItem round-trip
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// ── Mock jsonwebtoken so requireAuth trusts any "Bearer <payload-json>" token ──
vi.mock("jsonwebtoken", () => ({
  default: {
    verify: vi.fn((_tok: string, _secret: string) => {
      const b64 = _tok.split(".")[1] ?? "";
      try {
        return JSON.parse(Buffer.from(b64, "base64url").toString());
      } catch {
        return JSON.parse(_tok);
      }
    }),
    sign: vi.fn(() => "signed.token"),
  },
  verify: vi.fn((_tok: string, _secret: string) => {
    const b64 = _tok.split(".")[1] ?? "";
    try {
      return JSON.parse(Buffer.from(b64, "base64url").toString());
    } catch {
      return JSON.parse(_tok);
    }
  }),
  sign: vi.fn(() => "signed.token"),
}));

// ── Mock DB ───────────────────────────────────────────────────────────────────
vi.mock("@workspace/db", () => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    orderBy: vi.fn().mockResolvedValue([]),
  };
  return {
    db: {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockResolvedValue({}),
          returning: vi.fn().mockResolvedValue([{ dlqId: "test-dlq-id" }]),
        }),
      }),
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ dlqId: "test-dlq-id" }]),
        }),
      }),
    },
    mspEventStoreTable: {},
    mspIdempotencyStoreTable: {},
    mspDlqStoreTable: {},
    mspUsersTable: {},
    mspRefreshTokensTable: {},
  };
});

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

process.env.JWT_SECRET = "test-secret";

function makeJwt(payload: Record<string, unknown>): string {
  const json = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `hdr.${json}.sig`;
}

function mockReq(user?: Record<string, unknown>, params?: Record<string, string>): Request {
  const headers: Record<string, string> = {};
  if (user) headers["authorization"] = `Bearer ${makeJwt(user)}`;
  return { headers, method: "GET", params: params ?? {}, query: {}, body: {}, user } as unknown as Request;
}

function mockRes(): Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
  const res = {} as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

// ── 1. Role hierarchy ─────────────────────────────────────────────────────────

describe("requireRole()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("allows PlatformAdmin where MSPAdmin is required", async () => {
    const { requireRole } = await import("../middlewares/requireAuth");
    const user = { id: 1, email: "pa@x.com", role: "admin", mspRole: "PlatformAdmin" };
    const req = mockReq(user);
    const res = mockRes();
    const next = vi.fn();

    requireRole("MSPAdmin")(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it("allows MSPAdmin where MSPOperator is required", async () => {
    const { requireRole } = await import("../middlewares/requireAuth");
    const user = { id: 2, email: "msp@x.com", role: "client", mspRole: "MSPAdmin" };
    const req = mockReq(user);
    const res = mockRes();
    const next = vi.fn();

    requireRole("MSPOperator")(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("blocks Free user from MSPOperator-required route", async () => {
    const { requireRole } = await import("../middlewares/requireAuth");
    const user = { id: 3, email: "free@x.com", role: "client", mspRole: "Free" };
    const req = mockReq(user);
    const res = mockRes();
    const next = vi.fn();

    requireRole("MSPOperator")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("blocks CustomerUser from MSPAdmin-required route", async () => {
    const { requireRole } = await import("../middlewares/requireAuth");
    const user = { id: 4, email: "cu@x.com", role: "client", mspRole: "CustomerUser" };
    const req = mockReq(user);
    const res = mockRes();
    const next = vi.fn();

    requireRole("MSPAdmin")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows legacy role=admin as PlatformAdmin", async () => {
    const { requireRole } = await import("../middlewares/requireAuth");
    const user = { id: 5, email: "oldadmin@x.com", role: "admin" };
    const req = mockReq(user);
    const res = mockRes();
    const next = vi.fn();

    requireRole("PlatformAdmin")(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

// ── 2. Tenant isolation — requireMspScope ─────────────────────────────────────

describe("requireMspScope()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("PlatformAdmin bypasses mspId scope check", async () => {
    const { requireMspScope } = await import("../middlewares/requireAuth");
    const req = mockReq(
      { id: 1, email: "pa@x.com", role: "admin", mspRole: "PlatformAdmin" },
      { mspId: "99" }
    );
    const res = mockRes();
    const next = vi.fn();

    requireMspScope("params")(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it("MSPAdmin with wrong mspId gets 403", async () => {
    const { requireMspScope } = await import("../middlewares/requireAuth");
    const req = mockReq(
      { id: 5, email: "msp@x.com", role: "client", mspRole: "MSPAdmin", mspId: 1 },
      { mspId: "2" }
    );
    const res = mockRes();
    const next = vi.fn();

    requireMspScope("params")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("MSPAdmin with matching mspId is allowed", async () => {
    const { requireMspScope } = await import("../middlewares/requireAuth");
    const req = mockReq(
      { id: 5, email: "msp@x.com", role: "client", mspRole: "MSPAdmin", mspId: 1 },
      { mspId: "1" }
    );
    const res = mockRes();
    const next = vi.fn();

    requireMspScope("params")(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("returns 401 when req.user is absent", async () => {
    const { requireMspScope } = await import("../middlewares/requireAuth");
    const req = { headers: {}, method: "GET", params: { mspId: "1" } } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();

    requireMspScope("params")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

// ── 3. Event envelope — canonical fields ─────────────────────────────────────

describe("dispatchUnsafe()", () => {
  it("inserts a row with all canonical envelope fields", async () => {
    const { db } = await import("@workspace/db");
    const valuesMock = vi.fn().mockResolvedValue({});
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values: valuesMock });

    const { dispatchUnsafe, systemActor } = await import("./event-bus");

    const result = await dispatchUnsafe({
      eventType: "test.event",
      actor: systemActor(),
      source: "test-suite",
      mspId: 1,
      customerId: 2,
      payload: { foo: "bar" },
    });

    expect(result.eventType).toBe("test.event");
    expect(result.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.occurredAt).toBeInstanceOf(Date);

    const inserted = valuesMock.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted).toMatchObject({
      eventType: "test.event",
      eventVersion: "1.0",
      source: "test-suite",
      mspId: 1,
      customerId: 2,
    });
    expect(inserted.actor).toMatchObject({ id: "system", role: "system", type: "system" });
    expect((inserted.meta as { tenant: { mspId: number } }).tenant.mspId).toBe(1);
    expect((inserted.payload as { foo: string }).foo).toBe("bar");
  });

  it("uses provided correlationId/causationId (must be UUIDs)", async () => {
    const { db } = await import("@workspace/db");
    const valuesMock = vi.fn().mockResolvedValue({});
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values: valuesMock });

    const corrId = "11111111-1111-4111-8111-111111111111";
    const causId = "22222222-2222-4222-8222-222222222222";

    const { dispatchUnsafe, systemActor } = await import("./event-bus");
    await dispatchUnsafe({
      eventType: "test.correlated",
      actor: systemActor(),
      source: "test",
      correlationId: corrId,
      causationId: causId,
    });

    const inserted = valuesMock.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.correlationId).toBe(corrId);
    expect(inserted.causationId).toBe(causId);
  });

  it("auto-generates correlationId and causationId as UUIDs when not provided", async () => {
    const { db } = await import("@workspace/db");
    const valuesMock = vi.fn().mockResolvedValue({});
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values: valuesMock });

    const { dispatchUnsafe, systemActor } = await import("./event-bus");
    await dispatchUnsafe({ eventType: "test.auto-corr", actor: systemActor(), source: "test" });

    const inserted = valuesMock.mock.calls[0][0] as Record<string, unknown>;
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(inserted.correlationId).toMatch(uuidPattern);
    expect(inserted.causationId).toMatch(uuidPattern);
  });

  it("ownerType is 'msp' when mspId is set and 'platform' when not", async () => {
    const { db } = await import("@workspace/db");
    const valuesMock = vi.fn().mockResolvedValue({});
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values: valuesMock });

    const { dispatchUnsafe, systemActor } = await import("./event-bus");

    await dispatchUnsafe({ eventType: "a", actor: systemActor(), source: "t", mspId: 5 });
    expect((valuesMock.mock.calls[0][0] as Record<string, unknown>).ownerType).toBe("msp");

    await dispatchUnsafe({ eventType: "b", actor: systemActor(), source: "t" });
    expect((valuesMock.mock.calls[1][0] as Record<string, unknown>).ownerType).toBe("platform");
  });
});

// ── 4. Idempotency ────────────────────────────────────────────────────────────

describe("checkIdempotency()", () => {
  it("returns null when no matching row exists", async () => {
    const { db } = await import("@workspace/db");
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    });

    const { checkIdempotency } = await import("./idempotency");
    const result = await checkIdempotency("key-1", 1, "hash-abc");
    expect(result).toBeNull();
  });

  it("returns cached response when key+hash matches", async () => {
    const { db } = await import("@workspace/db");
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{
        idempotencyKey: "key-2",
        mspId: 1,
        requestHash: "hash-xyz",
        statusCode: 201,
        responseBody: { id: 99 },
        expiresAt: new Date(Date.now() + 60_000),
      }]),
    });

    const { checkIdempotency } = await import("./idempotency");
    const result = await checkIdempotency("key-2", 1, "hash-xyz");
    expect(result).toEqual({ statusCode: 201, responseBody: { id: 99 } });
  });

  it("returns null when hash mismatches (body changed)", async () => {
    const { db } = await import("@workspace/db");
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{
        idempotencyKey: "key-3",
        mspId: 1,
        requestHash: "hash-original",
        statusCode: 200,
        responseBody: {},
        expiresAt: new Date(Date.now() + 60_000),
      }]),
    });

    const { checkIdempotency } = await import("./idempotency");
    const result = await checkIdempotency("key-3", 1, "hash-different");
    expect(result).toBeNull();
  });

  it("hashBody is deterministic", async () => {
    const { hashBody } = await import("./idempotency");
    const body = { amount: 100, currency: "usd" };
    expect(hashBody(body)).toBe(hashBody(body));
    expect(hashBody(body)).not.toBe(hashBody({ ...body, amount: 101 }));
  });
});

// ── 5. DLQ round-trip ─────────────────────────────────────────────────────────

describe("DLQ", () => {
  it("enqueueDlq returns a dlqId", async () => {
    const { db } = await import("@workspace/db");
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ dlqId: "dlq-abc-123" }]),
      }),
    });

    const { enqueueDlq } = await import("./dlq");
    const id = await enqueueDlq({
      eventType: "payment.failed",
      payload: { orderId: 42 },
      errorMessage: "Stripe timeout",
      mspId: 1,
    });
    expect(id).toBe("dlq-abc-123");
  });

  it("resolveDlqItem marks the row resolved and returns true", async () => {
    const { db } = await import("@workspace/db");
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ dlqId: "dlq-to-resolve" }]),
      }),
    });

    const { resolveDlqItem } = await import("./dlq");
    const ok = await resolveDlqItem("dlq-to-resolve", { resolution: "replayed" });
    expect(ok).toBe(true);
  });

  it("resolveDlqItem returns false when row not found", async () => {
    const { db } = await import("@workspace/db");
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
      }),
    });

    const { resolveDlqItem } = await import("./dlq");
    const ok = await resolveDlqItem("nonexistent", { resolution: "discarded" });
    expect(ok).toBe(false);
  });
});
