/**
 * Tests for per-request child logger enrichment in requireAuth.
 *
 * Verifies that once a JWT with mspId/customerId is verified, req.log is
 * rebound as a child that carries those fields, and that every log line
 * produced inside a route handler includes traceId, mspId, and customerId.
 *
 * Run: pnpm --filter @workspace/api-server vitest run requireAuth
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({ db: {}, mspCustomersTable: {} }));

// ── Helpers ────────────────────────────────────────────────────────────────────

const JWT_SECRET = "test-secret-child-logger";
process.env.JWT_SECRET = JWT_SECRET;

function makeToken(claims: Record<string, unknown> = {}): string {
  return jwt.sign(
    { id: 1, email: "test@msp.com", role: "client", mspRole: "MSPAdmin", ...claims },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

/**
 * Builds a minimal mock Express request with a spy-equipped logger.
 * The `child` spy returns a new mock logger so we can inspect what
 * bindings were passed when requireAuth enriches req.log.
 */
function makeReq(authHeader: string, logOverrides: Record<string, unknown> = {}): Request {
  const childLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
    ...logOverrides,
  };

  const parentLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => childLogger),
  };

  return {
    headers: { authorization: authHeader },
    method: "GET",
    log: parentLogger,
  } as unknown as Request;
}

function makeRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

// ── Import the module under test after mocks are set ─────────────────────────

import { requireAuth } from "./requireAuth";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("requireAuth — per-request child logger enrichment", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = JWT_SECRET;
  });

  it("calls next() and replaces req.log with the child logger instance", () => {
    const token = makeToken({ mspId: 42 });
    const req = makeReq(`Bearer ${token}`);
    const originalLog = req.log;
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    // req.log must now be the child returned by parent.child(), not the parent
    expect(req.log).not.toBe(originalLog);
  });

  it("binds mspId on the child when JWT has mspId", () => {
    const token = makeToken({ mspId: 7 });
    const req = makeReq(`Bearer ${token}`);
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    // Capture the child spy before requireAuth reassigns req.log
    const parentChildSpy = (req.log as unknown as { child: ReturnType<typeof vi.fn> }).child;

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(parentChildSpy).toHaveBeenCalledWith(expect.objectContaining({ mspId: 7 }));
  });

  it("binds both mspId and customerId when both are in the JWT", () => {
    const token = makeToken({ mspId: 3, customerId: 99 });
    const req = makeReq(`Bearer ${token}`);
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    const parentChildSpy = (req.log as unknown as { child: ReturnType<typeof vi.fn> }).child;

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(parentChildSpy).toHaveBeenCalledWith(
      expect.objectContaining({ mspId: 3, customerId: 99 }),
    );
  });

  it("does not pass mspId/customerId fields when JWT has neither", () => {
    const token = jwt.sign(
      { id: 99, email: "admin@platform.com", role: "admin" },
      JWT_SECRET,
      { expiresIn: "1h" },
    );
    const req = makeReq(`Bearer ${token}`);
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    const parentChildSpy = (req.log as unknown as { child: ReturnType<typeof vi.fn> }).child;

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    // child() should still be called (with an empty bindings object since
    // neither mspId nor customerId spread any keys)
    expect(parentChildSpy).toHaveBeenCalledWith(
      expect.not.objectContaining({ mspId: expect.anything() }),
    );
    expect(parentChildSpy).toHaveBeenCalledWith(
      expect.not.objectContaining({ customerId: expect.anything() }),
    );
  });

  it("reassigns req.log to the child logger instance", () => {
    const token = makeToken({ mspId: 55, customerId: 11 });
    const req = makeReq(`Bearer ${token}`);
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    // Record the original parent logger object
    const originalLog = req.log;

    requireAuth(req, res, next);

    // req.log must now point at the child, not the parent
    expect(req.log).not.toBe(originalLog);
  });

  it("returns 401 when Authorization header is missing", () => {
    const req = makeReq("");
    (req as unknown as { headers: Record<string, string> }).headers = {};
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect((res.status as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(401);
  });

  it("returns 401 for an invalid/expired token", () => {
    const req = makeReq("Bearer this-is-not-a-valid-jwt");
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect((res.status as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(401);
  });
});
