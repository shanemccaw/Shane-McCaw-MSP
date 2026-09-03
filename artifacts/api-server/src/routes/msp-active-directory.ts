/**
 * msp-active-directory.ts — MSP-side OU manual assignment ("set" capability).
 *
 * Git #2148: #1952 built the manual OU-membership override
 * (`active_directory_ou_assignments`) admin-only, gated by `requireAdmin`
 * (`admin-active-directory.ts`), and explicitly left "should this be
 * MSP/customer self-service instead?" as an open finding. Shane's real
 * decision on #2148 (2026-09-03): OU-based policy assignment is set by the
 * MSP, through the MSP Portal — not admin-panel's AdminV2-only surface, and
 * not customer self-service (that is genuinely new scope, filed as its own
 * sibling finding, not built here).
 *
 * This file is the MSP-staff-gated mirror of that same CRUD — same table,
 * same real-Graph-verification-at-assign-time discipline, same resolution
 * order in policy-compliance-graph.ts (manual assignment first, then the
 * department-match guess). It does not replace or weaken the admin-only
 * routes in admin-active-directory.ts, which stay exactly as they are for
 * Shane/platform-admin access — this only adds a second, narrower path onto
 * the same data.
 *
 *   GET    /api/msp/active-directory/ou/:id/assignments
 *   POST   /api/msp/active-directory/ou/:id/assignments
 *   PATCH  /api/msp/active-directory/ou-assignments/:id
 *   DELETE /api/msp/active-directory/ou-assignments/:id
 *
 * Every route is gated `requireRole("MSPOperator")` (MSPAdmin and
 * PlatformAdmin clear that floor too) and scoped through
 * `assertCustomerAccess` — the same ownership + per-staff-scoping single
 * source of truth every other `/api/msp/*` route in this repo uses. A
 * customer outside the caller's book (wrong MSP, or outside a scoped staff
 * member's assigned set) 404s exactly like "not found" — its existence is
 * never disclosed, matching msp-diagnostics.ts / msp-engine-history.ts.
 *
 * MSP-side restriction beyond what the admin route allows: a null-tenantId
 * OU (a platform/MSP-level grouping node — see active_directory_ous' own
 * schema comment) is never a valid target for an MSP-initiated read or write
 * here, only for PlatformAdmin via the admin route. An OU carries no mspId
 * column of its own; a tenant-less OU cannot be proven to belong to any one
 * MSP, so allowing it here would let one MSP's staff read or write into a
 * node another MSP's customer might also share. Every MSP-side assignment
 * therefore requires `ou.tenantId === the target customerId` — never the
 * platform-wide null-tenant case.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, activeDirectoryOusTable, activeDirectoryOuAssignmentsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAuth, requireRole, assertCustomerAccess } from "../middlewares/requireAuth";
import { resolveMspIdStrict } from "../lib/resolve-msp-id";
import { apiError, ApiErrorCode } from "../lib/api-helpers";
import { logger } from "../lib/logger";
import { createAuditLog } from "../lib/audit";
import { resolveAssignmentCustomer, resolveGraphUserByUpn } from "./admin-active-directory";

const router: IRouter = Router();
const log = logger.child({ channel: "tenant.active-directory" });

function auditActor(req: Request): { actorUserId: number; actorName: string; actorRole: "admin" | "client" } {
  const user = req.user!;
  return { actorUserId: user.id, actorName: user.name ?? user.email, actorRole: user.role };
}

// ── GET /msp/active-directory/ou/:id/assignments ──────────────────────────────
// List every real manual assignment currently pointed at this OU, scoped to
// the caller's own MSP book.
router.get(
  "/msp/active-directory/ou/:id/assignments",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    const mspId = resolveMspIdStrict(req);
    if (mspId === null) {
      apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
      return;
    }

    const ouId = Number(req.params.id);
    if (!Number.isInteger(ouId)) {
      apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid OU id");
      return;
    }

    try {
      const [ou] = await db.select().from(activeDirectoryOusTable).where(eq(activeDirectoryOusTable.id, ouId)).limit(1);
      // A tenant-less OU never surfaces here (see header comment), and a
      // customer-scoped OU outside this MSP's book 404s the same as a
      // genuinely missing OU — its existence is never disclosed.
      if (!ou || ou.tenantId === null || !(await assertCustomerAccess(req.user!, ou.tenantId))) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "OU not found");
        return;
      }

      const rows = await db
        .select()
        .from(activeDirectoryOuAssignmentsTable)
        .where(eq(activeDirectoryOuAssignmentsTable.ouId, ouId))
        .orderBy(asc(activeDirectoryOuAssignmentsTable.objectUpn));
      res.json(rows);
    } catch (err) {
      log.error({ err, ouId, mspId }, "Failed to load OU assignments");
      apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to load OU assignments");
    }
  },
);

// ── POST /msp/active-directory/ou/:id/assignments ─────────────────────────────
// Body: { customerId: number, objectUpn: string }. Upserts on (customerId,
// objectId) — re-assigning an already-assigned object moves it to this OU
// rather than creating a second row, matching real AD's one-object-one-OU shape.
router.post(
  "/msp/active-directory/ou/:id/assignments",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    const mspId = resolveMspIdStrict(req);
    if (mspId === null) {
      apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
      return;
    }

    const ouId = Number(req.params.id);
    if (!Number.isInteger(ouId)) {
      apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid OU id");
      return;
    }
    const objectUpn = typeof req.body?.objectUpn === "string" ? req.body.objectUpn.trim() : "";
    if (!objectUpn) {
      apiError(res, 400, ApiErrorCode.VALIDATION, "objectUpn is required");
      return;
    }

    const [ou] = await db.select().from(activeDirectoryOusTable).where(eq(activeDirectoryOusTable.id, ouId)).limit(1);
    if (!ou) {
      apiError(res, 404, ApiErrorCode.NOT_FOUND, "OU not found");
      return;
    }

    const customerResolution = await resolveAssignmentCustomer(req.body?.customerId);
    if (!customerResolution.ok) {
      apiError(res, 400, ApiErrorCode.VALIDATION, customerResolution.error);
      return;
    }
    const { customerId, mspId: customerMspId, graphTenantId } = customerResolution;

    // Ownership + per-staff scoping via the shared source of truth — never
    // across an MSP boundary, never outside a scoped staff member's book.
    if (!(await assertCustomerAccess(req.user!, customerId))) {
      apiError(res, 404, ApiErrorCode.NOT_FOUND, "Customer not found");
      return;
    }

    // MSP-side restriction (see header comment): only a customer-scoped OU
    // that matches the target customer is a valid write target here — the
    // platform-wide null-tenant case the admin route allows is refused.
    if (ou.tenantId === null || ou.tenantId !== customerId) {
      apiError(res, 400, ApiErrorCode.VALIDATION, `OU '${ou.name}' is not scoped to customer '${customerId}'`);
      return;
    }

    const graphUser = await resolveGraphUserByUpn(graphTenantId, objectUpn);
    if (!graphUser.ok) {
      apiError(res, 400, ApiErrorCode.VALIDATION, graphUser.error);
      return;
    }

    try {
      const [assignment] = await db
        .insert(activeDirectoryOuAssignmentsTable)
        .values({
          mspId: customerMspId,
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
        metadata: { customerId, objectId: graphUser.id, objectUpn: graphUser.userPrincipalName, ouName: ou.name, actorSurface: "msp" },
      });
      log.info({ ouId, customerId, objectId: graphUser.id, mspId }, "MSP staff manually assigned an object to an OU");

      res.status(201).json(assignment);
    } catch (err) {
      log.error({ err, ouId, customerId, mspId }, "Failed to assign object to OU");
      apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to assign object to OU");
    }
  },
);

// ── PATCH /msp/active-directory/ou-assignments/:id ────────────────────────────
// Body: { ouId: number }. Moves an existing manual assignment to a different OU.
router.patch(
  "/msp/active-directory/ou-assignments/:id",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    const mspId = resolveMspIdStrict(req);
    if (mspId === null) {
      apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
      return;
    }

    const assignmentId = Number(req.params.id);
    const newOuId = Number(req.body?.ouId);
    if (!Number.isInteger(assignmentId)) {
      apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid assignment id");
      return;
    }
    if (!Number.isInteger(newOuId)) {
      apiError(res, 400, ApiErrorCode.VALIDATION, "ouId is required");
      return;
    }

    try {
      const [existing] = await db
        .select()
        .from(activeDirectoryOuAssignmentsTable)
        .where(eq(activeDirectoryOuAssignmentsTable.id, assignmentId))
        .limit(1);
      if (!existing) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Assignment not found");
        return;
      }

      // Ownership + staff scoping on the assignment's OWN customer — never
      // disclose an out-of-book assignment's existence.
      if (!(await assertCustomerAccess(req.user!, existing.customerId))) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Assignment not found");
        return;
      }

      const [ou] = await db.select().from(activeDirectoryOusTable).where(eq(activeDirectoryOusTable.id, newOuId)).limit(1);
      if (!ou) {
        apiError(res, 400, ApiErrorCode.VALIDATION, `OU '${newOuId}' does not exist`);
        return;
      }
      if (ou.tenantId === null || ou.tenantId !== existing.customerId) {
        apiError(res, 400, ApiErrorCode.VALIDATION, `OU '${ou.name}' is not scoped to this assignment's customer`);
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
        metadata: { assignmentId, fromOuId: existing.ouId, toOuId: newOuId, objectId: existing.objectId, actorSurface: "msp" },
      });
      log.info({ assignmentId, fromOuId: existing.ouId, toOuId: newOuId, mspId }, "MSP staff moved a manual OU assignment");

      res.json(updated);
    } catch (err) {
      log.error({ err, assignmentId, newOuId, mspId }, "Failed to move OU assignment");
      apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to move OU assignment");
    }
  },
);

// ── DELETE /msp/active-directory/ou-assignments/:id ───────────────────────────
// Removes the manual override — the object reverts to the department-match guess.
router.delete(
  "/msp/active-directory/ou-assignments/:id",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    const mspId = resolveMspIdStrict(req);
    if (mspId === null) {
      apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
      return;
    }

    const assignmentId = Number(req.params.id);
    if (!Number.isInteger(assignmentId)) {
      apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid assignment id");
      return;
    }

    try {
      const [existing] = await db
        .select()
        .from(activeDirectoryOuAssignmentsTable)
        .where(eq(activeDirectoryOuAssignmentsTable.id, assignmentId))
        .limit(1);
      if (!existing) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Assignment not found");
        return;
      }
      if (!(await assertCustomerAccess(req.user!, existing.customerId))) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Assignment not found");
        return;
      }

      const [deleted] = await db
        .delete(activeDirectoryOuAssignmentsTable)
        .where(eq(activeDirectoryOuAssignmentsTable.id, assignmentId))
        .returning();
      if (!deleted) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Assignment not found");
        return;
      }

      await createAuditLog({
        ...auditActor(req),
        actionType: "active_directory.ou_assignment.clear",
        entityType: "active_directory_ou",
        entityId: deleted.ouId,
        metadata: { assignmentId, objectId: deleted.objectId, customerId: deleted.customerId, actorSurface: "msp" },
      });
      log.info({ assignmentId, ouId: deleted.ouId, mspId }, "MSP staff cleared a manual OU assignment");

      res.status(204).send();
    } catch (err) {
      log.error({ err, assignmentId, mspId }, "Failed to delete OU assignment");
      apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to delete OU assignment");
    }
  },
);

export default router;
