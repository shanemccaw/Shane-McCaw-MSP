/**
 * POST-TERMINATION PURGE — the 7-year clock and its scheduler (Git #2765, EPIC #1944
 * part 7).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The requirement
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   *"7 years with no return → full purge. Same purge #1944 already defined. Audit trail
 *   survives it (part 2) — the account that this tenant existed, cancelled, and was
 *   purged on schedule is permanent even though the tenant's data is gone."*
 *   *"7 years later we can purge it... no point in being hoarders."* — confirmed: no
 *   cold-storage exception, no archived export retained.
 *
 * This is a DIFFERENT clock from the per-record 90/30 one, and the two must not be
 * confused. The per-record clock is `record_deletions.stageRemainingSeconds` and it is
 * FROZEN for the entire post-termination window. The clock here runs on the whole
 * dataset, starts at `tenants.subscription_lapsed_at`, and is the only thing still
 * counting after a customer leaves.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * What actually destroys the data
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `registerTenantDataPurger()` in `registry.ts` — each module declares how its own data
 * is destroyed, rather than this file carrying a hardcoded roster of every tenant-scoped
 * table. See that registry's own comment for why (short version: the dev-only hard-delete
 * route in `admin-active-directory.ts` is the worked example of such a roster rotting).
 *
 * **THE REGISTRY SHIPS EMPTY**, exactly as #1947's record-type registry does, and this
 * module treats that as a REFUSAL rather than a completed no-op — see
 * `purgeTerminatedTenant`. A tenant marked purged after destroying nothing would be the
 * worst possible outcome: an irreversible claim, recorded permanently in the audit trail,
 * that is false, with the tenant then excluded from every future sweep so the real purge
 * never happens.
 */

import { and, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { db, tenantsTable, RETENTION_DEFAULT_POST_TERMINATION_YEARS } from "@workspace/db";
import { logger } from "../logger";
import { postTerminationDueAt } from "./clock";
import { resolveRetentionPolicy } from "./policy";
import { listTenantDataPurgers } from "./registry";
import { resolveTenantBillingState } from "../tenant-billing-state";

const log = logger.child({ channel: "system.core" });
const auditLog = logger.child({ channel: "audit" });

// ─────────────────────────────────────────────────────────────────────────────
// The clock
// ─────────────────────────────────────────────────────────────────────────────

export interface PostTerminationSchedule {
  tenantId: number;
  lapsedAt: Date;
  years: number;
  /** True when `years` is the platform default rather than a per-customer override. */
  yearsIsDefault: boolean;
  purgeDueAt: Date;
  purgedAt: Date | null;
}

/**
 * The purge schedule for one lapsed customer, or null when there is nothing scheduled —
 * the tenant does not exist, is active, or has never been stamped with a lapse instant.
 *
 * A tenant with no lapse instant genuinely has no schedule, and this returns null rather
 * than substituting `now` or `createdAt`. Manufacturing a start point for an
 * irreversible 7-year clock is the one thing this module must never do.
 */
export async function postTerminationScheduleFor(tenantId: number): Promise<PostTerminationSchedule | null> {
  const [row] = await db
    .select({
      status: tenantsTable.status,
      lapsedAt: tenantsTable.subscriptionLapsedAt,
      purgedAt: tenantsTable.postTerminationPurgedAt,
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  if (!row || !row.lapsedAt) return null;

  // #2847 — "has this customer come back?" is the real billing question, not
  // `tenants.status` alone. A tenant whose subscription is cancelled while its status
  // still reads `active` is genuinely terminated, and checking status here would have
  // suppressed its schedule forever: `findTenantsDueForPostTerminationPurge` filters its
  // candidates through this function, so a null here means that customer's 7-year window
  // silently never expires. The `lapsedAt` check above is still the primary guard — the
  // reconciliation clears it the moment a customer returns — and this is the second half
  // of the same rule, now asking the same question the gate asks.
  const billing = await resolveTenantBillingState(tenantId);
  if (billing?.active) return null;

  const policy = await resolveRetentionPolicy(tenantId);
  const years = policy.postTermination.years;
  return {
    tenantId,
    lapsedAt: row.lapsedAt,
    years,
    yearsIsDefault: policy.postTermination.isDefault,
    purgeDueAt: postTerminationDueAt(row.lapsedAt, years),
    purgedAt: row.purgedAt,
  };
}

/**
 * Every tenant whose post-termination window may have expired.
 *
 * Coarse on purpose. The SQL filter uses the PLATFORM default window as its outer
 * bound — the shortest window any tenant can have is not knowable in SQL, because each
 * customer's is a nullable override in another table — and the exact per-customer due
 * date is then checked in `postTerminationScheduleFor` before anything is destroyed.
 * The candidate set is tiny (lapsed, unpurged, and years old) so the second pass costs
 * nothing, and this way a customer with a LONGER window than the default can never be
 * purged early by an over-eager range scan.
 *
 * A tenant that has returned to a running status is excluded by `subscription_lapsed_at`
 * being cleared, which is the reconciliation's job — the two halves agree by construction
 * rather than by both remembering the same rule.
 */
export async function findTenantsDueForPostTerminationPurge(now = new Date()): Promise<number[]> {
  const outerBound = new Date(now.getTime());
  outerBound.setUTCFullYear(outerBound.getUTCFullYear() - RETENTION_DEFAULT_POST_TERMINATION_YEARS);

  const rows = await db
    .select({ id: tenantsTable.id })
    .from(tenantsTable)
    .where(
      and(
        isNotNull(tenantsTable.subscriptionLapsedAt),
        isNull(tenantsTable.postTerminationPurgedAt),
        lte(tenantsTable.subscriptionLapsedAt, outerBound),
      ),
    );

  const due: number[] = [];
  for (const row of rows) {
    const schedule = await postTerminationScheduleFor(row.id);
    if (schedule && schedule.purgedAt === null && schedule.purgeDueAt.getTime() <= now.getTime()) {
      due.push(row.id);
    }
  }
  return due;
}

// ─────────────────────────────────────────────────────────────────────────────
// The purge
// ─────────────────────────────────────────────────────────────────────────────

export type PostTerminationPurgeOutcome =
  | "purged"
  | "not_due"
  | "already_purged"
  | "no_purgers_registered"
  | "failed";

export interface PostTerminationPurgeResult {
  tenantId: number;
  outcome: PostTerminationPurgeOutcome;
  /** Per-purger row counts, so the audit account says what was actually destroyed. */
  destroyed: Record<string, number>;
  totalDestroyed: number;
  error?: string;
}

/**
 * Purge one terminated customer's entire dataset.
 *
 * Re-checks the due date itself rather than trusting the caller. This function
 * irreversibly destroys a customer's data; a caller that computed the wrong tenant id or
 * ran against a stale candidate list must not be able to make that happen.
 *
 * The tenant ROW survives, stamped with `post_termination_purged_at`. That is forced:
 * `record_deletions.tenant_id` is `ON DELETE RESTRICT` so the account of every deletion
 * outlives the records it describes (#1944 part 2), and that account cannot point at a
 * tenant row that no longer exists. *"The audit references something that no longer
 * exists — that is correct and intended."*
 */
export async function purgeTerminatedTenant(
  tenantId: number,
  options?: { now?: Date; reason?: string },
): Promise<PostTerminationPurgeResult> {
  const now = options?.now ?? new Date();
  const empty: Record<string, number> = {};

  const schedule = await postTerminationScheduleFor(tenantId);
  if (!schedule) return { tenantId, outcome: "not_due", destroyed: empty, totalDestroyed: 0 };
  if (schedule.purgedAt !== null) {
    return { tenantId, outcome: "already_purged", destroyed: empty, totalDestroyed: 0 };
  }
  if (schedule.purgeDueAt.getTime() > now.getTime()) {
    return { tenantId, outcome: "not_due", destroyed: empty, totalDestroyed: 0 };
  }

  const registered = listTenantDataPurgers();
  if (registered.length === 0) {
    // Refuse rather than complete. Stamping `post_termination_purged_at` here would
    // write a permanent, irreversible claim that a customer's data was destroyed when
    // nothing was — and the tenant would then be excluded from every future sweep, so
    // the real purge would never happen. Leaving it due is recoverable; lying is not.
    log.error(
      { tenantId, lapsedAt: schedule.lapsedAt, purgeDueAt: schedule.purgeDueAt },
      "retention: tenant is due for post-termination purge but NO tenant-data purgers are registered — refusing to mark it purged",
    );
    return { tenantId, outcome: "no_purgers_registered", destroyed: empty, totalDestroyed: 0 };
  }

  const destroyed: Record<string, number> = {};
  try {
    await db.transaction(async (tx) => {
      for (const purger of registered) {
        destroyed[purger.key] = await purger.purge(tx, tenantId);
      }
      await tx
        .update(tenantsTable)
        .set({ postTerminationPurgedAt: now, updatedAt: now })
        // Conditional, so two sweeps racing cannot both claim the purge.
        .where(and(eq(tenantsTable.id, tenantId), isNull(tenantsTable.postTerminationPurgedAt)));
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err, tenantId }, "retention: post-termination purge failed — tenant left due for the next sweep");
    return { tenantId, outcome: "failed", destroyed, totalDestroyed: 0, error: message };
  }

  const totalDestroyed = Object.values(destroyed).reduce((a, b) => a + b, 0);

  // The account survives what it describes (#1944 part 2). This is the terminal entry in
  // the chain the epic specifies: deleted → soft → notified → semi-hard → notified → purged.
  auditLog.info(
    {
      actionType: "retention.tenant.post_termination_purged",
      tenantId,
      lapsedAt: schedule.lapsedAt.toISOString(),
      retentionYears: schedule.years,
      retentionYearsIsDefault: schedule.yearsIsDefault,
      purgeDueAt: schedule.purgeDueAt.toISOString(),
      destroyed,
      totalDestroyed,
      reason: options?.reason ?? "post_termination_window_expired",
      occurredAt: now.toISOString(),
    },
    "audit: post-termination retention window expired — customer dataset purged, no archived export retained",
  );

  return { tenantId, outcome: "purged", destroyed, totalDestroyed };
}

export interface PostTerminationSweepResult {
  due: number;
  purged: number;
  refused: number;
  failed: number;
}

/**
 * The daily sweep. Cheap on every normal day: the candidate query is a partial-index
 * lookup that returns nothing until a customer has actually been gone for years.
 */
export async function runPostTerminationPurgeSweep(now = new Date()): Promise<PostTerminationSweepResult> {
  const dueIds = await findTenantsDueForPostTerminationPurge(now);
  const result: PostTerminationSweepResult = { due: dueIds.length, purged: 0, refused: 0, failed: 0 };

  for (const tenantId of dueIds) {
    const outcome = await purgeTerminatedTenant(tenantId, { now });
    if (outcome.outcome === "purged") result.purged += 1;
    else if (outcome.outcome === "no_purgers_registered") result.refused += 1;
    else if (outcome.outcome === "failed") result.failed += 1;
  }

  if (result.due > 0) {
    log.info(result, "retention: post-termination purge sweep complete");
  }
  return result;
}
