/**
 * portal-engine-history.test.ts
 *
 * Unit tests for GET /api/portal/engines/:key/history.
 *
 * Security-critical: customerId must be resolvable ONLY from the
 * authenticated session (req.user.customerId) — never from a query param or
 * any other client-supplied value. Covers:
 *   - 401 without auth, 403 below CustomerUser
 *   - 404 for a truly unknown engine key
 *   - 404 for an internal/MSP-only engine key (not customer-safe), same
 *     response shape as a truly unknown key — its existence isn't disclosed
 *   - 400 when the session carries no customerId (e.g. MSP staff token)
 *   - a caller-supplied ?customerId= query param is silently ignored; the
 *     response always reflects the session's own customerId
 *   - start/end query params are forwarded to the engine-history helpers
 *
 * Run: pnpm --filter @workspace/api-server run test -- portal-engine-history
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const JWT_SECRET = "portal-engine-history-test-secret";
process.env["JWT_SECRET"] = JWT_SECRET;

function customerToken(customerId: number | undefined, mspRole: "CustomerUser" | "Free" | "MSPOperator" = "CustomerUser"): string {
  return jwt.sign(
    { id: 1, email: "customer@test.com", role: "client", mspRole, ...(customerId !== undefined ? { customerId } : {}) },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn() },
  mspCustomersTable: { id: "id", mspId: "mspId" },
  mspStaffCustomerScopesTable: { customerId: "customerId", staffUserId: "staffUserId" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (c: unknown, v: unknown) => ({ eq: [c, v] }),
  and: (...args: unknown[]) => ({ and: args }),
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

import router from "./portal-engine-history";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

beforeEach(() => {
  mockGetEngineHistoryMerged.mockClear();
  mockGetBaselineEvents.mockClear();
  mockGetSignalDeltasForRange.mockClear();
});

describe("GET /portal/engines/:key/history", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(makeApp()).get("/portal/engines/health/history");
    expect(res.status).toBe(401);
  });

  it("rejects roles below CustomerUser", async () => {
    const res = await request(makeApp())
      .get("/portal/engines/health/history")
      .set("Authorization", `Bearer ${customerToken(5, "Free")}`);
    expect(res.status).toBe(403);
  });

  it("404s for a truly unknown engine key", async () => {
    const res = await request(makeApp())
      .get("/portal/engines/nonexistent/history")
      .set("Authorization", `Bearer ${customerToken(5)}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Unknown engine" });
  });

  it("404s for a real but MSP-internal engine key, identical to a truly unknown key", async () => {
    const res = await request(makeApp())
      .get("/portal/engines/pricing/history")
      .set("Authorization", `Bearer ${customerToken(5)}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Unknown engine" });
  });

  it("400s when the session has no customerId", async () => {
    const res = await request(makeApp())
      .get("/portal/engines/health/history")
      .set("Authorization", `Bearer ${customerToken(undefined, "MSPOperator")}`);
    expect(res.status).toBe(400);
  });

  it("returns the session's own customerId and ignores a caller-supplied ?customerId= override", async () => {
    const res = await request(makeApp())
      .get("/portal/engines/health/history?customerId=999")
      .set("Authorization", `Bearer ${customerToken(5)}`);

    expect(res.status).toBe(200);
    expect(res.body.customerId).toBe(5);
    expect(res.body.engineKey).toBe("health");
    expect(res.body.series).toEqual(seriesFixture);
    expect(res.body.baselineEvents).toEqual(baselineFixture);
    expect(res.body.signalDeltas).toEqual(deltasFixture);

    // The malicious/irrelevant query param must never reach the data layer.
    expect(mockGetEngineHistoryMerged).toHaveBeenCalledWith(5, "health", undefined, undefined);
    expect(mockGetBaselineEvents).toHaveBeenCalledWith(5, "health");
    expect(mockGetSignalDeltasForRange).toHaveBeenCalledWith(5, "health", undefined, undefined);
  });

  it("forwards start/end query params as Dates", async () => {
    const res = await request(makeApp())
      .get("/portal/engines/drift/history?start=2026-01-01&end=2026-02-01")
      .set("Authorization", `Bearer ${customerToken(7)}`);

    expect(res.status).toBe(200);
    const [, , start, end] = mockGetEngineHistoryMerged.mock.calls[0];
    expect(start).toEqual(new Date("2026-01-01"));
    expect(end).toEqual(new Date("2026-02-01"));
  });
});
