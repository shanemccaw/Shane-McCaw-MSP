/**
 * portal-active-directory.test.ts
 *
 * Unit tests for the CUSTOMER-scoped OU-assignment surface (Git #2524):
 *   GET  /api/portal/active-directory/ou-assignment
 *   GET  /api/portal/active-directory/ou-assignment-requests
 *   POST /api/portal/active-directory/ou-assignment-requests
 *
 * Real `requireRole`/`requireAuth` (via a real signed JWT, same convention as
 * portal-customer-search.test.ts) so the role-floor gate is genuinely
 * exercised, not assumed. DB is a FIFO select-chain mock, same convention as
 * msp-active-directory.test.ts.
 *
 * Run: pnpm --filter @workspace/api-server run test -- portal-active-directory
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

process.env["JWT_SECRET"] = "portal-active-directory-test-secret";

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn(), insert: vi.fn() },
  activeDirectoryOusTable: { id: "id", name: "name", tenantId: "tenantId" },
  activeDirectoryOuAssignmentsTable: {
    id: "id",
    ouId: "ouId",
    customerId: "customerId",
    tenantId: "tenantId",
    objectId: "objectId",
    objectUpn: "objectUpn",
    objectDisplayName: "objectDisplayName",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  },
  activeDirectoryOuAssignmentRequestsTable: {
    id: "id",
    mspId: "mspId",
    customerId: "customerId",
    tenantId: "tenantId",
    objectUpn: "objectUpn",
    objectDisplayName: "objectDisplayName",
    currentOuId: "currentOuId",
    requestedOuId: "requestedOuId",
    requestedOuName: "requestedOuName",
    note: "note",
    status: "status",
    createdAt: "createdAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (c: unknown, v: unknown) => ({ eq: [c, v] }),
  and: (...args: unknown[]) => ({ and: args }),
  asc: (c: unknown) => ({ asc: c }),
  desc: (c: unknown) => ({ desc: c }),
}));

vi.mock("../lib/logger", () => {
  const stub = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});

const mockCreateAuditLog = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/audit", () => ({
  createAuditLog: (...args: unknown[]) => mockCreateAuditLog(...args),
}));

const mockResolveGraphUserByUpn = vi.fn();
vi.mock("./admin-active-directory", () => ({
  resolveGraphUserByUpn: (...args: unknown[]) => mockResolveGraphUserByUpn(...args),
}));

let mockScope: unknown = null;
vi.mock("../lib/portal-customer-scope", () => ({
  resolveCustomerId: (req: { user?: { customerId?: number } }) => req.user?.customerId ?? null,
  resolveTenantScope: async () => mockScope,
}));

import { db } from "@workspace/db";
import router from "./portal-active-directory";
import { LEGACY_ROLE } from "@workspace/db/rbac/legacy-ladder";

const mockSelect = (db as unknown as { select: ReturnType<typeof vi.fn> }).select;
const mockInsert = (db as unknown as { insert: ReturnType<typeof vi.fn> }).insert;

/** Drizzle-style fluent SELECT chain, thenable at any point, resolving to `rows`. */
function selectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain["then"] = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(rows).then(resolve, reject);
  return chain;
}

function insertChain(returning: unknown[]) {
  return { values: vi.fn().mockReturnThis(), returning: vi.fn().mockResolvedValue(returning) };
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return app;
}

function tokenFor(user: Record<string, unknown>) {
  return jwt.sign(user, process.env["JWT_SECRET"]!);
}

const CUSTOMER_TOKEN = tokenFor({ id: 7, email: "a@b.com", role: "client", mspRole: LEGACY_ROLE.customerUser, customerId: 42 });
const ASSESSMENT_TOKEN = tokenFor({ id: 8, email: "c@d.com", role: "client", mspRole: "Assessment", customerId: 42 });

beforeEach(() => {
  mockSelect.mockReset();
  mockInsert.mockReset();
  mockCreateAuditLog.mockClear();
  mockResolveGraphUserByUpn.mockReset();
  mockScope = null;
});

describe("GET /api/portal/active-directory/ou-assignment", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(makeApp()).get("/api/portal/active-directory/ou-assignment");
    expect(res.status).toBe(401);
  });

  it("rejects a role below CustomerUser", async () => {
    const res = await request(makeApp())
      .get("/api/portal/active-directory/ou-assignment")
      .set("Authorization", `Bearer ${ASSESSMENT_TOKEN}`);
    expect(res.status).toBe(403);
  });

  it("returns this tenant's OUs and real manual assignments", async () => {
    const ous = [{ id: 5, name: "VIP Users" }];
    const assignments = [
      { id: 1, ouId: 5, customerId: 42, objectUpn: "user@customer.com", objectDisplayName: "A User", createdAt: new Date("2026-09-01T00:00:00Z"), updatedAt: new Date("2026-09-01T00:00:00Z") },
    ];
    mockSelect.mockReturnValueOnce(selectChain(ous)).mockReturnValueOnce(selectChain(assignments));

    const res = await request(makeApp())
      .get("/api/portal/active-directory/ou-assignment")
      .set("Authorization", `Bearer ${CUSTOMER_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ous: [{ id: 5, name: "VIP Users" }],
      assignments: [
        {
          id: 1,
          ouId: 5,
          ouName: "VIP Users",
          objectUpn: "user@customer.com",
          objectDisplayName: "A User",
          createdAt: "2026-09-01T00:00:00.000Z",
          updatedAt: "2026-09-01T00:00:00.000Z",
        },
      ],
    });
  });

  it("returns a genuinely empty register rather than an error when nothing exists yet", async () => {
    mockSelect.mockReturnValueOnce(selectChain([])).mockReturnValueOnce(selectChain([]));
    const res = await request(makeApp())
      .get("/api/portal/active-directory/ou-assignment")
      .set("Authorization", `Bearer ${CUSTOMER_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ous: [], assignments: [] });
  });
});

describe("GET /api/portal/active-directory/ou-assignment-requests", () => {
  it("returns this customer's own requests only", async () => {
    const rows = [
      {
        id: 9,
        status: "pending",
        objectUpn: "user@customer.com",
        objectDisplayName: "A User",
        currentOuId: null,
        requestedOuId: 5,
        requestedOuName: null,
        note: "Please move to VIP Users",
        resolutionNote: null,
        createdAt: new Date("2026-09-06T00:00:00Z"),
        resolvedAt: null,
      },
    ];
    mockSelect.mockReturnValueOnce(selectChain(rows)).mockReturnValueOnce(selectChain([{ id: 5, name: "VIP Users" }]));

    const res = await request(makeApp())
      .get("/api/portal/active-directory/ou-assignment-requests")
      .set("Authorization", `Bearer ${CUSTOMER_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.requests).toHaveLength(1);
    expect(res.body.requests[0]).toMatchObject({ id: 9, status: "pending", requestedOuId: 5, requestedOuName: "VIP Users" });
  });
});

describe("POST /api/portal/active-directory/ou-assignment-requests", () => {
  it("400s when neither requestedOuId nor requestedOuName is given", async () => {
    const res = await request(makeApp())
      .post("/api/portal/active-directory/ou-assignment-requests")
      .set("Authorization", `Bearer ${CUSTOMER_TOKEN}`)
      .send({ objectUpn: "user@customer.com", note: "please fix this" });
    expect(res.status).toBe(400);
  });

  it("400s when the tenant has no resolvable Microsoft 365 tenant", async () => {
    mockScope = null;
    const res = await request(makeApp())
      .post("/api/portal/active-directory/ou-assignment-requests")
      .set("Authorization", `Bearer ${CUSTOMER_TOKEN}`)
      .send({ objectUpn: "user@customer.com", requestedOuName: "Somewhere else", note: "please fix this" });
    expect(res.status).toBe(400);
  });

  it("400s when the named Graph object cannot be resolved — never trusted from client input alone", async () => {
    mockScope = { customerId: 42, mspId: 1, tenantId: "tenant-guid" };
    mockResolveGraphUserByUpn.mockResolvedValueOnce({ ok: false, error: "No Graph user found" });

    const res = await request(makeApp())
      .post("/api/portal/active-directory/ou-assignment-requests")
      .set("Authorization", `Bearer ${CUSTOMER_TOKEN}`)
      .send({ objectUpn: "ghost@customer.com", requestedOuName: "Somewhere else", note: "please fix this" });
    expect(res.status).toBe(400);
    expect(mockResolveGraphUserByUpn).toHaveBeenCalledWith("tenant-guid", "ghost@customer.com");
  });

  it("400s a requestedOuId that does not belong to this tenant", async () => {
    mockScope = { customerId: 42, mspId: 1, tenantId: "tenant-guid" };
    mockResolveGraphUserByUpn.mockResolvedValueOnce({ ok: true, id: "aad-guid", userPrincipalName: "user@customer.com", displayName: "A User" });
    mockSelect.mockReturnValueOnce(selectChain([{ id: 6, tenantId: 999 }])); // OU belongs to a different tenant

    const res = await request(makeApp())
      .post("/api/portal/active-directory/ou-assignment-requests")
      .set("Authorization", `Bearer ${CUSTOMER_TOKEN}`)
      .send({ objectUpn: "user@customer.com", requestedOuId: 6, note: "please fix this" });
    expect(res.status).toBe(400);
  });

  it("raises a real, Graph-verified request and audits it", async () => {
    mockScope = { customerId: 42, mspId: 1, tenantId: "tenant-guid" };
    mockResolveGraphUserByUpn.mockResolvedValueOnce({ ok: true, id: "aad-guid", userPrincipalName: "user@customer.com", displayName: "A User" });
    const inserted = {
      id: 1,
      status: "pending",
      objectUpn: "user@customer.com",
      objectDisplayName: "A User",
      currentOuId: null,
      requestedOuId: null,
      requestedOuName: "Somewhere else",
      note: "please fix this",
      resolutionNote: null,
      createdAt: new Date("2026-09-06T00:00:00Z"),
      resolvedAt: null,
    };
    mockSelect
      .mockReturnValueOnce(selectChain([])) // existing assignment lookup -> none
      .mockReturnValueOnce(selectChain([])); // OU-name lookup for the response
    mockInsert.mockReturnValueOnce(insertChain([inserted]));

    const res = await request(makeApp())
      .post("/api/portal/active-directory/ou-assignment-requests")
      .set("Authorization", `Bearer ${CUSTOMER_TOKEN}`)
      .send({ objectUpn: " user@customer.com ", requestedOuName: "Somewhere else", note: "please fix this" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 1, status: "pending", requestedOuName: "Somewhere else" });
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "active_directory.ou_assignment_request.raised" }),
    );
  });
});
