/**
 * msp-policy-engine-settings.ts — the per-customer Policy Engine opt-in (#1549).
 *
 *   GET   /api/msp/tenants/:tenantId/policy-engine        — current opt-in state
 *   PATCH /api/msp/tenants/:tenantId/policy-engine        — flip it
 *
 * #1549 SETTLED: "Opt-in, default off... enabled per customer at onboarding via
 * checkbox... the platform does not evaluate or act against tenants that have
 * not opted in." This is that checkbox's backend — the wire contract, no UI
 * (SCOPE STOP: artifacts/portal has no page for this module). The continuous-
 * evaluation loop (policy-engine-nodes.ts) and the enactment-route preview
 * (#1551, policy-enactment-route.ts) both read `tenants.policy_engine_opt_in`
 * directly; this is where it actually gets set.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, tenantsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { resolveMspIdStrict } from "../lib/resolve-msp-id";
import { apiError, ApiErrorCode } from "../lib/api-helpers";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "engine.policy" });

const router: IRouter = Router();

async function loadOwnedTenant(mspId: number, tenantId: number) {
  const [tenant] = await db
    .select({ id: tenantsTable.id, policyEngineOptIn: tenantsTable.policyEngineOptIn })
    .from(tenantsTable)
    .where(and(eq(tenantsTable.id, tenantId), eq(tenantsTable.mspId, mspId)))
    .limit(1);
  return tenant ?? null;
}

router.get(
  "/msp/tenants/:tenantId/policy-engine",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
        return;
      }
      const tenantId = Number(req.params.tenantId);
      if (!Number.isInteger(tenantId)) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid tenant id");
        return;
      }
      const tenant = await loadOwnedTenant(mspId, tenantId);
      if (!tenant) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Tenant not found");
        return;
      }
      res.json({ tenantId: tenant.id, policyEngineOptIn: tenant.policyEngineOptIn });
    } catch (err: unknown) {
      log.error({ err }, "GET /api/msp/tenants/:tenantId/policy-engine failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

const patchSchema = z.object({ optIn: z.boolean() });

router.patch(
  "/msp/tenants/:tenantId/policy-engine",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
        return;
      }
      const tenantId = Number(req.params.tenantId);
      if (!Number.isInteger(tenantId)) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid tenant id");
        return;
      }
      const parsed = patchSchema.safeParse(req.body);
      if (!parsed.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid request body", parsed.error.flatten());
        return;
      }

      const tenant = await loadOwnedTenant(mspId, tenantId);
      if (!tenant) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Tenant not found");
        return;
      }

      const [updated] = await db
        .update(tenantsTable)
        .set({ policyEngineOptIn: parsed.data.optIn, updatedAt: new Date() })
        .where(eq(tenantsTable.id, tenantId))
        .returning({ id: tenantsTable.id, policyEngineOptIn: tenantsTable.policyEngineOptIn });

      log.info({ mspId, tenantId, policyEngineOptIn: updated.policyEngineOptIn }, "policy engine opt-in changed");
      res.json({ tenantId: updated.id, policyEngineOptIn: updated.policyEngineOptIn });
    } catch (err: unknown) {
      log.error({ err }, "PATCH /api/msp/tenants/:tenantId/policy-engine failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

export default router;
