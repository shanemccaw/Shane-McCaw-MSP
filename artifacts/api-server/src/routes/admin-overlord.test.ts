/**
 * admin-overlord.test.ts
 *
 * Unit tests for:
 *   GET /api/admin/overlord — PlatformAdmin-only overlord total + colony scores
 *
 * Run with: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

process.env["DATABASE_URL"] = "postgres://test";

const ADMIN_PASS = "test-admin-pass";

const createChain = (resolveValue: any) => {
  const chain: any = {
    from: vi.fn().mockImplementation(() => chain),
    innerJoin: vi.fn().mockImplementation(() => chain),
    where: vi.fn().mockImplementation(() => chain),
    limit: vi.fn().mockImplementation(() => chain),
    then: (resolve: any) => resolve(resolveValue),
  };
  return chain;
};

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnValue(createChain([])),
  },
  mspsTable: { id: "id", name: "name" },
  mspSubscriptionsTable: {},
  servicesTable: {},
}));

vi.mock("../middlewares/requireAuth", () => ({
  requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const auth = req.headers["authorization"] ?? "";
    if (auth === `Bearer ${ADMIN_PASS}`) return next();
    res.status(403).json({ error: "Admin access required" });
  },
}));

vi.mock("../lib/logger", () => ({
  logger: { child: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

const { mockAggregatePlatformMonitoringMrr, mockCalculateColonyCompositeScore } = vi.hoisted(() => ({
  mockAggregatePlatformMonitoringMrr: vi.fn(),
  mockCalculateColonyCompositeScore: vi.fn(),
}));

vi.mock("../lib/msp-financial-aggregator.ts", () => ({
  aggregatePlatformMonitoringMrr: mockAggregatePlatformMonitoringMrr,
  calculateColonyCompositeScore: mockCalculateColonyCompositeScore,
}));

let app: Express;

beforeEach(async () => {
  vi.clearAllMocks();
  mockAggregatePlatformMonitoringMrr.mockResolvedValue({
    grossRevenueUsd: "1000.00",
    wholesaleCostUsd: "700.00",
    mspMarginUsd: "300.00",
    mspMarginPct: "30.0%",
  });
  mockCalculateColonyCompositeScore.mockResolvedValue({
    score: 500,
    momentumBonusApplied: false,
    currentMonthRevenueUsd: 100,
    trailingThreeMonthAvgRevenueUsd: 200,
  });

  app = express();
  app.use(express.json());
  const { default: adminOverlordRouter } = await import("./admin-overlord");
  app.use(adminOverlordRouter);
});

const authHeader = { Authorization: `Bearer ${ADMIN_PASS}` };

describe("GET /api/admin/overlord", () => {
  it("rejects non-admin requests with 403", async () => {
    const res = await request(app).get("/admin/overlord");
    expect(res.status).toBe(403);
  });

  it("rejects requests with a non-admin bearer token", async () => {
    const res = await request(app).get("/admin/overlord").set({ Authorization: "Bearer not-an-admin" });
    expect(res.status).toBe(403);
  });

  it("returns overlordTotal and an empty colonies array when no MSPs exist", async () => {
    const res = await request(app).get("/admin/overlord").set(authHeader);
    expect(res.status).toBe(200);
    expect(res.body.overlordTotal).toEqual({
      grossRevenueUsd: "1000.00",
      wholesaleCostUsd: "700.00",
      mspMarginUsd: "300.00",
      mspMarginPct: "30.0%",
    });
    expect(res.body.colonies).toEqual([]);
  });
});
