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
import { ConfigPackError, loadConfigPack, runConfigPackForCustomer } from "../lib/config-pack-orchestrator";
import { buildConfigPackGraph, operatorRequiredVariables } from "../lib/config-pack-graph";
import { logger } from "../lib/logger";
const log = logger.child({ channel: "engine.config-pack" });

const router: IRouter = Router();

const runBodySchema = z.object({
  customerId: z.number().int().positive(),
  variables: z.record(z.string(), z.string()).optional(),
  // #1497 — an approved Change Request authorizes this write. Optional on this
  // route so the testbed manual-validation surface still runs without one; the
  // execute_write_pack MCP tool (the operator/AI write path) REQUIRES it, which
  // is where the fail-closed posture is enforced for that path.
  changeRequestId: z.number().int().positive().optional(),
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
  customer_write_consent_missing: 422,
  tenant_domain_unresolved: 422,
  // #1497 — the write path was reached without an approved, unconsumed CR that
  // authorizes writing to the target tenant. Forbidden, not "bad request".
  change_request_not_authorized: 403,
  // #1911 — Key Vault store for generated credentials isn't configured; fail
  // closed rather than write the credential to the database.
  generated_secret_store_unavailable: 503,
};

/**
 * GET /admin/config-packs/:packKey/run/plan
 *
 * Read-only. Returns the REAL execution plan the run endpoint would materialize
 * — the topologically-ordered step sequence (the same buildConfigPackGraph used
 * to actually run the pack, so the surfaced order can never diverge from what
 * executes), which step carries the pack's single verification gate, and which
 * required variables the operator must supply (everything else is derived by the
 * orchestrator). No customer, no tenant, no writes — purely materialization.
 *
 * Responses:
 *   200 { packKey, label, ordered[], gatedTemplateId, coalescedGateTemplateIds, operatorVariables }
 *   404 pack not found
 *   422 pack not runnable (inactive, empty, unknown dependency, dependency cycle)
 */
router.get(
  "/admin/config-packs/:packKey/run/plan",
  requireRole("PlatformAdmin"),
  async (req: Request, res: Response) => {
    const packKey = req.params.packKey as string;
    try {
      const { pack, templates } = await loadConfigPack(packKey);
      const { ordered, gatedTemplateId, coalescedGateTemplateIds } = buildConfigPackGraph(templates);

      res.json({
        packKey,
        label: pack.label,
        gatedTemplateId,
        coalescedGateTemplateIds,
        operatorVariables: operatorRequiredVariables(ordered),
        ordered: ordered.map((t) => ({
          templateId: t.templateId,
          label: t.label,
          sortOrder: t.sortOrder,
          effectiveDependsOn: t.effectiveDependsOn,
          requiresVerificationGate: t.requiresVerificationGate,
          requiredVariables: t.requiredVariables,
          // Whether the pack's single spliced gate sits immediately after THIS
          // step (only the first flagged step in topo order gets the gate).
          gatedHere: t.templateId === gatedTemplateId,
        })),
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
      log.error({ err, packKey }, "config-pack plan failed");
      res.status(500).json({ error: "Failed to plan config pack" });
    }
  },
);

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
        ...(body.data.changeRequestId != null
          ? { changeRequestAuthorization: { changeRequestId: body.data.changeRequestId } }
          : {}),
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
        authorizingChangeRequestId: result.authorizingChangeRequestId,
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
      log.error({ err, packKey }, "config-pack run failed");
      res.status(500).json({ error: "Failed to run config pack" });
    }
  },
);

export default router;
