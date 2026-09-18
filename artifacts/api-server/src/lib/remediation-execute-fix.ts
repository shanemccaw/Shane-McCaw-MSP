/**
 * remediation-execute-fix.ts — Feature #4587: the Remediation Checklist
 * "execute" affordance's real write-execution path.
 *
 * ── The gap this closes ──────────────────────────────────────────────────────
 * The Remediation Tracker resolves a per-item fix route (`remediation-fix-
 * route.ts`, #1539). A `we_can_run` item renders an "execute" affordance meaning
 * "the platform runs the fix." That affordance was real (correctly computed) but
 * had nowhere to go: the checklist's only checkKey-keyed write action was
 * `raise-change` (`remediation-raise-change.ts`), which creates a governance CR
 * record and STOPS — nothing off a checklist item ever called
 * `runBaselineTemplateAgainstTenant` or `recordExecution`.
 *
 * This is that missing step, built by EXTENDING the proven M365 Launch Control
 * pattern (`msp-launch-control.ts` `POST /execute` +
 * `launch-control-change-request.ts`), not reinventing it:
 *
 *   1. Resolve the item's `checkKey` → a real, execution-ready `templateId` via
 *      the SAME live `config_pack_templates` join the fix-route resolver already
 *      uses to raise a finding's ceiling to `we_can_run`.
 *   2. Raise a real, pre-approved `standard` Change Request BEFORE the write
 *      fires (#3541's authorization-gate principle), carrying `remediationCheckKey`
 *      so the CR links back to the finding it fixes.
 *   3. Execute via `runBaselineTemplateAgainstTenant` — the one, shared executor.
 *   4. Record the outcome as a `write_action` and close the CR — reusing
 *      `recordLaunchControlExecutionOutcome` verbatim (it is generic over
 *      changeRequestId/mspId/tenantId/success).
 *
 * ── Testbed-only, resolved on #4587 ──────────────────────────────────────────
 * Shane's decision on #4587: mirror Launch Control's testbed-only restriction,
 * NOT admin-execute-action's production posture. This is a real Graph write;
 * lifting it to live customer tenants is a separate, later task. Write-back
 * consent + tenant consent are enforced downstream by `graphWriteForTenant`
 * regardless (defense in depth) — the `we_can_run` gate below already requires
 * write-back `granted` via the fix-route resolution, and the isTestbed flag is
 * enforced here.
 *
 * This module is surface-agnostic: it takes a resolved customer + checkKey and
 * returns an `{ httpStatus, body }` outcome the calling route renders verbatim,
 * so the MSP and (future) portal surfaces share one execution path with one set
 * of gates.
 */

import { and, asc, eq, isNotNull } from "drizzle-orm";
import {
  db,
  baselineActionTemplatesTable,
  configPackTemplatesTable,
  configPacksTable,
  mspChangeRequestsTable,
  tenantsTable,
} from "@workspace/db";

import { logger } from "./logger.ts";
import { resolveRemediationChecklistItem, type RemediationChecklistItem } from "./remediation-checklist.ts";
import { categoryForWorkload, workloadForCheckKey, type StoredRiskLevel } from "./portal-change-control.ts";
import { materializeApprovalsForChange } from "./portal-change-approvals-store.ts";
import { recordCrEvent } from "./portal-change-timeline-store.ts";
import { formatChangeRequestCode } from "./msp-change-execution.ts";
import { recordLaunchControlExecutionOutcome } from "./launch-control-change-request.ts";
import { classifyCaEnforcementWrite, caEnforcementRefusalMessage } from "./ca-enforcement-mode.ts";
import {
  loadRequiredLicenseSkuListsByTemplate,
  resolveTenantWritePreconditionRefusal,
  PRECONDITION_HTTP_STATUS,
} from "./tenant-write-preconditions.ts";

const log = logger.child({ channel: "engine.remediation-tracker" });

/**
 * The single executable template behind a monitoring `checkKey` — the SAME live
 * `config_pack_templates` join the fix-route resolver uses to decide
 * `writePackAvailable`, but returning the real `templateId` to run rather than a
 * boolean. Confirmed on the live DB (2026-09-17): no checkKey maps to more than
 * one distinct template across active packs, so the lowest `sort_order` row is a
 * stable, unambiguous choice. Returns null when no active pack maps this check to
 * a real template — the fail-closed case for an item whose ceiling was raised to
 * `we_can_run` by an authored capability alone, with nothing runnable behind it.
 */
export async function resolveExecutableTemplateIdForCheckKey(checkKey: string): Promise<string | null> {
  const rows = await db
    .select({ templateId: configPackTemplatesTable.templateId })
    .from(configPackTemplatesTable)
    .innerJoin(configPacksTable, eq(configPacksTable.id, configPackTemplatesTable.packId))
    .where(
      and(
        eq(configPackTemplatesTable.checkKey, checkKey),
        isNotNull(configPackTemplatesTable.templateId),
        eq(configPacksTable.status, "active"),
      ),
    )
    .orderBy(asc(configPackTemplatesTable.sortOrder));
  return rows.find((r) => r.templateId != null)?.templateId ?? null;
}

/**
 * `critical` findings are the higher-risk write, `warning` the lower — the same
 * severity split the checklist itself sorts by. Distinct from
 * `changeClassForSeverity` in `remediation-raise-change.ts` (which decides
 * whether the GOVERNANCE raise-change flow needs review): an EXECUTE is always a
 * pre-approved `standard` CR — the write-back consent that made this item
 * `we_can_run` IS the pre-approval, exactly as Launch Control's tier entitlement
 * is — so severity only tunes the recorded risk level, never the change class.
 */
function riskLevelForSeverity(severity: "critical" | "warning"): StoredRiskLevel {
  return severity === "critical" ? "high" : "medium";
}

/**
 * Raise the real, pre-approved `standard` CR a remediation execute stands
 * behind — modelled on `raiseChangeRequestForLaunchControlExecution`, but
 * sourced from a checklist item + resolved template rather than a
 * `write_action_catalog` row, and carrying `remediationCheckKey` so the register
 * links the CR back to the finding it fixes.
 */
async function raiseChangeRequestForRemediationExecution(input: {
  readonly mspId: number;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly primaryDomain: string;
  readonly item: RemediationChecklistItem;
  readonly templateId: string;
  readonly proposedPayload: Record<string, unknown>;
  readonly requestedBy: string;
  readonly reverseTemplateId: string | null;
}): Promise<{ id: number; code: string }> {
  const requestedAt = new Date().toISOString();
  const riskLevel = riskLevelForSeverity(input.item.severity);

  const [inserted] = await db
    .insert(mspChangeRequestsTable)
    .values({
      mspId: input.mspId,
      tenantId: input.tenantId,
      tenantName: input.tenantName,
      primaryDomain: input.primaryDomain,
      title: `Fix: ${input.item.title}`,
      description:
        `Executed live from the Remediation Tracker: ${input.item.checkKey}` +
        (input.item.summary ? ` — ${input.item.summary}` : "") +
        `. Run by the platform against ${input.tenantName} — pre-approved by write-back consent, no CAB required.`,
      changeClass: "standard",
      riskLevel,
      category: categoryForWorkload(workloadForCheckKey(input.item.checkKey)),
      targetResource: `Remediation fix: ${input.item.checkKey} (${input.templateId})`,
      psaTicketId: "No ticket reference",
      requestedBy: input.requestedBy,
      requestedAt,
      scheduledFor: "Immediate — Remediation Tracker live execution",
      impactedUsersCount: 0,
      status: "pending_approval",
      // No real backup mechanism exists for this write yet — matches Launch
      // Control's own #2665 fix.
      backupVerified: false,
      backupHash: "",
      preChangeSnapshot: {},
      proposedPayload: input.proposedPayload,
      rollbackScriptSnippet: input.reverseTemplateId ? `Reverse via baseline template: ${input.reverseTemplateId}` : "",
      implementer: "msp",
      // The link Launch Control's own CR lacks: this CR is FROM a finding.
      remediationCheckKey: input.item.checkKey,
      linkedFinding: input.item.checkKey,
    })
    .returning({ id: mspChangeRequestsTable.id, createdAt: mspChangeRequestsTable.createdAt });

  await recordCrEvent({
    changeRequestId: inserted.id,
    mspId: input.mspId,
    tenantId: input.tenantId,
    eventType: "raised",
    fromValue: null,
    toValue: "pending_approval",
    actorRole: "msp",
    actorName: input.requestedBy,
    occurredAt: inserted.createdAt,
  });

  try {
    await materializeApprovalsForChange({
      id: inserted.id,
      mspId: input.mspId,
      tenantId: input.tenantId,
      changeClass: "standard",
      riskLevel,
      status: "pending_approval",
      approvedBy: null,
      requestedBy: input.requestedBy,
      createdAt: inserted.createdAt,
    });
  } catch (err) {
    log.error({ err, changeRequestId: inserted.id }, "remediation-execute-fix: approval materialisation failed");
  }

  const code = formatChangeRequestCode(inserted.id);
  log.info(
    { mspId: input.mspId, changeRequestId: inserted.id, code, checkKey: input.item.checkKey, templateId: input.templateId },
    "remediation-execute-fix: CR raised",
  );
  return { id: inserted.id, code };
}

async function safeRecordOutcome(changeRequestId: number, mspId: number, tenantId: string, success: boolean): Promise<void> {
  try {
    await recordLaunchControlExecutionOutcome({ changeRequestId, mspId, tenantId, success });
  } catch (err) {
    log.error({ err, changeRequestId, mspId }, "remediation-execute-fix: execution record failed (non-fatal)");
  }
}

/** What the calling route renders verbatim — one shape for every gate + the success case. */
export interface ExecuteRemediationFixOutcome {
  readonly httpStatus: number;
  readonly body: Record<string, unknown>;
}

/**
 * Execute the fix for a `we_can_run` remediation checklist item: resolve the
 * template, run every pre-write gate (all CR-free clean refusals), raise the
 * pre-approved CR, fire the real Graph write, and record + close the CR. The
 * caller has already resolved and authorized `customerId` for its own surface;
 * this owns the execution and its gates.
 */
export async function executeRemediationChecklistFix(input: {
  readonly customerId: number;
  readonly checkKey: string;
  readonly actor: { readonly email?: string | null; readonly id?: number | null };
  readonly variables?: Record<string, string>;
}): Promise<ExecuteRemediationFixOutcome> {
  const { customerId, checkKey } = input;

  // Gate 1 — only a currently-OPEN finding for this tenant's latest scan is
  // executable. Identical fail-closed gate to the raise-change route: a resolved
  // or never-real item has nothing to execute.
  const item = await resolveRemediationChecklistItem(customerId, checkKey);
  if (!item) {
    return { httpStatus: 404, body: { error: "Unknown or already-resolved checklist item" } };
  }

  // Gate 2 — only a `we_can_run` item (affordance "execute") may be run by the
  // platform. This is the resolved `min(what the finding supports, what the
  // tenant permits)` shape (#1539): a tenant without write-back consent resolves
  // to `you_must_run` and is refused here, from the SAME single source of truth
  // the checklist UI renders its affordance from — never a second, drifting
  // judgement of executability.
  if (item.fixRoute !== "we_can_run") {
    return {
      httpStatus: 409,
      body: {
        error: "This item cannot be executed by the platform — its resolved fix route is not 'we_can_run'.",
        fixRoute: item.fixRoute,
        affordance: item.affordance,
      },
    };
  }

  // Resolve the real executable template. Fail closed if the `we_can_run`
  // ceiling was raised by an authored KB capability alone with no runnable pack
  // behind it — there is genuinely nothing to run.
  const templateId = await resolveExecutableTemplateIdForCheckKey(checkKey);
  if (!templateId) {
    return { httpStatus: 409, body: { error: "This item has no execution-ready config-pack template to run" } };
  }

  // The customer's real M365 tenant this write lands on. mspId is the customer's
  // own MSP (the CR belongs to it). Consent is enforced downstream by
  // graphWriteForTenant; the testbed flag is enforced here.
  const [customer] = await db
    .select({
      mspId: tenantsTable.mspId,
      tenantId: tenantsTable.tenantId,
      isTestbed: tenantsTable.isTestbed,
      name: tenantsTable.customerName,
      domain: tenantsTable.domain,
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, customerId))
    .limit(1);
  if (!customer?.tenantId) {
    return { httpStatus: 400, body: { error: "Selected customer has no connected tenant" } };
  }
  if (customer.mspId == null) {
    return { httpStatus: 409, body: { error: "Customer is not associated with an MSP" } };
  }

  // TESTBED-ONLY (resolved on #4587: mirror Launch Control, not admin-execute-
  // action's production posture). tenants.is_testbed is NOT NULL DEFAULT false,
  // so any path that doesn't set it fails CLOSED here.
  if (!customer.isTestbed) {
    return { httpStatus: 403, body: { error: "Remediation execute is only available for a customer flagged isTestbed" } };
  }

  const [template] = await db
    .select()
    .from(baselineActionTemplatesTable)
    .where(eq(baselineActionTemplatesTable.templateId, templateId))
    .limit(1);
  if (!template) {
    return { httpStatus: 409, body: { error: "This item's template is not runnable" } };
  }

  const payload: Record<string, unknown> = { ...(input.variables ?? {}), customerId };

  const { resolveBaselineTemplateRequest, runBaselineTemplateAgainstTenant } = await import("./workflow-executor.ts");

  // Resolve the request once for the pre-write gates (pure resolution, no Graph
  // call). A missing required input is a clean 400 BEFORE any CR is raised.
  const preview = await resolveBaselineTemplateRequest(templateId, payload);
  if (preview.missingVariables.length > 0) {
    return {
      httpStatus: 400,
      body: { error: "This fix needs inputs that were not provided", missingVariables: preview.missingVariables },
    };
  }

  // #4522 — a write that would leave a Conditional Access policy ENFORCING is
  // refused here, CR-free: that decision belongs to the promotion workflow,
  // which reviews the policy's real sign-in impact first. The executor refuses
  // it too; this is the clean refusal before a CR is raised.
  const caEnforcementKind = classifyCaEnforcementWrite({ method: preview.method, endpoint: preview.endpoint, body: preview.body });
  if (caEnforcementKind !== null) {
    log.info(
      { customerId, checkKey, templateId, caEnforcementKind },
      "remediation-execute-fix: refused — Conditional Access enforcement goes through the promotion workflow",
    );
    return {
      httpStatus: 409,
      body: { error: caEnforcementRefusalMessage(caEnforcementKind), errorType: "ca_enforcement_requires_promotion", caEnforcementKind },
    };
  }

  // #4545 — the Security Defaults replacement rule + any tenant precondition,
  // evaluated through the same shared function every other write path uses,
  // before a CR is ever raised for a write that is about to be refused.
  const licenseLists = await loadRequiredLicenseSkuListsByTemplate([templateId]);
  const preconditionRefusal = await resolveTenantWritePreconditionRefusal({
    packKey: templateId,
    subject: `Remediation fix '${item.title}'`,
    steps: [
      {
        templateId,
        method: template.method,
        endpoint: template.endpoint,
        bodyTemplate: (template.bodyTemplate ?? {}) as Record<string, unknown>,
        requiredLicenseSkuLists: licenseLists.get(templateId) ?? [],
      },
    ],
    tenantId: customer.tenantId,
    payload,
  });
  if (preconditionRefusal) {
    log.info(
      { customerId, checkKey, templateId, code: preconditionRefusal.code },
      "remediation-execute-fix: refused by a tenant precondition",
    );
    return {
      httpStatus: PRECONDITION_HTTP_STATUS[preconditionRefusal.code] ?? 409,
      body: { error: preconditionRefusal.message, errorType: preconditionRefusal.code, ...(preconditionRefusal.details ?? {}) },
    };
  }

  // Change Control as the authorization gate (#3541): raise the real,
  // pre-approved CR BEFORE the Graph write fires, so there is always a real
  // `msp_change_requests` row behind this execution.
  const changeRequest = await raiseChangeRequestForRemediationExecution({
    mspId: customer.mspId,
    tenantId: customer.tenantId,
    tenantName: customer.name ?? "",
    primaryDomain: customer.domain ?? "",
    item,
    templateId,
    proposedPayload: payload,
    requestedBy: input.actor.email ?? "unknown@mspplatform.com",
    reverseTemplateId: template.reversible ? template.reverseTemplateId : null,
  });

  const result = await runBaselineTemplateAgainstTenant(templateId, customer.tenantId, customerId, payload, "remediation_execute");

  // #3937 — a tenant licensing shortfall surfaces as a clear, customer-safe
  // message rather than a raw Graph 403; record the failed outcome and close.
  if (!result.success && result.errorType === "license_gap") {
    await safeRecordOutcome(changeRequest.id, customer.mspId, customer.tenantId, false);
    log.info(
      { customerId, checkKey, templateId, licenseFeature: result.licenseFeature, changeRequestId: changeRequest.id },
      "remediation-execute-fix: blocked by tenant license gap",
    );
    return {
      httpStatus: 409,
      body: {
        error: `This action requires ${result.licenseFeature ?? "a Microsoft 365 add-on license"} on this customer's tenant, which it does not currently have.`,
        errorType: "license_gap",
        licenseFeature: result.licenseFeature ?? null,
        changeRequest: { id: changeRequest.id, code: changeRequest.code },
      },
    };
  }

  // Record the execution as a `write_action` (a code path — this very call —
  // confirms it) and close the CR out on success; a failed run leaves the CR
  // pending so the approved CR can authorize a retry.
  await safeRecordOutcome(changeRequest.id, customer.mspId, customer.tenantId, result.success);

  log.info(
    { customerId, checkKey, templateId, success: result.success, changeRequestId: changeRequest.id },
    "remediation-execute-fix: execute completed",
  );
  return {
    httpStatus: 200,
    body: {
      result: { ...result, reversible: result.success && template.reversible },
      checkKey,
      tenant: { customerId, name: customer.name ?? null },
      changeRequest: { id: changeRequest.id, code: changeRequest.code },
    },
  };
}
