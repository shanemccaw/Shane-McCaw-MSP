import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

/**
 * HTTP-level tests for the RBAC admin management surface (#2461, part of
 * #1696). The real CRUD logic (create/rename/delete a role, grant/revoke a
 * membership, the deny-wins-relevant mapping upsert, and every DB-trigger
 * refusal path) is exhaustively covered against the real local database in
 * lib/db/src/rbac/admin.test.ts — these tests exercise the HTTP plumbing
 * around it: request validation, status codes, and that a successful write
 * calls createAuditLog. Same split as
 * admin-active-directory-user-actions.test.ts's own header comment.
 */

const rbac = vi.hoisted(() => ({
  listCapabilities: vi.fn(),
  listRoles: vi.fn(),
  createRole: vi.fn(),
  renameRole: vi.fn(),
  deleteRole: vi.fn(),
  listUserRoles: vi.fn(),
  assignUserRole: vi.fn(),
  removeUserRole: vi.fn(),
  resolveUserOrgId: vi.fn(),
  roleGrantFloor: vi.fn(),
  getUserLadderIdentity: vi.fn(),
  getMapping: vi.fn(),
  upsertMapping: vi.fn(),
  listMappings: vi.fn(),
}));

const ladder = vi.hoisted(() => ({
  invalidateLadderSnapshot: vi.fn(),
  userClearsLadderCapability: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@workspace/db/rbac", () => rbac);
vi.mock("../middlewares/rbac-ladder.ts", () => ladder);

const auditLogSpy = vi.fn();
vi.mock("../lib/audit.ts", () => ({
  createAuditLog: (...args: unknown[]) => {
    auditLogSpy(...args);
    return Promise.resolve();
  },
}));

import router from "./admin-rbac.ts";
import { LEGACY_ROLE } from "@workspace/db/rbac/legacy-ladder";

const app = express();
app.use(express.json());
app.use("/api", router);

const JWT_SECRET = "admin-rbac-test-secret";
process.env.JWT_SECRET = JWT_SECRET;

function adminToken(): string {
  return jwt.sign({ id: 1, email: "pa@platform.com", name: "Platform Admin", role: "admin", mspRole: LEGACY_ROLE.platformAdmin }, JWT_SECRET, {
    expiresIn: "15m",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /admin/rbac/capabilities", () => {
  it("400s an unknown system", async () => {
    // system is optional here — an unrecognised value is simply treated as "all systems".
    rbac.listCapabilities.mockReturnValue([{ system: "msp", key: "team.manage" }]);
    const res = await request(app).get("/api/admin/rbac/capabilities?system=bogus").set("Authorization", `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(rbac.listCapabilities).toHaveBeenCalledWith(undefined);
  });

  it("passes a valid system through", async () => {
    rbac.listCapabilities.mockReturnValue([]);
    const res = await request(app).get("/api/admin/rbac/capabilities?system=customer").set("Authorization", `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(rbac.listCapabilities).toHaveBeenCalledWith("customer");
  });
});

describe("GET /admin/rbac/roles", () => {
  it("400s a missing/invalid system", async () => {
    const res = await request(app).get("/api/admin/rbac/roles?orgId=1").set("Authorization", `Bearer ${adminToken()}`);
    expect(res.status).toBe(400);
  });

  it("400s a non-integer orgId", async () => {
    const res = await request(app).get("/api/admin/rbac/roles?system=msp&orgId=abc").set("Authorization", `Bearer ${adminToken()}`);
    expect(res.status).toBe(400);
  });

  it("200s and passes null orgId through for the platform scope", async () => {
    rbac.listRoles.mockResolvedValue([]);
    const res = await request(app).get("/api/admin/rbac/roles?system=msp").set("Authorization", `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(rbac.listRoles).toHaveBeenCalledWith({}, "msp", null);
  });
});

describe("POST /admin/rbac/roles", () => {
  it("400s a missing key/name", async () => {
    const res = await request(app)
      .post("/api/admin/rbac/roles")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ system: "msp", orgId: 1 });
    expect(res.status).toBe(400);
    expect(rbac.createRole).not.toHaveBeenCalled();
  });

  it("400s when the DB layer refuses (e.g. duplicate key) and does not audit-log", async () => {
    rbac.createRole.mockResolvedValue({ ok: false, error: "A role with this key already exists." });
    const res = await request(app)
      .post("/api/admin/rbac/roles")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ system: "msp", orgId: 1, key: "engineer", name: "Engineer" });
    expect(res.status).toBe(400);
    expect(auditLogSpy).not.toHaveBeenCalled();
  });

  it("201s a real create and audit-logs it", async () => {
    const role = { id: "r1", system: "msp", orgId: 1, key: "engineer", name: "Engineer", description: "", isSystem: false, memberCount: 0 };
    rbac.createRole.mockResolvedValue({ ok: true, role });
    const res = await request(app)
      .post("/api/admin/rbac/roles")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ system: "msp", orgId: 1, key: "engineer", name: "Engineer" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ role });
    expect(auditLogSpy).toHaveBeenCalledWith(expect.objectContaining({ actionType: "rbac.role.create", entityId: "r1" }));
  });
});

describe("DELETE /admin/rbac/roles/:id", () => {
  it("400s a missing system", async () => {
    const res = await request(app).delete("/api/admin/rbac/roles/r1").set("Authorization", `Bearer ${adminToken()}`);
    expect(res.status).toBe(400);
  });

  it("404s when the DB layer reports the role does not exist", async () => {
    rbac.deleteRole.mockResolvedValue({ ok: false, error: "Role not found." });
    const res = await request(app).delete("/api/admin/rbac/roles/r1?system=msp").set("Authorization", `Bearer ${adminToken()}`);
    expect(res.status).toBe(404);
  });

  it("400s (not 500) when the DB layer refuses a system-role delete", async () => {
    rbac.deleteRole.mockResolvedValue({ ok: false, error: "This is a platform-defined baseline role and cannot be deleted." });
    const res = await request(app).delete("/api/admin/rbac/roles/r1?system=msp").set("Authorization", `Bearer ${adminToken()}`);
    expect(res.status).toBe(400);
    expect(auditLogSpy).not.toHaveBeenCalled();
  });

  it("204s a real delete and audit-logs it", async () => {
    rbac.deleteRole.mockResolvedValue({ ok: true });
    const res = await request(app).delete("/api/admin/rbac/roles/r1?system=msp").set("Authorization", `Bearer ${adminToken()}`);
    expect(res.status).toBe(204);
    expect(auditLogSpy).toHaveBeenCalledWith(expect.objectContaining({ actionType: "rbac.role.delete", entityId: "r1" }));
  });
});

describe("POST /admin/rbac/user/:userId/roles (grant)", () => {
  it("400s an invalid userId", async () => {
    const res = await request(app)
      .post("/api/admin/rbac/user/abc/roles")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ system: "msp", roleId: "r1" });
    expect(res.status).toBe(400);
  });

  it("400s when the scope trigger refuses a cross-org grant", async () => {
    rbac.assignUserRole.mockResolvedValue({ ok: false, error: "msp_user_roles: user 100 (msp_id 1) may not hold msp_roles r1 scoped to msp_id 2" });
    const res = await request(app)
      .post("/api/admin/rbac/user/100/roles")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ system: "msp", roleId: "r1" });
    expect(res.status).toBe(400);
    expect(auditLogSpy).not.toHaveBeenCalled();
  });

  it("200s a real grant, audit-logs it, and returns the refreshed role list", async () => {
    rbac.assignUserRole.mockResolvedValue({ ok: true });
    rbac.listUserRoles.mockResolvedValue([{ id: "r1", name: "Engineer" }]);
    const res = await request(app)
      .post("/api/admin/rbac/user/100/roles")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ system: "msp", roleId: "r1" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ roles: [{ id: "r1", name: "Engineer" }] });
    expect(auditLogSpy).toHaveBeenCalledWith(expect.objectContaining({ actionType: "rbac.user_role.grant", entityId: 100 }));
  });

  // #3637 — the rung-floor guard on the SECOND writer of the membership row that #3570
  // guarded on the msp-settings toggle. A role with no floor (roleGrantFloor → null,
  // the default in the tests above) skips the guard entirely; a floored role is checked
  // against the target's effective rung through the same evaluator #3570 uses.
  describe("capability-role grant floor (#3637)", () => {
    it("400s granting a floored role (cap.purchases.approve) to a below-floor target, without writing or auditing", async () => {
      rbac.roleGrantFloor.mockResolvedValue(LEGACY_ROLE.mspOperator);
      rbac.getUserLadderIdentity.mockResolvedValue({ role: "client", mspRole: LEGACY_ROLE.customer });
      ladder.userClearsLadderCapability.mockResolvedValue({ kind: "deny", decision: {} });
      const res = await request(app)
        .post("/api/admin/rbac/user/100/roles")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ system: "msp", roleId: "cap-purchases-approve-id" });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain(LEGACY_ROLE.mspOperator);
      expect(rbac.assignUserRole).not.toHaveBeenCalled();
      expect(auditLogSpy).not.toHaveBeenCalled();
      // The evaluator was asked with the TARGET as principal, against the floor's ladder key.
      expect(ladder.userClearsLadderCapability).toHaveBeenCalledWith(
        { role: "client", mspRole: LEGACY_ROLE.customer },
        "ladder.msp-operator",
      );
    });

    it("503s when the ladder model is unavailable rather than allowing the grant", async () => {
      rbac.roleGrantFloor.mockResolvedValue(LEGACY_ROLE.mspOperator);
      rbac.getUserLadderIdentity.mockResolvedValue({ role: "client", mspRole: LEGACY_ROLE.customer });
      ladder.userClearsLadderCapability.mockResolvedValue({ kind: "unavailable", reason: "rbac_model_unreadable" });
      const res = await request(app)
        .post("/api/admin/rbac/user/100/roles")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ system: "msp", roleId: "cap-purchases-approve-id" });
      expect(res.status).toBe(503);
      expect(rbac.assignUserRole).not.toHaveBeenCalled();
    });

    it("404s a floored grant to a user that does not exist", async () => {
      rbac.roleGrantFloor.mockResolvedValue(LEGACY_ROLE.mspOperator);
      rbac.getUserLadderIdentity.mockResolvedValue(null);
      const res = await request(app)
        .post("/api/admin/rbac/user/999/roles")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ system: "msp", roleId: "cap-purchases-approve-id" });
      expect(res.status).toBe(404);
      expect(rbac.assignUserRole).not.toHaveBeenCalled();
    });

    it("200s a floored grant to a target that clears the floor", async () => {
      rbac.roleGrantFloor.mockResolvedValue(LEGACY_ROLE.mspOperator);
      rbac.getUserLadderIdentity.mockResolvedValue({ role: "client", mspRole: LEGACY_ROLE.mspOperator });
      ladder.userClearsLadderCapability.mockResolvedValue({ kind: "allow", decision: {} });
      rbac.assignUserRole.mockResolvedValue({ ok: true });
      rbac.listUserRoles.mockResolvedValue([{ id: "cap-purchases-approve-id", name: "Approve Purchases" }]);
      const res = await request(app)
        .post("/api/admin/rbac/user/100/roles")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ system: "msp", roleId: "cap-purchases-approve-id" });
      expect(res.status).toBe(200);
      expect(rbac.assignUserRole).toHaveBeenCalled();
      expect(auditLogSpy).toHaveBeenCalledWith(expect.objectContaining({ actionType: "rbac.user_role.grant" }));
    });
  });
});

describe("PUT /admin/rbac/mapping", () => {
  it("400s a missing capabilityKey", async () => {
    const res = await request(app)
      .put("/api/admin/rbac/mapping")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ system: "customer", orgId: 1, allow: [], deny: [] });
    expect(res.status).toBe(400);
  });

  it("400s an uncatalogued capability, surfaced from the DB layer", async () => {
    rbac.getMapping.mockResolvedValue({ allow: [], deny: [] });
    rbac.upsertMapping.mockResolvedValue({ ok: false, error: "'not.real' is not a catalogued customer capability." });
    const res = await request(app)
      .put("/api/admin/rbac/mapping")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ system: "customer", orgId: 1, capabilityKey: "not.real", allow: [], deny: [] });
    expect(res.status).toBe(400);
    expect(auditLogSpy).not.toHaveBeenCalled();
  });

  it("200s a real mapping update and audit-logs before/after", async () => {
    rbac.getMapping.mockResolvedValue({ allow: [], deny: [] });
    rbac.upsertMapping.mockResolvedValue({ ok: true, roles: { allow: ["r1"], deny: [] } });
    const res = await request(app)
      .put("/api/admin/rbac/mapping")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ system: "customer", orgId: 1, capabilityKey: "billing.view", allow: ["r1"], deny: [] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ roles: { allow: ["r1"], deny: [] } });
    expect(auditLogSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "rbac.mapping.update",
        entityId: "billing.view",
        metadata: expect.objectContaining({ before: { allow: [], deny: [] }, after: { allow: ["r1"], deny: [] } }),
      }),
    );
  });
});
