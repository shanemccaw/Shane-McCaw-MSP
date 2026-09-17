/**
 * security-defaults-compensation-run.ts
 *
 * Git #4529 — the compensating write. When a workflow run ends failed or cancelled
 * after it switched Security Defaults off and before an enforcing Conditional Access
 * policy was confirmed (see security-defaults-compensation.ts for the rule), turn
 * Security Defaults back on:
 *
 *   PATCH /policies/identitySecurityDefaultsEnforcementPolicy {"isEnabled": true}
 *
 * then read the policy back, and record the attempt on the run itself:
 *   - a wf_run_node_outputs row under COMPENSATION_NODE_ID (structured result),
 *   - a wf_run_node_logs row,
 *   - a suffix on wf_runs.error_message,
 *   - a baseline_action_template_audit_log row (source "security_defaults_compensation").
 *
 * Runs through graphWriteForTenant, so the MSP write-back and write-consent gates
 * still apply; a blocked or failed re-enable is recorded as such, loudly, never
 * swallowed. Idempotent per run: an existing COMPENSATION_NODE_ID row means it
 * already ran.
 */

import {
  db,
  wfRunsTable,
  wfRunNodeLogsTable,
  wfRunNodeOutputsTable,
  baselineActionTemplatesTable,
  baselineActionTemplateAuditLogTable,
} from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { logger } from "./logger.ts";
import {
  planSecurityDefaultsCompensation,
  type ExecutedTemplateStep,
  type SecurityDefaultsCompensationPlan,
} from "./security-defaults-compensation.ts";

const log = logger.child({ channel: "workflow.compensation" });

export const COMPENSATION_NODE_ID = "__compensation__.security-defaults";
export const SECURITY_DEFAULTS_ENDPOINT = "/policies/identitySecurityDefaultsEnforcementPolicy";
const COMPENSATION_SOURCE = "security_defaults_compensation";

/** Throttle / transient server errors are worth another attempt; nothing else is. */
const RETRY_DELAYS_MS = [2_000, 5_000];

export interface SecurityDefaultsCompensationOutcome {
  plan: Extract<SecurityDefaultsCompensationPlan, { needed: true }>;
  success: boolean;
  status: number | null;
  errorType: string | null;
  error: string | null;
  attempts: number;
  /** isEnabled read back after the write; null when the read failed. */
  readBackIsEnabled: boolean | null;
  readBackError: string | null;
  auditLogId: number | null;
}

async function loadExecutedTemplateSteps(runId: number): Promise<ExecutedTemplateStep[]> {
  const rows = await db
    .select({
      nodeId: wfRunNodeOutputsTable.nodeId,
      input: wfRunNodeOutputsTable.input,
      output: wfRunNodeOutputsTable.output,
    })
    .from(wfRunNodeOutputsTable)
    .where(and(eq(wfRunNodeOutputsTable.runId, runId), eq(wfRunNodeOutputsTable.status, "ok")))
    .orderBy(asc(wfRunNodeOutputsTable.id));

  const templateRows = rows.filter((r) => typeof (r.output as Record<string, unknown>)?.templateId === "string");
  if (templateRows.length === 0) return [];

  const templateIds = [...new Set(templateRows.map((r) => (r.output as Record<string, unknown>).templateId as string))];
  const templates = await db
    .select({
      templateId: baselineActionTemplatesTable.templateId,
      method: baselineActionTemplatesTable.method,
      endpoint: baselineActionTemplatesTable.endpoint,
      bodyTemplate: baselineActionTemplatesTable.bodyTemplate,
    })
    .from(baselineActionTemplatesTable)
    .where(inArray(baselineActionTemplatesTable.templateId, templateIds));
  const byId = new Map(templates.map((t) => [t.templateId, t]));

  const steps: ExecutedTemplateStep[] = [];
  for (const r of templateRows) {
    const output = r.output as Record<string, unknown>;
    const template = byId.get(output.templateId as string);
    if (!template) continue;
    steps.push({
      nodeId: r.nodeId,
      templateId: template.templateId,
      method: template.method,
      endpoint: template.endpoint,
      bodyTemplate: (template.bodyTemplate ?? {}) as Record<string, unknown>,
      input: (r.input ?? {}) as Record<string, unknown>,
      output,
    });
  }
  return steps;
}

async function readBackSecurityDefaults(tenantId: string): Promise<{ isEnabled: boolean | null; error: string | null }> {
  try {
    const { graphFetchForTenant } = await import("./graph.ts");
    const res = await graphFetchForTenant(tenantId, SECURITY_DEFAULTS_ENDPOINT);
    if (!res.ok) return { isEnabled: null, error: `read-back returned ${res.status}` };
    const body = (await res.json()) as { isEnabled?: unknown };
    return typeof body.isEnabled === "boolean"
      ? { isEnabled: body.isEnabled, error: null }
      : { isEnabled: null, error: "read-back returned no isEnabled" };
  } catch (err) {
    return { isEnabled: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Fire the compensating re-enable for `runId` if its recorded steps call for one.
 * Returns null when no compensation is needed (or it already ran for this run).
 * Never throws: the caller is a run that has already reached a terminal state.
 */
export async function compensateSecurityDefaultsForRun(
  runId: number,
  opts: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<SecurityDefaultsCompensationOutcome | null> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)));
  try {
    const [run] = await db
      .select({ status: wfRunsTable.status, errorMessage: wfRunsTable.errorMessage })
      .from(wfRunsTable)
      .where(eq(wfRunsTable.id, runId))
      .limit(1);
    if (!run || (run.status !== "failed" && run.status !== "cancelled")) return null;

    const [already] = await db
      .select({ id: wfRunNodeOutputsTable.id })
      .from(wfRunNodeOutputsTable)
      .where(and(eq(wfRunNodeOutputsTable.runId, runId), eq(wfRunNodeOutputsTable.nodeId, COMPENSATION_NODE_ID)))
      .limit(1);
    if (already) return null;

    const plan = planSecurityDefaultsCompensation(await loadExecutedTemplateSteps(runId));
    if (!plan.needed) return null;

    log.warn({ runId, runStatus: run.status, ...plan }, "security-defaults compensation: re-enabling Security Defaults");

    let success = false;
    let status: number | null = null;
    let errorType: string | null = null;
    let error: string | null = null;
    let attempts = 0;

    if (!plan.tenantId || !plan.customerId) {
      error = "the disable step recorded no tenantId/customerId, so the tenant to restore cannot be resolved";
    } else {
      const { graphWriteForTenant } = await import("./graph.ts");
      for (;;) {
        attempts += 1;
        try {
          const result = await graphWriteForTenant(
            plan.tenantId, plan.customerId, SECURITY_DEFAULTS_ENDPOINT, "PATCH", { isEnabled: true }, [200, 204],
          );
          success = result.success;
          status = result.status;
          errorType = result.errorType ?? null;
          error = result.success ? null : (typeof result.data === "string" ? result.data : JSON.stringify(result.data ?? null)).slice(0, 1000);
          const transient = !result.success && (result.status === 429 || result.status >= 500);
          if (!transient || attempts > RETRY_DELAYS_MS.length) break;
        } catch (err) {
          // Write-back / consent gates throw; retrying cannot change their answer.
          error = err instanceof Error ? err.message : String(err);
          errorType = err instanceof Error ? err.name : "unexpected";
          break;
        }
        await sleep(RETRY_DELAYS_MS[attempts - 1]!);
      }
    }

    const readBack = plan.tenantId ? await readBackSecurityDefaults(plan.tenantId) : { isEnabled: null, error: "no tenant" };

    let auditLogId: number | null = null;
    try {
      const [inserted] = await db.insert(baselineActionTemplateAuditLogTable).values({
        action: success ? "executed" : "failed",
        templateId: null,
        requestVariables: { isEnabled: true },
        afterSnapshot: {
          success, status, errorType, error,
          endpoint: SECURITY_DEFAULTS_ENDPOINT, method: "PATCH",
          customerId: plan.customerId, tenantId: plan.tenantId,
          executedAt: new Date().toISOString(),
          source: COMPENSATION_SOURCE,
          runId, disableNodeId: plan.disableNodeId, disableTemplateId: plan.disableTemplateId,
          attempts, readBackIsEnabled: readBack.isEnabled,
        },
      }).returning({ id: baselineActionTemplateAuditLogTable.id });
      auditLogId = inserted?.id ?? null;
    } catch (auditErr) {
      log.warn({ runId, auditErr }, "security-defaults compensation: audit log insert failed (non-fatal)");
    }

    const outcome: SecurityDefaultsCompensationOutcome = {
      plan, success, status, errorType, error, attempts,
      readBackIsEnabled: readBack.isEnabled, readBackError: readBack.error, auditLogId,
    };

    const summary = success
      ? `Compensation: Security Defaults re-enabled after ${plan.disableTemplateId} (HTTP ${status}` +
        `${readBack.isEnabled === true ? ", read back enabled" : readBack.isEnabled === false ? ", but read back still DISABLED" : `, read-back unavailable: ${readBack.error}`})`
      : `Compensation FAILED: Security Defaults could not be re-enabled after ${plan.disableTemplateId} — ` +
        `tenant may have no MFA enforcement (${error ?? `HTTP ${status}`})`;

    await db.insert(wfRunNodeOutputsTable).values({
      runId,
      nodeId: COMPENSATION_NODE_ID,
      input: {
        compensation: "security_defaults_reenable",
        runStatus: run.status,
        reason: plan.reason,
        disableNodeId: plan.disableNodeId,
        disableTemplateId: plan.disableTemplateId,
        unconfirmedPolicies: plan.unconfirmedPolicies,
      },
      output: {
        compensation: "security_defaults_reenable",
        success, status, errorType, attempts,
        endpoint: SECURITY_DEFAULTS_ENDPOINT, method: "PATCH",
        tenantId: plan.tenantId, customerId: plan.customerId,
        readBackIsEnabled: readBack.isEnabled, readBackError: readBack.error,
        auditLogId,
      },
      status: success ? "ok" : "error",
      errorMessage: success ? null : summary,
    });

    await db.insert(wfRunNodeLogsTable).values({
      runId, nodeId: COMPENSATION_NODE_ID, level: success ? "warn" : "error", message: summary,
      metadata: { reason: plan.reason, auditLogId },
    }).catch(() => { });

    await db.update(wfRunsTable)
      .set({ errorMessage: run.errorMessage ? `${run.errorMessage} | ${summary}` : summary })
      .where(eq(wfRunsTable.id, runId));

    if (success) log.warn({ runId, ...outcome }, "security-defaults compensation: re-enabled");
    else log.error({ runId, ...outcome }, "security-defaults compensation: re-enable FAILED — tenant may have no MFA enforcement");
    return outcome;
  } catch (err) {
    log.error({ runId, err }, "security-defaults compensation: unexpected error");
    return null;
  }
}
