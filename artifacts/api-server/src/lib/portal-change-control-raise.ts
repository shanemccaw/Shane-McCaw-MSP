/**
 * portal-change-control-raise.ts — the ONE place that inserts a real
 * `msp_change_requests` row for a customer's own tenant (#1941).
 *
 * Extracted out of `routes/portal-change-control.ts`'s wizard POST handler
 * so a SECOND caller can raise a real CR without re-deriving risk/workload,
 * re-running the freeze gate, or re-materialising approvals: everything the
 * wizard's `POST /portal/change-control` does after validating its body now
 * lives here as `raiseChangeRequest`, and the route calls it too.
 *
 * The second caller is `portal-remediation-checklist.ts`'s
 * `POST /portal/remediation/checklist/:checkKey/raise-change` (#1941) — the
 * structured backend path #1541's CR gate has been waiting on since it
 * shipped: a CR raised FROM a checklist item, with `remediation_check_key`
 * populated, so `evaluateRevealAuthorization` finally has a real row to
 * authorize once that CR is approved.
 */

import {
  db,
  mspChangeRequestsTable,
  portalChangeControlPolicyTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

import type { AuthUser } from "../middlewares/requireAuth";
import { resolveTenantScope } from "./portal-customer-scope";
import { personIdForUser } from "./portal-ownership";
import { dischargeRisksForNewChangeRequest } from "./change-request-risk-discharge";
import { activeFreezeForSubmit, freezeForBookedWindow, recordFreezeException } from "./portal-change-freeze-store";
import { maintenanceCoverageForBookedSpan } from "./portal-change-maintenance-store";
import { collidingChangeRequestForSubmit } from "./portal-change-collision-store";
import { loadApprovalPolicy, materializeApprovalsForChange } from "./portal-change-approvals-store";
import { recordCrEvent } from "./portal-change-timeline-store";
import { logger } from "./logger";
import {
  categoryForWorkload,
  computeRiskLevel,
  deriveWorkload,
  formatChangeRequestCode,
  storedChangeClass,
  storedRiskLevel,
  type ChangeClass,
  type ChangeRequestWorkload,
  type RiskLevel,
} from "./portal-change-control";

export type { ChangeRequestWorkload } from "./portal-change-control";

const log = logger.child({ channel: "tenant.portal" });

export interface RaiseChangeRequestInput {
  readonly title: string;
  readonly target: string;
  readonly ticket?: string;
  readonly pre?: Record<string, unknown>;
  readonly post: Record<string, unknown>;
  readonly changeClass: ChangeClass;
  readonly impactedUsersCount: number;
  readonly window: string;
  readonly scheduledStart?: string;
  readonly scheduledEnd?: string;
  readonly freezeException?: { readonly justification: string };
  /** #1541 — set when this CR is raised FROM a remediation checklist item. */
  readonly remediationCheckKey?: string | null;
  /**
   * #1941 — when the caller already knows the real workload from a better
   * source than `deriveWorkload`'s cmdlet/Graph-endpoint pattern match over
   * `target` (e.g. a checklist item's own `checkKey` prefix), it can supply
   * that workload directly rather than have it silently re-derived (and
   * possibly mis-derived) from a `target` string that was never a technical
   * resource identifier to begin with. Not client-supplied — only ever set
   * by server-side derivation, same trust boundary as `risk`/`workload`
   * themselves (see this file's header on why those are never accepted from
   * a request body).
   */
  readonly workloadOverride?: ChangeRequestWorkload;
}

export interface RaiseChangeRequestResult {
  readonly code: string;
  readonly risk: Exclude<RiskLevel, "Critical">;
  readonly workload: ChangeRequestWorkload;
  readonly freezeException: boolean;
  readonly riskDischarged: boolean;
}

/**
 * Thrown for every rejection this function makes on the caller's behalf
 * (no connected tenant, an unresolved freeze block). The route maps
 * `status`/`body` straight onto the HTTP response; a caller that doesn't
 * want the HTTP shape can read `.status` and `.message` directly.
 */
export class RaiseChangeRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "RaiseChangeRequestError";
  }
}

/**
 * Raises a real change request against the caller's own tenant. Identical
 * behaviour to the wizard's POST handler (freeze enforcement, computed
 * risk/workload, approval materialisation, freeze-exception recording, risk
 * discharge) — see that route's own header for why each of those exists.
 * Non-fatal side effects (approval materialisation, freeze-exception
 * recording, risk discharge) log and continue rather than throwing: the CR
 * itself is already committed by the time any of them run.
 */
export async function raiseChangeRequest(
  customerId: number,
  user: Pick<AuthUser, "id" | "email">,
  input: RaiseChangeRequestInput,
): Promise<RaiseChangeRequestResult> {
  const scope = await resolveTenantScope(customerId);
  if (!scope) {
    throw new RaiseChangeRequestError(409, "This account has no connected Microsoft 365 tenant to raise a change against");
  }

  const risk = computeRiskLevel({
    changeClass: input.changeClass,
    targetResource: input.target,
    impactedUsersCount: input.impactedUsersCount,
  });
  const workload = input.workloadOverride ?? deriveWorkload(input.target);
  const requestedBy = user.email ?? "unknown";
  const requestedAt = new Date().toISOString();

  const [policyRow] = await db
    .select({
      enabled: portalChangeControlPolicyTable.enabled,
      enforceFreezeCalendar: portalChangeControlPolicyTable.enforceFreezeCalendar,
      enforceMaintenanceWindows: portalChangeControlPolicyTable.enforceMaintenanceWindows,
    })
    .from(portalChangeControlPolicyTable)
    .where(eq(portalChangeControlPolicyTable.customerId, scope.customerId))
    .limit(1);
  const freezeEnforced = policyRow?.enabled === true && policyRow?.enforceFreezeCalendar === true;
  const maintenanceEnforced = policyRow?.enabled === true && policyRow?.enforceMaintenanceWindows === true;
  const freezeCtx = { mspId: scope.mspId, tenantId: scope.tenantId, workload };
  const submitFreeze = freezeEnforced ? await activeFreezeForSubmit(freezeCtx, new Date()) : null;

  const bookedWindowEvaluated = freezeEnforced && !!input.scheduledStart;
  const bookedFreeze = bookedWindowEvaluated
    ? await freezeForBookedWindow(
        freezeCtx,
        new Date(input.scheduledStart!),
        input.scheduledEnd ? new Date(input.scheduledEnd) : null,
      )
    : null;

  const blockingFreeze = submitFreeze ?? bookedFreeze;
  if (blockingFreeze && !input.freezeException) {
    const reason = submitFreeze
      ? `"${blockingFreeze.name}" is an active change freeze. Raising a change now requires a written exception.`
      : `The booked window overlaps the "${blockingFreeze.name}" change freeze. Scheduling into it requires a written exception.`;
    throw new RaiseChangeRequestError(409, reason, {
      freeze: { id: blockingFreeze.id, name: blockingFreeze.name, scope: blockingFreeze.scope },
      bookedWindowEvaluated,
    });
  }

  // #1504 — maintenance-window enforcement: only meaningful against a real
  // booked span, same gate as the freeze booked-window check above.
  if (maintenanceEnforced && input.scheduledStart) {
    const covered = await maintenanceCoverageForBookedSpan(
      freezeCtx,
      new Date(input.scheduledStart),
      input.scheduledEnd ? new Date(input.scheduledEnd) : null,
    );
    if (!covered) {
      throw new RaiseChangeRequestError(409, "The booked window falls outside every approved maintenance window.", {
        maintenanceWindowRequired: true,
      });
    }
  }

  // #1504 — collision detection on `targetResource`: two changes hitting the
  // same object. Unconditional (not policy-gated) — this is a scheduling
  // conflict, not a curated calendar rule an MSP opts into. Only evaluated
  // against a real booked span; a change with no real instant cannot collide.
  if (input.scheduledStart) {
    const colliding = await collidingChangeRequestForSubmit(
      scope.mspId,
      scope.tenantId,
      input.target,
      new Date(input.scheduledStart),
      input.scheduledEnd ? new Date(input.scheduledEnd) : null,
    );
    if (colliding) {
      throw new RaiseChangeRequestError(
        409,
        `This target is already booked by ${colliding.code} in an overlapping window.`,
        { collidesWith: colliding.code },
      );
    }
  }

  // #1761 — a Standard change is pre-approved at creation. See the wizard
  // route's own comment on why this name mirrors materializeApprovalsForChange's.
  const wizardApprovedBy = input.changeClass === "Standard" ? "Standard change — pre-approved" : null;

  const [inserted] = await db
    .insert(mspChangeRequestsTable)
    .values({
      mspId: scope.mspId,
      tenantId: scope.tenantId,
      tenantName: scope.tenantName,
      primaryDomain: scope.primaryDomain,
      title: input.title,
      description: input.remediationCheckKey
        ? `Raised from the remediation checklist (${input.remediationCheckKey}). Awaiting approval.`
        : "Raised from the change control page. Awaiting approval.",
      changeClass: storedChangeClass(input.changeClass),
      riskLevel: storedRiskLevel(risk),
      category: categoryForWorkload(workload),
      targetResource: input.target,
      psaTicketId: input.ticket?.trim() || "No ticket reference",
      requestedBy,
      requestedAt,
      scheduledFor: input.window,
      scheduledStart: input.scheduledStart ? new Date(input.scheduledStart) : null,
      scheduledEnd: input.scheduledEnd ? new Date(input.scheduledEnd) : null,
      impactedUsersCount: input.impactedUsersCount,
      status: "pending_approval",
      backupVerified: false,
      backupHash: "",
      preChangeSnapshot: input.pre ?? {},
      proposedPayload: input.post,
      rollbackScriptSnippet: "",
      remediationCheckKey: input.remediationCheckKey?.trim() || null,
      approvedBy: wizardApprovedBy,
    })
    .returning({ id: mspChangeRequestsTable.id, createdAt: mspChangeRequestsTable.createdAt });

  await recordCrEvent({
    changeRequestId: inserted.id,
    mspId: scope.mspId,
    tenantId: scope.tenantId,
    eventType: "raised",
    fromValue: null,
    toValue: "pending_approval",
    actorRole: "customer",
    actorPersonId: personIdForUser(user.id),
    actorName: requestedBy,
    occurredAt: inserted.createdAt,
  });

  try {
    const policy = await loadApprovalPolicy(customerId);
    await materializeApprovalsForChange(
      {
        id: inserted.id,
        mspId: scope.mspId,
        tenantId: scope.tenantId,
        changeClass: storedChangeClass(input.changeClass),
        riskLevel: storedRiskLevel(risk),
        status: "pending_approval",
        approvedBy: wizardApprovedBy,
        requestedBy,
        createdAt: inserted.createdAt,
      },
      policy,
    );
  } catch (err) {
    log.error({ err, crId: inserted.id }, "change request created but approval materialisation failed");
  }

  if (blockingFreeze && input.freezeException) {
    try {
      await recordFreezeException({
        changeRequestId: inserted.id,
        mspId: scope.mspId,
        tenantId: scope.tenantId,
        freezeWindowId: blockingFreeze.id,
        justification: input.freezeException.justification,
        requestedBy,
      });
    } catch (err) {
      log.error({ err, crId: inserted.id }, "change request created but freeze-exception stage failed to record");
    }
  }

  let riskDischarged = false;
  if (input.remediationCheckKey) {
    try {
      const { dischargedRiskIds } = await dischargeRisksForNewChangeRequest({
        changeRequestId: inserted.id,
        mspId: scope.mspId,
        tenantId: scope.tenantId,
        checkKey: input.remediationCheckKey.trim(),
      });
      riskDischarged = dischargedRiskIds.length > 0;
    } catch (err) {
      log.error({ err, crId: inserted.id }, "change request created but risk discharge lookup failed");
    }
  }

  const code = formatChangeRequestCode(inserted.id);
  log.info(
    { customerId, mspId: scope.mspId, code, risk, workload, changeClass: input.changeClass, freezeException: blockingFreeze !== null, riskDischarged, remediationCheckKey: input.remediationCheckKey ?? null },
    "change request raised",
  );

  return { code, risk, workload, freezeException: blockingFreeze !== null, riskDischarged };
}
