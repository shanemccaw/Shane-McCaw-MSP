/**
 * dlp-role-group-provisioning.ts
 *
 * #249 (#246 chunk C): orchestrates the three-step chain #247/#248 built but
 * left unwired — create an Entra security group, add the ps-execution app's
 * service principal as its member (see the #2166 note below for WHICH app that
 * is, and why it is not MT_APP_CLIENT_ID), then assign that group to the
 * Purview role group that carries the "DLP Compliance Management" role.
 * Without this, an app-only Get-DlpCompliancePolicy/etc. call fails with
 * "not recognized" on every tenant onboarded after #212 shipped, even though
 * Graph admin consent itself succeeded (Purview role groups are a completely
 * separate permission system — see #246's problem statement).
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
 * ── WHICH service principal, and why not MT_APP_CLIENT_ID (#2166) ──────────
 * Identical to the Gap 3 bug #2161 fixed in global-reader-role-provisioning.ts,
 * and fixed here the same way. The env var name `MT_APP_CLIENT_ID` holds
 * *different app registrations in different runtimes*:
 *   • api-server            MT_APP_CLIENT_ID = 4743b130-… → SP 6bae4b49-… (the
 *                           READ app; runs the `graph` executor checks).
 *   • ps-execution container MT_APP_CLIENT_ID = 9ea2e409-… → SP 1c640fe8-… (runs
 *                           the `powershell` Exchange/Purview/Teams checks via
 *                           mt-app-cert; entrypoint.ps1:71, README.md:186).
 * The checks this whole chain exists to unblock — `compliance:zero-dlp-policies`,
 * `weak-dlp-policies`, `missing-labels`, `label-errors`, `dlp-incidents`,
 * `audit-log-retention` — are `powershell` checks, so they run in the CONTAINER
 * as the 9ea2e409 app. But this module runs in the api-server, where
 * `process.env.MT_APP_CLIENT_ID` is 4743b130 — so resolving that env var (the
 * pre-#2166 behavior) put SP 6bae4b49 in the security group and therefore in the
 * Purview role group, while the app-only Get-DlpCompliancePolicy/Get-Label calls
 * kept running as 1c640fe8 with no DLP Compliance Management. The role-group
 * membership landed on a principal that never runs the checks needing it, which
 * is the exact failure #249 exists to prevent.
 * The fix: resolve the ps-execution app explicitly via PS_EXECUTION_APP_CLIENT_ID
 * (the container's own MT_APP_CLIENT_ID value, 9ea2e409-…), falling back to
 * MT_APP_CLIENT_ID only for a unified deployment where both are the same app.
 * The resolved appId + which env var supplied it is recorded in the step detail,
 * on the result, and in the audit metadata so a wrong target is visible in the
 * trail, not silent. See docs/tenant-permission-model.md §7.
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
  /** App registration whose SP was targeted, and which env var supplied it (#2166). */
  targetAppId: string | null;
  targetAppIdSource: string | null;
  steps: {
    resolveServicePrincipal: ProvisioningStepResult;
    createGroup: ProvisioningStepResult;
    addServicePrincipalMember: ProvisioningStepResult;
    addRoleGroupMember: ProvisioningStepResult;
  };
}

function failedResult(
  steps: DlpProvisioningResult["steps"],
  groupId: string | null,
  servicePrincipalId: string | null,
  target: { clientId: string | null; sourceVar: string | null },
): DlpProvisioningResult {
  const anySucceeded = Object.values(steps).some(s => s.status === "succeeded" || s.status === "already_done");
  const anyBlocked = Object.values(steps).some(s => s.status === "blocked");
  return {
    overallStatus: anyBlocked && !anySucceeded ? "blocked" : anySucceeded ? "partially_provisioned" : "failed",
    groupId,
    servicePrincipalId,
    targetAppId: target.clientId,
    targetAppIdSource: target.sourceVar,
    steps,
  };
}

/**
 * Which app registration's service principal should end up in the Purview DLP
 * role group. Prefers PS_EXECUTION_APP_CLIENT_ID (the ps-execution container's
 * app — the one that actually runs the DLP/label PowerShell checks needing the
 * role); falls back to MT_APP_CLIENT_ID only for a unified deployment where
 * they are the same app. See the #2166 note in this file's header.
 */
function resolveTargetAppClientId(): { clientId: string; sourceVar: string } | null {
  const psExec = process.env.PS_EXECUTION_APP_CLIENT_ID;
  if (psExec) return { clientId: psExec, sourceVar: "PS_EXECUTION_APP_CLIENT_ID" };
  const mtApp = process.env.MT_APP_CLIENT_ID;
  if (mtApp) return { clientId: mtApp, sourceVar: "MT_APP_CLIENT_ID (fallback — set PS_EXECUTION_APP_CLIENT_ID to be explicit)" };
  return null;
}

/**
 * Resolves the ps-execution app's own service principal object id INSIDE the
 * target tenant's directory. Multi-tenant app registrations get a distinct SP
 * object per tenant, so this can't be a static env var — it's a live read
 * (uses the `graph` read consent, guaranteed present since this chain only
 * fires after that consent just succeeded).
 * Returns the resolved SP id plus the appId/env-var it was resolved from, so
 * the exact target is auditable (#2166).
 */
async function resolveTargetServicePrincipalId(
  tenantId: string,
): Promise<{ servicePrincipalId: string | null; clientId: string | null; sourceVar: string | null }> {
  const target = resolveTargetAppClientId();
  if (!target) return { servicePrincipalId: null, clientId: null, sourceVar: null };
  const res = await graphFetchForTenant(tenantId, `/servicePrincipals?$filter=appId eq '${target.clientId}'&$select=id,appId`);
  if (!res.ok) return { servicePrincipalId: null, clientId: target.clientId, sourceVar: target.sourceVar };
  const body = (await res.json()) as { value?: Array<{ id: string }> };
  return { servicePrincipalId: body.value?.[0]?.id ?? null, clientId: target.clientId, sourceVar: target.sourceVar };
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
  // Which app registration we targeted, and which env var named it (#2166) —
  // carried onto every return path so a wrong target is never silent.
  let target: { clientId: string | null; sourceVar: string | null } = { clientId: null, sourceVar: null };

  try {
    // ── Step 0: resolve the ps-execution app's SP object id in this tenant (read-only) ──
    try {
      const resolved = await resolveTargetServicePrincipalId(tenantId);
      servicePrincipalId = resolved.servicePrincipalId;
      target = { clientId: resolved.clientId, sourceVar: resolved.sourceVar };
      const via = resolved.clientId
        ? `appId=${resolved.clientId} via ${resolved.sourceVar}`
        : "no target app client id configured (PS_EXECUTION_APP_CLIENT_ID / MT_APP_CLIENT_ID both unset)";
      steps.resolveServicePrincipal = servicePrincipalId
        ? { status: "succeeded", detail: `SP ${servicePrincipalId} (${via})` }
        : { status: "failed", detail: `ps-execution app service principal not found in this tenant's directory (${via})` };
    } catch (err) {
      steps.resolveServicePrincipal = { status: "failed", detail: err instanceof Error ? err.message : String(err) };
    }
    if (!servicePrincipalId) {
      const result = failedResult(steps, groupId, servicePrincipalId, target);
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
      const result = failedResult(steps, groupId, servicePrincipalId, target);
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
      const result = failedResult(steps, groupId, servicePrincipalId, target);
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
    const result: DlpProvisioningResult = {
      overallStatus,
      groupId,
      servicePrincipalId,
      targetAppId: target.clientId,
      targetAppIdSource: target.sourceVar,
      steps,
    };
    await writeAudit(tenantId, customerId, source, actor, result);
    return result;
  } catch (err) {
    // Backstop — every real failure path above is already caught and
    // classified; this only catches a genuinely unexpected throw so the
    // function's "never throws" contract holds even then.
    log.error({ err, tenantId, customerId, source }, "provisionDlpRoleGroupForTenant: unexpected failure");
    const result = failedResult(steps, groupId, servicePrincipalId, target);
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
    metadata: {
      source,
      overallStatus: result.overallStatus,
      groupId: result.groupId,
      servicePrincipalId: result.servicePrincipalId,
      // #2166: which app registration's SP this run actually targeted, and
      // which env var supplied it — top-level so a wrong target is queryable
      // in the audit trail, not buried in a step detail string.
      targetAppId: result.targetAppId,
      targetAppIdSource: result.targetAppIdSource,
      steps: result.steps,
    },
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
 * The membership read resolves the SAME target app as the provisioning chain
 * (#2166) and reports which appId/env var it used, so the admin panel can never
 * show "member: yes" for a principal the chain no longer targets.
 */
export interface DlpProvisioningState {
  status: "not_provisioned" | "partially_provisioned" | "provisioned" | "unknown";
  groupExists: boolean;
  servicePrincipalIsMember: boolean;
  /** App registration whose SP the membership check ran against, and which env var named it (#2166). */
  targetAppId: string | null;
  targetAppIdSource: string | null;
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
  let targetAppId: string | null = null;
  let targetAppIdSource: string | null = null;
  try {
    const { servicePrincipalId: spId, clientId, sourceVar } = await resolveTargetServicePrincipalId(tenantId);
    targetAppId = clientId;
    targetAppIdSource = sourceVar;
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

  return { status, groupExists, servicePrincipalIsMember, targetAppId, targetAppIdSource, lastRun };
}
