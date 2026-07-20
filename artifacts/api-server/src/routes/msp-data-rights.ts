/**
 * msp-data-rights.ts
 *
 * MSP-facing view of the real GDPR data-rights activity (right-to-portability
 * exports + right-to-erasure deletion requests) recorded by the customer-
 * facing self-service flow in portal.ts, PLUS an action to record a deletion
 * request on behalf of a customer who contacts the MSP directly instead of
 * using self-service (a real support scenario).
 *
 * There is no dedicated "deletion-request queue" table in this codebase —
 * both self-service endpoints only ever wrote a fire-and-forget audit_logs
 * row (actionType "deletion_request_submitted" / "data_export_downloaded")
 * plus a one-time admin notification email; there is no status/lifecycle
 * field anywhere (see docs/runbooks/data-subject-rights.md — fulfillment is
 * a manual, out-of-band process). This route reads that SAME audit_logs
 * stream rather than inventing a parallel table, and the deletion-request
 * action writes to it via the exact same lib/data-rights.ts helper portal.ts
 * uses — never a second, divergent code path.
 *
 * Data-model note: audit_logs has no mspId/customerId column — it is keyed by
 * usersTable.id (actorUserId/clientId). Requests are bridged into the MSP's
 * book via msp_users (clientId -> customerId -> mspId), the same bridge
 * msp-customer-timeline.ts uses for insights_generated_documents/sales_offers.
 * A request submitted by an MSP admin on behalf of a customer still has
 * `clientId` set to the CUSTOMER's own userId (only `actorUserId`/`actorRole`
 * differ), so both self-service and admin-initiated rows bridge identically.
 *
 * Scoping: mspId from resolveMspIdStrict (session JWT only) +
 * resolveStaffScopedCustomerIds (0 scope rows = unrestricted) — the same
 * pattern as msp-alerts.ts / msp-customer-timeline.ts. Gated MSPAdmin (not
 * MSPOperator+) since this surfaces PII/legal-retention-sensitive data,
 * matching msp-audit-log.ts's gate on the adjacent MSP audit trail.
 *
 * This does NOT modify or duplicate the customer-initiated GDPR logic, and
 * does NOT reimplement legal-retention handling — retention exceptions
 * (signed SOWs/invoices/contracts) remain exactly what they always were:
 * prose in the admin notification email and the runbook, reused verbatim via
 * lib/data-rights.ts's shared email-building code.
 *
 * Routes:
 *   GET  /api/msp/data-rights
 *   GET  /api/msp/data-rights/customers/:customerId/users
 *   POST /api/msp/data-rights/customers/:customerId/deletion-request
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, auditLogsTable, mspCustomersTable, mspUsersTable, usersTable } from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { requireRole, resolveStaffScopedCustomerIds, assertCustomerAccess } from "../middlewares/requireAuth.ts";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { submitAdminInitiatedDeletionRequest } from "../lib/data-rights.ts";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

const DATA_RIGHTS_ACTION_TYPES = ["deletion_request_submitted", "data_export_downloaded"] as const;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** userId(users.id) -> { customerId, customerName } for every customer in mspId's book. */
async function loadCustomerBridge(mspId: number) {
  const rows = await db
    .select({
      userId: mspUsersTable.userId,
      customerId: mspUsersTable.customerId,
      customerName: mspCustomersTable.name,
    })
    .from(mspUsersTable)
    .leftJoin(mspCustomersTable, eq(mspUsersTable.customerId, mspCustomersTable.id))
    .where(eq(mspUsersTable.mspId, mspId));

  const byUserId = new Map<number, { customerId: number | null; customerName: string | null }>();
  for (const row of rows) {
    byUserId.set(row.userId, { customerId: row.customerId, customerName: row.customerName ?? null });
  }
  return byUserId;
}

// ── GET /api/msp/data-rights ─────────────────────────────────────────────────

router.get("/msp/data-rights", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  try {
    const mspId = resolveMspIdStrict(req);
    if (mspId === null) {
      res.status(403).json({ error: "MSP context required" });
      return;
    }

    const scopedIds = await resolveStaffScopedCustomerIds(req.user!);
    const bridge = await loadCustomerBridge(mspId);

    const eligibleUserIds = [...bridge.entries()]
      .filter(([, v]) => (scopedIds === null ? v.customerId !== null : v.customerId !== null && scopedIds.includes(v.customerId)))
      .map(([userId]) => userId);

    if (eligibleUserIds.length === 0) {
      res.json({ requests: [] });
      return;
    }

    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);

    const rows = await db
      .select({
        id: auditLogsTable.id,
        actionType: auditLogsTable.actionType,
        actorRole: auditLogsTable.actorRole,
        actorName: auditLogsTable.actorName,
        clientId: auditLogsTable.clientId,
        metadata: auditLogsTable.metadata,
        createdAt: auditLogsTable.createdAt,
      })
      .from(auditLogsTable)
      .where(and(inArray(auditLogsTable.actionType, [...DATA_RIGHTS_ACTION_TYPES]), inArray(auditLogsTable.clientId, eligibleUserIds)))
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(limit);

    const requests = rows.map((row) => {
      const bridged = row.clientId != null ? bridge.get(row.clientId) : undefined;
      const metadata = (row.metadata ?? {}) as Record<string, unknown>;
      return {
        id: row.id,
        actionType: row.actionType,
        submittedByAdmin: row.actorRole === "admin",
        submittedByName: row.actorName,
        customerId: bridged?.customerId ?? null,
        customerName: bridged?.customerName ?? null,
        currentSchema: row.actionType === "deletion_request_submitted" ? (metadata.currentSchema ?? null) : null,
        createdAt: row.createdAt.toISOString(),
      };
    });

    res.json({ requests });
  } catch (err) {
    log.error({ err }, "msp-data-rights: failed to load data-rights activity");
    res.status(500).json({ error: "Unable to load data-rights activity right now. Please try again shortly." });
  }
});

// ── GET /api/msp/data-rights/customers/:customerId/users ────────────────────
// Portal users linked to a customer, so an admin can pick who a deletion
// request applies to (a customer/company can have more than one team member).

router.get("/msp/data-rights/customers/:customerId/users", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  try {
    const customerId = Number(req.params.customerId);
    if (!Number.isInteger(customerId)) {
      res.status(400).json({ error: "Invalid customerId" });
      return;
    }

    const allowed = await assertCustomerAccess(req.user!, customerId);
    if (!allowed) {
      res.status(403).json({ error: "Not authorized for this customer" });
      return;
    }

    const rows = await db
      .select({ userId: mspUsersTable.userId, name: usersTable.name, email: usersTable.email, isActive: mspUsersTable.isActive })
      .from(mspUsersTable)
      .innerJoin(usersTable, eq(mspUsersTable.userId, usersTable.id))
      .where(eq(mspUsersTable.customerId, customerId));

    res.json({ users: rows.map((r) => ({ userId: r.userId, name: r.name, email: r.email, isActive: r.isActive })) });
  } catch (err) {
    log.error({ err }, "msp-data-rights: failed to load customer's linked users");
    res.status(500).json({ error: "Unable to load customer users right now. Please try again shortly." });
  }
});

// ── POST /api/msp/data-rights/customers/:customerId/deletion-request ────────
// Records a deletion request on behalf of a customer's own portal user
// (body.userId), for when the customer contacted the MSP directly instead of
// using self-service. Reuses the exact same audit-log + admin-email logic the
// customer-initiated route uses (lib/data-rights.ts) — never a new path.

router.post("/msp/data-rights/customers/:customerId/deletion-request", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  try {
    const customerId = Number(req.params.customerId);
    if (!Number.isInteger(customerId)) {
      res.status(400).json({ error: "Invalid customerId" });
      return;
    }

    const allowed = await assertCustomerAccess(req.user!, customerId);
    if (!allowed) {
      res.status(403).json({ error: "Not authorized for this customer" });
      return;
    }

    const targetUserId = Number(req.body?.userId);
    if (!Number.isInteger(targetUserId)) {
      res.status(400).json({ error: "userId is required" });
      return;
    }

    // Confirm the target user actually belongs to THIS customer, not just
    // any user in the caller's MSP — prevents an admin from filing a
    // deletion request against an arbitrary userId via this route.
    const [link] = await db
      .select({ userId: mspUsersTable.userId })
      .from(mspUsersTable)
      .where(and(eq(mspUsersTable.userId, targetUserId), eq(mspUsersTable.customerId, customerId)))
      .limit(1);
    if (!link) {
      res.status(404).json({ error: "That user is not linked to this customer" });
      return;
    }

    const actorUser = req.user!;
    const result = await submitAdminInitiatedDeletionRequest(targetUserId, customerId, {
      actorRole: "admin",
      actorUserId: actorUser.id,
      actorName: actorUser.name ?? actorUser.email ?? `user ${actorUser.id}`,
    });

    if ("error" in result) {
      res.status(404).json({ error: "Target user not found" });
      return;
    }

    res.json({
      ok: true,
      message: "Deletion request recorded on the customer's behalf. It will be processed within 30 days per the standard retention policy; signed contracts and invoices are retained for 7 years as required by law.",
      currentSchemaSummary: result.currentSchemaSummary,
    });
  } catch (err) {
    log.error({ err }, "msp-data-rights: failed to record admin-initiated deletion request");
    res.status(500).json({ error: "Failed to submit deletion request" });
  }
});

export default router;
