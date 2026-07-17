/**
 * admin-config-pack-run.ts
 *
 * POST /api/admin/config-packs/:packKey/run — materialize a Config Pack into a
 * real Workflow Definition + published Version and fire a run for a customer
 * through the standard Workflow Engine (wf_runs + executeWorkflowRun). See
 * lib/config-pack-orchestrator.ts for the materialization rules.
 *
 * v1 trigger surface: PlatformAdmin-only, testbed customers only — meant for
 * manual validation against the platform's own tenant before any
 * purchase/consent-triggered automation is wired up (deliberately NOT called
 * from checkout or consent flows).
 *
 * Body: {
 *   customerId: number,           // required — msp_customers.id
 *   variables?: Record<string,string>  // e.g. { tenantPrefix: "CONTOSO" } — values
 *                                      // with no derivable source, or overrides
 * }
 *
 * Responses:
 *   202 { runId, definitionId, versionId, packKey, customerId, gated, templateOrder }
 *   400 invalid body / missing variables (missingVariables listed)
 *   404 pack or customer not found
 *   409 concurrency limit reached
 *   422 pack/customer not runnable (inactive pack, no tenant, not testbed, unresolvable domain, bad dependency graph)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { requireRole } from "../middlewares/requireAuth";
import { ConfigPackError, runConfigPackForCustomer } from "../lib/config-pack-orchestrator";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const runBodySchema = z.object({
  customerId: z.number().int().positive(),
  variables: z.record(z.string(), z.string()).optional(),
});

const ERROR_STATUS: Record<ConfigPackError["code"], number> = {
  pack_not_found: 404,
  customer_not_found: 404,
  missing_variables: 400,
  concurrency_limit: 409,
  pack_not_active: 422,
  pack_empty: 422,
  dependency_not_in_pack: 422,
  dependency_cycle: 422,
  customer_not_connected: 422,
  customer_not_testbed: 422,
  tenant_domain_unresolved: 422,
};

router.post(
  "/admin/config-packs/:packKey/run",
  requireRole("PlatformAdmin"),
  async (req: Request, res: Response) => {
    const packKey = req.params.packKey as string;

    const body = runBodySchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Invalid body", details: body.error.flatten() });
      return;
    }

    try {
      const result = await runConfigPackForCustomer({
        packKey,
        customerId: body.data.customerId,
        variables: body.data.variables,
        triggeredBy: `config-pack:${packKey}:customer:${body.data.customerId}:admin:${req.user?.id ?? "unknown"}`,
      });

      res.status(202).json({
        runId: result.runId,
        definitionId: result.definitionId,
        versionId: result.versionId,
        packKey,
        customerId: body.data.customerId,
        gated: result.gated,
        reusedVersion: result.reusedVersion,
        templateOrder: result.templateOrder,
      });
    } catch (err) {
      if (err instanceof ConfigPackError) {
        res.status(ERROR_STATUS[err.code] ?? 422).json({
          error: err.message,
          code: err.code,
          ...(err.details ?? {}),
        });
        return;
      }
      logger.error({ err, packKey }, "config-pack run failed");
      res.status(500).json({ error: "Failed to run config pack" });
    }
  },
);

export default router;
