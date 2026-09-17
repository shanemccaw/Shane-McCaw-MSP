/**
 * msp-ca-policy-promotion.ts
 *
 * Git #4522 — the MSP operator's Conditional Access promotion workflow (Shane's
 * #4518 decision: CA policies are report-only by default; a policy is promoted
 * to enforced only after its real sign-in impact has been verified). Lives next to
 * M365 Launch Control, which already runs single CA writes for the same operator
 * and now refuses the enforcing one (action.set-ca-policy-state → "enabled") in
 * favour of this workflow.
 *
 * Auth: requireCapability("ladder.msp-operator") + requireMspScope("params"), and
 * every customerId re-checked with assertCustomerAccess — the same fence as
 * Launch Control.
 *
 * Routes:
 *   GET  /api/msp/:mspId/customers/:customerId/ca-policies
 *        Live CA policies (report-only first) with days in current state, plus the
 *        customer's recent promotion attempts. Read-only, any accessible customer.
 *   GET  /api/msp/:mspId/customers/:customerId/ca-policies/:policyId/impact
 *        The policy's real report-only sign-in impact: would-block / would-interrupt
 *        counts, affected users, recent events, readiness and the fingerprint the
 *        promote call must echo back. Read-only.
 *   POST /api/msp/:mspId/customers/:customerId/ca-policies/:policyId/promote
 *        Body { reviewedFingerprint, acknowledgeImpact, confirm: true, note? }.
 *        Re-derives impact server-side; refuses (with the fresh impact) when it
 *        changed, when impact was not acknowledged, or when it cannot be verified.
 *        Testbed-flagged customers only, matching Launch Control's staging restriction.
 */

import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, tenantsTable } from "@workspace/db";
import { requireCapability, requireMspScope, assertCustomerAccess } from "../middlewares/requireAuth.ts";
import { apiError, ApiErrorCode } from "../lib/api-helpers.ts";
import { getRequestContext } from "../lib/request-context.ts";
import {
  PROMOTION_REFUSAL_STATUS,
  evaluateCaPolicyImpact,
  isPolicyIdShape,
  listCaPoliciesForTenant,
  listCaPolicyPromotions,
  promoteCaPolicy,
} from "../lib/ca-policy-promotion.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "engine.ca-promotion" });

const router: IRouter = Router();

const promoteBodySchema = z.object({
  reviewedFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  acknowledgeImpact: z.boolean(),
  // The explicit confirm step: a promote call without it is not a decision.
  confirm: z.literal(true),
  note: z.string().trim().max(2000).optional(),
});

interface ScopedCustomer {
  mspId: number;
  customerId: number;
  tenantId: string;
  isTestbed: boolean;
  name: string;
}

/** Parse + fence the :mspId/:customerId pair; responds and returns null on failure. */
async function loadScopedCustomer(req: Request, res: Response): Promise<ScopedCustomer | null> {
  const mspId = Number.parseInt(String(req.params["mspId"]), 10);
  const customerId = Number.parseInt(String(req.params["customerId"]), 10);
  if (!Number.isInteger(mspId) || !Number.isInteger(customerId)) {
    res.status(400).json({ error: "mspId and customerId must be numbers" });
    return null;
  }
  if (!(await assertCustomerAccess(req.user!, customerId))) {
    apiError(res, 403, ApiErrorCode.FORBIDDEN, "Access to this customer is not permitted");
    return null;
  }
  const [customer] = await db
    .select({
      id: tenantsTable.id,
      tenantId: tenantsTable.tenantId,
      isTestbed: tenantsTable.isTestbed,
      name: tenantsTable.customerName,
    })
    .from(tenantsTable)
    .where(and(eq(tenantsTable.id, customerId), eq(tenantsTable.mspId, mspId)))
    .limit(1);
  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return null;
  }
  if (!customer.tenantId) {
    res.status(400).json({ error: "Selected customer has no connected tenant" });
    return null;
  }
  return { mspId, customerId, tenantId: customer.tenantId, isTestbed: customer.isTestbed, name: customer.name };
}

router.get(
  "/msp/:mspId/customers/:customerId/ca-policies",
  requireCapability("ladder.msp-operator"),
  requireMspScope("params"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const scoped = await loadScopedCustomer(req, res);
      if (!scoped) return;
      const [list, promotions] = await Promise.all([
        listCaPoliciesForTenant(scoped.tenantId),
        listCaPolicyPromotions(scoped.mspId, scoped.customerId),
      ]);
      res.json({
        customer: { id: scoped.customerId, name: scoped.name, isTestbed: scoped.isTestbed },
        promotionWritesAvailable: scoped.isTestbed,
        ...list,
        promotions,
      });
    } catch (err) {
      log.error({ err, params: req.params }, "GET ca-policies failed");
      res.status(500).json({ error: "Failed to load Conditional Access policies" });
    }
  },
);

router.get(
  "/msp/:mspId/customers/:customerId/ca-policies/:policyId/impact",
  requireCapability("ladder.msp-operator"),
  requireMspScope("params"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const scoped = await loadScopedCustomer(req, res);
      if (!scoped) return;
      const policyId = String(req.params["policyId"]);
      if (!isPolicyIdShape(policyId)) {
        res.status(400).json({ error: "policyId must be a Conditional Access policy GUID" });
        return;
      }
      const impact = await evaluateCaPolicyImpact(scoped.tenantId, policyId);
      res.json({ ...impact, promotionWritesAvailable: scoped.isTestbed });
    } catch (err) {
      log.error({ err, params: req.params }, "GET ca-policy impact failed");
      res.status(500).json({ error: "Failed to evaluate sign-in impact" });
    }
  },
);

router.post(
  "/msp/:mspId/customers/:customerId/ca-policies/:policyId/promote",
  requireCapability("ladder.msp-operator"),
  requireMspScope("params"),
  async (req: Request, res: Response): Promise<void> => {
    const policyId = String(req.params["policyId"]);
    try {
      const scoped = await loadScopedCustomer(req, res);
      if (!scoped) return;
      if (!isPolicyIdShape(policyId)) {
        res.status(400).json({ error: "policyId must be a Conditional Access policy GUID" });
        return;
      }
      const body = promoteBodySchema.safeParse(req.body);
      if (!body.success) {
        res.status(400).json({
          error: "Promotion needs the reviewed impact fingerprint, an explicit acknowledgeImpact choice and confirm: true",
          details: body.error.flatten(),
        });
        return;
      }

      const user = req.user!;
      const result = await promoteCaPolicy({
        mspId: scoped.mspId,
        customerId: scoped.customerId,
        policyId,
        reviewedFingerprint: body.data.reviewedFingerprint,
        acknowledgeImpact: body.data.acknowledgeImpact,
        note: body.data.note && body.data.note.length > 0 ? body.data.note : null,
        actor: {
          userId: user.id,
          name: user.name ?? user.email ?? `user ${user.id}`,
          role: user.mspRole ?? user.role,
          email: user.email ?? null,
          ipAddress: req.ip ?? null,
          userAgent: req.get("user-agent") ?? null,
          correlationId: getRequestContext()?.traceId ?? randomUUID(),
        },
      });

      if (result.outcome === "refused") {
        res.status(PROMOTION_REFUSAL_STATUS[result.code]).json({
          error: result.message,
          code: result.code,
          promotionId: result.promotionId,
          impact: result.impact,
        });
        return;
      }
      res.status(result.outcome === "succeeded" ? 200 : 502).json(result);
    } catch (err) {
      log.error({ err, params: req.params }, "POST ca-policy promote failed");
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to promote policy" });
    }
  },
);

export default router;
