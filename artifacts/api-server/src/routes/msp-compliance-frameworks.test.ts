/**
 * msp-compliance-frameworks.test.ts — the MSP-console tenant-authored
 * compliance-framework/-obligation create route (Git #3042).
 *
 * What's worth failing a build over:
 *   1. `:customerId` is resolved and verified to belong to the CALLING MSP — a
 *      tenant that resolves but belongs to another MSP 404s, same as one that
 *      doesn't exist at all (no cross-MSP existence leak).
 *   2. A created framework always carries the CALLER's own (mspId, tenantId) —
 *      never anything from the request body.
 *   3. An obligation can only be authored under a framework that is itself
 *      tenant-authored for the SAME (mspId, tenantId) — a global framework
 *      (mspId null) or one belonging to a different tenant/MSP 404s.
 *   4. A duplicate `key` on either table is a 409, not a 500.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn(), insert: vi.fn() },
  complianceFrameworksTable: {
    id: "id",
    key: "key",
    name: "name",
    mspId: "mspId",
    tenantId: "tenantId",
    sortOrder: "sortOrder",
  },
  complianceObligationsTable: {
    id: "id",
    frameworkId: "frameworkId",
    key: "key",
    citation: "citation",
    sortOrder: "sortOrder",
  },
  AUTHORITY_TYPES: ["regulation", "certification", "contract", "insurance", "internal_schedule"],
}));

vi.mock("drizzle-orm", () => ({
  eq: (c: unknown, v: unknown) => ({ eq: [c, v] }),
  and: (...args: unknown[]) => ({ and: args }),
  asc: (c: unknown) => ({ asc: c }),
}));

vi.mock("../middlewares/requireAuth.ts", () => ({
  requireCapability: () => (_req: any, _res: any, next: () => void) => next(),
  requireAuth: (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock("../lib/logger.ts", () => {
  const stub = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});

let mockMspId: number | null = 1;
vi.mock("../lib/resolve-msp-id.ts", () => ({
  resolveMspIdStrict: (_req: any) => mockMspId,
}));

let mockScope: any = null;
vi.mock("../lib/portal-customer-scope.ts", () => ({
  resolveTenantScope: async (_customerId: number) => mockScope,
}));

import { db } from "@workspace/db";
import router from "./msp-compliance-frameworks.ts";

const mockSelect = (db as unknown as { select: ReturnType<typeof vi.fn> }).select;
const mockInsert = (db as unknown as { insert: ReturnType<typeof vi.fn> }).insert;

function selectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain["then"] = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(rows).then(resolve, reject);
  return chain;
}

function insertChain(returningOrError: unknown[] | Error) {
  return {
    values: vi.fn().mockReturnThis(),
    returning:
      returningOrError instanceof Error
        ? vi.fn().mockRejectedValue(returningOrError)
        : vi.fn().mockResolvedValue(returningOrError),
  };
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: 9, mspId: 1, email: "operator@msp.test" };
    next();
  });
  app.use("/api", router);
  return app;
}

const SCOPE = {
  customerId: 42,
  mspId: 1,
  tenantId: "0a361ab2-9e85-4bbf-8b75-c1ebf042dfba",
  tenantName: "Test Me",
  primaryDomain: "shanemccaw.onmicrosoft.com",
  businessUnit: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockMspId = 1;
  mockScope = SCOPE;
});

describe("POST /api/msp/customers/:customerId/compliance-frameworks", () => {
  it("creates a framework scoped to the caller's own (mspId, tenantId), ignoring any body override", async () => {
    mockInsert.mockReturnValue(
      insertChain([{ id: 5, key: "acme-insurance", mspId: SCOPE.mspId, tenantId: SCOPE.tenantId }]),
    );

    const res = await request(makeApp())
      .post("/api/msp/customers/42/compliance-frameworks")
      .send({
        key: "acme-insurance",
        name: "ACME Cyber Insurance Schedule",
        authorityType: "insurance",
        mspId: 999, // must be ignored — server derives from session/tenant scope
        tenantId: "attacker-supplied",
      });

    expect(res.status).toBe(201);
    const insertedValues = (mockInsert.mock.results[0].value.values as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(insertedValues.mspId).toBe(SCOPE.mspId);
    expect(insertedValues.tenantId).toBe(SCOPE.tenantId);
  });

  it("404s a customer belonging to another MSP, without disclosing it exists", async () => {
    mockScope = { ...SCOPE, mspId: 2 }; // resolves, but to a DIFFERENT msp than the caller's (1)

    const res = await request(makeApp())
      .post("/api/msp/customers/42/compliance-frameworks")
      .send({ key: "x", name: "X", authorityType: "insurance" });

    expect(res.status).toBe(404);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("404s when the tenant does not resolve at all", async () => {
    mockScope = null;

    const res = await request(makeApp())
      .post("/api/msp/customers/42/compliance-frameworks")
      .send({ key: "x", name: "X", authorityType: "insurance" });

    expect(res.status).toBe(404);
  });

  it("rejects invalid body (missing required fields) with 400", async () => {
    const res = await request(makeApp()).post("/api/msp/customers/42/compliance-frameworks").send({ key: "x" });
    expect(res.status).toBe(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("maps a duplicate key to 409, not 500", async () => {
    mockInsert.mockReturnValue(insertChain(Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" })));

    const res = await request(makeApp())
      .post("/api/msp/customers/42/compliance-frameworks")
      .send({ key: "dup", name: "Dup", authorityType: "insurance" });

    expect(res.status).toBe(409);
  });
});

describe("POST /api/msp/customers/:customerId/compliance-frameworks/:frameworkId/compliance-obligations", () => {
  it("creates an obligation under a framework this MSP authored for this same tenant", async () => {
    mockSelect.mockReturnValue(
      selectChain([{ id: 5, mspId: SCOPE.mspId, tenantId: SCOPE.tenantId, key: "acme-insurance" }]),
    );
    mockInsert.mockReturnValue(insertChain([{ id: 11, frameworkId: 5, key: "acme-clause-1" }]));

    const res = await request(makeApp())
      .post("/api/msp/customers/42/compliance-frameworks/5/compliance-obligations")
      .send({ key: "acme-clause-1", citation: "Schedule A(3)", requires: "Maintain MFA on all admin accounts" });

    expect(res.status).toBe(201);
    expect(mockInsert).toHaveBeenCalled();
  });

  it("404s when the target framework is global (mspId null) rather than tenant-authored", async () => {
    mockSelect.mockReturnValue(selectChain([{ id: 5, mspId: null, tenantId: null, key: "gdpr" }]));

    const res = await request(makeApp())
      .post("/api/msp/customers/42/compliance-frameworks/5/compliance-obligations")
      .send({ key: "x", citation: "y", requires: "z" });

    expect(res.status).toBe(404);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("404s when the target framework belongs to a different tenant", async () => {
    mockSelect.mockReturnValue(selectChain([{ id: 5, mspId: SCOPE.mspId, tenantId: "some-other-tenant-guid" }]));

    const res = await request(makeApp())
      .post("/api/msp/customers/42/compliance-frameworks/5/compliance-obligations")
      .send({ key: "x", citation: "y", requires: "z" });

    expect(res.status).toBe(404);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("404s when the framework id does not exist at all", async () => {
    mockSelect.mockReturnValue(selectChain([]));

    const res = await request(makeApp())
      .post("/api/msp/customers/42/compliance-frameworks/999/compliance-obligations")
      .send({ key: "x", citation: "y", requires: "z" });

    expect(res.status).toBe(404);
  });
});

describe("GET /api/msp/customers/:customerId/compliance-frameworks", () => {
  it("returns only this MSP's tenant-authored frameworks for this customer", async () => {
    mockSelect.mockReturnValue(selectChain([{ id: 5, mspId: SCOPE.mspId, tenantId: SCOPE.tenantId, key: "acme-insurance" }]));

    const res = await request(makeApp()).get("/api/msp/customers/42/compliance-frameworks");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 5, mspId: SCOPE.mspId, tenantId: SCOPE.tenantId, key: "acme-insurance" }]);
  });
});
