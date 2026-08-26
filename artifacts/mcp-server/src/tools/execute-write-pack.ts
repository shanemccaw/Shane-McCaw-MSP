import { z } from "zod";
import { apiFetch } from "../api-client.ts";
import type { ToolDef } from "./registry.ts";
import { logger } from "../logger.ts";

/**
 * execute_write_pack — Phase 5 of #1319 (Git #1324): full config-pack
 * execution against a customer's REAL connected Microsoft tenant.
 *
 * Wraps the api-server's own POST /admin/config-packs/:packKey/run
 * (routes/admin-config-pack-run.ts), which runs runConfigPackForCustomer in
 * lib/config-pack-orchestrator.ts — the SAME engine the purchase flow (Epic
 * #1309 Phase 7, #1316) fires. No second execution path: the pack is
 * materialized into a real Workflow Definition + published Version and fired
 * through fireWorkflowForDefinition → wf_runs → executeWorkflowRun, so every
 * run is visible on the Workflow Runs page and the break-glass by-run
 * endpoint works unchanged. Real Graph writes happen via graphFetchForTenant
 * inside the engine's step executor.
 *
 * Safety posture:
 *  - audit: { access: "write" } — Phase 6 (#1325) makes the audit row
 *    write-ahead and FAIL-CLOSED: no persisted attempt row in
 *    msp_audit_logs, no execution (and apiFetch refuses the POST outright
 *    if this declaration were missing).
 *  - The engine's own v1 guard currently refuses customers whose tenants row
 *    is not testbed-flagged (422 customer_not_testbed) — surfaced verbatim.
 *    The testbed customer's tenant IS a real production M365 tenant; treat
 *    every call as production infrastructure.
 *  - planOnly=true previews the pack's REAL materialized execution plan
 *    (GET .../run/plan — the same buildConfigPackGraph the run uses) without
 *    executing anything.
 */

// Pack-execution lines land under the orchestrator's own channel
// (engine.config-pack, see lib/config-pack-orchestrator.ts) — the child
// binding overrides the parent logger's admin.mcp channel key, so each line
// carries exactly one channel.
const log = logger.child({ channel: "engine.config-pack" });

interface PackPlanStep {
  templateId: string | null;
  label: string | null;
  sortOrder: number;
  effectiveDependsOn: string[];
  requiresVerificationGate: boolean;
  requiredVariables: string[];
  gatedHere: boolean;
}

interface PackPlanResponse {
  packKey: string;
  label: string;
  gatedTemplateId: string | null;
  coalescedGateTemplateIds: string[];
  /** Variables the operator must pass under `variables` — everything else
   *  (tenantDomain, organizationId, generatedPassword, …) the orchestrator
   *  derives itself. */
  operatorVariables: string[];
  ordered: PackPlanStep[];
}

interface PackRunResponse {
  runId: number;
  definitionId: number;
  versionId: number;
  packKey: string;
  customerId: number;
  gated: boolean;
  reusedVersion: boolean;
  templateOrder: string[];
}

const inputSchema = {
  packKey: z
    .string()
    .min(1)
    .describe(
      "config_packs.pack_key of the ACTIVE pack to execute (e.g. quickstart-v1, onboarding-v1). Unknown key = 404.",
    ),
  customerId: z
    .number()
    .int()
    .positive()
    .describe("tenants.id of the customer whose CONNECTED Microsoft tenant the pack's Graph writes target."),
  variables: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "Operator-supplied variable values the orchestrator cannot derive (the plan's operatorVariables list, " +
        "e.g. tenantPrefix). Missing ones come back as a 400 listing missingVariables. " +
        "customerId and the generated break-glass password cannot be overridden.",
    ),
  planOnly: z
    .boolean()
    .optional()
    .describe(
      "true = do NOT execute. Returns the pack's real materialized execution plan instead " +
        "(topological step order, which step the single verification gate follows, operatorVariables to supply).",
    ),
};

export const executeWritePackTool: ToolDef = {
  name: "execute_write_pack",
  description:
    "EXECUTE A FULL CONFIG PACK — REAL Microsoft Graph writes against the customer's real connected M365 tenant; " +
    "there is no simulation mode. Wraps the real POST /admin/config-packs/:packKey/run: the config-pack " +
    "orchestrator materializes the pack into a real Workflow Definition and fires a run through the standard " +
    "Workflow Engine (visible on the Workflow Runs page as 'Config Pack: <packKey>'). Returns { runId, gated, " +
    "templateOrder, … }; the run's steps execute asynchronously AFTER this returns — check the run for real " +
    "step outcomes. gated=true means the run pauses mid-run at its break-glass verification gate and waits for " +
    "verification before the remaining steps fire. The engine currently refuses non-testbed customers " +
    "(422 customer_not_testbed); note the testbed customer's tenant is itself a REAL production M365 tenant. " +
    "Call with planOnly=true FIRST to preview the real execution plan and learn which variables you must pass. " +
    "Failures surface the route's real refusal: 400 missing variables (listed), 404 unknown pack/customer, " +
    "409 concurrency limit (a run of this pack is already in flight), 422 not runnable.",
  inputSchema,
  audit: { access: "write", tenantArg: "customerId", entityType: "config_pack", entityIdArg: "packKey" },
  handler: async (raw) => {
    const { packKey, customerId, variables, planOnly } = raw as {
      packKey: string;
      customerId: number;
      variables?: Record<string, string>;
      planOnly?: boolean;
    };

    if (planOnly) {
      const plan = await apiFetch<PackPlanResponse>(
        `/admin/config-packs/${encodeURIComponent(packKey)}/run/plan`,
      );
      log.info(
        { packKey, customerId, operatorVariables: plan.operatorVariables, steps: plan.ordered.length },
        "config pack plan fetched (planOnly — nothing executed)",
      );
      return { executed: false, planOnly: true, plan };
    }

    const run = await apiFetch<PackRunResponse>(`/admin/config-packs/${encodeURIComponent(packKey)}/run`, {
      method: "POST",
      body: { customerId, ...(variables ? { variables } : {}) },
    });

    log.info(
      {
        packKey,
        customerId,
        runId: run.runId,
        definitionId: run.definitionId,
        versionId: run.versionId,
        gated: run.gated,
        reusedVersion: run.reusedVersion,
      },
      "config pack run fired against the customer's real tenant",
    );

    return { executed: true, ...run };
  },
};
