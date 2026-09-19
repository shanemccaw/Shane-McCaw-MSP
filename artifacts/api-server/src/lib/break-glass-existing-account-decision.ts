/**
 * break-glass-existing-account-decision.ts — Git #4532
 *
 * Gate-side half of the "existing break-glass account" decision. A config-pack
 * re-run whose create step found exactly one existing account (#4514) never applied
 * the run's generated password to it. Rather than fail the run, or pick a path, the
 * break_glass_verification_gate pauses (the same `pauseForApproval` mechanism
 * approval_gate and generate_script use) and calls into here to:
 *
 *   - record one `break_glass_existing_account_decisions` row the operator answers, and
 *   - tell the people who can answer it.
 *
 * The answer itself — reset + redeliver, or resume without delivering — is executed
 * by `performExistingAccountDecision()` in routes/break-glass-verification.ts, next
 * to the `performBreakGlassAdminOverride()` it delegates to.
 *
 * Nothing here ever sees, stores or logs the generated password.
 */

import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  breakGlassExistingAccountDecisionsTable,
  tenantsTable,
  usersTable,
  type BreakGlassExistingAccountDecision,
} from "@workspace/db";
import { LEGACY_ROLE } from "@workspace/db/rbac/legacy-ladder";
import { createNotification, createNotificationForAllAdmins } from "./notification-center.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "auth" });

/** The identifiers of the account the create step found — never a credential. */
export function describeExistingAccount(existing: unknown): { id: string | null; upn: string | null } {
  const o = (existing ?? {}) as { id?: unknown; userPrincipalName?: unknown };
  const id = typeof o.id === "string" && o.id.length > 0 ? o.id : null;
  const upn = typeof o.userPrincipalName === "string" && o.userPrincipalName.length > 0 ? o.userPrincipalName : null;
  return { id, upn };
}

export async function recordExistingAccountDecision(input: {
  runId: number;
  gateNodeId: string;
  customerId: number;
  pendingSecretId: number;
  existingAccountId: string | null;
  existingAccountUpn: string | null;
  skippedNodeId: string;
  /** The run's REDACTED payload snapshot — the one resumeWorkflowRun() needs back. */
  context: Record<string, unknown>;
}): Promise<BreakGlassExistingAccountDecision> {
  const [row] = await db.insert(breakGlassExistingAccountDecisionsTable).values({
    runId: input.runId,
    gateNodeId: input.gateNodeId,
    customerId: input.customerId,
    pendingSecretId: input.pendingSecretId,
    existingAccountId: input.existingAccountId,
    existingAccountUpn: input.existingAccountUpn,
    skippedNodeId: input.skippedNodeId,
    status: "pending",
    context: input.context,
  }).returning();
  return row!;
}

/**
 * Tell the platform admins and the customer's MSP operators that a run is waiting
 * on their answer. Best-effort: a failed notification must not fail the pause — the
 * decision row and the console's Break-glass page are the source of truth.
 */
export async function notifyExistingAccountDecision(input: {
  runId: number;
  customerId: number;
  decisionId: number;
  accountLabel: string;
}): Promise<void> {
  const title = "Break-glass decision needed";
  const linkPath = "/break-glass";
  try {
    const [tenant] = await db
      .select({ name: tenantsTable.customerName, mspId: tenantsTable.mspId })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, input.customerId))
      .limit(1);
    const body =
      `Run #${input.runId} paused: ${tenant?.name ?? `customer #${input.customerId}`} already has a break-glass account ` +
      `(${input.accountLabel}). Ask the customer whether to reset and redeliver its password or resume without delivering, then record their answer.`;

    await createNotificationForAllAdmins({
      title,
      body,
      notifType: "general",
      category: "approval",
      linkPath,
    });

    if (tenant?.mspId != null) {
      const operators = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(and(
          eq(usersTable.mspId, tenant.mspId),
          eq(usersTable.isActive, true),
          inArray(usersTable.mspRole, [LEGACY_ROLE.mspAdmin, LEGACY_ROLE.mspOperator]),
        ));
      await Promise.all(operators.map((u) => createNotification({
        title,
        body,
        notifType: "general",
        linkPath,
        feedType: "personal",
        category: "approval",
        severity: "warning",
        recipient: { type: "msp_user", mspUserId: u.id, mspId: tenant.mspId! },
      })));
    }
  } catch (err) {
    log.warn({ err, runId: input.runId, decisionId: input.decisionId }, "break-glass: could not notify about the existing-account decision (non-fatal)");
  }
}
