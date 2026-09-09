// artifacts/api-server/src/routes/admin-rbac.ts
//
// Admin management surface for the RBAC foundation (#2455) — #2461, part of
// #1696 (RBAC Role Model Redesign). This is the backend AdminV2's re-pointed
// AD-style UI calls to manage `msp_roles`/`customer_roles`, their `*_user_roles`
// memberships, and `*_feature_role_mapping` allow/deny rows — additive
// alongside the existing `MSP_ROLES` ladder UI those screens already have.
//
// #2457 (express today's 7 roles as data) and #2458 (move enforcement onto the
// evaluator) have NOT landed. Nothing here changes what actually gates a
// request — `requireRole`/`MSP_ROLES` remain the real enforcement path exactly
// as #2455 left them. This route lets a PlatformAdmin build out the new model
// (roles, memberships, mappings) ahead of that cutover, which is what makes
// #2461 genuinely "parallel-safe once #2455's data model exists" per the issue.

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  assignUserRole,
  createRole,
  deleteRole,
  getMapping,
  listCapabilities,
  listMappings,
  listRoles,
  listUserRoles,
  removeUserRole,
  renameRole,
  resolveUserOrgId,
  upsertMapping,
  type RbacSystem,
} from "@workspace/db/rbac";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { createAuditLog } from "../lib/audit";

const router: IRouter = Router();
const log = logger.child({ channel: "admin.active-directory" });

function parseSystem(value: unknown): RbacSystem | null {
  return value === "msp" || value === "customer" ? value : null;
}

/** `orgId` query/body param: absent/null = platform scope, otherwise must be a real integer. */
function parseOrgId(value: unknown): { ok: true; orgId: number | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") return { ok: true, orgId: null };
  const n = Number(value);
  if (!Number.isInteger(n)) return { ok: false, error: "orgId must be an integer, or omitted for the platform scope." };
  return { ok: true, orgId: n };
}

function auditActor(req: Request): { actorUserId: number; actorName: string; actorRole: "admin" | "client" } {
  const user = req.user!;
  return { actorUserId: user.id, actorName: user.name ?? user.email, actorRole: user.role };
}

// ─── GET /admin/rbac/capabilities?system= ────────────────────────────────────
router.get("/admin/rbac/capabilities", requireAdmin, (req: Request, res: Response) => {
  const system = parseSystem(req.query.system);
  res.json({ capabilities: listCapabilities(system ?? undefined) });
});

// ─── GET /admin/rbac/roles?system=&orgId= ────────────────────────────────────
// Platform-scoped roles PLUS the given org's own roles.
router.get("/admin/rbac/roles", requireAdmin, async (req: Request, res: Response) => {
  const system = parseSystem(req.query.system);
  if (!system) {
    res.status(400).json({ error: "system must be 'msp' or 'customer'." });
    return;
  }
  const orgResult = parseOrgId(req.query.orgId);
  if (!orgResult.ok) {
    res.status(400).json({ error: orgResult.error });
    return;
  }

  try {
    const roles = await listRoles(db, system, orgResult.orgId);
    res.json({ roles });
  } catch (err) {
    log.error({ err, system }, "Failed to list RBAC roles");
    res.status(500).json({ error: "Failed to load roles" });
  }
});

// ─── POST /admin/rbac/roles ──────────────────────────────────────────────────
// Body: { system, orgId, key, name, description? }
router.post("/admin/rbac/roles", requireAdmin, async (req: Request, res: Response) => {
  const system = parseSystem(req.body?.system);
  if (!system) {
    res.status(400).json({ error: "system must be 'msp' or 'customer'." });
    return;
  }
  const orgResult = parseOrgId(req.body?.orgId);
  if (!orgResult.ok) {
    res.status(400).json({ error: orgResult.error });
    return;
  }
  const key = req.body?.key;
  const name = req.body?.name;
  if (typeof key !== "string" || typeof name !== "string") {
    res.status(400).json({ error: "key and name are required strings." });
    return;
  }

  try {
    const result = await createRole(db, system, {
      orgId: orgResult.orgId,
      key,
      name,
      description: typeof req.body?.description === "string" ? req.body.description : undefined,
    });
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    await createAuditLog({
      ...auditActor(req),
      actionType: "rbac.role.create",
      entityType: "rbac_role",
      entityId: result.role.id,
      metadata: { system, orgId: orgResult.orgId, key, name },
    });
    log.info({ system, roleId: result.role.id, key }, "PlatformAdmin created an RBAC role");
    res.status(201).json({ role: result.role });
  } catch (err) {
    log.error({ err, system }, "Failed to create RBAC role");
    res.status(500).json({ error: "Failed to create role" });
  }
});

// ─── PATCH /admin/rbac/roles/:id ─────────────────────────────────────────────
// Body: { system, name?, description? }
router.patch("/admin/rbac/roles/:id", requireAdmin, async (req: Request, res: Response) => {
  const system = parseSystem(req.body?.system);
  if (!system) {
    res.status(400).json({ error: "system must be 'msp' or 'customer'." });
    return;
  }
  const roleId = String(req.params.id);

  try {
    const result = await renameRole(db, system, roleId, {
      name: typeof req.body?.name === "string" ? req.body.name : undefined,
      description: typeof req.body?.description === "string" ? req.body.description : undefined,
    });
    if (!result.ok) {
      res.status(result.error === "Role not found." ? 404 : 400).json({ error: result.error });
      return;
    }
    await createAuditLog({
      ...auditActor(req),
      actionType: "rbac.role.update",
      entityType: "rbac_role",
      entityId: roleId,
      metadata: { system, name: req.body?.name, description: req.body?.description },
    });
    res.json({ role: result.role });
  } catch (err) {
    log.error({ err, system, roleId }, "Failed to update RBAC role");
    res.status(500).json({ error: "Failed to update role" });
  }
});

// ─── DELETE /admin/rbac/roles/:id?system= ────────────────────────────────────
router.delete("/admin/rbac/roles/:id", requireAdmin, async (req: Request, res: Response) => {
  const system = parseSystem(req.query.system);
  if (!system) {
    res.status(400).json({ error: "system must be 'msp' or 'customer'." });
    return;
  }
  const roleId = String(req.params.id);

  try {
    const result = await deleteRole(db, system, roleId);
    if (!result.ok) {
      res.status(result.error === "Role not found." ? 404 : 400).json({ error: result.error });
      return;
    }
    await createAuditLog({
      ...auditActor(req),
      actionType: "rbac.role.delete",
      entityType: "rbac_role",
      entityId: roleId,
      metadata: { system },
    });
    log.info({ system, roleId }, "PlatformAdmin deleted an RBAC role");
    res.status(204).send();
  } catch (err) {
    log.error({ err, system, roleId }, "Failed to delete RBAC role");
    res.status(500).json({ error: "Failed to delete role" });
  }
});

// ─── GET /admin/rbac/user/:userId/roles?system= ──────────────────────────────
router.get("/admin/rbac/user/:userId/roles", requireAdmin, async (req: Request, res: Response) => {
  const userId = Number(req.params.userId);
  const system = parseSystem(req.query.system);
  if (!Number.isInteger(userId)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  if (!system) {
    res.status(400).json({ error: "system must be 'msp' or 'customer'." });
    return;
  }

  try {
    const [roles, orgId] = await Promise.all([listUserRoles(db, system, userId), resolveUserOrgId(db, system, userId)]);
    res.json({ roles, orgId });
  } catch (err) {
    log.error({ err, system, userId }, "Failed to list a user's RBAC roles");
    res.status(500).json({ error: "Failed to load this user's roles" });
  }
});

// ─── POST /admin/rbac/user/:userId/roles ─────────────────────────────────────
// Body: { system, roleId }
router.post("/admin/rbac/user/:userId/roles", requireAdmin, async (req: Request, res: Response) => {
  const userId = Number(req.params.userId);
  const system = parseSystem(req.body?.system);
  const roleId = req.body?.roleId;
  if (!Number.isInteger(userId)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  if (!system) {
    res.status(400).json({ error: "system must be 'msp' or 'customer'." });
    return;
  }
  if (typeof roleId !== "string" || !roleId.trim()) {
    res.status(400).json({ error: "roleId is required." });
    return;
  }

  try {
    const result = await assignUserRole(db, system, userId, roleId, req.user!.id);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    await createAuditLog({
      ...auditActor(req),
      actionType: "rbac.user_role.grant",
      entityType: "user",
      entityId: userId,
      metadata: { system, roleId },
    });
    log.info({ system, userId, roleId }, "PlatformAdmin granted an RBAC role");
    res.json(await listUserRoles(db, system, userId).then((roles) => ({ roles })));
  } catch (err) {
    log.error({ err, system, userId, roleId }, "Failed to grant an RBAC role");
    res.status(500).json({ error: "Failed to grant this role" });
  }
});

// ─── DELETE /admin/rbac/user/:userId/roles/:roleId?system= ──────────────────
router.delete("/admin/rbac/user/:userId/roles/:roleId", requireAdmin, async (req: Request, res: Response) => {
  const userId = Number(req.params.userId);
  const system = parseSystem(req.query.system);
  const roleId = String(req.params.roleId);
  if (!Number.isInteger(userId)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  if (!system) {
    res.status(400).json({ error: "system must be 'msp' or 'customer'." });
    return;
  }

  try {
    await removeUserRole(db, system, userId, roleId);
    await createAuditLog({
      ...auditActor(req),
      actionType: "rbac.user_role.revoke",
      entityType: "user",
      entityId: userId,
      metadata: { system, roleId },
    });
    log.info({ system, userId, roleId }, "PlatformAdmin revoked an RBAC role");
    res.json({ roles: await listUserRoles(db, system, userId) });
  } catch (err) {
    log.error({ err, system, userId, roleId }, "Failed to revoke an RBAC role");
    res.status(500).json({ error: "Failed to revoke this role" });
  }
});

// ─── GET /admin/rbac/mappings?system=&orgId= ─────────────────────────────────
// Every capability's allow/deny row visible to this org (platform default +
// its own override, where present) — the raw material for a capability's
// admin editor. Rows that don't yet exist for a catalogued capability are
// synthesized as the empty payload so the UI has one row per capability.
router.get("/admin/rbac/mappings", requireAdmin, async (req: Request, res: Response) => {
  const system = parseSystem(req.query.system);
  if (!system) {
    res.status(400).json({ error: "system must be 'msp' or 'customer'." });
    return;
  }
  const orgResult = parseOrgId(req.query.orgId);
  if (!orgResult.ok) {
    res.status(400).json({ error: orgResult.error });
    return;
  }

  try {
    const [rows, catalog] = await Promise.all([listMappings(db, system, orgResult.orgId), Promise.resolve(listCapabilities(system))]);
    const byKey = new Map(rows.map((r) => [`${r.orgId ?? "platform"}:${r.capabilityKey}`, r]));

    const mappings = catalog.map((cap) => ({
      capability: cap,
      platform: byKey.get(`platform:${cap.key}`)?.roles ?? { allow: [], deny: [] },
      org: orgResult.orgId === null ? null : byKey.get(`${orgResult.orgId}:${cap.key}`)?.roles ?? { allow: [], deny: [] },
    }));

    res.json({ mappings });
  } catch (err) {
    log.error({ err, system }, "Failed to list RBAC mappings");
    res.status(500).json({ error: "Failed to load mappings" });
  }
});

// ─── PUT /admin/rbac/mapping ──────────────────────────────────────────────────
// Body: { system, orgId, capabilityKey, allow: string[], deny: string[] }
// Whole-payload replace for one (system, orgId, capabilityKey) row.
router.put("/admin/rbac/mapping", requireAdmin, async (req: Request, res: Response) => {
  const system = parseSystem(req.body?.system);
  if (!system) {
    res.status(400).json({ error: "system must be 'msp' or 'customer'." });
    return;
  }
  const orgResult = parseOrgId(req.body?.orgId);
  if (!orgResult.ok) {
    res.status(400).json({ error: orgResult.error });
    return;
  }
  const capabilityKey = req.body?.capabilityKey;
  if (typeof capabilityKey !== "string" || !capabilityKey.trim()) {
    res.status(400).json({ error: "capabilityKey is required." });
    return;
  }
  const allow = Array.isArray(req.body?.allow) ? req.body.allow.filter((v: unknown) => typeof v === "string") : [];
  const deny = Array.isArray(req.body?.deny) ? req.body.deny.filter((v: unknown) => typeof v === "string") : [];

  try {
    const before = await getMapping(db, system, orgResult.orgId, capabilityKey);
    const result = await upsertMapping(db, system, orgResult.orgId, capabilityKey, { allow, deny });
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    await createAuditLog({
      ...auditActor(req),
      actionType: "rbac.mapping.update",
      entityType: "rbac_feature_role_mapping",
      entityId: capabilityKey,
      metadata: { system, orgId: orgResult.orgId, before, after: result.roles },
    });
    log.info({ system, orgId: orgResult.orgId, capabilityKey }, "PlatformAdmin updated an RBAC feature→role mapping");
    res.json({ roles: result.roles });
  } catch (err) {
    log.error({ err, system, capabilityKey }, "Failed to update RBAC mapping");
    res.status(500).json({ error: "Failed to update this mapping" });
  }
});

export default router;
