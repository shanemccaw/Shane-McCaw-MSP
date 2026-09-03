/**
 * msp-break-glass.ts
 *
 * MSP console operator routes for Break-glass Access (#2675) — the operator
 * counterpart to the customer-facing `/portal/break-glass/*` routes in
 * `break-glass-verification.ts`. Before this file, zero `requireRole`-gated
 * routes existed for this domain anywhere in the repo (confirmed by grep across
 * every route file); an MSP operator had no way to see a pending break-glass
 * credential, its verification attempts, or its override history without going
 * through the customer-scoped portal path.
 *
 * Real read/write contract, extracted from the same 3 tables the portal routes
 * and the `break_glass_verification_gate` workflow node already use (see
 * `docs/break-glass-access-contract-pack.md`, #2443) — no new schema, no
 * fixture data:
 *
 *   GET  /api/msp/break-glass
 *     — Cross-tenant list of every currently pending_delivery secret across the
 *       caller's own MSP book (mspId from JWT via resolveMspIdStrict — same
 *       session-scoped pattern as msp-alerts.ts), honoring per-staff customer
 *       scoping (resolveStaffScopedCustomerIds).
 *
 *   GET  /api/msp/customers/:customerId/break-glass
 *     — Full pending-secret history (any status) for one customer.
 *
 *   GET  /api/msp/customers/:customerId/break-glass/:pendingSecretId
 *     — One pending secret + its verification attempts. Never returns
 *       linkToken or the encrypted/vault-referenced secret value — same
 *       status-read contract as the portal's by-run endpoint.
 *
 *   POST /api/msp/customers/:customerId/break-glass/:pendingSecretId/admin-override
 *     — Force-reset + reissue. Delegates the actual reset to
 *       performBreakGlassAdminOverride() (break-glass-verification.ts) — the
 *       ONE implementation of this security-sensitive flow, shared with the
 *       portal route rather than re-implemented here.
 *
 *   GET  /api/msp/customers/:customerId/break-glass/audit
 *     — Override audit trail for one customer (break_glass_override_audit),
 *       with the acting admin's name/email resolved for display.
 *
 * Auth: requireRole("MSPOperator") on every route (admits MSPOperator, MSPAdmin,
 * PlatformAdmin — see requireAuth.ts roleIndex) plus assertCustomerAccess on
 * every :customerId-scoped route, exactly the ownership-check pattern every
 * other MSP-scoped route in this repo uses (e.g. msp-diagnostics.ts). Both
 * "not found" and "not yours" return 404 on the :pendingSecretId routes, same
 * non-confirming-existence discipline break-glass-verification.ts already
 * applies for the portal side.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  breakGlassPendingSecretsTable,
  breakGlassVerificationAttemptsTable,
  breakGlassOverrideAuditTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, inArray, desc } from "drizzle-orm";
import { requireRole, assertCustomerAccess, resolveStaffScopedCustomerIds } from "../middlewares/requireAuth";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { z } from "zod";
import {
  resolvePendingContext,
  performBreakGlassAdminOverride,
} from "./break-glass-verification";
import {
  WriteBackCustomerNotFoundError,
  WriteBackNotEnabledError,
  WriteConsentRequiredError,
} from "../lib/graph";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "auth" });

const router: IRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /msp/break-glass — cross-tenant pending list, MSP-scoped
// ─────────────────────────────────────────────────────────────────────────────
router.get("/msp/break-glass", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  try {
    const mspId = resolveMspIdStrict(req);
    if (mspId === null) {
      return res.status(403).json({ error: "MSP context required" });
    }

    // Per-staff customer scoping, same as msp-alerts.ts: null = unrestricted.
    const scopedIds = await resolveStaffScopedCustomerIds(req.user!);

    const customers = await db
      .select({ id: tenantsTable.id, name: tenantsTable.customerName })
      .from(tenantsTable)
      .where(
        scopedIds === null
          ? eq(tenantsTable.mspId, mspId)
          : and(eq(tenantsTable.mspId, mspId), inArray(tenantsTable.id, scopedIds)),
      );
    if (customers.length === 0) {
      return res.json({ pending: [] });
    }
    const customerNameById = new Map(customers.map((c) => [c.id, c.name]));
    const customerIds = customers.map((c) => c.id);

    const secrets = await db
      .select({
        id: breakGlassPendingSecretsTable.id,
        runId: breakGlassPendingSecretsTable.runId,
        customerId: breakGlassPendingSecretsTable.customerId,
        status: breakGlassPendingSecretsTable.status,
        createdAt: breakGlassPendingSecretsTable.createdAt,
      })
      .from(breakGlassPendingSecretsTable)
      .where(and(
        eq(breakGlassPendingSecretsTable.status, "pending_delivery"),
        inArray(breakGlassPendingSecretsTable.customerId, customerIds),
      ))
      .orderBy(desc(breakGlassPendingSecretsTable.createdAt));

    if (secrets.length === 0) {
      return res.json({ pending: [] });
    }
    const secretIds = secrets.map((s) => s.id);
    const attempts = await db
      .select({
        pendingSecretId: breakGlassVerificationAttemptsTable.pendingSecretId,
        linkStatus: breakGlassVerificationAttemptsTable.linkStatus,
      })
      .from(breakGlassVerificationAttemptsTable)
      .where(inArray(breakGlassVerificationAttemptsTable.pendingSecretId, secretIds));

    const liveCountBySecret = new Map<number, number>();
    const totalCountBySecret = new Map<number, number>();
    for (const a of attempts) {
      totalCountBySecret.set(a.pendingSecretId, (totalCountBySecret.get(a.pendingSecretId) ?? 0) + 1);
      if (a.linkStatus === "pending") {
        liveCountBySecret.set(a.pendingSecretId, (liveCountBySecret.get(a.pendingSecretId) ?? 0) + 1);
      }
    }

    const pending = secrets.map((s) => ({
      pendingSecretId: s.id,
      runId: s.runId,
      customerId: s.customerId,
      customerName: customerNameById.get(s.customerId) ?? null,
      status: s.status,
      createdAt: s.createdAt.toISOString(),
      liveInviteCount: liveCountBySecret.get(s.id) ?? 0,
      totalInviteCount: totalCountBySecret.get(s.id) ?? 0,
    }));

    return res.json({ pending });
  } catch (err) {
    log.error({ err }, "msp-break-glass: GET /msp/break-glass failed");
    return res.status(500).json({ error: "Failed to load break-glass activity" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /msp/customers/:customerId/break-glass — per-customer pending-secret history
// ─────────────────────────────────────────────────────────────────────────────
router.get("/msp/customers/:customerId/break-glass", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const customerId = parseInt(req.params.customerId as string, 10);
  if (isNaN(customerId)) return res.status(400).json({ error: "Invalid customerId" });

  try {
    if (!(await assertCustomerAccess(req.user!, customerId))) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const secrets = await db
      .select({
        id: breakGlassPendingSecretsTable.id,
        runId: breakGlassPendingSecretsTable.runId,
        status: breakGlassPendingSecretsTable.status,
        createdAt: breakGlassPendingSecretsTable.createdAt,
        deliveredAt: breakGlassPendingSecretsTable.deliveredAt,
        deliveredToEmail: breakGlassPendingSecretsTable.deliveredToEmail,
      })
      .from(breakGlassPendingSecretsTable)
      .where(eq(breakGlassPendingSecretsTable.customerId, customerId))
      .orderBy(desc(breakGlassPendingSecretsTable.createdAt));

    return res.json({
      secrets: secrets.map((s) => ({
        pendingSecretId: s.id,
        runId: s.runId,
        status: s.status,
        createdAt: s.createdAt.toISOString(),
        deliveredAt: s.deliveredAt ? s.deliveredAt.toISOString() : null,
        deliveredToEmail: s.deliveredToEmail,
      })),
    });
  } catch (err) {
    log.error({ err, customerId }, "msp-break-glass: GET customer break-glass history failed");
    return res.status(500).json({ error: "Failed to load break-glass history" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /msp/customers/:customerId/break-glass/:pendingSecretId — detail + attempts
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/msp/customers/:customerId/break-glass/:pendingSecretId",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    const customerId = parseInt(req.params.customerId as string, 10);
    const pendingSecretId = parseInt(req.params.pendingSecretId as string, 10);
    if (isNaN(customerId) || isNaN(pendingSecretId)) return res.status(404).json({ error: "Not found" });

    try {
      if (!(await assertCustomerAccess(req.user!, customerId))) {
        return res.status(404).json({ error: "Not found" });
      }

      const ctx = await resolvePendingContext(pendingSecretId);
      // Both "not found" and "not this customer's" return a bare 404 — never
      // confirm a pendingSecretId belonging to another customer exists.
      if (!ctx || ctx.secret.customerId !== customerId) {
        return res.status(404).json({ error: "Not found" });
      }

      const attempts = await db
        .select({
          id: breakGlassVerificationAttemptsTable.id,
          invitedEmail: breakGlassVerificationAttemptsTable.invitedEmail,
          linkStatus: breakGlassVerificationAttemptsTable.linkStatus,
          verificationOutcome: breakGlassVerificationAttemptsTable.verificationOutcome,
          entraUserPrincipalName: breakGlassVerificationAttemptsTable.entraUserPrincipalName,
          failedAttemptCount: breakGlassVerificationAttemptsTable.failedAttemptCount,
          attemptedAt: breakGlassVerificationAttemptsTable.attemptedAt,
          createdAt: breakGlassVerificationAttemptsTable.createdAt,
        })
        .from(breakGlassVerificationAttemptsTable)
        .where(eq(breakGlassVerificationAttemptsTable.pendingSecretId, pendingSecretId))
        .orderBy(desc(breakGlassVerificationAttemptsTable.createdAt));

      return res.json({
        pendingSecretId: ctx.secret.id,
        runId: ctx.secret.runId,
        customerId: ctx.secret.customerId,
        status: ctx.secret.status,
        createdAt: ctx.secret.createdAt.toISOString(),
        deliveredAt: ctx.secret.deliveredAt ? ctx.secret.deliveredAt.toISOString() : null,
        deliveredToEmail: ctx.secret.deliveredToEmail,
        attempts: attempts.map((a) => ({
          id: a.id,
          invitedEmail: a.invitedEmail,
          linkStatus: a.linkStatus,
          verificationOutcome: a.verificationOutcome,
          entraUserPrincipalName: a.entraUserPrincipalName,
          failedAttemptCount: a.failedAttemptCount,
          attemptedAt: a.attemptedAt ? a.attemptedAt.toISOString() : null,
          createdAt: a.createdAt.toISOString(),
        })),
      });
    } catch (err) {
      log.error({ err, customerId, pendingSecretId }, "msp-break-glass: GET detail failed");
      return res.status(500).json({ error: "Failed to load break-glass detail" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /msp/customers/:customerId/break-glass/:pendingSecretId/admin-override
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/msp/customers/:customerId/break-glass/:pendingSecretId/admin-override",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    const customerId = parseInt(req.params.customerId as string, 10);
    const pendingSecretId = parseInt(req.params.pendingSecretId as string, 10);
    if (isNaN(customerId) || isNaN(pendingSecretId)) return res.status(404).json({ error: "Not found" });

    const body = z.object({
      reason: z.string().trim().min(1),
      emails: z.array(z.string().email()).min(1).max(5).optional(),
    }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "reason is required; emails (if given) must be 1–5 valid addresses" });

    try {
      if (!(await assertCustomerAccess(req.user!, customerId))) {
        return res.status(404).json({ error: "Not found" });
      }

      const ctx = await resolvePendingContext(pendingSecretId);
      if (!ctx || ctx.secret.customerId !== customerId) {
        return res.status(404).json({ error: "Not found" });
      }

      const result = await performBreakGlassAdminOverride(ctx, pendingSecretId, req.user!.id, body.data.reason, body.data.emails);
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error, ...(result.detail ? { detail: result.detail } : {}) });
      }
      return res.json(result);
    } catch (err) {
      if (err instanceof WriteBackNotEnabledError || err instanceof WriteBackCustomerNotFoundError || err instanceof WriteConsentRequiredError) {
        log.warn({ customerId, pendingSecretId, reason: err.reason }, "msp-break-glass: admin-override blocked by write-back gate");
        return res.status(409).json({ error: err.message, blockedBy: err.reason });
      }
      log.error({ err, customerId, pendingSecretId }, "msp-break-glass: admin-override failed");
      return res.status(500).json({ error: "Failed to process override" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /msp/customers/:customerId/break-glass/audit — override audit trail
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/msp/customers/:customerId/break-glass/audit",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    const customerId = parseInt(req.params.customerId as string, 10);
    if (isNaN(customerId)) return res.status(400).json({ error: "Invalid customerId" });

    try {
      if (!(await assertCustomerAccess(req.user!, customerId))) {
        return res.status(404).json({ error: "Customer not found" });
      }

      const rows = await db
        .select({
          id: breakGlassOverrideAuditTable.id,
          adminUserId: breakGlassOverrideAuditTable.adminUserId,
          adminName: usersTable.name,
          adminEmail: usersTable.email,
          reason: breakGlassOverrideAuditTable.reason,
          oldPendingSecretId: breakGlassOverrideAuditTable.oldPendingSecretId,
          newPendingSecretId: breakGlassOverrideAuditTable.newPendingSecretId,
          createdAt: breakGlassOverrideAuditTable.createdAt,
        })
        .from(breakGlassOverrideAuditTable)
        .leftJoin(usersTable, eq(usersTable.id, breakGlassOverrideAuditTable.adminUserId))
        .where(eq(breakGlassOverrideAuditTable.customerId, customerId))
        .orderBy(desc(breakGlassOverrideAuditTable.createdAt));

      return res.json({
        audit: rows.map((r) => ({
          id: r.id,
          adminUserId: r.adminUserId,
          adminName: r.adminName ?? r.adminEmail ?? `user #${r.adminUserId}`,
          reason: r.reason,
          oldPendingSecretId: r.oldPendingSecretId,
          newPendingSecretId: r.newPendingSecretId,
          createdAt: r.createdAt.toISOString(),
        })),
      });
    } catch (err) {
      log.error({ err, customerId }, "msp-break-glass: GET audit failed");
      return res.status(500).json({ error: "Failed to load override audit" });
    }
  },
);

export default router;
