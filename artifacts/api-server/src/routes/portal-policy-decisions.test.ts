/**
 * portal-policy-decisions.test.ts — the create path's XOR validation and the
 * manual mark-resolved endpoint for #1526's dependency-based clearance, the
 * third clock alongside the date-based review cycle.
 *
 * What's worth failing a build over:
 *   1. EXACTLY ONE OF reviewCadence / clearanceCondition. Neither and both are
 *      both rejected — matching the DB's own
 *      `policy_decisions_review_xor_clearance_chk` CHECK, so the API can never
 *      produce a row the database would refuse.
 *   2. A dependency-based create requires clearanceTriggerType, and
 *      clearanceTriggerSkuPartNumber is required for 'license_sku' and
 *      forbidden for 'manual'.
 *   3. MANUAL RESOLVE ONLY WORKS ON A 'manual' TRIGGER. A 'license_sku' row is
 *      the platform's own to resolve (advancePolicyClearances()); a human
 *      cannot short-circuit it here — 409.
 *   4. MANUAL RESOLVE IS ONE-SHOT. Already-resolved 409s, matching the
 *      accept-flow's guarded-UPDATE pattern.
 *   5. ANOTHER TENANT'S DECISION IS A 404, matching portal-risk-register.ts's
 *      accept endpoint.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

let mockSelectResultsQueue: any[][] = [];
let mockInsertReturns: any[][] = [];
let mockInsertValues: any[] = [];
let mockUpdateSets: any[] = [];
let mockUpdateReturns: any[][] = [];

vi.mock("@workspace/db", () => {
  const makeSelectChain = () => {
    const chain: any = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (onfulfilled: any, onrejected?: any) =>
        Promise.resolve(mockSelectResultsQueue.shift() ?? []).then(onfulfilled, onrejected),
    };
    return chain;
  };

  const makeInsertChain = () => {
    const chain: any = {
      values: (v: any) => {
        mockInsertValues.push(v);
        return chain;
      },
      returning: () => Promise.resolve(mockInsertReturns.shift() ?? [{ id: 1 }]),
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
      insert: vi.fn(() => makeInsertChain()),
      update: vi.fn(() => makeUpdateChain()),
    },
    policyDecisionsTable: {
      id: col("id"),
      mspId: col("msp_id"),
      tenantId: col("tenant_id"),
      clearanceResolvedAt: col("clearance_resolved_at"),
    },
    // #1525 — loadObligationTypes()'s cited-authority join. This mock predates
    // that addition and was never extended.
    complianceObligationsTable: {
      id: col("id"),
      frameworkId: col("framework_id"),
    },
    complianceFrameworksTable: {
      id: col("id"),
      authorityType: col("authority_type"),
    },
    CLEARANCE_TRIGGER_TYPES: ["license_sku", "manual"] as const,
    REVIEW_CADENCES: ["Monthly", "Quarterly", "Semi-Annual", "Annual", "Biennial"] as const,
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

let mockScope: any = null;
vi.mock("../lib/portal-customer-scope", () => ({
  resolveCustomerId: (req: any) => req.user?.customerId ?? null,
  resolveTenantScope: async () => mockScope,
}));

vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => ({ and: a }),
  eq: (l: unknown, r: unknown) => ({ eq: [l, r] }),
  desc: (c: unknown) => ({ desc: c }),
  isNull: (c: unknown) => ({ isNull: c }),
  // #1525 added loadObligationTypes()'s inArray() lookup (cited-authority
  // resolution) and an `or` import alongside it — this mock predates that
  // and was never extended.
  inArray: (c: unknown, v: unknown) => ({ inArray: [c, v] }),
  or: (...a: unknown[]) => ({ or: a }),
}));

import router from "./portal-policy-decisions";

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

const CUSTOMER = { id: 7, customerId: 42 };
const SCOPE = {
  customerId: 42,
  mspId: 1,
  tenantId: "0a361ab2-9e85-4bbf-8b75-c1ebf042dfba",
  tenantName: "Test Me",
  primaryDomain: "shanemccaw.onmicrosoft.com",
};

const CREATE_BASE = {
  title: "Guest access reviews deferred",
  obligation: "GDPR Art. 5(1)(e)",
  owner: "Jordan Diaz",
  compensatingControl: "Conditional Access restricts guest sign-in to approved domains.",
  signerName: "Jordan Diaz",
  confirmed: true as const,
  statement: "I confirm this decision.",
};

function bareDecisionRow(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    mspId: 1,
    tenantId: SCOPE.tenantId,
    title: CREATE_BASE.title,
    obligation: CREATE_BASE.obligation,
    pillar: null,
    owner: CREATE_BASE.owner,
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
    compensatingControl: CREATE_BASE.compensatingControl,
    signedBy: CREATE_BASE.signerName,
    signedAt: new Date("2026-08-31T00:00:00Z"),
    statement: CREATE_BASE.statement,
    ipAddress: null,
    signatureHash: "abc123",
    createdAt: new Date("2026-08-31T00:00:00Z"),
    updatedAt: new Date("2026-08-31T00:00:00Z"),
    ...over,
  };
}

beforeEach(() => {
  mockSelectResultsQueue = [];
  mockInsertReturns = [];
  mockInsertValues = [];
  mockUpdateSets = [];
  mockUpdateReturns = [];
  mockScope = SCOPE;
});

describe("POST /portal/policy-register — reviewCadence XOR clearanceCondition", () => {
  it("rejects a request with neither reviewCadence nor clearanceCondition", async () => {
    const res = await request(makeApp(CUSTOMER)).post("/api/portal/policy-register").send(CREATE_BASE);
    expect(res.status).toBe(400);
  });

  it("rejects a request with BOTH reviewCadence and clearanceCondition", async () => {
    const res = await request(makeApp(CUSTOMER))
      .post("/api/portal/policy-register")
      .send({ ...CREATE_BASE, reviewCadence: "Quarterly", clearanceCondition: "Entra P2 licences land", clearanceTriggerType: "manual" });
    expect(res.status).toBe(400);
  });

  it("accepts a date-based decision (reviewCadence alone)", async () => {
    mockInsertReturns = [[bareDecisionRow({ reviewCadence: "Quarterly", reviewState: "on_track", reviewDueAt: new Date("2026-11-30T00:00:00Z"), clearanceCondition: null, clearanceTriggerType: null })]];
    const res = await request(makeApp(CUSTOMER))
      .post("/api/portal/policy-register")
      .send({ ...CREATE_BASE, reviewCadence: "Quarterly" });
    expect(res.status).toBe(201);
    expect(res.body.decision.reviewCadence).toBe("Quarterly");
    expect(res.body.decision.clearanceCondition).toBeNull();
  });

  it("rejects a reviewCadence outside the fixed enum (#2518)", async () => {
    const res = await request(makeApp(CUSTOMER))
      .post("/api/portal/policy-register")
      .send({ ...CREATE_BASE, reviewCadence: "Weekly" });
    expect(res.status).toBe(400);
  });

  it("computes reviewDueAt from reviewCadence + createdAt anchor (#2518)", async () => {
    mockInsertReturns = [[bareDecisionRow({ reviewCadence: "Monthly", reviewState: "on_track", clearanceCondition: null, clearanceTriggerType: null })]];
    const res = await request(makeApp(CUSTOMER))
      .post("/api/portal/policy-register")
      .send({ ...CREATE_BASE, reviewCadence: "Monthly" });
    expect(res.status).toBe(201);
    // Assert the insert was actually called with a computed reviewDueAt
    // exactly one month after the createdAt anchor it used, not just that
    // the (mocked) response echoes something back.
    const inserted = mockInsertValues[0];
    expect(inserted.reviewDueAt).toBeInstanceOf(Date);
    expect(inserted.createdAt).toBeInstanceOf(Date);
    const expectedMonth = (inserted.createdAt.getUTCMonth() + 1) % 12;
    expect(inserted.reviewDueAt.getUTCMonth()).toBe(expectedMonth);
  });

  it("leaves reviewDueAt null for a dependency-based decision (#2518)", async () => {
    mockInsertReturns = [[bareDecisionRow()]];
    await request(makeApp(CUSTOMER))
      .post("/api/portal/policy-register")
      .send({ ...CREATE_BASE, clearanceCondition: "Entra P2 licences land", clearanceTriggerType: "manual" });
    expect(mockInsertValues[0].reviewDueAt).toBeNull();
  });

  it("requires clearanceTriggerType when clearanceCondition is set", async () => {
    const res = await request(makeApp(CUSTOMER))
      .post("/api/portal/policy-register")
      .send({ ...CREATE_BASE, clearanceCondition: "Entra P2 licences land" });
    expect(res.status).toBe(400);
  });

  it("requires clearanceTriggerSkuPartNumber when clearanceTriggerType is 'license_sku'", async () => {
    const res = await request(makeApp(CUSTOMER))
      .post("/api/portal/policy-register")
      .send({ ...CREATE_BASE, clearanceCondition: "Entra P2 licences land", clearanceTriggerType: "license_sku" });
    expect(res.status).toBe(400);
  });

  it("rejects clearanceTriggerSkuPartNumber on a 'manual' trigger", async () => {
    const res = await request(makeApp(CUSTOMER))
      .post("/api/portal/policy-register")
      .send({
        ...CREATE_BASE,
        clearanceCondition: "Entra P2 licences land",
        clearanceTriggerType: "manual",
        clearanceTriggerSkuPartNumber: "AAD_PREMIUM_P2",
      });
    expect(res.status).toBe(400);
  });

  it("accepts a dependency-based decision and leaves reviewState null, not on_track", async () => {
    mockInsertReturns = [[bareDecisionRow()]];
    const res = await request(makeApp(CUSTOMER))
      .post("/api/portal/policy-register")
      .send({ ...CREATE_BASE, clearanceCondition: "Entra P2 licences land", clearanceTriggerType: "manual" });
    expect(res.status).toBe(201);
    expect(res.body.decision.reviewCadence).toBeNull();
    expect(res.body.decision.reviewState).toBeNull();
    expect(res.body.decision.clearanceCondition).toBe("Entra P2 licences land");
    expect(res.body.decision.isCleared).toBe(false);
  });

  it("accepts a 'license_sku' dependency with its SKU", async () => {
    mockInsertReturns = [[
      bareDecisionRow({ clearanceTriggerType: "license_sku", clearanceTriggerSkuPartNumber: "AAD_PREMIUM_P2" }),
    ]];
    const res = await request(makeApp(CUSTOMER))
      .post("/api/portal/policy-register")
      .send({
        ...CREATE_BASE,
        clearanceCondition: "Entra P2 licences land",
        clearanceTriggerType: "license_sku",
        clearanceTriggerSkuPartNumber: "AAD_PREMIUM_P2",
      });
    expect(res.status).toBe(201);
    expect(res.body.decision.clearanceTriggerType).toBe("license_sku");
    expect(res.body.decision.clearanceTriggerSkuPartNumber).toBe("AAD_PREMIUM_P2");
  });
});

describe("PATCH /portal/policy-register/:id/clearance/resolve", () => {
  it("404s a decision belonging to another tenant", async () => {
    mockSelectResultsQueue = [[]];
    const res = await request(makeApp(CUSTOMER))
      .patch("/api/portal/policy-register/1/clearance/resolve")
      .send({ note: "Confirmed by phone with the vendor." });
    expect(res.status).toBe(404);
  });

  it("409s a decision with no clearance condition at all", async () => {
    mockSelectResultsQueue = [[bareDecisionRow({ clearanceCondition: null, clearanceTriggerType: null })]];
    const res = await request(makeApp(CUSTOMER))
      .patch("/api/portal/policy-register/1/clearance/resolve")
      .send({ note: "Confirmed by phone." });
    expect(res.status).toBe(409);
  });

  it("409s a 'license_sku' trigger — the platform resolves that one, not a human", async () => {
    mockSelectResultsQueue = [[bareDecisionRow({ clearanceTriggerType: "license_sku", clearanceTriggerSkuPartNumber: "AAD_PREMIUM_P2" })]];
    const res = await request(makeApp(CUSTOMER))
      .patch("/api/portal/policy-register/1/clearance/resolve")
      .send({ note: "I checked and it's there." });
    expect(res.status).toBe(409);
  });

  it("409s an already-resolved decision", async () => {
    mockSelectResultsQueue = [[bareDecisionRow({ clearanceResolvedAt: new Date("2026-08-30T00:00:00Z") })]];
    const res = await request(makeApp(CUSTOMER))
      .patch("/api/portal/policy-register/1/clearance/resolve")
      .send({ note: "Confirmed." });
    expect(res.status).toBe(409);
  });

  it("resolves a 'manual' trigger and records the note", async () => {
    mockSelectResultsQueue = [[bareDecisionRow()]];
    mockUpdateReturns = [[bareDecisionRow({ clearanceResolvedAt: new Date("2026-08-31T12:00:00Z"), clearanceResolvedNote: "Confirmed by phone with the vendor." })]];
    const res = await request(makeApp(CUSTOMER))
      .patch("/api/portal/policy-register/1/clearance/resolve")
      .send({ note: "Confirmed by phone with the vendor." });
    expect(res.status).toBe(200);
    expect(res.body.decision.isCleared).toBe(true);
    expect(res.body.decision.clearanceResolvedNote).toBe("Confirmed by phone with the vendor.");
  });

  it("rejects an empty note", async () => {
    mockSelectResultsQueue = [[bareDecisionRow()]];
    const res = await request(makeApp(CUSTOMER))
      .patch("/api/portal/policy-register/1/clearance/resolve")
      .send({ note: "" });
    expect(res.status).toBe(400);
  });
});
