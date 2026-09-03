/**
 * msp-remediation-tracker.test.ts — Git #2670, Feature #1684 (Remediation
 * Tracking, MSP Console).
 *
 * The write rules themselves (completed_at derivation, verification reset,
 * the s1-s30 catalogue, `accepted_risk` rejection) are already proven by
 * `portal-remediation-tracker.test.ts` — this file is byte-identical logic,
 * so re-proving those here would be a second copy of the same test, not new
 * coverage. What IS new and worth guarding here is the one thing that
 * actually differs from the customer-facing route: **who is allowed to act
 * on which customer.**
 *
 *   1. A customer outside the caller's MSP book 404s (never a distinguishable
 *      error that discloses whether the customer even exists) — the exact
 *      "don't disclose existence" convention msp-diagnostics.ts and
 *      msp-active-directory.ts already established for every single-customer
 *      `/api/msp/*` route.
 *   2. A malformed :customerId 400s before any DB call.
 *   3. Once ownership clears, the GET/PUT/verify handlers behave exactly like
 *      the customer-facing route (same wire shape, same rejection of a
 *      direct `accepted_risk` write).
 *
 * Run: pnpm --filter @workspace/api-server run test -- msp-remediation-tracker
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

let mockInsertValues: any[] = [];
let mockConflictSets: any[] = [];
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

  const insertChain: any = {
    values: (v: any) => {
      mockInsertValues.push(v);
      return insertChain;
    },
    onConflictDoUpdate: (cfg: { target: unknown; set: Record<string, unknown> }) => {
      mockConflictSets.push(cfg.set);
      return insertChain;
    },
    then: (onfulfilled: any) => Promise.resolve({}).then(onfulfilled),
  };

  return {
    db: {
      select: vi.fn(() => makeSelectChain()),
      insert: vi.fn(() => insertChain),
    },
    remediationTrackerStepsTable: {
      customerId: "customer_id",
      stepId: "step_id",
      status: "status",
      completedAt: "completed_at",
      updatedByUserId: "updated_by_user_id",
      verificationState: "verification_state",
      verifiedAt: "verified_at",
      verifiedByRunId: "verified_by_run_id",
      updatedAt: "updated_at",
    },
    tenantsTable: { id: "id", tenantId: "tenant_id" },
    REMEDIATION_TRACKER_STEP_STATUS: [
      "not_started",
      "completed",
      "already_handled",
      "not_applicable",
      "deferred",
      "shane_handles",
      "accepted_risk",
    ] as const,
  };
});

const mockEmitWorkflowEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/workflow-executor", () => ({
  emitWorkflowEvent: (...args: unknown[]) => mockEmitWorkflowEvent(...args),
}));

vi.mock("../lib/remediation-knowledge-base", () => ({
  fetchPublishedKnowledgeBaseRows: () => Promise.resolve(new Map()),
}));

const mockLogRetainerWorkFromTracker = vi.fn().mockResolvedValue(true);
vi.mock("../lib/retainer-work-logger", () => ({
  logRetainerWorkFromTracker: (...args: unknown[]) => mockLogRetainerWorkFromTracker(...args),
}));

vi.mock("../lib/logger", () => {
  const child = vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child }));
  return { logger: { child, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

// The one thing this file actually exists to prove: ownership gating. Every
// other route in this repo's `/api/msp/*` single-customer family resolves
// this the same way, so it is mocked at its own boundary — assertCustomerAccess
// itself (and its DB-backed ownership rule) has its own coverage elsewhere.
const mockAssertCustomerAccess = vi.fn();
vi.mock("../middlewares/requireAuth", () => ({
  requireRole: () => (req: any, _res: any, next: () => void) => {
    req.user = req.user ?? { id: 1, email: "staff@test.com", role: "client", mspRole: "MSPOperator", mspId: 9 };
    next();
  },
  assertCustomerAccess: (...args: unknown[]) => mockAssertCustomerAccess(...args),
}));

import router from "./msp-remediation-tracker";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return app;
}

beforeEach(() => {
  mockInsertValues = [];
  mockConflictSets = [];
  mockSelectResultsQueue = [];
  mockAssertCustomerAccess.mockReset();
  mockEmitWorkflowEvent.mockClear();
  mockLogRetainerWorkFromTracker.mockClear();
});

describe("GET /msp/customers/:customerId/remediation-tracker", () => {
  it("404s a customer outside the caller's book, never disclosing existence", async () => {
    mockAssertCustomerAccess.mockResolvedValue(false);
    const res = await request(buildApp()).get("/api/msp/customers/999/remediation-tracker");
    expect(res.status).toBe(404);
    expect(mockAssertCustomerAccess).toHaveBeenCalledWith(expect.anything(), 999);
  });

  it("400s a malformed customerId before any ownership check", async () => {
    const res = await request(buildApp()).get("/api/msp/customers/not-a-number/remediation-tracker");
    expect(res.status).toBe(400);
    expect(mockAssertCustomerAccess).not.toHaveBeenCalled();
  });

  it("returns the customer's stored steps once ownership clears", async () => {
    mockAssertCustomerAccess.mockResolvedValue(true);
    mockSelectResultsQueue.push([
      {
        stepId: "s1",
        status: "completed",
        completedAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
        verificationState: "unverified",
        verifiedAt: null,
      },
    ]);
    const res = await request(buildApp()).get("/api/msp/customers/42/remediation-tracker");
    expect(res.status).toBe(200);
    expect(res.body.steps).toHaveLength(1);
    expect(res.body.steps[0]).toMatchObject({ stepId: "s1", status: "completed", terminalState: "outstanding" });
  });
});

describe("PUT /msp/customers/:customerId/remediation-tracker/steps/:stepId", () => {
  it("404s a customer outside the caller's book", async () => {
    mockAssertCustomerAccess.mockResolvedValue(false);
    const res = await request(buildApp())
      .put("/api/msp/customers/999/remediation-tracker/steps/s1")
      .send({ status: "completed" });
    expect(res.status).toBe(404);
  });

  it("rejects a direct accepted_risk write — that is only ever the customer's own signed decline", async () => {
    mockAssertCustomerAccess.mockResolvedValue(true);
    const res = await request(buildApp())
      .put("/api/msp/customers/42/remediation-tracker/steps/s1")
      .send({ status: "accepted_risk" });
    expect(res.status).toBe(400);
    expect(mockInsertValues).toHaveLength(0);
  });

  it("400s an unknown stepId", async () => {
    mockAssertCustomerAccess.mockResolvedValue(true);
    const res = await request(buildApp())
      .put("/api/msp/customers/42/remediation-tracker/steps/s999")
      .send({ status: "completed" });
    expect(res.status).toBe(400);
  });

  it("upserts the step and logs retainer work for the MSP actor completing it", async () => {
    mockAssertCustomerAccess.mockResolvedValue(true);
    mockSelectResultsQueue.push([
      {
        id: 7,
        stepId: "s1",
        status: "completed",
        completedAt: new Date(),
        updatedAt: new Date(),
        verificationState: "unverified",
        verifiedAt: null,
      },
    ]);
    const res = await request(buildApp())
      .put("/api/msp/customers/42/remediation-tracker/steps/s1")
      .send({ status: "completed" });
    expect(res.status).toBe(200);
    expect(res.body.step.status).toBe("completed");
    expect(mockConflictSets[0]).toMatchObject({ status: "completed", verificationState: "unverified" });
    expect(mockLogRetainerWorkFromTracker).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 42, mspId: 9, source: "remediation_tracker" }),
    );
  });
});

describe("POST /msp/customers/:customerId/remediation-tracker/steps/:stepId/verify", () => {
  it("404s a customer outside the caller's book", async () => {
    mockAssertCustomerAccess.mockResolvedValue(false);
    const res = await request(buildApp()).post("/api/msp/customers/999/remediation-tracker/steps/s1/verify");
    expect(res.status).toBe(404);
  });

  it("400s when the step has no claim on it yet", async () => {
    mockAssertCustomerAccess.mockResolvedValue(true);
    mockSelectResultsQueue.push([{ status: "not_started" }]);
    const res = await request(buildApp()).post("/api/msp/customers/42/remediation-tracker/steps/s1/verify");
    expect(res.status).toBe(400);
    expect(mockEmitWorkflowEvent).not.toHaveBeenCalled();
  });

  it("fires the pointed re-scan workflow event once a claim and a tenant both exist", async () => {
    mockAssertCustomerAccess.mockResolvedValue(true);
    mockSelectResultsQueue.push([{ status: "completed" }]); // step claim
    mockSelectResultsQueue.push([{ tenantId: "contoso.onmicrosoft.com" }]); // tenant lookup
    const res = await request(buildApp()).post("/api/msp/customers/42/remediation-tracker/steps/s1/verify");
    expect(res.status).toBe(202);
    expect(mockEmitWorkflowEvent).toHaveBeenCalledWith("remediation.verify_requested", { customerId: 42, stepId: "s1" });
  });
});
