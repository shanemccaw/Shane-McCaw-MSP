/**
 * launch-control-change-request.ts — Git #3541: the real Change Request a
 * Console-executed M365 Launch Control catalog-script execution stands behind.
 *
 * ── The gap this closes ──────────────────────────────────────────────────────
 * `msp-launch-control.ts`'s `POST /execute` ran a real, live Graph write
 * (`runBaselineTemplateAgainstTenant`) without ever creating a
 * `msp_change_requests` row. #3464 assumed the Console would afterwards call
 * `POST /change-control/executions/human-action` to attest it — but that
 * endpoint 404s without a real, existing CR (`loadScopedChange`), and no code
 * path ever created one for a Launch Control action. #3541 filed the mismatch;
 * this is the fix.
 *
 * ── Why `write_action`, not `human_action` (the real second half of the fix) ──
 * `human_action` is reserved for "a change only a person can make... no code
 * path observes it" (see `cr_executions.executor_kind`'s own schema comment).
 * A Launch Control execution is the OPPOSITE of that: a real Graph write a code
 * path (`runBaselineTemplateAgainstTenant`) directly confirms, with its own
 * `success`/`status` result. `write_action` already exists for exactly this
 * ("a change a code path can confirm") — so this records the execution as a
 * `write_action`, entirely server-side, and never asks the Console to attest
 * anything. #3464's premise (Console calls `human-action` after a catalog
 * script) does not survive contact with the real executor-kind vocabulary; the
 * correct integration is this module, not a client-side attestation call.
 *
 * ── Why `changeClass: "standard"` (the same shape #1498 already established) ──
 * `POST /portal/change-catalog/:id/execute` raises a pre-approved `standard` CR
 * for a customer executing a governed catalog item — 0 required approval
 * stages (`requiredStages`), one real inherited-approval ledger row instead of
 * a pending human ask. A Launch Control action is pre-approved the same way,
 * just gated by a different mechanism: the MSP's tier entitlement
 * (`computeAvailability` in `msp-launch-control.ts`, re-validated server-side
 * on every execute call, never trusted from the client). There is no single
 * named human approver behind a `write_action_catalog` row the way a
 * `change_catalog_items` row carries `approvedByName` — the entitlement gate
 * IS the pre-approval — so `approvedBy` is left null here and
 * `materializeApprovalsForChange`'s `stages === 0, no approvedBy` branch
 * records "Standard change — pre-approved by policy" rather than naming a
 * human who never actually signed off on this specific row.
 */

import { and, eq } from "drizzle-orm";

import {
  db,
  mspChangeRequestsTable,
  type WriteActionCatalog,
} from "@workspace/db";

import { materializeApprovalsForChange } from "./portal-change-approvals-store.ts";
import { recordCrEvent } from "./portal-change-timeline-store.ts";
import { recordExecution } from "./msp-change-execution-store.ts";
import { formatChangeRequestCode } from "./msp-change-execution.ts";
import type { ChangeRequestCategory, StoredRiskLevel } from "./portal-change-control.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "workflow.change-control" });

/**
 * `write_action_catalog.domain` (13 real live values, confirmed against the
 * local database) → `msp_change_requests.category` (the 8-value
 * `CHANGE_REQUEST_CATEGORIES` enum `portal-change-control.ts` owns). Every
 * unmapped domain falls back to "Identity" — the same convention
 * `workloadForCategory` already documents for a category with no display
 * mapping: the column is free text at the DB level, so an unrecognised value
 * must still render a row rather than fail the write.
 */
const CATEGORY_BY_WRITE_ACTION_DOMAIN: Record<string, ChangeRequestCategory> = {
  "Conditional Access": "ConditionalAccess",
  Exchange: "Exchange",
  "Devices/Intune": "Intune",
  "Security (Defender)": "Defender",
  "SharePoint/OneDrive": "SharePoint",
  Teams: "Teams",
};

function categoryForWriteActionDomain(domain: string): ChangeRequestCategory {
  return CATEGORY_BY_WRITE_ACTION_DOMAIN[domain] ?? "Identity";
}

/**
 * `write_action_catalog.safe_or_gated` → `msp_change_requests.risk_level`. A
 * `gated` action (the catalog's own stricter capability check,
 * `launch_control_gated_write`) is the higher-risk write; `safe` is the lower.
 * Null (present on the catalog's unclassified `blocked_no_workaround` rows)
 * can never actually reach this function in practice — `execute` 409s on a
 * null `templateId` before a live write is possible — but is mapped to
 * "medium" rather than assumed, the same fail-safe-middle `computeAvailability`
 * already applies to an unclassified row.
 */
function riskLevelForSafeOrGated(safeOrGated: string | null): StoredRiskLevel {
  if (safeOrGated === "gated") return "high";
  if (safeOrGated === "safe") return "low";
  return "medium";
}

export interface RaiseLaunchControlChangeRequestInput {
  readonly mspId: number;
  /** The Graph tenant guid — `msp_change_requests.tenant_id`'s real shape. */
  readonly tenantId: string;
  readonly tenantName: string;
  readonly primaryDomain: string;
  readonly catalogRow: Pick<WriteActionCatalog, "domain" | "actionName" | "surface" | "safeOrGated">;
  readonly templateId: string;
  /** The real payload about to be sent to Graph — variables + customerId, verbatim. */
  readonly proposedPayload: Record<string, unknown>;
  readonly requestedBy: string;
  /** Set only when the template pairs with a real reverse template (Reverse-Template Pairing). */
  readonly reverseTemplateId: string | null;
}

export interface RaisedLaunchControlChangeRequest {
  readonly id: number;
  readonly code: string;
}

/**
 * Raise the real, pre-approved `standard` CR a Launch Control execute call
 * stands behind — called BEFORE the Graph write fires, so Change Control is
 * genuinely the authorization gate (#1497's own principle) rather than a
 * record bolted on after the fact. On success the caller executes the write
 * and then calls `recordLaunchControlExecutionOutcome` below with the real
 * result; the CR row already exists either way.
 */
export async function raiseChangeRequestForLaunchControlExecution(
  input: RaiseLaunchControlChangeRequestInput,
): Promise<RaisedLaunchControlChangeRequest> {
  const requestedAt = new Date().toISOString();
  const riskLevel = riskLevelForSafeOrGated(input.catalogRow.safeOrGated);

  const [inserted] = await db
    .insert(mspChangeRequestsTable)
    .values({
      mspId: input.mspId,
      tenantId: input.tenantId,
      tenantName: input.tenantName,
      primaryDomain: input.primaryDomain,
      title: input.catalogRow.actionName,
      description:
        `Raised from M365 Launch Control: ${input.catalogRow.domain} · ${input.catalogRow.actionName}. ` +
        `Executed live by the MSP operator against ${input.tenantName} — pre-approved by tier entitlement, no CAB required.`,
      changeClass: "standard",
      riskLevel,
      category: categoryForWriteActionDomain(input.catalogRow.domain),
      targetResource: `Write action: ${input.catalogRow.actionName} (${input.catalogRow.surface})`,
      psaTicketId: "No ticket reference",
      requestedBy: input.requestedBy,
      requestedAt,
      scheduledFor: "Immediate — Launch Control live execution",
      impactedUsersCount: 0,
      status: "pending_approval",
      // #2665 — no real backup mechanism exists for a Launch Control write yet;
      // matches the standard-catalog and MSP-console create routes' own fix.
      backupVerified: false,
      backupHash: "",
      preChangeSnapshot: {},
      proposedPayload: input.proposedPayload,
      rollbackScriptSnippet: input.reverseTemplateId
        ? `Reverse via baseline template: ${input.reverseTemplateId}`
        : "",
      implementer: "msp",
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
    log.error({ err, changeRequestId: inserted.id }, "launch-control-change-request: approval materialisation failed");
  }

  const code = formatChangeRequestCode(inserted.id);
  log.info(
    { mspId: input.mspId, changeRequestId: inserted.id, code, templateId: input.templateId },
    "launch-control-change-request: raised",
  );
  return { id: inserted.id, code };
}

/**
 * Record the real outcome of the write this CR authorized, as a `write_action`
 * — a code path (the Graph write that just ran) confirms it, so it is recorded
 * AND completed in the same call, never left `pending` awaiting an attestation
 * that #3541 found never corresponds to a real mapping for this executor kind.
 * On success the CR itself is closed to `completed` (with `executedAt`
 * stamped) so the register reflects reality immediately rather than sitting at
 * "pending approval" forever; on failure the CR is left `pending_approval` —
 * consistent with `releaseChangeRequestClaim`'s own "a failed run releases the
 * claim so the approved CR can authorize a retry" behaviour.
 */
export async function recordLaunchControlExecutionOutcome(opts: {
  readonly changeRequestId: number;
  readonly mspId: number;
  readonly tenantId: string;
  readonly success: boolean;
}): Promise<void> {
  await recordExecution({
    changeRequestId: opts.changeRequestId,
    mspId: opts.mspId,
    tenantId: opts.tenantId,
    executorKind: "write_action",
    implementer: "msp",
    outcome: opts.success ? "succeeded" : "failed",
  });

  if (opts.success) {
    const now = new Date();
    await db
      .update(mspChangeRequestsTable)
      .set({ status: "completed", executedAt: now.toISOString(), updatedAt: now })
      .where(and(eq(mspChangeRequestsTable.id, opts.changeRequestId), eq(mspChangeRequestsTable.mspId, opts.mspId)));
  }
}
