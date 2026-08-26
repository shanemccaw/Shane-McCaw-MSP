import { z } from "zod";
import { apiFetch } from "../api-client.ts";
import type { ToolDef } from "./registry.ts";
import { logger } from "../logger.ts";

/**
 * execute_action — Phase 4 of #1319 (Git #1323): ONE micro-remediation, ONE
 * real Microsoft Graph write, against ONE customer's REAL connected
 * production tenant. The single-action counterpart to execute_write_pack —
 * remediation-catalog.ts already models micro_remediation as a distinct
 * concept from config_pack execution, and this tool wraps exactly that path.
 *
 * Wraps the api-server's POST /admin/remediation/execute-action
 * (routes/admin-execute-action.ts): the catalog service slug resolves through
 * lib/remediation-catalog.ts to its baseline_action_templates executable and
 * runs through the one production engine, runBaselineTemplateAgainstTenant()
 * — the same function Launch Control, the workflow engine's node and the
 * Simulator's write-actions surface use. Every execution lands a
 * baseline_action_template_audit_log row (source:"execute_action").
 *
 * Safety posture:
 *  - NO testbed gate, per Shane's explicit #1319 direction — this fires at
 *    real production tenants. The real per-tenant write gates stay armed:
 *    the MSP must have write-back enabled and the tenant must hold granted
 *    write consent, or the route answers 409 with the gate's name.
 *  - audit: { access: "write" } — Phase 6 (#1325) makes the audit row
 *    write-ahead and FAIL-CLOSED: no persisted msp_audit_logs attempt row,
 *    no execution (and apiFetch refuses the POST outright without this
 *    declaration).
 *  - The route requires confirmed:true server-side for the real write.
 *    Anything else returns a PREVIEW — the byte-for-byte resolved request
 *    (endpoint, method, body after variable substitution) with no Graph
 *    call. This tool passes confirm through as that flag.
 */

// Single-action lines land under the remediation engine's own channel
// (engine.config-pack, matching lib/config-pack-orchestrator.ts) — the child
// binding overrides the parent logger's admin.mcp channel key, so each line
// carries exactly one channel.
const log = logger.child({ channel: "engine.config-pack" });

interface ExecuteActionResponse {
  mode: "preview" | "executed";
  service: { slug: string; name: string; templateId: string };
  tenant: { customerId: number; name: string | null; isTestbed: boolean };
  resolvedRequest?: {
    endpoint: string;
    method: string;
    body: Record<string, unknown>;
    requiredVariables: string[];
    missingVariables: string[];
  };
  ready?: boolean;
  safety?: Record<string, unknown>;
  confirmationRequired?: string;
  result?: {
    success: boolean;
    status: number;
    errorType?: string;
    endpoint: string;
    method: string;
    label: string;
    missingVariables?: string[];
    auditLogId?: number;
  };
  successCriteria?: Record<string, unknown>;
}

const inputSchema = {
  serviceSlug: z
    .string()
    .min(1)
    .describe(
      "Micro-remediation catalog slug (services.category='micro_remediation'), e.g. 'remediate-revoke-sessions', " +
        "'remediate-force-password-reset'. An unknown slug answers 404 listing every valid slug. A config-pack " +
        "slug is refused — that is execute_write_pack's job.",
    ),
  customerId: z
    .number()
    .int()
    .positive()
    .describe(
      "tenants.id of the target customer — the id execution surfaces use (same as execute_write_pack), NOT the " +
        "users.id clientId that query_customers/get_customer_findings return.",
    ),
  variables: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "Template variables the action needs (e.g. userId, policyId, groupId — the preview's requiredVariables/" +
        "missingVariables say exactly which). tenantName/organizationId/currentDateTime are derived server-side; " +
        "customerId cannot be overridden.",
    ),
  confirm: z
    .boolean()
    .optional()
    .describe(
      "Omitted/false = PREVIEW ONLY: returns the exact resolved request (endpoint, method, body) without touching " +
        "Graph. Set true ONLY after Shane has seen the preview and explicitly told you to execute — true fires the " +
        "real write at the live tenant.",
    ),
};

export const executeActionTool: ToolDef = {
  name: "execute_action",
  description:
    "EXECUTE ONE MICRO-REMEDIATION — a single REAL Microsoft Graph write against the customer's real connected " +
    "production M365 tenant; there is no simulation mode and no testbed gate. Wraps the real " +
    "POST /admin/remediation/execute-action: the catalog slug resolves through remediation-catalog.ts to its " +
    "baseline_action_template and executes via the one production engine (runBaselineTemplateAgainstTenant, " +
    "recorded in baseline_action_template_audit_log). ALWAYS call without confirm first: that returns a preview " +
    "of the byte-for-byte resolved request plus safety info (reversible?, requiresVerificationGate?, " +
    "missingVariables) — show it to Shane and only re-call with confirm:true on his explicit go-ahead. " +
    "Failures surface the route's real refusal: 404 unknown slug (with the valid slug list), 400 config-pack " +
    "slug (use execute_write_pack), 409 unwired product / missing template / production write gate " +
    "(write_back_not_enabled, write_consent_not_granted).",
  inputSchema,
  audit: { access: "write", tenantArg: "customerId", entityType: "micro_remediation", entityIdArg: "serviceSlug" },
  handler: async (raw) => {
    const { serviceSlug, customerId, variables, confirm } = raw as {
      serviceSlug: string;
      customerId: number;
      variables?: Record<string, string>;
      confirm?: boolean;
    };

    const response = await apiFetch<ExecuteActionResponse>("/admin/remediation/execute-action", {
      method: "POST",
      body: {
        serviceSlug,
        customerId,
        ...(variables ? { variables } : {}),
        confirmed: confirm === true,
      },
    });

    if (response.mode === "preview") {
      log.info(
        {
          serviceSlug,
          customerId,
          templateId: response.service.templateId,
          missingVariables: response.resolvedRequest?.missingVariables,
        },
        "execute_action preview resolved (nothing executed)",
      );
      return { executed: false, ...response };
    }

    log.info(
      {
        serviceSlug,
        customerId,
        templateId: response.service.templateId,
        success: response.result?.success,
        status: response.result?.status,
        auditLogId: response.result?.auditLogId,
      },
      "execute_action fired a real write against the customer's live tenant",
    );
    return { executed: true, ...response };
  },
};
