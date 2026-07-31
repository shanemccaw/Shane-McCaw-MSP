/**
 * dlp-role-group-provisioning.ts
 *
 * #249 (#246 chunk C): orchestrates the three-step chain #247/#248 built but
 * left unwired — create an Entra security group, add mt-app's own service
 * principal as its member, then assign that group to the Purview role group
 * that carries the "DLP Compliance Management" role. Without this, an
 * app-only Get-DlpCompliancePolicy/etc. call fails with "not recognized" on
 * every tenant onboarded after #212 shipped, even though Graph admin consent
 * itself succeeded (Purview role groups are a completely separate permission
 * system — see #246's problem statement).
 *
 * ── Graph engine vs. manual passing (investigated, not assumed) ────────────
 * #248 identified two ways to thread step 1's created-group id into step 2:
 * (a) wire both `execute_baseline_template` nodes into a real Workflow Engine
 * graph (config-pack-graph.ts's break-glass mapping node at line 324 already
 * proves `steps.<nodeId>.data.id` threading works), or (b) call
 * runBaselineTemplateAgainstTenant() twice and manually thread the result,
 * the same pattern rollbackExecution() already uses for Teams membership-id
 * resolution (workflow-executor.ts:645-666).
 *
 * This chain uses (b), manual passing, for one concrete reason found on
 * inspection: step 3 (Add-RoleGroupMember) has no Workflow Engine node type.
 * `execute_baseline_template` nodes only invoke graphWriteForTenant — the two
 * `execute_script`/`execute_runbook` node types run PowerShell via Azure
 * Automation, a completely different mechanism that never touches
 * ps-execution's CmdletCatalog. Making this a real 3-node graph would mean
 * inventing a new node type (registry entry + executor case) AND the
 * persist-a-wf_workflow_definitions-row-then-fire ceremony every graph run
 * requires (config-pack-orchestrator.ts's buildConfigPackGraph ->
 * persistConfigPackWorkflow -> fireWorkflowForDefinition) — real cost for a
 * fixed, non-reusable, backend-triggered 3-step chain with only one caller.
 * If a second PS-cmdlet-invoking graph step is ever needed, that node type
 * becomes worth building and this chain should be revisited.
 *
 * ── The write-back consent gate (found while wiring, not assumed) ──────────
 * Steps 1-2 are POSTs through graphWriteForTenant(), which is gated on the
 * tenant's SEPARATE `writeBack` consent grant (its own admin-triggered OAuth
 * flow — /admin/customers/:id/write-consent/start, consent.ts:920) being
 * "granted" — NOT the `graph` (read) consent this chain is triggered from.
 * A brand-new tenant's `graph` consent succeeding does NOT imply `writeBack`
 * consent has also been granted; in practice it usually has not been yet.
 * This chain still fires on every `graph` consent success (in case write-back
 * was already granted, e.g. a re-consent), but a WriteBackNotEnabledError /
 * WriteConsentRequiredError is treated as an expected, non-alarming "blocked"
 * outcome — logged plainly, never thrown past this module — precisely so the
 * admin-panel re-trigger button (routes/admin-dlp-provisioning.ts) has
 * something correct to retry once write-back consent is granted later.
 *
 * ── The Purview role group name (flagged, not guessed) ──────────────────────
 * Shane resolved this manually once tonight (#246's own text: "assigned that
 * group to a Purview role group containing DLP Compliance Management") but
 * the exact role-group display name used isn't recorded anywhere in this
 * repo, an issue, or PLATFORM_BUILD.md. Rather than hardcode a guessed name
 * (e.g. "Compliance Administrator") into a real write against live tenants,
 * it is a required env var (PURVIEW_DLP_ROLE_GROUP_NAME) with no fallback —
 * step 3 fails loudly and specifically if it's unset, instead of silently
 * assigning the wrong role group. Shane: please confirm/set this to whatever
 * role group you actually used tonight.
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
import { callPsExecution, PsExecutionError } from "./ps-execution-client";
import { createAuditLog } from "./audit";
import { logger } from "./logger";

const log = logger.child({ channel: "tenant.provisioning" });

// Fixed, deterministic identity for the provisioning group — same name in
// every customer tenant. Uniqueness (mailNickname) is enforced by Graph
// within ONE tenant's directory, not globally, so reusing the same literal
// across tenants is safe and is what makes the idempotency pre-check below
// (look up by mailNickname) reliable without persisting our own group-id map.
const GROUP_DISPLAY_NAME = "MSP Platform - Purview DLP Access";
const GROUP_MAIL_NICKNAME = "msp-platform-purview-dlp-access";

export type ProvisioningStepStatus = "succeeded" | "already_done" | "failed" | "skipped" | "blocked";

export interface ProvisioningStepResult {
  status: ProvisioningStepStatus;
  detail?: string;
}

export interface DlpProvisioningResult {
  overallStatus: "provisioned" | "partially_provisioned" | "blocked" | "failed";
  groupId: string | null;
  servicePrincipalId: string | null;
  steps: {
    resolveServicePrincipal: ProvisioningStepResult;
    createGroup: ProvisioningStepResult;
    addServicePrincipalMember: ProvisioningStepResult;
    addRoleGroupMember: ProvisioningStepResult;
  };
}

function failedResult(steps: DlpProvisioningResult["steps"], groupId: string | null, servicePrincipalId: string | null): DlpProvisioningResult {
  const anySucceeded = Object.values(steps).some(s => s.status === "succeeded" || s.status === "already_done");
  const anyBlocked = Object.values(steps).some(s => s.status === "blocked");
  return {
    overallStatus: anyBlocked && !anySucceeded ? "blocked" : anySucceeded ? "partially_provisioned" : "failed",
    groupId,
    servicePrincipalId,
    steps,
  };
}

/**
 * Resolves mt-app's own service principal object id INSIDE the target
 * tenant's directory. Multi-tenant app registrations get a distinct SP
 * object per tenant, so this can't be a static env var — it's a live read
 * (uses the `graph` read consent, guaranteed present since this chain only
 * fires after that consent just succeeded).
 */
async function resolveMtAppServicePrincipalId(tenantId: string): Promise<string | null> {
  const clientId = process.env.MT_APP_CLIENT_ID;
  if (!clientId) return null;
  const res = await graphFetchForTenant(tenantId, `/servicePrincipals?$filter=appId eq '${clientId}'&$select=id,appId`);
  if (!res.ok) return null;
  const body = (await res.json()) as { value?: Array<{ id: string }> };
  return body.value?.[0]?.id ?? null;
}

/** Live idempotency check — does the provisioning group already exist in this tenant? */
async function findExistingGroupId(tenantId: string): Promise<string | null> {
  const res = await graphFetchForTenant(
    tenantId,
    `/groups?$filter=mailNickname eq '${GROUP_MAIL_NICKNAME}'&$select=id,displayName`,
  );
  if (!res.ok) return null;
  const body = (await res.json()) as { value?: Array<{ id: string }> };
  return body.value?.[0]?.id ?? null;
}

/** Live idempotency check — is the service principal already a member of the group? */
async function isServicePrincipalMember(tenantId: string, groupId: string, servicePrincipalId: string): Promise<boolean> {
  const res = await graphFetchForTenant(tenantId, `/groups/${groupId}/members?$select=id`);
  if (!res.ok) return false;
  const body = (await res.json()) as { value?: Array<{ id: string }> };
  return (body.value ?? []).some(m => m.id === servicePrincipalId);
}

/**
 * Runs (or re-runs) the full chain for one tenant. Never throws — every
 * failure mode, including a write-back consent gate blocking steps 1-2, is
 * captured in the returned result and in one createAuditLog() entry. Callers
 * (consent.ts's fire-and-forget hook, and the admin re-trigger route) rely on
 * this: a throw here must never be possible to accidentally propagate.
 *
 * `source` distinguishes an automatic post-consent run from an admin-panel
 * manual re-trigger in the audit trail.
 */
export async function provisionDlpRoleGroupForTenant(
  tenantId: string,
  customerId: number,
  source: "consent.granted" | "admin_manual_retrigger",
  actor?: { actorUserId: number | null; actorName: string },
): Promise<DlpProvisioningResult> {
  const steps: DlpProvisioningResult["steps"] = {
    resolveServicePrincipal: { status: "skipped" },
    createGroup: { status: "skipped" },
    addServicePrincipalMember: { status: "skipped" },
    addRoleGroupMember: { status: "skipped" },
  };
  let groupId: string | null = null;
  let servicePrincipalId: string | null = null;

  try {
    // ── Step 0: resolve mt-app's SP object id in this tenant (read-only) ──────
    try {
      servicePrincipalId = await resolveMtAppServicePrincipalId(tenantId);
      steps.resolveServicePrincipal = servicePrincipalId
        ? { status: "succeeded", detail: servicePrincipalId }
        : { status: "failed", detail: "mt-app service principal not found in this tenant's directory (or MT_APP_CLIENT_ID unset)" };
    } catch (err) {
      steps.resolveServicePrincipal = { status: "failed", detail: err instanceof Error ? err.message : String(err) };
    }
    if (!servicePrincipalId) {
      const result = failedResult(steps, groupId, servicePrincipalId);
      await writeAudit(tenantId, customerId, source, actor, result);
      return result;
    }

    // ── Step 1: create (or reuse) the Entra security group ────────────────────
    try {
      const existing = await findExistingGroupId(tenantId);
      if (existing) {
        groupId = existing;
        steps.createGroup = { status: "already_done", detail: existing };
      } else {
        const result = await runBaselineTemplateAgainstTenant(
          "groups.create_security_group",
          tenantId,
          customerId,
          { displayName: GROUP_DISPLAY_NAME, mailNickname: GROUP_MAIL_NICKNAME },
          source,
        );
        const createdId = result.success ? (result.data as { id?: string } | null)?.id : undefined;
        if (result.success && createdId) {
          groupId = String(createdId);
          steps.createGroup = { status: "succeeded", detail: groupId };
        } else {
          steps.createGroup = { status: "failed", detail: `status=${result.status} ${typeof result.data === "string" ? result.data.slice(0, 300) : JSON.stringify(result.data)}` };
        }
      }
    } catch (err) {
      steps.createGroup = classifyWriteBackError(err);
    }
    if (!groupId) {
      const result = failedResult(steps, groupId, servicePrincipalId);
      await writeAudit(tenantId, customerId, source, actor, result);
      return result;
    }

    // ── Step 2: add mt-app's SP as a member of the group ──────────────────────
    try {
      const alreadyMember = await isServicePrincipalMember(tenantId, groupId, servicePrincipalId);
      if (alreadyMember) {
        steps.addServicePrincipalMember = { status: "already_done" };
      } else {
        const result = await runBaselineTemplateAgainstTenant(
          "groups.add_service_principal_member",
          tenantId,
          customerId,
          { groupId, servicePrincipalId },
          source,
        );
        if (result.success) {
          steps.addServicePrincipalMember = { status: "succeeded" };
        } else if (result.status === 400 && typeof result.data === "string" && /already exist/i.test(result.data)) {
          // Graph's real "already a member" shape for POST .../members/$ref — a
          // 400, not a 409 — same idempotent-no-op treatment #247 documented
          // for Add-RoleGroupMember's own duplicate-add case.
          steps.addServicePrincipalMember = { status: "already_done", detail: "Graph reported the member reference already exists" };
        } else {
          steps.addServicePrincipalMember = { status: "failed", detail: `status=${result.status} ${typeof result.data === "string" ? result.data.slice(0, 300) : JSON.stringify(result.data)}` };
        }
      }
    } catch (err) {
      steps.addServicePrincipalMember = classifyWriteBackError(err);
    }
    if (steps.addServicePrincipalMember.status === "failed" || steps.addServicePrincipalMember.status === "blocked") {
      const result = failedResult(steps, groupId, servicePrincipalId);
      await writeAudit(tenantId, customerId, source, actor, result);
      return result;
    }

    // ── Step 3: assign the group to the Purview DLP role group (PS write) ─────
    const roleGroupName = process.env.PURVIEW_DLP_ROLE_GROUP_NAME;
    if (!roleGroupName) {
      steps.addRoleGroupMember = {
        status: "failed",
        detail: "PURVIEW_DLP_ROLE_GROUP_NAME is not set — refusing to guess a Purview role group name for a real write",
      };
    } else {
      try {
        const psResult = await callPsExecution("add-role-group-member", {
          Organization: tenantId,
          Identity: roleGroupName,
          Member: groupId,
        });
        const item = psResult.items[0] as { status?: string } | undefined;
        steps.addRoleGroupMember = item?.status === "already_member"
          ? { status: "already_done", detail: roleGroupName }
          : { status: "succeeded", detail: roleGroupName };
      } catch (err) {
        if (err instanceof PsExecutionError) {
          steps.addRoleGroupMember = { status: "failed", detail: `${err.kind}: ${err.message}` };
        } else {
          steps.addRoleGroupMember = { status: "failed", detail: err instanceof Error ? err.message : String(err) };
        }
      }
    }

    const overallStatus: DlpProvisioningResult["overallStatus"] =
      steps.addRoleGroupMember.status === "succeeded" || steps.addRoleGroupMember.status === "already_done"
        ? "provisioned"
        : "partially_provisioned";
    const result: DlpProvisioningResult = { overallStatus, groupId, servicePrincipalId, steps };
    await writeAudit(tenantId, customerId, source, actor, result);
    return result;
  } catch (err) {
    // Backstop — every real failure path above is already caught and
    // classified; this only catches a genuinely unexpected throw so the
    // function's "never throws" contract holds even then.
    log.error({ err, tenantId, customerId, source }, "provisionDlpRoleGroupForTenant: unexpected failure");
    const result = failedResult(steps, groupId, servicePrincipalId);
    await writeAudit(tenantId, customerId, source, actor, result).catch(() => {});
    return result;
  }
}

// graphWriteForTenant's three write-back gate errors (customer not found /
// write-back not enabled / write consent not granted) are THROWN, never
// returned in the result — every runBaselineTemplateAgainstTenant() call
// above is wrapped in a try/catch that routes here.
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
  result: DlpProvisioningResult,
): Promise<void> {
  // Closes the gap #247 explicitly left open: ps-execution's add-role-group-
  // member write has no DB access and can only emit its outcome on the
  // "audit" stdout log channel (entrypoint.ps1:428-433) — this is that
  // outcome's forward into the real, queryable auditLogsTable.
  await createAuditLog({
    actorUserId: actor?.actorUserId ?? null,
    actorName: actor?.actorName ?? "system:consent.granted",
    actorRole: "admin",
    actionType: "dlp_role_group_provisioning",
    entityType: "tenant",
    entityId: customerId,
    entityLabel: tenantId,
    clientId: null,
    metadata: { source, overallStatus: result.overallStatus, groupId: result.groupId, servicePrincipalId: result.servicePrincipalId, steps: result.steps },
  });

  if (result.overallStatus === "failed" || result.overallStatus === "blocked") {
    log.warn({ tenantId, customerId, source, result }, "DLP role-group provisioning did not fully complete");
  } else {
    log.info({ tenantId, customerId, source, result }, "DLP role-group provisioning finished");
  }
}

/**
 * Real current provisioning state for a tenant, for the admin-panel display —
 * two live Graph reads (group existence, SP membership) plus the most recent
 * audit-log record for the Purview role-group step, since there is no Graph
 * (or PS) read endpoint in this platform today that can confirm Security &
 * Compliance role-group membership directly. Flagged: this makes the
 * role-group half of "current state" only as fresh as the last run/re-trigger
 * recorded, not a live read — same limitation callPsExecution's write-only
 * catalog entry has everywhere else in this chain.
 */
export interface DlpProvisioningState {
  status: "not_provisioned" | "partially_provisioned" | "provisioned" | "unknown";
  groupExists: boolean;
  servicePrincipalIsMember: boolean;
  lastRun: { at: string; source: string; overallStatus: string; roleGroupStepStatus: string } | null;
}

export async function getDlpProvisioningState(tenantId: string, customerId: number): Promise<DlpProvisioningState> {
  const { auditLogsTable } = await import("@workspace/db");
  const { and, desc } = await import("drizzle-orm");

  const [lastProvisioningRow] = await db
    .select({ createdAt: auditLogsTable.createdAt, metadata: auditLogsTable.metadata })
    .from(auditLogsTable)
    .where(and(
      eq(auditLogsTable.entityType, "tenant"),
      eq(auditLogsTable.entityId, String(customerId)),
      eq(auditLogsTable.actionType, "dlp_role_group_provisioning"),
    ))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(1);

  let groupExists = false;
  let servicePrincipalIsMember = false;
  try {
    const spId = await resolveMtAppServicePrincipalId(tenantId);
    const existingGroupId = await findExistingGroupId(tenantId);
    groupExists = existingGroupId != null;
    if (existingGroupId && spId) {
      servicePrincipalIsMember = await isServicePrincipalMember(tenantId, existingGroupId, spId);
    }
  } catch (err) {
    log.warn({ err, tenantId, customerId }, "getDlpProvisioningState: live Graph read failed — falling back to audit-log-only state");
  }

  const lastRun = lastProvisioningRow
    ? {
        at: lastProvisioningRow.createdAt.toISOString(),
        source: String((lastProvisioningRow.metadata as Record<string, unknown> | null)?.source ?? "unknown"),
        overallStatus: String((lastProvisioningRow.metadata as Record<string, unknown> | null)?.overallStatus ?? "unknown"),
        roleGroupStepStatus: String(
          ((lastProvisioningRow.metadata as { steps?: { addRoleGroupMember?: { status?: string } } } | null)?.steps?.addRoleGroupMember?.status) ?? "unknown",
        ),
      }
    : null;

  const roleGroupAssigned = lastRun != null && (lastRun.roleGroupStepStatus === "succeeded" || lastRun.roleGroupStepStatus === "already_done");

  let status: DlpProvisioningState["status"];
  if (!groupExists) {
    status = "not_provisioned";
  } else if (groupExists && servicePrincipalIsMember && roleGroupAssigned) {
    status = "provisioned";
  } else {
    status = "partially_provisioned";
  }

  return { status, groupExists, servicePrincipalIsMember, lastRun };
}
