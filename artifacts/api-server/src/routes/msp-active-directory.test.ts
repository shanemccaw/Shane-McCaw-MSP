/**
 * msp-active-directory.test.ts
 *
 * Unit tests for the MSP-staff-gated OU manual-assignment CRUD (Git #2148):
 *   GET    /api/msp/active-directory/ou/:id/assignments
 *   POST   /api/msp/active-directory/ou/:id/assignments
 *   PATCH  /api/msp/active-directory/ou-assignments/:id
 *   DELETE /api/msp/active-directory/ou-assignments/:id
 *
 * Security-critical, same discipline as msp-engine-history.test.ts: mspId is
 * resolvable ONLY from the authenticated session (resolveMspIdStrict), and
 * every target (OU or existing assignment) must resolve through
 * assertCustomerAccess — ownership + per-staff scoping — before any read or
 * write happens; a target outside the caller's book must 404, never a
 * distinguishable error that discloses it exists. Also locks the MSP-side
 * restriction beyond the admin route's shape: a null-tenantId (platform/
 * MSP-level) OU is never a valid target here.
 *
 * Run: pnpm --filter @workspace/api-server run test -- msp-active-directory
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const JWT_SECRET = "msp-active-directory-test-secret";
process.env["JWT_SECRET"] = JWT_SECRET;

function mspToken(opts: { mspId?: number; mspRole?: "MSPOperator" | "MSPAdmin" | "CustomerUser" | "PlatformAdmin"; id?: number }): string {
  const { mspId, mspRole = "MSPOperator", id = 1 } = opts;
  return jwt.sign(
    { id, email: "staff@test.com", role: "client", mspRole, ...(mspId !== undefined ? { mspId } : {}) },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
  activeDirectoryOusTable: { id: "id", name: "name", tenantId: "tenantId" },
  activeDirectoryOuAssignmentsTable: {
    id: "id",
    mspId: "mspId",
    ouId: "ouId",
    customerId: "customerId",
    tenantId: "tenantId",
    objectId: "objectId",
    objectUpn: "objectUpn",
    objectDisplayName: "objectDisplayName",
    assignedByUserId: "assignedByUserId",
  },
  tenantsTable: { id: "id", mspId: "mspId" },
  mspStaffCustomerScopesTable: { customerId: "customerId", staffUserId: "staffUserId" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (c: unknown, v: unknown) => ({ eq: [c, v] }),
  and: (...args: unknown[]) => ({ and: args }),
  asc: (c: unknown) => ({ asc: c }),
}));

vi.mock("../lib/logger", () => {
  const stub = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});

const mockCreateAuditLog = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/audit", () => ({
  createAuditLog: (...args: unknown[]) => mockCreateAuditLog(...args),
}));

const mockResolveAssignmentCustomer = vi.fn();
const mockResolveGraphUserByUpn = vi.fn();
vi.mock("./admin-active-directory", () => ({
  resolveAssignmentCustomer: (...args: unknown[]) => mockResolveAssignmentCustomer(...args),
  resolveGraphUserByUpn: (...args: unknown[]) => mockResolveGraphUserByUpn(...args),
}));

import { db } from "@workspace/db";
import router from "./msp-active-directory";

const mockSelect = (db as unknown as { select: ReturnType<typeof vi.fn> }).select;
const mockInsert = (db as unknown as { insert: ReturnType<typeof vi.fn> }).insert;
const mockUpdate = (db as unknown as { update: ReturnType<typeof vi.fn> }).update;
const mockDelete = (db as unknown as { delete: ReturnType<typeof vi.fn> }).delete;

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
  const chain: Record<string, unknown> = {
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(returning),
  };
  return chain;
}

function updateChain(returning: unknown[]) {
  const chain: Record<string, unknown> = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(returning),
  };
  return chain;
}

function deleteChain(returning: unknown[]) {
  const chain: Record<string, unknown> = {
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(returning),
  };
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
  mockInsert.mockReset();
  mockUpdate.mockReset();
  mockDelete.mockReset();
  mockCreateAuditLog.mockClear();
  mockResolveAssignmentCustomer.mockReset();
  mockResolveGraphUserByUpn.mockReset();
});

const MSP_ID = 900;
const OU = { id: 5, name: "VIP Users", tenantId: 42 };

describe("GET /msp/active-directory/ou/:id/assignments", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(makeApp()).get("/msp/active-directory/ou/5/assignments");
    expect(res.status).toBe(401);
  });

  it("rejects roles below MSPOperator", async () => {
    const res = await request(makeApp())
      .get("/msp/active-directory/ou/5/assignments")
      .set("Authorization", `Bearer ${mspToken({ mspId: MSP_ID, mspRole: "CustomerUser" })}`);
    expect(res.status).toBe(403);
  });

  it("403s when the session carries no mspId", async () => {
    const res = await request(makeApp())
      .get("/msp/active-directory/ou/5/assignments")
      .set("Authorization", `Bearer ${mspToken({ mspRole: "MSPOperator" })}`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: "FORBIDDEN", message: "MSP context required" } });
  });

  it("404s when the OU does not exist", async () => {
    mockSelect.mockReturnValueOnce(selectChain([])); // OU lookup -> none
    const res = await request(makeApp())
      .get("/msp/active-directory/ou/5/assignments")
      .set("Authorization", `Bearer ${mspToken({ mspId: MSP_ID })}`);
    expect(res.status).toBe(404);
  });

  it("404s a platform/MSP-level OU with no tenantId, without any ownership lookup", async () => {
    mockSelect.mockReturnValueOnce(selectChain([{ id: 5, name: "Platform Grouping", tenantId: null }]));
    const res = await request(makeApp())
      .get("/msp/active-directory/ou/5/assignments")
      .set("Authorization", `Bearer ${mspToken({ mspId: MSP_ID })}`);
    expect(res.status).toBe(404);
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it("404s an OU whose customer belongs to a different MSP, without disclosing it exists", async () => {
    mockSelect
      .mockReturnValueOnce(selectChain([OU])) // OU lookup
      .mockReturnValueOnce(selectChain([])); // tenant ownership check -> no match
    const res = await request(makeApp())
      .get("/msp/active-directory/ou/5/assignments")
      .set("Authorization", `Bearer ${mspToken({ mspId: MSP_ID })}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "NOT_FOUND", message: "OU not found" } });
  });

  it("returns real assignments for an OU owned by the caller's MSP", async () => {
    const assignments = [{ id: 1, ouId: 5, customerId: 42, objectUpn: "user@customer.com" }];
    mockSelect
      .mockReturnValueOnce(selectChain([OU])) // OU lookup
      .mockReturnValueOnce(selectChain([{ id: 42 }])) // tenant ownership
      .mockReturnValueOnce(selectChain([])) // unrestricted staff scope
      .mockReturnValueOnce(selectChain(assignments)); // assignments

    const res = await request(makeApp())
      .get("/msp/active-directory/ou/5/assignments")
      .set("Authorization", `Bearer ${mspToken({ mspId: MSP_ID })}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(assignments);
  });

  it("PlatformAdmin bypasses per-customer ownership check (no extra db lookup)", async () => {
    const assignments = [{ id: 1, ouId: 5, customerId: 42, objectUpn: "user@customer.com" }];
    mockSelect
      .mockReturnValueOnce(selectChain([OU])) // OU lookup
      .mockReturnValueOnce(selectChain(assignments)); // assignments — no ownership db calls
    const res = await request(makeApp())
      .get("/msp/active-directory/ou/5/assignments")
      .set("Authorization", `Bearer ${mspToken({ mspId: MSP_ID, mspRole: "PlatformAdmin" })}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(assignments);
  });
});

describe("POST /msp/active-directory/ou/:id/assignments", () => {
  it("400s when objectUpn is missing", async () => {
    const res = await request(makeApp())
      .post("/msp/active-directory/ou/5/assignments")
      .set("Authorization", `Bearer ${mspToken({ mspId: MSP_ID })}`)
      .send({ customerId: 42 });
    expect(res.status).toBe(400);
  });

  it("404s when the OU does not exist", async () => {
    mockSelect.mockReturnValueOnce(selectChain([]));
    const res = await request(makeApp())
      .post("/msp/active-directory/ou/5/assignments")
      .set("Authorization", `Bearer ${mspToken({ mspId: MSP_ID })}`)
      .send({ customerId: 42, objectUpn: "user@customer.com" });
    expect(res.status).toBe(404);
  });

  it("404s a customer belonging to a different MSP, without disclosing it exists", async () => {
    mockSelect
      .mockReturnValueOnce(selectChain([OU])) // OU lookup
      .mockReturnValueOnce(selectChain([])); // tenant ownership -> no match
    mockResolveAssignmentCustomer.mockResolvedValueOnce({ ok: true, customerId: 42, mspId: 777, graphTenantId: "tenant-guid" });

    const res = await request(makeApp())
      .post("/msp/active-directory/ou/5/assignments")
      .set("Authorization", `Bearer ${mspToken({ mspId: MSP_ID })}`)
      .send({ customerId: 42, objectUpn: "user@customer.com" });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "NOT_FOUND", message: "Customer not found" } });
  });

  it("400s a platform/MSP-level OU (null tenantId) — never a valid MSP-side write target", async () => {
    mockSelect
      .mockReturnValueOnce(selectChain([{ id: 5, name: "Platform Grouping", tenantId: null }])) // OU lookup
      .mockReturnValueOnce(selectChain([{ id: 42 }])) // tenant ownership
      .mockReturnValueOnce(selectChain([])); // unrestricted staff
    mockResolveAssignmentCustomer.mockResolvedValueOnce({ ok: true, customerId: 42, mspId: MSP_ID, graphTenantId: "tenant-guid" });

    const res = await request(makeApp())
      .post("/msp/active-directory/ou/5/assignments")
      .set("Authorization", `Bearer ${mspToken({ mspId: MSP_ID })}`)
      .send({ customerId: 42, objectUpn: "user@customer.com" });
    expect(res.status).toBe(400);
    expect(mockResolveGraphUserByUpn).not.toHaveBeenCalled();
  });

  it("assigns a real Graph-verified object into the OU and audits it", async () => {
    const graphUser = { ok: true, id: "aad-guid", userPrincipalName: "user@customer.com", displayName: "A User" };
    const inserted = { id: 1, ouId: 5, customerId: 42, objectId: "aad-guid" };
    mockSelect
      .mockReturnValueOnce(selectChain([OU])) // OU lookup
      .mockReturnValueOnce(selectChain([{ id: 42 }])) // tenant ownership
      .mockReturnValueOnce(selectChain([])); // unrestricted staff
    mockResolveAssignmentCustomer.mockResolvedValueOnce({ ok: true, customerId: 42, mspId: MSP_ID, graphTenantId: "tenant-guid" });
    mockResolveGraphUserByUpn.mockResolvedValueOnce(graphUser);
    mockInsert.mockReturnValueOnce(insertChain([inserted]));

    const res = await request(makeApp())
      .post("/msp/active-directory/ou/5/assignments")
      .set("Authorization", `Bearer ${mspToken({ mspId: MSP_ID })}`)
      .send({ customerId: 42, objectUpn: " user@customer.com " });
    expect(res.status).toBe(201);
    expect(res.body).toEqual(inserted);
    expect(mockResolveGraphUserByUpn).toHaveBeenCalledWith("tenant-guid", "user@customer.com");
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "active_directory.ou_assignment.set" }),
    );
  });
});

describe("PATCH /msp/active-directory/ou-assignments/:id", () => {
  const EXISTING = { id: 9, ouId: 5, customerId: 42, objectId: "aad-guid" };

  it("404s when the assignment does not exist", async () => {
    mockSelect.mockReturnValueOnce(selectChain([]));
    const res = await request(makeApp())
      .patch("/msp/active-directory/ou-assignments/9")
      .set("Authorization", `Bearer ${mspToken({ mspId: MSP_ID })}`)
      .send({ ouId: 6 });
    expect(res.status).toBe(404);
  });

  it("404s an assignment belonging to a different MSP's customer, without disclosing it", async () => {
    mockSelect
      .mockReturnValueOnce(selectChain([EXISTING])) // assignment lookup
      .mockReturnValueOnce(selectChain([])); // tenant ownership -> no match
    const res = await request(makeApp())
      .patch("/msp/active-directory/ou-assignments/9")
      .set("Authorization", `Bearer ${mspToken({ mspId: MSP_ID })}`)
      .send({ ouId: 6 });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "NOT_FOUND", message: "Assignment not found" } });
  });

  it("moves the assignment to a new OU scoped to the same customer", async () => {
    const updated = { ...EXISTING, ouId: 6 };
    mockSelect
      .mockReturnValueOnce(selectChain([EXISTING])) // assignment lookup
      .mockReturnValueOnce(selectChain([{ id: 42 }])) // tenant ownership
      .mockReturnValueOnce(selectChain([])) // unrestricted staff
      .mockReturnValueOnce(selectChain([{ id: 6, name: "New OU", tenantId: 42 }])); // new OU lookup
    mockUpdate.mockReturnValueOnce(updateChain([updated]));

    const res = await request(makeApp())
      .patch("/msp/active-directory/ou-assignments/9")
      .set("Authorization", `Bearer ${mspToken({ mspId: MSP_ID })}`)
      .send({ ouId: 6 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(updated);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "active_directory.ou_assignment.move" }),
    );
  });
});

describe("DELETE /msp/active-directory/ou-assignments/:id", () => {
  const EXISTING = { id: 9, ouId: 5, customerId: 42, objectId: "aad-guid" };

  it("404s an assignment belonging to a different MSP's customer, without disclosing it", async () => {
    mockSelect
      .mockReturnValueOnce(selectChain([EXISTING])) // assignment lookup
      .mockReturnValueOnce(selectChain([])); // tenant ownership -> no match
    const res = await request(makeApp())
      .delete("/msp/active-directory/ou-assignments/9")
      .set("Authorization", `Bearer ${mspToken({ mspId: MSP_ID })}`);
    expect(res.status).toBe(404);
  });

  it("clears the manual override and audits it", async () => {
    mockSelect
      .mockReturnValueOnce(selectChain([EXISTING])) // assignment lookup
      .mockReturnValueOnce(selectChain([{ id: 42 }])) // tenant ownership
      .mockReturnValueOnce(selectChain([])); // unrestricted staff
    mockDelete.mockReturnValueOnce(deleteChain([EXISTING]));

    const res = await request(makeApp())
      .delete("/msp/active-directory/ou-assignments/9")
      .set("Authorization", `Bearer ${mspToken({ mspId: MSP_ID })}`);
    expect(res.status).toBe(204);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "active_directory.ou_assignment.clear" }),
    );
  });
});
