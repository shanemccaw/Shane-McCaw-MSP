/**
 * msp-policy-decisions.test.ts — the MSP-side view + manual-clearance-resolve
 * routes over `policy_decisions` (Git #2671).
 *
 * What's worth failing a build over:
 *   1. `:customerId` is resolved and verified to belong to the CALLING MSP —
 *      a tenant that resolves but belongs to another MSP 404s, same as one
 *      that doesn't exist at all (no cross-MSP existence leak).
 *   2. GET returns every decision scoped to (mspId, tenantId) for that customer.
 *   3. MANUAL RESOLVE ONLY WORKS ON A 'manual' TRIGGER — a 'license_sku' row is
 *      the platform's own to resolve (advancePolicyClearances()); 409 otherwise.
 *   4. MANUAL RESOLVE IS ONE-SHOT — already-resolved 409s.
 *   5. ANOTHER TENANT'S DECISION IS A 404, matching the portal endpoint's own rule.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

let mockSelectResultsQueue: any[][] = [];
let mockUpdateSets: any[] = [];
let mockUpdateReturns: any[][] = [];

vi.mock("@workspace/db", () => {
  const makeSelectChain = () => {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      innerJoin: () => chain,
      then: (onfulfilled: any, onrejected?: any) =>
        Promise.resolve(mockSelectResultsQueue.shift() ?? []).then(onfulfilled, onrejected),
    };
    return chain;
  };

  const makeUpdateChain = () => {
    const chain: any = {
      set: (v: any) => {
        mockUpdateSets.push(v);
        return chain;
      },
      where: () => chain,
      returning: () => Promise.resolve(mockUpdateReturns.shift() ?? [{ id: 1 }]),
    };
    return chain;
  };

  const col = (name: string) => name;
  return {
    db: {
      select: vi.fn(() => makeSelectChain()),
      update: vi.fn(() => makeUpdateChain()),
    },
    policyDecisionsTable: {
      id: col("id"),
      mspId: col("msp_id"),
      tenantId: col("tenant_id"),
      obligationId: col("obligation_id"),
      clearanceResolvedAt: col("clearance_resolved_at"),
    },
    complianceObligationsTable: { id: col("id"), frameworkId: col("framework_id") },
    complianceFrameworksTable: { id: col("id"), authorityType: col("authority_type") },
  };
});

vi.mock("../middlewares/requireAuth", () => ({
  requireRole: () => (_req: any, _res: any, next: () => void) => next(),
  requireAuth: (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock("../lib/logger", () => {
  const child = vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child }));
  return { logger: { child, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

let mockMspId: number | null = 1;
vi.mock("../lib/resolve-msp-id", () => ({
  resolveMspIdStrict: (_req: any) => mockMspId,
}));

let mockScope: any = null;
vi.mock("../lib/portal-customer-scope", () => ({
  resolveTenantScope: async (_customerId: number) => mockScope,
}));

vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => ({ and: a }),
  eq: (l: unknown, r: unknown) => ({ eq: [l, r] }),
  desc: (c: unknown) => ({ desc: c }),
  isNull: (c: unknown) => ({ isNull: c }),
  inArray: (l: unknown, r: unknown) => ({ inArray: [l, r] }),
}));

import router from "./msp-policy-decisions";

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

const MSP_USER = { id: 9, mspId: 1, email: "operator@msp.test" };
const SCOPE = {
  customerId: 42,
  mspId: 1,
  tenantId: "0a361ab2-9e85-4bbf-8b75-c1ebf042dfba",
  tenantName: "Test Me",
  primaryDomain: "shanemccaw.onmicrosoft.com",
  businessUnit: null,
};

function bareDecisionRow(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    mspId: 1,
    tenantId: SCOPE.tenantId,
    title: "Guest access reviews deferred",
    obligation: "GDPR Art. 5(1)(e)",
    obligationId: null,
    pillar: null,
    owner: "Jordan Diaz",
    ownerId: null,
    reviewCadence: null,
    reviewState: null,
    reviewDueAt: null,
    clearanceCondition: "Entra P2 licences land",
    clearanceTriggerType: "manual",
    clearanceTriggerSkuPartNumber: null,
    clearanceResolvedAt: null,
    clearanceResolvedNote: null,
    decisionState: "live",
    compensatingControl: "Conditional Access restricts guest sign-in to approved domains.",
    signedBy: "Jordan Diaz",
    signedAt: new Date("2026-08-31T00:00:00Z"),
    statement: "I confirm this decision.",
    ipAddress: null,
    signatureHash: "abc123",
    createdAt: new Date("2026-08-31T00:00:00Z"),
    updatedAt: new Date("2026-08-31T00:00:00Z"),
    ...over,
  };
}

beforeEach(() => {
  mockSelectResultsQueue = [];
  mockUpdateSets = [];
  mockUpdateReturns = [];
  mockMspId = 1;
  mockScope = SCOPE;
});

describe("GET /msp/policy-decisions/:customerId", () => {
  it("403s with no MSP context", async () => {
    mockMspId = null;
    const res = await request(makeApp(MSP_USER)).get("/api/msp/policy-decisions/42");
    expect(res.status).toBe(403);
  });

  it("400s a non-numeric customerId", async () => {
    const res = await request(makeApp(MSP_USER)).get("/api/msp/policy-decisions/not-a-number");
    expect(res.status).toBe(400);
  });

  it("404s when the tenant does not resolve", async () => {
    mockScope = null;
    const res = await request(makeApp(MSP_USER)).get("/api/msp/policy-decisions/42");
    expect(res.status).toBe(404);
  });

  it("404s a customer that belongs to another MSP, without leaking existence", async () => {
    mockScope = { ...SCOPE, mspId: 2 };
    const res = await request(makeApp(MSP_USER)).get("/api/msp/policy-decisions/42");
    expect(res.status).toBe(404);
  });

  it("lists this customer's decisions, scoped to (mspId, tenantId)", async () => {
    mockSelectResultsQueue = [[bareDecisionRow()], []];
    const res = await request(makeApp(MSP_USER)).get("/api/msp/policy-decisions/42");
    expect(res.status).toBe(200);
    expect(res.body.customerId).toBe(42);
    expect(res.body.decisions).toHaveLength(1);
    expect(res.body.decisions[0].clearanceCondition).toBe("Entra P2 licences land");
    expect(res.body.decisions[0].isCleared).toBe(false);
  });
});

describe("PATCH /msp/policy-decisions/:customerId/:id/clearance/resolve", () => {
  it("404s a customer belonging to another MSP before ever reading the decision", async () => {
    mockScope = { ...SCOPE, mspId: 2 };
    const res = await request(makeApp(MSP_USER))
      .patch("/api/msp/policy-decisions/42/1/clearance/resolve")
      .send({ note: "Confirmed by phone with the vendor." });
    expect(res.status).toBe(404);
  });

  it("404s a decision belonging to another tenant", async () => {
    mockSelectResultsQueue = [[]];
    const res = await request(makeApp(MSP_USER))
      .patch("/api/msp/policy-decisions/42/1/clearance/resolve")
      .send({ note: "Confirmed by phone with the vendor." });
    expect(res.status).toBe(404);
  });

  it("409s a decision with no clearance condition at all", async () => {
    mockSelectResultsQueue = [[bareDecisionRow({ clearanceCondition: null, clearanceTriggerType: null })]];
    const res = await request(makeApp(MSP_USER))
      .patch("/api/msp/policy-decisions/42/1/clearance/resolve")
      .send({ note: "Confirmed by phone." });
    expect(res.status).toBe(409);
  });

  it("409s a 'license_sku' trigger — the platform resolves that one, not a human", async () => {
    mockSelectResultsQueue = [[bareDecisionRow({ clearanceTriggerType: "license_sku", clearanceTriggerSkuPartNumber: "AAD_PREMIUM_P2" })]];
    const res = await request(makeApp(MSP_USER))
      .patch("/api/msp/policy-decisions/42/1/clearance/resolve")
      .send({ note: "I checked and it's there." });
    expect(res.status).toBe(409);
  });

  it("409s an already-resolved decision", async () => {
    mockSelectResultsQueue = [[bareDecisionRow({ clearanceResolvedAt: new Date("2026-08-30T00:00:00Z") })]];
    const res = await request(makeApp(MSP_USER))
      .patch("/api/msp/policy-decisions/42/1/clearance/resolve")
      .send({ note: "Confirmed." });
    expect(res.status).toBe(409);
  });

  it("resolves a 'manual' trigger and records the note", async () => {
    mockSelectResultsQueue = [[bareDecisionRow()]];
    mockUpdateReturns = [[bareDecisionRow({ clearanceResolvedAt: new Date("2026-08-31T12:00:00Z"), clearanceResolvedNote: "Confirmed by phone with the vendor." })]];
    const res = await request(makeApp(MSP_USER))
      .patch("/api/msp/policy-decisions/42/1/clearance/resolve")
      .send({ note: "Confirmed by phone with the vendor." });
    expect(res.status).toBe(200);
    expect(res.body.decision.isCleared).toBe(true);
    expect(res.body.decision.clearanceResolvedNote).toBe("Confirmed by phone with the vendor.");
  });

  it("rejects an empty note", async () => {
    mockSelectResultsQueue = [[bareDecisionRow()]];
    const res = await request(makeApp(MSP_USER))
      .patch("/api/msp/policy-decisions/42/1/clearance/resolve")
      .send({ note: "" });
    expect(res.status).toBe(400);
  });
});
