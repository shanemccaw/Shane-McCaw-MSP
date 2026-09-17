// artifacts/api-server/src/routes/admin-active-directory-ou.ts
//
// OU / policy-engine surface — split out of admin-active-directory.ts
// (Git #4495). This is the genuinely AD-terminology half: real Organizational
// Unit placeholder objects and their manual membership assignments, consumed
// by the standing-policy engine (policy-compliance-evaluator.ts,
// policy-compliance-graph.ts). Paths, behavior and the underlying
// activeDirectoryOusTable/activeDirectoryOuAssignmentsTable tables are
// UNCHANGED by the split — relocation only. The Tenant/Customer/MSP/User/Group
// management routes that used to live alongside these moved to
// admin-msp-directory.ts under new `/admin/msp-directory/*` paths; these OU
// routes keep their original `/admin/active-directory/ou*` paths.

import { Router, type IRouter, type Request, type Response } from "express";
import { db, activeDirectoryOusTable, activeDirectoryOuAssignmentsTable, tenantsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { logger } from "../lib/logger.ts";
import { createAuditLog } from "../lib/audit.ts";
import { graphFetchForTenant } from "../lib/graph.ts";

const router: IRouter = Router();
const log = logger.child({ channel: "admin.active-directory" });

function auditActor(req: Request): { actorUserId: number; actorName: string; actorRole: "admin" | "client" } {
  const user = req.user!;
  return { actorUserId: user.id, actorName: user.name ?? user.email, actorRole: user.role };
}

// ─── OU CRUD (Phase 5) ────────────────────────────────────────────────────────
// Organizational Unit placeholder objects — create/list/rename/delete a
// container node only. No policy logic, no object-to-OU membership model.

// `tenantId` (#1549): optional, nullable — which real customer tenant this OU
// governs. Validated against a real tenants row when provided; never a bare
// pass-through int, and never required (a platform/MSP-level OU has none).
async function resolveOuTenantId(body: unknown): Promise<{ ok: true; tenantId: number | null } | { ok: false; error: string }> {
  const raw = (body as Record<string, unknown> | null | undefined)?.tenantId;
  if (raw === undefined || raw === null) return { ok: true, tenantId: null };
  const tenantId = Number(raw);
  if (!Number.isInteger(tenantId)) return { ok: false, error: "tenantId must be an integer" };
  const [tenant] = await db.select({ id: tenantsTable.id }).from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1);
  if (!tenant) return { ok: false, error: `Tenant '${tenantId}' does not exist` };
  return { ok: true, tenantId };
}

router.post("/admin/active-directory/ou", requireAdmin, async (req: Request, res: Response) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "OU name is required" });
    return;
  }
  const tenantResolution = await resolveOuTenantId(req.body);
  if (!tenantResolution.ok) {
    res.status(400).json({ error: tenantResolution.error });
    return;
  }

  try {
    const [created] = await db.insert(activeDirectoryOusTable).values({ name, tenantId: tenantResolution.tenantId }).returning();
    res.status(201).json(created);
  } catch (err) {
    log.error({ err }, "Failed to create OU");
    res.status(500).json({ error: "Failed to create OU" });
  }
});

router.patch("/admin/active-directory/ou/:id", requireAdmin, async (req: Request, res: Response) => {
  const ouId = Number(req.params.id);
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!Number.isInteger(ouId)) {
    res.status(400).json({ error: "Invalid OU id" });
    return;
  }
  if (!name) {
    res.status(400).json({ error: "OU name is required" });
    return;
  }
  // tenantId is only touched when the caller explicitly sends the key — omitting
  // it entirely leaves the OU's existing tenant attachment untouched on a rename.
  const bodyHasTenantId = req.body != null && Object.prototype.hasOwnProperty.call(req.body, "tenantId");
  let tenantId: number | null | undefined;
  if (bodyHasTenantId) {
    const tenantResolution = await resolveOuTenantId(req.body);
    if (!tenantResolution.ok) {
      res.status(400).json({ error: tenantResolution.error });
      return;
    }
    tenantId = tenantResolution.tenantId;
  }

  try {
    const [updated] = await db
      .update(activeDirectoryOusTable)
      .set({ name, ...(bodyHasTenantId ? { tenantId } : {}), updatedAt: new Date() })
      .where(eq(activeDirectoryOusTable.id, ouId))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "OU not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    log.error({ err, ouId }, "Failed to rename OU");
    res.status(500).json({ error: "Failed to rename OU" });
  }
});

router.delete("/admin/active-directory/ou/:id", requireAdmin, async (req: Request, res: Response) => {
  const ouId = Number(req.params.id);
  if (!Number.isInteger(ouId)) {
    res.status(400).json({ error: "Invalid OU id" });
    return;
  }

  try {
    const [deleted] = await db.delete(activeDirectoryOusTable).where(eq(activeDirectoryOusTable.id, ouId)).returning();
    if (!deleted) {
      res.status(404).json({ error: "OU not found" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    log.error({ err, ouId }, "Failed to delete OU");
    res.status(500).json({ error: "Failed to delete OU" });
  }
});

// ─── OU manual membership assignment (Git #1952) ─────────────────────────────
// Shane's final decision on #1952: department-match (policy-compliance-graph.ts)
// stays the automatic OU-membership resolution, but a real Graph object can be
// EXPLICITLY assigned to an OU, taking precedence over that guess — most tenants
// don't populate `department` at all, and where set it's often stale. Same
// requireAdmin (PlatformAdmin-only) gate as the OU CRUD above; if this needs to
// become customer-self-service instead, that is a follow-up decision, not one
// this build makes silently — see the finding filed alongside this build.
//
// The assigned object is always verified against the real Graph tenant at
// assign time (never trusted from client input alone) — this is what makes the
// row real rather than an invented membership claim.

// Exported (Git #2148) so msp-active-directory.ts's MSP-staff-gated mirror of
// this same CRUD can reuse the identical tenant-resolution and Graph
// verification logic rather than duplicating it — the routes differ only in
// their auth gate and staff-scoping, never in how a customer or object is
// resolved and verified.
export async function resolveAssignmentCustomer(customerId: unknown): Promise<
  | { ok: true; customerId: number; mspId: number; graphTenantId: string }
  | { ok: false; error: string }
> {
  const id = Number(customerId);
  if (!Number.isInteger(id)) return { ok: false, error: "customerId must be an integer" };
  const [tenant] = await db
    .select({ id: tenantsTable.id, mspId: tenantsTable.mspId, tenantId: tenantsTable.tenantId })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, id))
    .limit(1);
  if (!tenant) return { ok: false, error: `Customer '${id}' does not exist` };
  return { ok: true, customerId: tenant.id, mspId: tenant.mspId, graphTenantId: tenant.tenantId };
}

/** Real Graph user lookup by UPN — the verification step that keeps an assignment real. */
export async function resolveGraphUserByUpn(graphTenantId: string, upn: string): Promise<
  | { ok: true; id: string; userPrincipalName: string; displayName: string | null }
  | { ok: false; error: string }
> {
  const res = await graphFetchForTenant(
    graphTenantId,
    `/users/${encodeURIComponent(upn)}?$select=id,userPrincipalName,displayName`,
  );
  if (res.status === 404) {
    return { ok: false, error: `No Graph user found for '${upn}' on this tenant` };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `Graph lookup failed (${res.status}): ${text.slice(0, 300)}` };
  }
  const body = (await res.json()) as { id: string; userPrincipalName: string; displayName: string | null };
  return { ok: true, id: body.id, userPrincipalName: body.userPrincipalName, displayName: body.displayName ?? null };
}

// GET /admin/active-directory/ou/:id/assignments
// List every real manual assignment currently pointed at this OU.
router.get("/admin/active-directory/ou/:id/assignments", requireAdmin, async (req: Request, res: Response) => {
  const ouId = Number(req.params.id);
  if (!Number.isInteger(ouId)) {
    res.status(400).json({ error: "Invalid OU id" });
    return;
  }

  try {
    const rows = await db
      .select()
      .from(activeDirectoryOuAssignmentsTable)
      .where(eq(activeDirectoryOuAssignmentsTable.ouId, ouId))
      .orderBy(asc(activeDirectoryOuAssignmentsTable.objectUpn));

    await createAuditLog({
      actorUserId: req.user!.id,
      actorName: req.user!.email ?? "platform-admin",
      actorRole: "platform_admin",
      actionType: "admin_ou_assignments_viewed",
      actionCategory: "access",
      entityType: "active_directory_ou_assignment",
      entityId: ouId,
      metadata: { count: rows.length },
    });

    res.json(rows);
  } catch (err) {
    log.error({ err, ouId }, "Failed to load OU assignments");
    res.status(500).json({ error: "Failed to load OU assignments" });
  }
});

// POST /admin/active-directory/ou/:id/assignments
// Body: { customerId: number, objectUpn: string }. Upserts on (customerId,
// objectId) — re-assigning an already-assigned object moves it to this OU
// rather than creating a second row, matching real AD's one-object-one-OU shape.
router.post("/admin/active-directory/ou/:id/assignments", requireAdmin, async (req: Request, res: Response) => {
  const ouId = Number(req.params.id);
  if (!Number.isInteger(ouId)) {
    res.status(400).json({ error: "Invalid OU id" });
    return;
  }
  const objectUpn = typeof req.body?.objectUpn === "string" ? req.body.objectUpn.trim() : "";
  if (!objectUpn) {
    res.status(400).json({ error: "objectUpn is required" });
    return;
  }

  const [ou] = await db.select().from(activeDirectoryOusTable).where(eq(activeDirectoryOusTable.id, ouId)).limit(1);
  if (!ou) {
    res.status(404).json({ error: "OU not found" });
    return;
  }

  const customerResolution = await resolveAssignmentCustomer(req.body?.customerId);
  if (!customerResolution.ok) {
    res.status(400).json({ error: customerResolution.error });
    return;
  }
  const { customerId, mspId, graphTenantId } = customerResolution;

  // A customer-scoped OU (tenantId set) only accepts objects from that same
  // customer. A platform/MSP-level OU (tenantId null) accepts any customer,
  // matching how the department-match guess already applies across an MSP's
  // whole tenant roster.
  if (ou.tenantId !== null && ou.tenantId !== customerId) {
    res.status(400).json({ error: `OU '${ou.name}' belongs to a different customer than '${customerId}'` });
    return;
  }

  const graphUser = await resolveGraphUserByUpn(graphTenantId, objectUpn);
  if (!graphUser.ok) {
    res.status(400).json({ error: graphUser.error });
    return;
  }

  try {
    const [assignment] = await db
      .insert(activeDirectoryOuAssignmentsTable)
      .values({
        mspId,
        ouId,
        customerId,
        tenantId: graphTenantId,
        objectId: graphUser.id,
        objectUpn: graphUser.userPrincipalName,
        objectDisplayName: graphUser.displayName,
        assignedByUserId: req.user!.id,
      })
      .onConflictDoUpdate({
        target: [activeDirectoryOuAssignmentsTable.customerId, activeDirectoryOuAssignmentsTable.objectId],
        set: {
          ouId,
          objectUpn: graphUser.userPrincipalName,
          objectDisplayName: graphUser.displayName,
          assignedByUserId: req.user!.id,
          updatedAt: new Date(),
        },
      })
      .returning();

    await createAuditLog({
      ...auditActor(req),
      actionType: "active_directory.ou_assignment.set",
      entityType: "active_directory_ou",
      entityId: ouId,
      metadata: { customerId, objectId: graphUser.id, objectUpn: graphUser.userPrincipalName, ouName: ou.name },
    });
    log.info({ ouId, customerId, objectId: graphUser.id }, "PlatformAdmin manually assigned an object to an OU");

    res.status(201).json(assignment);
  } catch (err) {
    log.error({ err, ouId, customerId }, "Failed to assign object to OU");
    res.status(500).json({ error: "Failed to assign object to OU" });
  }
});

// PATCH /admin/active-directory/ou-assignments/:id
// Body: { ouId: number }. Moves an existing manual assignment to a different OU.
router.patch("/admin/active-directory/ou-assignments/:id", requireAdmin, async (req: Request, res: Response) => {
  const assignmentId = Number(req.params.id);
  const newOuId = Number(req.body?.ouId);
  if (!Number.isInteger(assignmentId)) {
    res.status(400).json({ error: "Invalid assignment id" });
    return;
  }
  if (!Number.isInteger(newOuId)) {
    res.status(400).json({ error: "ouId is required" });
    return;
  }

  const [ou] = await db.select().from(activeDirectoryOusTable).where(eq(activeDirectoryOusTable.id, newOuId)).limit(1);
  if (!ou) {
    res.status(400).json({ error: `OU '${newOuId}' does not exist` });
    return;
  }

  try {
    const [existing] = await db
      .select()
      .from(activeDirectoryOuAssignmentsTable)
      .where(eq(activeDirectoryOuAssignmentsTable.id, assignmentId))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Assignment not found" });
      return;
    }
    if (ou.tenantId !== null && ou.tenantId !== existing.customerId) {
      res.status(400).json({ error: `OU '${ou.name}' belongs to a different customer than this assignment's` });
      return;
    }

    const [updated] = await db
      .update(activeDirectoryOuAssignmentsTable)
      .set({ ouId: newOuId, updatedAt: new Date() })
      .where(eq(activeDirectoryOuAssignmentsTable.id, assignmentId))
      .returning();

    await createAuditLog({
      ...auditActor(req),
      actionType: "active_directory.ou_assignment.move",
      entityType: "active_directory_ou",
      entityId: newOuId,
      metadata: { assignmentId, fromOuId: existing.ouId, toOuId: newOuId, objectId: existing.objectId },
    });
    log.info({ assignmentId, fromOuId: existing.ouId, toOuId: newOuId }, "PlatformAdmin moved a manual OU assignment");

    res.json(updated);
  } catch (err) {
    log.error({ err, assignmentId, newOuId }, "Failed to move OU assignment");
    res.status(500).json({ error: "Failed to move OU assignment" });
  }
});

// DELETE /admin/active-directory/ou-assignments/:id
// Removes the manual override — the object reverts to the department-match guess.
router.delete("/admin/active-directory/ou-assignments/:id", requireAdmin, async (req: Request, res: Response) => {
  const assignmentId = Number(req.params.id);
  if (!Number.isInteger(assignmentId)) {
    res.status(400).json({ error: "Invalid assignment id" });
    return;
  }

  try {
    const [deleted] = await db
      .delete(activeDirectoryOuAssignmentsTable)
      .where(eq(activeDirectoryOuAssignmentsTable.id, assignmentId))
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Assignment not found" });
      return;
    }

    await createAuditLog({
      ...auditActor(req),
      actionType: "active_directory.ou_assignment.clear",
      entityType: "active_directory_ou",
      entityId: deleted.ouId,
      metadata: { assignmentId, objectId: deleted.objectId, customerId: deleted.customerId },
    });
    log.info({ assignmentId, ouId: deleted.ouId }, "PlatformAdmin cleared a manual OU assignment");

    res.status(204).send();
  } catch (err) {
    log.error({ err, assignmentId }, "Failed to delete OU assignment");
    res.status(500).json({ error: "Failed to delete OU assignment" });
  }
});
export default router;
