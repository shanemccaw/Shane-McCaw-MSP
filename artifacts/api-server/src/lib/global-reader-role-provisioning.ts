/**
 * global-reader-role-provisioning.ts
 *
 * #1130 (part of #1128): assigns the built-in Entra **Global Reader** directory
 * role to the READ app registration's (MT_APP_CLIENT_ID) service principal,
 * tenant-wide, using the WRITE app's (MT_APP_WRITE_CLIENT_ID) elevated consent.
 * Prerequisite for adopting the orphaned checks #1129 found — two of them need
 * Global Reader-level directory read the READ app does not otherwise carry.
 *
 * Global Reader is READ-ONLY: it grants tenant-wide read of directory objects
 * and cannot modify anything. The WRITE app is used only because *assigning* a
 * directory role requires RoleManagement.ReadWrite.Directory, a permission the
 * READ app deliberately does not (and must not) hold.
 *
 * ── Structure mirrors dlp-role-group-provisioning.ts on purpose ─────────────
 * This is the same shape as the DLP provisioning chain (#249): a live read to
 * resolve the READ app's per-tenant service principal object id, then a single
 * write through runBaselineTemplateAgainstTenant() (which routes through
 * graphWriteForTenant = write app + the write-back consent gates). It NEVER
 * throws — every failure mode, including the write-back gate blocking the
 * assignment, is captured in the returned result and one createAuditLog()
 * entry — so both callers (consent.ts's fire-and-forget hook on the write-
 * consent callback, and the admin re-trigger route) can rely on that contract.
 *
 * ── The write-back consent gate (same as the DLP chain) ─────────────────────
 * The assignment is a POST through graphWriteForTenant(), gated on the tenant's
 * SEPARATE `writeBack` consent grant being "granted" — NOT the `graph` (read)
 * consent. That is exactly why #1130 fires this from the write-consent callback
 * (consent.ts /admin/write-consent/callback), the grant that satisfies the
 * gate, rather than at first read consent. A WriteBackNotEnabledError /
 * WriteConsentRequiredError is treated as an expected, non-alarming "blocked"
 * outcome — logged plainly, never thrown — so the admin re-trigger route has
 * something correct to retry once write-back consent is granted later.
 *
 * ── Idempotency (attempt-and-classify, no pre-read) ─────────────────────────
 * There is no cheap way to pre-read existing role assignments with the READ
 * app's scopes (reading /roleManagement/directory/roleAssignments needs
 * RoleManagement.Read.Directory, which the READ app does not have — that's the
 * whole chicken-and-egg this issue resolves). So instead of a pre-check read,
 * the assignment is attempted and a conflict response (409, or a 400 whose body
 * mentions a conflicting/existing object) is classified as an idempotent
 * "already_done" — the same attempt-and-classify approach the DLP
 * add-service-principal-member step uses for its own duplicate case.
 */

import { db } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  graphFetchForTenant,
  WriteBackNotEnabledError,
  WriteBackCustomerNotFoundError,
  WriteConsentRequiredError,
} from "./graph";
import { runBaselineTemplateAgainstTenant } from "./workflow-executor";
import { createAuditLog } from "./audit";
import { logger } from "./logger";

const log = logger.child({ channel: "tenant.provisioning" });

// Built-in Global Reader role. For a built-in Entra role the roleDefinitionId
// used by the unified role-assignment endpoint is the same GUID as the
// roleTemplateId (confirmed in global-admin-count-role-members-551.test.ts).
export const GLOBAL_READER_ROLE_DEFINITION_ID = "f2ef992c-3afb-46b9-b7cf-a126ee74c451";
// "/" = the whole tenant directory. Global Reader is inherently tenant-wide read.
const TENANT_WIDE_DIRECTORY_SCOPE = "/";

export type ProvisioningStepStatus = "succeeded" | "already_done" | "failed" | "skipped" | "blocked";

export interface ProvisioningStepResult {
  status: ProvisioningStepStatus;
  detail?: string;
}

export interface GlobalReaderProvisioningResult {
  overallStatus: "provisioned" | "blocked" | "failed";
  servicePrincipalId: string | null;
  steps: {
    resolveServicePrincipal: ProvisioningStepResult;
    assignGlobalReaderRole: ProvisioningStepResult;
  };
}

function failedResult(steps: GlobalReaderProvisioningResult["steps"], servicePrincipalId: string | null): GlobalReaderProvisioningResult {
  const anyBlocked = Object.values(steps).some(s => s.status === "blocked");
  return {
    overallStatus: anyBlocked ? "blocked" : "failed",
    servicePrincipalId,
    steps,
  };
}

/**
 * Resolves the READ app's own service principal object id INSIDE the target
 * tenant's directory. A multi-tenant app registration gets a distinct SP
 * object per tenant, so this can't be a static env var — it's a live read
 * (uses the `graph` read consent, guaranteed present by the time this runs).
 */
async function resolveMtAppServicePrincipalId(tenantId: string): Promise<string | null> {
  const clientId = process.env.MT_APP_CLIENT_ID;
  if (!clientId) return null;
  const res = await graphFetchForTenant(tenantId, `/servicePrincipals?$filter=appId eq '${clientId}'&$select=id,appId`);
  if (!res.ok) return null;
  const body = (await res.json()) as { value?: Array<{ id: string }> };
  return body.value?.[0]?.id ?? null;
}

/**
 * Runs (or re-runs) the Global Reader assignment for one tenant. Never throws.
 * `source` distinguishes an automatic post-consent run from an admin-panel
 * manual re-trigger in the audit trail.
 */
export async function provisionGlobalReaderForTenant(
  tenantId: string,
  customerId: number,
  source: "consent.granted" | "admin_manual_retrigger",
  actor?: { actorUserId: number | null; actorName: string },
): Promise<GlobalReaderProvisioningResult> {
  const steps: GlobalReaderProvisioningResult["steps"] = {
    resolveServicePrincipal: { status: "skipped" },
    assignGlobalReaderRole: { status: "skipped" },
  };
  let servicePrincipalId: string | null = null;

  try {
    // ── Step 0: resolve the READ app's SP object id in this tenant (read-only) ──
    try {
      servicePrincipalId = await resolveMtAppServicePrincipalId(tenantId);
      steps.resolveServicePrincipal = servicePrincipalId
        ? { status: "succeeded", detail: servicePrincipalId }
        : { status: "failed", detail: "read app service principal not found in this tenant's directory (or MT_APP_CLIENT_ID unset)" };
    } catch (err) {
      steps.resolveServicePrincipal = { status: "failed", detail: err instanceof Error ? err.message : String(err) };
    }
    if (!servicePrincipalId) {
      const result = failedResult(steps, servicePrincipalId);
      await writeAudit(tenantId, customerId, source, actor, result);
      return result;
    }

    // ── Step 1: assign Global Reader to that SP, tenant-wide (write) ──────────
    try {
      const result = await runBaselineTemplateAgainstTenant(
        "roleManagement.assign_directory_role",
        tenantId,
        customerId,
        {
          principalId: servicePrincipalId,
          roleDefinitionId: GLOBAL_READER_ROLE_DEFINITION_ID,
          directoryScopeId: TENANT_WIDE_DIRECTORY_SCOPE,
        },
        source,
      );
      if (result.success) {
        steps.assignGlobalReaderRole = { status: "succeeded" };
      } else if (isConflictResponse(result.status, result.data)) {
        // Graph's real "this principal already holds this role at this scope"
        // shape — a 409 (or a 400 mentioning a conflicting/existing object).
        // Idempotent no-op, exactly like the DLP member-add duplicate case.
        steps.assignGlobalReaderRole = { status: "already_done", detail: "role already assigned to this principal at this scope" };
      } else {
        steps.assignGlobalReaderRole = {
          status: "failed",
          detail: `status=${result.status} ${typeof result.data === "string" ? result.data.slice(0, 300) : JSON.stringify(result.data)}`,
        };
      }
    } catch (err) {
      steps.assignGlobalReaderRole = classifyWriteBackError(err);
    }

    const succeeded = steps.assignGlobalReaderRole.status === "succeeded" || steps.assignGlobalReaderRole.status === "already_done";
    if (!succeeded) {
      const result = failedResult(steps, servicePrincipalId);
      await writeAudit(tenantId, customerId, source, actor, result);
      return result;
    }

    const result: GlobalReaderProvisioningResult = { overallStatus: "provisioned", servicePrincipalId, steps };
    await writeAudit(tenantId, customerId, source, actor, result);
    return result;
  } catch (err) {
    // Backstop — every real failure path above is already caught and
    // classified; this only catches a genuinely unexpected throw so the
    // function's "never throws" contract holds even then.
    log.error({ err, tenantId, customerId, source }, "provisionGlobalReaderForTenant: unexpected failure");
    const result = failedResult(steps, servicePrincipalId);
    await writeAudit(tenantId, customerId, source, actor, result).catch(() => {});
    return result;
  }
}

// A duplicate unified role assignment comes back as a 409 (conflicting object)
// or occasionally a 400 whose body names an existing/conflicting object.
function isConflictResponse(status: number, data: unknown): boolean {
  if (status === 409) return true;
  if (status === 400 && typeof data === "string" && /conflict|already exist/i.test(data)) return true;
  return false;
}

// graphWriteForTenant's three write-back gate errors (customer not found /
// write-back not enabled / write consent not granted) are THROWN, never
// returned in the result — the runBaselineTemplateAgainstTenant() call above
// is wrapped in a try/catch that routes here.
function classifyWriteBackError(err: unknown): ProvisioningStepResult {
  if (err instanceof WriteBackNotEnabledError || err instanceof WriteConsentRequiredError || err instanceof WriteBackCustomerNotFoundError) {
    return { status: "blocked", detail: err.message };
  }
  return { status: "failed", detail: err instanceof Error ? err.message : String(err) };
}

async function writeAudit(
  tenantId: string,
  customerId: number,
  source: "consent.granted" | "admin_manual_retrigger",
  actor: { actorUserId: number | null; actorName: string } | undefined,
  result: GlobalReaderProvisioningResult,
): Promise<void> {
  await createAuditLog({
    actorUserId: actor?.actorUserId ?? null,
    actorName: actor?.actorName ?? "system:consent.granted",
    actorRole: "admin",
    actionType: "global_reader_role_provisioning",
    entityType: "tenant",
    entityId: customerId,
    entityLabel: tenantId,
    clientId: null,
    metadata: { source, overallStatus: result.overallStatus, servicePrincipalId: result.servicePrincipalId, steps: result.steps },
  });

  if (result.overallStatus === "failed" || result.overallStatus === "blocked") {
    log.warn({ tenantId, customerId, source, result }, "Global Reader role provisioning did not complete");
  } else {
    log.info({ tenantId, customerId, source, result }, "Global Reader role provisioning finished");
  }
}

/**
 * Real current provisioning state for a tenant, for the admin-panel display.
 * The service-principal resolution is a live read. Whether the role is actually
 * assigned is best-effort: reading /roleManagement/directory/roleAssignments
 * needs RoleManagement.Read.Directory, which the READ app does not carry, so
 * this attempts the live read and falls back to the most recent audit-log run
 * when it isn't reachable — the same live-read-then-audit-fallback limitation
 * dlp-role-group-provisioning.ts documents for its Purview role-group step.
 */
export interface GlobalReaderProvisioningState {
  status: "not_provisioned" | "provisioned" | "unknown";
  roleAssigned: boolean;
  roleAssignedSource: "live" | "audit" | "none";
  lastRun: { at: string; source: string; overallStatus: string; roleStepStatus: string } | null;
}

export async function getGlobalReaderProvisioningState(tenantId: string, customerId: number): Promise<GlobalReaderProvisioningState> {
  const { auditLogsTable } = await import("@workspace/db");
  const { and, desc } = await import("drizzle-orm");

  const [lastProvisioningRow] = await db
    .select({ createdAt: auditLogsTable.createdAt, metadata: auditLogsTable.metadata })
    .from(auditLogsTable)
    .where(and(
      eq(auditLogsTable.entityType, "tenant"),
      eq(auditLogsTable.entityId, String(customerId)),
      eq(auditLogsTable.actionType, "global_reader_role_provisioning"),
    ))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(1);

  const lastRun = lastProvisioningRow
    ? {
        at: lastProvisioningRow.createdAt.toISOString(),
        source: String((lastProvisioningRow.metadata as Record<string, unknown> | null)?.source ?? "unknown"),
        overallStatus: String((lastProvisioningRow.metadata as Record<string, unknown> | null)?.overallStatus ?? "unknown"),
        roleStepStatus: String(
          ((lastProvisioningRow.metadata as { steps?: { assignGlobalReaderRole?: { status?: string } } } | null)?.steps?.assignGlobalReaderRole?.status) ?? "unknown",
        ),
      }
    : null;

  // Best-effort live confirmation.
  let roleAssigned = false;
  let roleAssignedSource: GlobalReaderProvisioningState["roleAssignedSource"] = "none";
  try {
    const spId = await resolveMtAppServicePrincipalId(tenantId);
    if (spId) {
      const res = await graphFetchForTenant(
        tenantId,
        `/roleManagement/directory/roleAssignments?$filter=principalId eq '${spId}' and roleDefinitionId eq '${GLOBAL_READER_ROLE_DEFINITION_ID}'&$select=id`,
      );
      if (res.ok) {
        const body = (await res.json()) as { value?: Array<{ id: string }> };
        roleAssigned = (body.value ?? []).length > 0;
        roleAssignedSource = "live";
      }
    }
  } catch (err) {
    log.warn({ err, tenantId, customerId }, "getGlobalReaderProvisioningState: live role-assignment read failed — falling back to audit-log-only state");
  }

  if (roleAssignedSource !== "live") {
    // Fall back to the last recorded run.
    roleAssigned = lastRun != null && (lastRun.roleStepStatus === "succeeded" || lastRun.roleStepStatus === "already_done");
    roleAssignedSource = lastRun != null ? "audit" : "none";
  }

  const status: GlobalReaderProvisioningState["status"] = roleAssigned
    ? "provisioned"
    : roleAssignedSource === "none"
      ? "not_provisioned"
      : "not_provisioned";

  return { status, roleAssigned, roleAssignedSource, lastRun };
}
