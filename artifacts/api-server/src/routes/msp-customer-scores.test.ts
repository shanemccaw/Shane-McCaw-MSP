/**
 * msp-customer-scores.test.ts — Git #3558, Feature #3557.
 *
 * Unit tests for GET /api/msp/customers/:customerId/scores — the MSP-side
 * mirror of /portal/dashboard's composite/pillar scoring.
 *
 * Covers:
 *   - 400 on a malformed :customerId before any ownership check
 *   - 404 for a customer outside the caller's MSP book, never disclosing
 *     existence (assertCustomerAccess is the chokepoint, mocked at its own
 *     boundary the same way msp-remediation-tracker.test.ts does)
 *   - once ownership clears: real composite score, per-engine scores, and
 *     pillar findings/recommendations are returned UNREDACTED — proving the
 *     #164 customer-side paywall gate is deliberately not applied here
 *   - real priority items (critical/warning findings from the latest run)
 *     come back with title/description populated, not redacted
 *
 * Run: pnpm --filter @workspace/api-server run test -- msp-customer-scores
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
      orderBy: () => chain,
      limit: () => chain,
      then: (onfulfilled: any, onrejected?: any) =>
        Promise.resolve(mockSelectResultsQueue.shift() ?? []).then(onfulfilled, onrejected),
    };
    return chain;
  };

  return {
    db: {
      select: vi.fn(() => makeSelectChain()),
    },
    tenantsTable: { id: "id", status: "status", customerName: "customer_name" },
    tenantEngineSnapshotsTable: {
      customerId: "customer_id",
      engineKey: "engine_key",
      score: "score",
      breakdown: "breakdown",
      runId: "run_id",
      capturedAt: "captured_at",
    },
    mspDiagnosticFindingsTable: {
      customerId: "customer_id",
      runId: "run_id",
      checkKey: "check_key",
      severity: "severity",
      title: "title",
      description: "description",
      createdAt: "created_at",
    },
  };
});

vi.mock("../lib/logger.ts", () => {
  const child = vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child }));
  return { logger: { child, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

// The one thing this file exists to prove beyond the scoring math itself is
// ownership gating — mocked at its own boundary the same way every other
// /api/msp/customers/:customerId/* test in this repo does (assertCustomerAccess
// has its own DB-backed coverage elsewhere).
const mockAssertCustomerAccess = vi.fn();
vi.mock("../middlewares/requireAuth.ts", () => ({
  requireCapability: () => (req: any, _res: any, next: () => void) => {
    req.user = req.user ?? { id: 1, email: "staff@test.com", role: "client", mspRole: "MSPOperator", mspId: 9 };
    next();
  },
  assertCustomerAccess: (...args: unknown[]) => mockAssertCustomerAccess(...args),
}));

import router from "./msp-customer-scores.ts";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return app;
}

beforeEach(() => {
  mockSelectResultsQueue = [];
  mockAssertCustomerAccess.mockReset();
});

describe("GET /msp/customers/:customerId/scores", () => {
  it("400s a malformed customerId before any ownership check", async () => {
    const res = await request(buildApp()).get("/api/msp/customers/not-a-number/scores");
    expect(res.status).toBe(400);
    expect(mockAssertCustomerAccess).not.toHaveBeenCalled();
  });

  it("404s a customer outside the caller's book, never disclosing existence", async () => {
    mockAssertCustomerAccess.mockResolvedValue(false);
    const res = await request(buildApp()).get("/api/msp/customers/999/scores");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Customer not found" });
    expect(mockAssertCustomerAccess).toHaveBeenCalledWith(expect.anything(), 999);
  });

  it("returns the real composite score, per-engine scores, and UNREDACTED pillar findings/recommendations once ownership clears", async () => {
    mockAssertCustomerAccess.mockResolvedValue(true);

    // 1) tenant_engine_snapshots select
    mockSelectResultsQueue.push([
      {
        engineKey: "security",
        score: 72,
        breakdown: [{ finding: "MFA not enforced for 3 admins", recommendation: "Enforce MFA org-wide" }],
        runId: "run-abc",
        capturedAt: new Date("2026-09-01T00:00:00Z"),
      },
      {
        engineKey: "health",
        score: 88,
        breakdown: [],
        runId: "run-abc",
        capturedAt: new Date("2026-09-01T00:00:00Z"),
      },
    ]);
    // 2) latest findings run lookup
    mockSelectResultsQueue.push([{ runId: "run-abc" }]);
    // 3) finding rows for that run
    mockSelectResultsQueue.push([
      {
        checkKey: "mfa-coverage",
        severity: "critical",
        title: "MFA not enforced for 3 admins",
        description: "3 admin accounts can sign in without MFA.",
        createdAt: new Date("2026-09-01T00:00:00Z"),
      },
    ]);
    // 4) tenant row (name/status)
    mockSelectResultsQueue.push([{ status: "active", customerName: "Acme Corp" }]);

    const res = await request(buildApp()).get("/api/msp/customers/42/scores");

    expect(res.status).toBe(200);
    expect(res.body.customerId).toBe(42);
    expect(res.body.customerName).toBe("Acme Corp");
    expect(res.body.telemetryStatus).toBe("completed");
    expect(res.body.scores.security).toBe(72);
    expect(res.body.scores.health).toBe(88);
    expect(res.body.results.summary.compositeScore).toBe(80); // (72 + 88) / 2

    // The load-bearing assertion: NOT redacted to counts, unlike the
    // customer-facing /portal/dashboard route this mirrors.
    expect(res.body.results.pillars.security).toEqual({
      score: 72,
      status: "complete",
      findings: ["MFA not enforced for 3 admins"],
      recommendations: ["Enforce MFA org-wide"],
    });

    expect(res.body.results.summary.priorityItems).toEqual([
      {
        checkKey: "mfa-coverage",
        severity: "critical",
        title: "MFA not enforced for 3 admins",
        description: "3 admin accounts can sign in without MFA.",
      },
    ]);
  });

  it("returns an honest zero-composite payload for a customer with no snapshots yet", async () => {
    mockAssertCustomerAccess.mockResolvedValue(true);
    mockSelectResultsQueue.push([]); // no snapshots
    mockSelectResultsQueue.push([]); // no findings run
    mockSelectResultsQueue.push([{ status: "onboarding", customerName: "New Co" }]); // tenant row

    const res = await request(buildApp()).get("/api/msp/customers/7/scores");

    expect(res.status).toBe(200);
    expect(res.body.telemetryStatus).toBe("in_progress");
    expect(res.body.results.status).toBe("running");
    expect(res.body.results.summary.compositeScore).toBeNull();
    expect(res.body.results.summary.priorityItems).toEqual([]);
  });
});
