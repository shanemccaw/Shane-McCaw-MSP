import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

/**
 * HTTP-level tests for Active Directory Phase 7's three write endpoints
 * (Issue #67): PATCH .../role, PATCH .../assignment, GET/PATCH
 * .../entitlements. The invalid-reassignment REJECTION LOGIC itself
 * (planRoleChange/planAssignmentChange) is exhaustively unit-tested,
 * DB-free, in active-directory.test.ts — these tests exercise the HTTP
 * plumbing around it: status codes, request validation, and that a
 * successful write calls createAuditLog.
 *
 * Mocks @workspace/db with a queueable chain, same pattern as
 * dashboard-overrides.test.ts — each terminal query (or bare await of the
 * chain) shifts the next queued result off mockResultQueue, in the exact
 * order the route issues its awaits.
 */

let mockResultQueue: any[][] = [];
const auditLogSpy = vi.fn();

vi.mock("@workspace/db", () => {
  function makeChain() {
    const chain: any = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      set: () => chain,
      values: () => chain,
      onConflictDoUpdate: () => Promise.resolve(mockResultQueue.shift() ?? []),
      returning: () => Promise.resolve(mockResultQueue.shift() ?? []),
      then: (onFulfilled: any, onRejected: any) =>
        Promise.resolve(mockResultQueue.shift() ?? []).then(onFulfilled, onRejected),
    };
    return chain;
  }

  const mockDb = {
    select: vi.fn(() => makeChain()),
    insert: vi.fn(() => makeChain()),
    update: vi.fn(() => makeChain()),
    delete: vi.fn(() => makeChain()),
  };

  const tbl = (cols: string[]) => Object.fromEntries(cols.map((c) => [c, c]));

  return {
    db: mockDb,
    mspsTable: tbl(["id", "name", "slug"]),
    tenantsTable: tbl(["id", "mspId", "customerName", "domain", "industry", "tenantId", "tenantUrl", "status", "isTestbed", "consent", "createdAt"]),
    // Post-refactor the RBAC/linkage columns live on `users` itself, so the
    // users stub carries what the msp_users stub used to.
    usersTable: tbl(["id", "email", "name", "company", "phone", "role", "createdAt", "mspId", "tenantId", "mspRole", "isActive", "mfaEnforced", "canApprovePurchases", "department", "jobTitle", "lastLoginAt", "updatedAt"]),
    mspSubscriptionsTable: tbl(["mspId", "serviceId", "status", "billingInterval", "currentPeriodStart", "currentPeriodEnd", "dunningState", "paymentFailedAt", "tenantCountSnapshot", "contactEmail"]),
    servicesTable: tbl(["id", "name", "typeAttributes"]),
    platformAgreementsTable: tbl(["version", "isCurrentVersion"]),
    mspAgreementAcceptancesTable: tbl(["mspId", "agreementVersion", "acceptedAt", "checkboxConfirmed"]),
    clientServicesTable: tbl(["id", "clientUserId", "serviceId", "status", "billingInterval", "purchasedAt"]),
    mspDiagnosticRunsTable: tbl(["runId", "customerId", "packageKey", "status", "startedAt", "completedAt", "createdAt"]),
    activeDirectoryOusTable: tbl(["id", "name", "createdAt", "updatedAt"]),
    userSessionsTable: tbl(["userId", "sessionType", "loginMethod", "ipAddress", "userAgent", "createdAt", "lastActiveAt", "expiresAt", "revokedAt"]),
    mfaEnrollmentsTable: tbl(["userId", "method", "createdAt", "enabled"]),
    userEntitlementOverridesTable: tbl(["userId", "capabilityKey", "enabled", "grantedByUserId", "createdAt", "updatedAt"]),
  };
});

vi.mock("../lib/audit", () => ({
  createAuditLog: (...args: unknown[]) => {
    auditLogSpy(...args);
    return Promise.resolve();
  },
}));

import router from "./admin-active-directory";

const app = express();
app.use(express.json());
app.use("/api", router);

const JWT_SECRET = "admin-active-directory-user-actions-test-secret";
process.env.JWT_SECRET = JWT_SECRET;

function adminToken(): string {
  return jwt.sign({ id: 1, email: "pa@platform.com", name: "Platform Admin", role: "admin", mspRole: "PlatformAdmin" }, JWT_SECRET, {
    expiresIn: "15m",
  });
}

beforeEach(() => {
  mockResultQueue = [];
  auditLogSpy.mockClear();
});

// ── PATCH /admin/active-directory/user/:id/role ──────────────────────────────

describe("PATCH /admin/active-directory/user/:id/role", () => {
  it("400s an invalid mspRole", async () => {
    const res = await request(app)
      .patch("/api/admin/active-directory/user/100/role")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ mspRole: "SuperAdmin" });
    expect(res.status).toBe(400);
  });

  it("404s when the account has no msp_users linkage row", async () => {
    mockResultQueue = [[]]; // current row lookup returns nothing
    const res = await request(app)
      .patch("/api/admin/active-directory/user/100/role")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ mspRole: "MSPAdmin" });
    expect(res.status).toBe(404);
  });

  it("400s an invalid transition — CustomerUser target with no customer linkage (acceptance-criteria rejection case)", async () => {
    mockResultQueue = [[{ mspRole: "MSPAdmin", mspId: 1, customerId: null }]];
    const res = await request(app)
      .patch("/api/admin/active-directory/user/100/role")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ mspRole: "CustomerUser" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no customer linkage/i);
    expect(auditLogSpy).not.toHaveBeenCalled();
  });

  it("200s a valid role change, clearing customer linkage when moving a CustomerUser to an MSP-scoped role, and audit-logs before/after", async () => {
    mockResultQueue = [
      [{ mspRole: "CustomerUser", mspId: 1, customerId: 10 }], // current row
      [], // update()
      [], // createAuditLog's insert() (unused since createAuditLog is mocked, but harmless if consumed)
    ];
    const res = await request(app)
      .patch("/api/admin/active-directory/user/100/role")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ mspRole: "MSPOperator" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, mspRole: "MSPOperator", mspId: 1, customerId: null });
    expect(auditLogSpy).toHaveBeenCalledTimes(1);
    const call = auditLogSpy.mock.calls[0][0];
    expect(call.actionType).toBe("user.role.update");
    expect(call.metadata.before).toEqual({ mspRole: "CustomerUser", mspId: 1, customerId: 10 });
    expect(call.metadata.after).toEqual({ mspRole: "MSPOperator", mspId: 1, customerId: null });
  });
});

// ── PATCH /admin/active-directory/user/:id/assignment ────────────────────────

describe("PATCH /admin/active-directory/user/:id/assignment", () => {
  it("404s when the account has no msp_users linkage row", async () => {
    mockResultQueue = [[]];
    const res = await request(app)
      .patch("/api/admin/active-directory/user/100/assignment")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ mspId: 5 });
    expect(res.status).toBe(404);
  });

  it("404s a target MSP that doesn't exist", async () => {
    mockResultQueue = [
      [{ mspRole: "MSPAdmin", mspId: 1, customerId: null }], // current row
      [], // target MSP lookup — not found
    ];
    const res = await request(app)
      .patch("/api/admin/active-directory/user/100/assignment")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ mspId: 999 });
    expect(res.status).toBe(404);
    expect(auditLogSpy).not.toHaveBeenCalled();
  });

  it("400s assigning a customer to an MSP-scoped role (invalid-reassignment rejection case)", async () => {
    mockResultQueue = [
      [{ mspRole: "MSPAdmin", mspId: 1, customerId: null }], // current row
      [{ mspId: 7 }], // target customer lookup resolves (but is the wrong field for this role)
    ];
    const res = await request(app)
      .patch("/api/admin/active-directory/user/100/assignment")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ customerId: 42 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot be assigned a customer/i);
    expect(auditLogSpy).not.toHaveBeenCalled();
  });

  it("200s a valid CustomerUser reassignment, deriving mspId from the target customer's real owning MSP", async () => {
    mockResultQueue = [
      [{ mspRole: "CustomerUser", mspId: 1, customerId: 10 }], // current row
      [{ mspId: 7 }], // target customer's owning MSP
      [], // update()
      [], // createAuditLog insert
    ];
    const res = await request(app)
      .patch("/api/admin/active-directory/user/100/assignment")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ customerId: 42 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, mspId: 7, customerId: 42 });
    expect(auditLogSpy).toHaveBeenCalledTimes(1);
    expect(auditLogSpy.mock.calls[0][0].actionType).toBe("user.assignment.update");
  });

  it("400s a client-supplied mspId alongside a customerId for a CustomerUser (mspId is always derived server-side)", async () => {
    mockResultQueue = [
      [{ mspRole: "CustomerUser", mspId: 1, customerId: 10 }], // current row
      [{ mspId: 7 }], // target customer lookup
      [{ id: 3 }], // target MSP lookup (since bodyMspId is also provided)
    ];
    const res = await request(app)
      .patch("/api/admin/active-directory/user/100/assignment")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ mspId: 3, customerId: 42 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/derived automatically/i);
    expect(auditLogSpy).not.toHaveBeenCalled();
  });
});

// ── GET/PATCH /admin/active-directory/user/:id/entitlements ──────────────────

describe("GET /admin/active-directory/user/:id/entitlements", () => {
  it("returns inherited/overrides/effective for an account with no MSP linkage (no subscription query issued)", async () => {
    mockResultQueue = [
      [], // usersTable lookup — no mspId
      [{ capabilityKey: "betaFeature", enabled: true, grantedByUserId: 1, createdAt: new Date(), updatedAt: new Date() }], // overrides
    ];
    const res = await request(app)
      .get("/api/admin/active-directory/user/100/entitlements")
      .set("Authorization", `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.inherited).toBeNull();
    expect(res.body.effective.tierCapabilities).toEqual({ betaFeature: true });
  });
});

describe("PATCH /admin/active-directory/user/:id/entitlements", () => {
  it("400s a missing capabilityKey", async () => {
    const res = await request(app)
      .patch("/api/admin/active-directory/user/100/entitlements")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ enabled: true });
    expect(res.status).toBe(400);
  });

  it("400s an invalid enabled value", async () => {
    const res = await request(app)
      .patch("/api/admin/active-directory/user/100/entitlements")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ capabilityKey: "copilot", enabled: "yes" });
    expect(res.status).toBe(400);
  });

  it("grants a capability override and audit-logs it", async () => {
    mockResultQueue = [
      [], // select before override
      [], // insert...onConflictDoUpdate
      [], // usersTable lookup for the post-write view — no mspId
      [{ capabilityKey: "copilot", enabled: true, grantedByUserId: 1, createdAt: new Date(), updatedAt: new Date() }], // overrides
    ];
    const res = await request(app)
      .patch("/api/admin/active-directory/user/100/entitlements")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ capabilityKey: "copilot", enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.effective.tierCapabilities).toEqual({ copilot: true });
    expect(auditLogSpy).toHaveBeenCalledTimes(1);
    expect(auditLogSpy.mock.calls[0][0].actionType).toBe("user.entitlement.grant");
  });

  it("clears an override (enabled: null) and audit-logs a clear action", async () => {
    mockResultQueue = [
      [{ enabled: false }], // select before override — an existing revoke override
      [], // delete()
      [], // usersTable lookup for the post-write view
      [], // overrides — now empty
    ];
    const res = await request(app)
      .patch("/api/admin/active-directory/user/100/entitlements")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ capabilityKey: "copilot", enabled: null });
    expect(res.status).toBe(200);
    expect(auditLogSpy).toHaveBeenCalledTimes(1);
    expect(auditLogSpy.mock.calls[0][0].actionType).toBe("user.entitlement.clear");
    expect(auditLogSpy.mock.calls[0][0].metadata).toEqual({ capabilityKey: "copilot", before: false, after: null });
  });
});
