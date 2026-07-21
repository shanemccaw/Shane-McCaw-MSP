/**
 * msp-engine-history.test.ts
 *
 * Unit tests for GET /api/msp/engines/:key/history.
 *
 * Security-critical: mspId must be resolvable ONLY from the authenticated
 * session (resolveMspIdStrict — req.user.mspId), never from a query/body
 * override. A caller-supplied ?customerId= must be validated against the
 * caller's own MSP book (assertCustomerAccess) — including per-staff scoping
 * — before any history is queried; a customer outside that book must not be
 * disclosed to exist (404, not a different error shape).
 *
 * Covers:
 *   - 401 without auth, 403 below MSPOperator
 *   - 403 when the session carries no mspId
 *   - 404 for a truly unknown engine key
 *   - customerId omitted -> returns the MSP's own customer list for this
 *     engine (no blended cross-customer series)
 *   - customerId belonging to a different MSP -> 404, not leaked
 *   - customerId outside a scoped staff member's assigned set -> 404
 *   - customerId within the caller's book -> real history returned
 *
 * Run: pnpm --filter @workspace/api-server run test -- msp-engine-history
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const JWT_SECRET = "msp-engine-history-test-secret";
process.env["JWT_SECRET"] = JWT_SECRET;

function mspToken(opts: { mspId?: number; mspRole?: "MSPOperator" | "MSPAdmin" | "CustomerUser" | "PlatformAdmin"; id?: number }): string {
  const { mspId, mspRole = "MSPOperator", id = 1 } = opts;
  return jwt.sign(
    { id, email: "staff@test.com", role: "client", mspRole, ...(mspId !== undefined ? { mspId } : {}) },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn(), selectDistinct: vi.fn() },
  mspCustomersTable: { id: "id", name: "name", mspId: "mspId" },
  tenantEngineSnapshotsTable: { customerId: "customerId", engineKey: "engineKey" },
  mspStaffCustomerScopesTable: { customerId: "customerId", staffUserId: "staffUserId" },
  mspsTable: { id: "id", slug: "slug" },
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

const KNOWN_ENGINE_KEYS = ["health", "security", "drift", "monitoring", "sla", "scope_creep", "pricing", "crm", "priority"];

vi.mock("../lib/engine-registry", () => ({
  getEngineDef: vi.fn((key: string) => (KNOWN_ENGINE_KEYS.includes(key) ? { key, label: key } : undefined)),
}));

const seriesFixture = [{ date: "2026-07-01", score: 40, previousScore: null, delta: null, trendDirection: null, source: "snapshot", runId: null, ruleVersion: null }];
const baselineFixture = [{ id: 1, baselineScore: 30, resetTriggerType: null, createdAt: "2026-06-01" }];
const deltasFixture = [{ signalKey: "s1", label: "Signal 1", direction: "up", date: "2026-07-01", historyId: 1 }];

const mockGetEngineHistoryMerged = vi.fn().mockResolvedValue(seriesFixture);
const mockGetBaselineEvents = vi.fn().mockResolvedValue(baselineFixture);
const mockGetSignalDeltasForRange = vi.fn().mockResolvedValue(deltasFixture);

vi.mock("../lib/engine-history", () => ({
  getEngineHistoryMerged: (...args: unknown[]) => mockGetEngineHistoryMerged(...args),
  getBaselineEvents: (...args: unknown[]) => mockGetBaselineEvents(...args),
  getSignalDeltasForRange: (...args: unknown[]) => mockGetSignalDeltasForRange(...args),
}));

import { db } from "@workspace/db";
import router from "./msp-engine-history";

const mockSelect = (db as unknown as { select: ReturnType<typeof vi.fn> }).select;
const mockSelectDistinct = (db as unknown as { selectDistinct: ReturnType<typeof vi.fn> }).selectDistinct;

/** Drizzle-style fluent chain, thenable at any point, resolving to `rows`. */
function buildChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit", "innerJoin", "leftJoin"]) {
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

beforeEach(() => {
  mockSelect.mockReset();
  mockSelectDistinct.mockReset();
  mockGetEngineHistoryMerged.mockClear();
  mockGetBaselineEvents.mockClear();
  mockGetSignalDeltasForRange.mockClear();
});

const MSP_ID = 900;
const OTHER_MSP_CUSTOMER = { id: 42 };

describe("GET /msp/engines/:key/history", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(makeApp()).get("/msp/engines/health/history");
    expect(res.status).toBe(401);
  });

  it("rejects roles below MSPOperator", async () => {
    const res = await request(makeApp())
      .get("/msp/engines/health/history")
      .set("Authorization", `Bearer ${mspToken({ mspId: MSP_ID, mspRole: "CustomerUser" })}`);
    expect(res.status).toBe(403);
  });

  it("403s when the session carries no mspId", async () => {
    const res = await request(makeApp())
      .get("/msp/engines/health/history")
      .set("Authorization", `Bearer ${mspToken({ mspRole: "MSPOperator" })}`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "MSP context required" });
  });

  it("404s for a truly unknown engine key", async () => {
    const res = await request(makeApp())
      .get("/msp/engines/nonexistent/history")
      .set("Authorization", `Bearer ${mspToken({ mspId: MSP_ID })}`);
    expect(res.status).toBe(404);
  });

  it("lists the MSP's own customers with history when customerId is omitted", async () => {
    mockSelect.mockReturnValueOnce(buildChain([])); // resolveStaffScopedCustomerIds -> unrestricted
    mockSelectDistinct.mockReturnValueOnce(buildChain([{ id: 1, name: "Acme Corp" }]));

    const res = await request(makeApp())
      .get("/msp/engines/health/history")
      .set("Authorization", `Bearer ${mspToken({ mspId: MSP_ID })}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ engineKey: "health", customers: [{ id: 1, name: "Acme Corp" }] });
    expect(mockGetEngineHistoryMerged).not.toHaveBeenCalled();
  });

  it("404s a customerId belonging to a different MSP, without disclosing it exists", async () => {
    mockSelect.mockReturnValueOnce(buildChain([])); // customer lookup scoped to caller's mspId -> no match

    const res = await request(makeApp())
      .get(`/msp/engines/health/history?customerId=${OTHER_MSP_CUSTOMER.id}`)
      .set("Authorization", `Bearer ${mspToken({ mspId: MSP_ID })}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Customer not found" });
    expect(mockGetEngineHistoryMerged).not.toHaveBeenCalled();
  });

  it("404s a customerId outside a scoped staff member's assigned set", async () => {
    mockSelect
      .mockReturnValueOnce(buildChain([{ id: 42 }])) // customer belongs to caller's mspId
      .mockReturnValueOnce(buildChain([{ customerId: 7 }])); // staff scoped to customer 7 only

    const res = await request(makeApp())
      .get("/msp/engines/health/history?customerId=42")
      .set("Authorization", `Bearer ${mspToken({ mspId: MSP_ID })}`);

    expect(res.status).toBe(404);
    expect(mockGetEngineHistoryMerged).not.toHaveBeenCalled();
  });

  it("returns real history for a customer within the caller's book, ignoring no mspId override path", async () => {
    mockSelect
      .mockReturnValueOnce(buildChain([{ id: 42 }])) // customer belongs to caller's mspId
      .mockReturnValueOnce(buildChain([])); // unrestricted staff

    const res = await request(makeApp())
      .get("/msp/engines/health/history?customerId=42")
      .set("Authorization", `Bearer ${mspToken({ mspId: MSP_ID })}`);

    expect(res.status).toBe(200);
    expect(res.body.customerId).toBe(42);
    expect(res.body.engineKey).toBe("health");
    expect(res.body.series).toEqual(seriesFixture);
    expect(mockGetEngineHistoryMerged).toHaveBeenCalledWith(42, "health", undefined, undefined);
  });

  it("PlatformAdmin bypasses per-customer ownership check (no db lookup) but still needs a session mspId", async () => {
    const res = await request(makeApp())
      .get("/msp/engines/health/history?customerId=42")
      .set("Authorization", `Bearer ${mspToken({ mspId: MSP_ID, mspRole: "PlatformAdmin" })}`);

    expect(res.status).toBe(200);
    expect(res.body.customerId).toBe(42);
  });
});
