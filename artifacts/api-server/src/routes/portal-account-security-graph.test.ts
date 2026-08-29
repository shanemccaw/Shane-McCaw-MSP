/**
 * portal-account-security-graph.test.ts — Git #1593.
 *
 * Mirrors portal-tenant-check-items.test.ts's pattern: the tenantId resolution
 * is scoped to the caller's own customerId (never accepted from the request),
 * and a customer with no resolvable tenant gets an honest all-unavailable
 * response rather than a 500.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

let mockSelectResultsQueue: any[][] = [];

vi.mock("@workspace/db", () => {
  const makeSelectChain = () => {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      limit: () => chain,
      then: (onfulfilled: any, onrejected?: any) =>
        Promise.resolve(mockSelectResultsQueue.shift() ?? []).then(onfulfilled, onrejected),
    };
    return chain;
  };
  return {
    db: { select: vi.fn(() => makeSelectChain()) },
    tenantsTable: { id: "id", tenantId: "tenant_id" },
  };
});

vi.mock("../middlewares/requireAuth", () => ({
  requireRole: () => (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock("../lib/logger", () => {
  const child = vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child }));
  return { logger: { child, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

const mockGetPasswordAgeSignal = vi.fn();
const mockGetFailedSignInsSignal = vi.fn();
const mockGetDeviceComplianceSignal = vi.fn();
const mockGetLocalFailedLoginSignal = vi.fn();
vi.mock("../lib/account-security-graph", () => ({
  getPasswordAgeSignal: (tenantId: string) => mockGetPasswordAgeSignal(tenantId),
  getFailedSignInsSignal: (tenantId: string) => mockGetFailedSignInsSignal(tenantId),
  getDeviceComplianceSignal: (tenantId: string) => mockGetDeviceComplianceSignal(tenantId),
  getLocalFailedLoginSignal: (userId: number) => mockGetLocalFailedLoginSignal(userId),
}));

import router from "./portal-account-security-graph";

function makeApp(user: Record<string, unknown> | null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (user) (req as any).user = user;
    next();
  });
  app.use("/api", router);
  return app;
}

const CUSTOMER = { id: 7, customerId: 42, role: "client" };

beforeEach(() => {
  mockSelectResultsQueue = [];
  mockGetPasswordAgeSignal.mockReset();
  mockGetFailedSignInsSignal.mockReset();
  mockGetDeviceComplianceSignal.mockReset();
  mockGetLocalFailedLoginSignal.mockReset();
  mockGetLocalFailedLoginSignal.mockResolvedValue({ available: true, failedAttempts: 0, lastFailedLoginAt: null, lockedUntil: null });
});

describe("GET /api/portal/account-security/graph-signals", () => {
  it("rejects a request with no customerId on the token", async () => {
    const app = makeApp({ id: 1, role: "client" });
    const res = await request(app).get("/api/portal/account-security/graph-signals");
    expect(res.status).toBe(403);
  });

  it("returns an honest all-unavailable response when the caller has no resolvable tenant, never a 500 — but still returns the local (non-Graph) failed-login signal", async () => {
    mockSelectResultsQueue.push([]); // tenants lookup finds nothing
    mockGetLocalFailedLoginSignal.mockResolvedValue({ available: true, failedAttempts: 1, lastFailedLoginAt: null, lockedUntil: null });
    const app = makeApp(CUSTOMER);
    const res = await request(app).get("/api/portal/account-security/graph-signals");
    expect(res.status).toBe(200);
    expect(res.body.passwordAge).toEqual({ available: false, reason: "error", detail: "No Microsoft 365 tenant is linked to this account." });
    expect(res.body.failedSignIns.available).toBe(false);
    expect(res.body.deviceCompliance.available).toBe(false);
    expect(res.body.localFailedLogins).toEqual({ available: true, failedAttempts: 1, lastFailedLoginAt: null, lockedUntil: null });
    expect(mockGetPasswordAgeSignal).not.toHaveBeenCalled();
    expect(mockGetLocalFailedLoginSignal).toHaveBeenCalledWith(7);
  });

  it("resolves the caller's own tenantId (never one from the request) and returns all four real signals", async () => {
    mockSelectResultsQueue.push([{ tenantId: "m365-tenant-guid" }]);
    mockGetPasswordAgeSignal.mockResolvedValue({ available: true, staleThresholdDays: 90, totalUsers: 24, staleCount: 18, oldestChangeAt: "2014-04-03T04:03:29Z" });
    mockGetFailedSignInsSignal.mockResolvedValue({ available: false, reason: "entra_premium_required", detail: "..." });
    mockGetDeviceComplianceSignal.mockResolvedValue({ available: false, reason: "no_intune_license", detail: "..." });
    mockGetLocalFailedLoginSignal.mockResolvedValue({ available: true, failedAttempts: 0, lastFailedLoginAt: null, lockedUntil: null });

    const app = makeApp(CUSTOMER);
    const res = await request(app).get("/api/portal/account-security/graph-signals");

    expect(res.status).toBe(200);
    expect(res.body.passwordAge).toEqual({ available: true, staleThresholdDays: 90, totalUsers: 24, staleCount: 18, oldestChangeAt: "2014-04-03T04:03:29Z" });
    expect(res.body.failedSignIns.reason).toBe("entra_premium_required");
    expect(res.body.deviceCompliance.reason).toBe("no_intune_license");
    expect(res.body.localFailedLogins).toEqual({ available: true, failedAttempts: 0, lastFailedLoginAt: null, lockedUntil: null });
    expect(mockGetPasswordAgeSignal).toHaveBeenCalledWith("m365-tenant-guid");
    expect(mockGetFailedSignInsSignal).toHaveBeenCalledWith("m365-tenant-guid");
    expect(mockGetDeviceComplianceSignal).toHaveBeenCalledWith("m365-tenant-guid");
    expect(mockGetLocalFailedLoginSignal).toHaveBeenCalledWith(7);
  });
});
