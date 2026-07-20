/**
 * msp-data-rights.test.ts
 *
 * Unit tests for the MSP-facing Data Rights view/action:
 *   GET  /msp/data-rights
 *   GET  /msp/data-rights/customers/:customerId/users
 *   POST /msp/data-rights/customers/:customerId/deletion-request
 *
 * Covers:
 *   - 401 without auth, 403 below MSPAdmin (MSPOperator is not enough here)
 *   - GET bridges audit_logs rows (clientId = users.id) into the MSP's book
 *     via msp_users, and staff scoping narrows which rows are eligible
 *   - POST validates the target user is actually linked to the given
 *     customer, then delegates to lib/data-rights.ts (mocked here — its own
 *     behavior is proven by portal.ts's existing deletion-request coverage)
 *
 * Run: pnpm --filter @workspace/api-server run test -- msp-data-rights
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const JWT_SECRET = "msp-data-rights-test-secret";
process.env["JWT_SECRET"] = JWT_SECRET;

function mspToken(mspId: number, mspRole: "MSPOperator" | "MSPAdmin" | "PlatformAdmin" | "CustomerUser" = "MSPAdmin"): string {
  return jwt.sign(
    { id: 7, email: "admin@test.com", name: "Pat Admin", role: "client", mspRole, mspId },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn() },
  auditLogsTable: { id: "id", actionType: "actionType", actorRole: "actorRole", actorName: "actorName", clientId: "clientId", metadata: "metadata", createdAt: "createdAt" },
  mspCustomersTable: { id: "id", name: "name", mspId: "mspId" },
  mspUsersTable: { userId: "userId", customerId: "customerId", mspId: "mspId", isActive: "isActive" },
  usersTable: { id: "id", name: "name", email: "email" },
  // Per-staff customer-access scoping table (read by resolveStaffScopedCustomerIds).
  mspStaffCustomerScopesTable: { customerId: "customerId", staffUserId: "staffUserId", mspId: "mspId" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (c: unknown, v: unknown) => ({ eq: [c, v] }),
  and: (...args: unknown[]) => ({ and: args }),
  desc: (c: unknown) => ({ desc: c }),
  inArray: (c: unknown, v: unknown) => ({ inArray: [c, v] }),
}));

vi.mock("../lib/logger", () => {
  const stub = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});
vi.mock("../lib/logger.ts", () => {
  const stub = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});

const submitAdminInitiatedDeletionRequest = vi.fn();
vi.mock("../lib/data-rights.ts", () => ({
  submitAdminInitiatedDeletionRequest: (...args: unknown[]) => submitAdminInitiatedDeletionRequest(...args),
}));
vi.mock("../lib/data-rights", () => ({
  submitAdminInitiatedDeletionRequest: (...args: unknown[]) => submitAdminInitiatedDeletionRequest(...args),
}));

import { db } from "@workspace/db";
import router from "./msp-data-rights";

const mockSelect = (db as unknown as { select: ReturnType<typeof vi.fn> }).select;

/** Drizzle-style fluent chain, thenable at any point, resolving to `rows`. */
function buildChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit", "leftJoin", "innerJoin"]) {
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
  submitAdminInitiatedDeletionRequest.mockReset();
});

const MSP_ID = 900;

const bridgeRows = [
  { userId: 101, customerId: 1, customerName: "Acme Corp" },
  { userId: 102, customerId: 2, customerName: "Beta LLC" },
];

const deletionEvent = {
  id: 1,
  actionType: "deletion_request_submitted",
  actorRole: "client",
  actorName: "Jane Client",
  clientId: 101,
  metadata: { currentSchema: { customerId: 1, mspId: MSP_ID, customerName: "Acme Corp", diagnosticRuns: 3, diagnosticFindings: 5, sows: 1, mspDocuments: 2, engineSnapshots: 10 } },
  createdAt: new Date("2026-07-19T10:00:00Z"),
};

const exportEvent = {
  id: 2,
  actionType: "data_export_downloaded",
  actorRole: "client",
  actorName: "Bo Beta",
  clientId: 102,
  metadata: {},
  createdAt: new Date("2026-07-18T10:00:00Z"),
};

const adminInitiatedEvent = {
  id: 3,
  actionType: "deletion_request_submitted",
  actorRole: "admin",
  actorName: "Pat Admin",
  clientId: 102,
  metadata: { currentSchema: null, submittedByAdmin: true },
  createdAt: new Date("2026-07-17T10:00:00Z"),
};

describe("GET /msp/data-rights", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(makeApp()).get("/msp/data-rights");
    expect(res.status).toBe(401);
  });

  it("rejects roles below MSPAdmin", async () => {
    const res = await request(makeApp())
      .get("/msp/data-rights")
      .set("Authorization", `Bearer ${mspToken(MSP_ID, "MSPOperator")}`);
    expect(res.status).toBe(403);
  });

  it("bridges audit_logs rows into the MSP's book and tags each with its customer", async () => {
    mockSelect.mockReturnValueOnce(buildChain([])); // resolveStaffScopedCustomerIds -> unrestricted
    mockSelect.mockReturnValueOnce(buildChain(bridgeRows)); // loadCustomerBridge
    mockSelect.mockReturnValueOnce(buildChain([deletionEvent, exportEvent, adminInitiatedEvent])); // audit_logs

    const res = await request(makeApp())
      .get("/msp/data-rights")
      .set("Authorization", `Bearer ${mspToken(MSP_ID, "MSPAdmin")}`);

    expect(res.status).toBe(200);
    expect(res.body.requests).toHaveLength(3);

    const deletion = res.body.requests.find((r: { id: number }) => r.id === 1);
    expect(deletion.customerId).toBe(1);
    expect(deletion.customerName).toBe("Acme Corp");
    expect(deletion.submittedByAdmin).toBe(false);
    expect(deletion.currentSchema.diagnosticRuns).toBe(3);

    const adminInitiated = res.body.requests.find((r: { id: number }) => r.id === 3);
    expect(adminInitiated.submittedByAdmin).toBe(true);
    expect(adminInitiated.customerId).toBe(2);

    const exported = res.body.requests.find((r: { id: number }) => r.id === 2);
    expect(exported.currentSchema).toBeNull();
  });

  it("returns no requests when the MSP's book has no linked users", async () => {
    mockSelect.mockReturnValueOnce(buildChain([]));
    mockSelect.mockReturnValueOnce(buildChain([]));

    const res = await request(makeApp())
      .get("/msp/data-rights")
      .set("Authorization", `Bearer ${mspToken(MSP_ID, "MSPAdmin")}`);

    expect(res.status).toBe(200);
    expect(res.body.requests).toEqual([]);
  });

  it("restricts a scoped admin to their assigned customers", async () => {
    mockSelect.mockReturnValueOnce(buildChain([{ customerId: 1 }])); // scoped to customer 1 only
    mockSelect.mockReturnValueOnce(buildChain(bridgeRows));
    mockSelect.mockReturnValueOnce(buildChain([deletionEvent])); // narrowed query would only return customer 1's rows

    const res = await request(makeApp())
      .get("/msp/data-rights")
      .set("Authorization", `Bearer ${mspToken(MSP_ID, "MSPAdmin")}`);

    expect(res.status).toBe(200);
    for (const r of res.body.requests) {
      expect(r.customerId).toBe(1);
    }
  });
});

describe("POST /msp/data-rights/customers/:customerId/deletion-request", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(makeApp()).post("/msp/data-rights/customers/1/deletion-request").send({ userId: 101 });
    expect(res.status).toBe(401);
  });

  it("rejects roles below MSPAdmin", async () => {
    const res = await request(makeApp())
      .post("/msp/data-rights/customers/1/deletion-request")
      .set("Authorization", `Bearer ${mspToken(MSP_ID, "MSPOperator")}`)
      .send({ userId: 101 });
    expect(res.status).toBe(403);
  });

  it("403s when the customer does not belong to the caller's MSP (assertCustomerAccess)", async () => {
    mockSelect.mockReturnValueOnce(buildChain([])); // mspCustomersTable lookup finds nothing -> assertCustomerAccess false
    const res = await request(makeApp())
      .post("/msp/data-rights/customers/1/deletion-request")
      .set("Authorization", `Bearer ${mspToken(MSP_ID, "MSPAdmin")}`)
      .send({ userId: 101 });
    expect(res.status).toBe(403);
  });

  it("400s when userId is missing", async () => {
    mockSelect.mockReturnValueOnce(buildChain([{ id: 1 }])); // assertCustomerAccess -> customer found
    mockSelect.mockReturnValueOnce(buildChain([])); // isCustomerBlockedByStaffScope -> resolveStaffScopedCustomerIds unrestricted
    const res = await request(makeApp())
      .post("/msp/data-rights/customers/1/deletion-request")
      .set("Authorization", `Bearer ${mspToken(MSP_ID, "MSPAdmin")}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("404s when the target user is not linked to the given customer", async () => {
    mockSelect.mockReturnValueOnce(buildChain([{ id: 1 }])); // assertCustomerAccess: customer found
    mockSelect.mockReturnValueOnce(buildChain([])); // isCustomerBlockedByStaffScope: unrestricted
    mockSelect.mockReturnValueOnce(buildChain([])); // mspUsersTable link lookup: none found
    const res = await request(makeApp())
      .post("/msp/data-rights/customers/1/deletion-request")
      .set("Authorization", `Bearer ${mspToken(MSP_ID, "MSPAdmin")}`)
      .send({ userId: 999 });
    expect(res.status).toBe(404);
    expect(submitAdminInitiatedDeletionRequest).not.toHaveBeenCalled();
  });

  it("delegates to the shared lib/data-rights.ts helper on success — the same code path portal.ts uses", async () => {
    mockSelect.mockReturnValueOnce(buildChain([{ id: 1 }])); // assertCustomerAccess: customer found
    mockSelect.mockReturnValueOnce(buildChain([])); // isCustomerBlockedByStaffScope: unrestricted
    mockSelect.mockReturnValueOnce(buildChain([{ userId: 101 }])); // mspUsersTable link lookup: found
    submitAdminInitiatedDeletionRequest.mockResolvedValueOnce({ ok: true, currentSchemaSummary: { customerId: 1, mspId: MSP_ID, customerName: "Acme Corp", diagnosticRuns: 3, diagnosticFindings: 5, sows: 1, mspDocuments: 2, engineSnapshots: 10 } });

    const res = await request(makeApp())
      .post("/msp/data-rights/customers/1/deletion-request")
      .set("Authorization", `Bearer ${mspToken(MSP_ID, "MSPAdmin")}`)
      .send({ userId: 101 });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(submitAdminInitiatedDeletionRequest).toHaveBeenCalledWith(
      101,
      1,
      expect.objectContaining({ actorRole: "admin", actorUserId: 7, actorName: "Pat Admin" }),
    );
  });
});
