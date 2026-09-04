/**
 * TENANT SUBSCRIPTION STATE — the freeze/resume trigger and the gate's data source
 * (Git #2765, EPIC #1944 parts 7 and 8).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * What this module is for
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * #1947 built the clock and left it unwired on purpose: `freezeTenantClocks()` and
 * `resumeTenantClocks()` exist and are correct, but nothing ever calls them. This
 * module is what calls them, and it is the single place that decides — for the gate,
 * for the clocks, and for the 7-year purge — whether a customer's subscription is
 * running.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Why this is a RECONCILIATION and not a transition hook
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The obvious implementation is an `onStatusChange` hook fired from wherever
 * `tenants.status` is written. That is the shape #1944 part 8 rejected for the gate
 * itself, and it fails here for exactly the same reason:
 *
 *   *"A flag-based approach requires every route, or at least every route's data
 *   layer, to respect the flag. A gate in front of routing cannot be bypassed by a
 *   route that forgot to check — there is nothing to forget."*
 *
 * A status written by a route that forgot to call the hook — or by a migration, a
 * seed, a support session, or psql — would leave a cancelled customer's clocks running
 * and their purge window never started. Irreversibly, in the direction that destroys
 * data early.
 *
 * So the durable state is a two-field comparison and nothing else:
 *
 *   | `tenants.status` running? | `subscription_lapsed_at` | meaning        | action           |
 *   |---------------------------|--------------------------|----------------|------------------|
 *   | yes                       | null                     | steady, active | none             |
 *   | no                        | set                      | steady, lapsed | none             |
 *   | no                        | null                     | JUST LAPSED    | freeze + stamp   |
 *   | yes                       | set                      | JUST RETURNED  | resume + clear   |
 *
 * Any writer that changes `status` by any means puts the pair into a disagreeing
 * state, and the next reconciliation — whichever of the three below runs first —
 * settles it. There is nothing to forget, and no second source of truth for "is this
 * customer paying" (part 8's other requirement).
 *
 * Three things drive it, deliberately overlapping:
 *
 *   1. **The real status write sites call it directly**, so an operator who archives a
 *      customer sees the freeze happen now rather than within a day.
 *   2. **The subscription gate calls it** when it observes a disagreeing pair on a live
 *      request. The gate already reads the tenant row on every request, so this is free.
 *   3. **A daily sweep calls it for every tenant.** This one is load-bearing rather
 *      than belt-and-braces: a customer who cancels stops making requests, so the gate
 *      will never fire for them again. Without the sweep, the one customer whose clocks
 *      most need freezing is the one whose clocks never would.
 */

import { and, eq, inArray, isNotNull, isNull, notInArray, or } from "drizzle-orm";
import {
  db,
  tenantsTable,
  RETENTION_CLOCK_RUNNING_TENANT_STATUSES,
  type Tenant,
} from "@workspace/db";
import { logger } from "../logger";
import { postTerminationDueAt } from "./clock";
import { freezeTenantClocks, resumeTenantClocks } from "./lifecycle";
import { resolveRetentionPolicy } from "./policy";

const log = logger.child({ channel: "system.core" });
const auditLog = logger.child({ channel: "audit" });

/** Why a clock froze. The only real cause today; stored so a frozen row explains itself. */
export const SUBSCRIPTION_FREEZE_REASON = "subscription_inactive";

type TenantStatus = Tenant["status"];

/**
 * The clock-running statuses, typed as the `tenants.status` enum union rather than
 * `string[]`, so drizzle's `inArray`/`notInArray` accept them and so the compiler
 * enforces the check that actually matters: if a status is ever added to the column's
 * enum, this list is the one place that has to decide what it means for retention.
 *
 * Mutable rather than `readonly` because those two helpers reject a `readonly` array.
 * Private to this module; never handed out.
 */
const RUNNING_STATUSES: TenantStatus[] = [...RETENTION_CLOCK_RUNNING_TENANT_STATUSES];

export function isRunningStatus(status: string | null | undefined): boolean {
  return status != null && (RUNNING_STATUSES as readonly string[]).includes(status);
}

// ─────────────────────────────────────────────────────────────────────────────
// The resolved state
// ─────────────────────────────────────────────────────────────────────────────

export interface TenantSubscriptionState {
  tenantId: number;
  mspId: number;
  customerName: string;
  /** Raw `tenants.status`. */
  status: string;
  /** True when the portal is open. The one fact the gate acts on. */
  active: boolean;
  /** When the subscription stopped running. Null while active. */
  lapsedAt: Date | null;
  /** The post-termination window in years — this customer's policy, or the platform default. */
  postTerminationYears: number;
  /** True when `postTerminationYears` came from the platform default rather than an override. */
  postTerminationIsDefault: boolean;
  /**
   * When the whole dataset purges if the customer never returns. Null while active —
   * an active customer has no purge date, and rendering one would be inventing it.
   */
  purgeDueAt: Date | null;
  /** Set once the post-termination purge has actually run. The tenant row is a tombstone. */
  purgedAt: Date | null;
}

/**
 * The full subscription/retention state for one customer. Returns null when the tenant
 * does not exist — the caller decides what that means, because the two callers want
 * opposite things from it (the gate denies, the sweep skips).
 */
export async function readTenantSubscriptionState(tenantId: number): Promise<TenantSubscriptionState | null> {
  const [row] = await db
    .select({
      id: tenantsTable.id,
      mspId: tenantsTable.mspId,
      customerName: tenantsTable.customerName,
      status: tenantsTable.status,
      lapsedAt: tenantsTable.subscriptionLapsedAt,
      purgedAt: tenantsTable.postTerminationPurgedAt,
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  if (!row) return null;

  const policy = await resolveRetentionPolicy(tenantId);
  const active = isRunningStatus(row.status);

  return {
    tenantId: row.id,
    mspId: row.mspId,
    customerName: row.customerName,
    status: row.status,
    active,
    lapsedAt: row.lapsedAt,
    postTerminationYears: policy.postTermination.years,
    postTerminationIsDefault: policy.postTermination.isDefault,
    // Null while active AND null while lapsed-but-not-yet-stamped: until the
    // reconciliation records a real lapse instant there is no honest date to show, and
    // the alternative — computing one from `now` — would move every time it was read.
    purgeDueAt:
      !active && row.lapsedAt
        ? postTerminationDueAt(row.lapsedAt, policy.postTermination.years)
        : null,
    purgedAt: row.purgedAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The gate's read cache
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How long a resolved subscription state may be reused by the gate.
 *
 * #1944 part 8 requires the gate be *"re-evaluated live, not a one-time transition"*, and
 * a cache is in tension with that — so the window is deliberately small, and correctness
 * does not depend on it being small:
 *
 *   - Locking OUT is never delayed by more than this, and this is seconds.
 *   - Unlocking is not delayed at all. Every path that reactivates a customer calls
 *     `invalidateSubscriptionGateCache()`, so a returning customer's very next request
 *     reads fresh state. A stale lock-out is the failure that would make the product look
 *     broken to a customer who has just paid, so that direction is removed outright
 *     rather than merely shortened.
 *
 * Per-process, one small object keyed by tenant id, bounded by the number of customers
 * that made a request in the last few seconds.
 */
const GATE_CACHE_TTL_MS = 5_000;

const stateCache = new Map<number, { state: TenantSubscriptionState | null; expiresAt: number }>();

/** Drop a tenant's cached state so the next request re-reads it. */
export function invalidateSubscriptionGateCache(tenantId?: number): void {
  if (tenantId === undefined) stateCache.clear();
  else stateCache.delete(tenantId);
}

/** `readTenantSubscriptionState` with the short TTL above. What the gate calls per request. */
export async function readTenantSubscriptionStateCached(
  tenantId: number,
): Promise<TenantSubscriptionState | null> {
  const now = Date.now();
  const hit = stateCache.get(tenantId);
  if (hit && hit.expiresAt > now) return hit.state;

  const state = await readTenantSubscriptionState(tenantId);
  stateCache.set(tenantId, { state, expiresAt: now + GATE_CACHE_TTL_MS });
  return state;
}

// ─────────────────────────────────────────────────────────────────────────────
// The reconciliation
// ─────────────────────────────────────────────────────────────────────────────

export type TenantRetentionSyncAction = "none" | "frozen" | "resumed" | "tenant_missing";

export interface TenantRetentionSyncResult {
  tenantId: number;
  action: TenantRetentionSyncAction;
  /** How many `record_deletions` clocks were actually moved. */
  clocksAffected: number;
  lapsedAt: Date | null;
}

/**
 * Reconcile one customer's retention state against its real billing state.
 *
 * Safe to call on every request, from a sweep, and from a write site simultaneously —
 * the two mutating branches are guarded by the same predicate they are correcting, so
 * a concurrent caller that already applied the change updates zero rows and reports
 * `none`. In particular a double freeze cannot re-stamp `subscription_lapsed_at` and
 * silently push a customer's purge date years into the future.
 */
export async function syncTenantRetentionState(tenantId: number): Promise<TenantRetentionSyncResult> {
  const [row] = await db
    .select({
      status: tenantsTable.status,
      lapsedAt: tenantsTable.subscriptionLapsedAt,
      purgedAt: tenantsTable.postTerminationPurgedAt,
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  if (!row) {
    return { tenantId, action: "tenant_missing", clocksAffected: 0, lapsedAt: null };
  }

  const active = isRunningStatus(row.status);
  const now = new Date();

  // ── JUST LAPSED — the customer cancelled ────────────────────────────────────
  if (!active && row.lapsedAt === null) {
    // Stamp first, conditionally. If another caller got here first this updates zero
    // rows and we fall through to a no-op rather than freezing twice.
    const stamped = await db
      .update(tenantsTable)
      .set({ subscriptionLapsedAt: now, updatedAt: now })
      .where(and(eq(tenantsTable.id, tenantId), isNull(tenantsTable.subscriptionLapsedAt)))
      .returning({ id: tenantsTable.id });

    if (stamped.length === 0) {
      return { tenantId, action: "none", clocksAffected: 0, lapsedAt: row.lapsedAt };
    }

    // #1944 part 7: every per-record clock freezes exactly where it stands. Idempotent
    // in the foundation, so a crash between the stamp and here is recoverable — the
    // next reconciliation sees a lapsed tenant whose clocks are still running.
    const clocksAffected = await freezeTenantClocks(tenantId, SUBSCRIPTION_FREEZE_REASON);

    auditLog.info(
      {
        actionType: "retention.subscription.lapsed",
        tenantId,
        status: row.status,
        lapsedAt: now.toISOString(),
        clocksFrozen: clocksAffected,
        occurredAt: now.toISOString(),
      },
      "audit: subscription lapsed — per-record retention clocks frozen and post-termination window started",
    );

    return { tenantId, action: "frozen", clocksAffected, lapsedAt: now };
  }

  // ── JUST RETURNED — the customer came back inside the window ────────────────
  if (active && row.lapsedAt !== null) {
    // A purged tenant that somehow reads active is NOT a return. Its data is gone, so
    // there is nothing to unlock and clearing the lapse instant would erase the only
    // record of when the window it already ran started. Refuse loudly instead.
    if (row.purgedAt !== null) {
      log.error(
        { tenantId, purgedAt: row.purgedAt, status: row.status },
        "retention: tenant reads active but its data was already purged — refusing to resume; this needs a human",
      );
      return { tenantId, action: "none", clocksAffected: 0, lapsedAt: row.lapsedAt };
    }

    const cleared = await db
      .update(tenantsTable)
      .set({ subscriptionLapsedAt: null, updatedAt: now })
      .where(and(eq(tenantsTable.id, tenantId), isNotNull(tenantsTable.subscriptionLapsedAt)))
      .returning({ id: tenantsTable.id });

    if (cleared.length === 0) {
      return { tenantId, action: "none", clocksAffected: 0, lapsedAt: null };
    }

    // *"Per-record clocks RESUME from where they froze — a record that was mid-ghost is
    // still mid-ghost, not reset."* The remainder replay is the foundation's job; this
    // only decides when.
    const clocksAffected = await resumeTenantClocks(tenantId);
    const frozenForDays = Math.floor((now.getTime() - row.lapsedAt.getTime()) / 86_400_000);

    auditLog.info(
      {
        actionType: "retention.subscription.returned",
        tenantId,
        status: row.status,
        lapsedAt: row.lapsedAt.toISOString(),
        frozenForDays,
        clocksResumed: clocksAffected,
        occurredAt: now.toISOString(),
      },
      "audit: subscription returned inside the retention window — full unlock, per-record clocks resumed from where they froze",
    );

    return { tenantId, action: "resumed", clocksAffected, lapsedAt: null };
  }

  return { tenantId, action: "none", clocksAffected: 0, lapsedAt: row.lapsedAt };
}

/**
 * What a route calls immediately after writing `tenants.status`.
 *
 * The reconciliation would catch these tenants anyway — on their next request, or on the
 * daily sweep. This exists so an operator who cancels or reactivates a customer sees it
 * take effect now rather than eventually, and so the gate's cached state is dropped in
 * the same breath.
 *
 * Never throws. A failure here is a delay, not a loss: the state is still inconsistent
 * in exactly the way the sweep is built to find. Failing the operator's request because
 * a follow-up reconciliation stumbled would be the wrong trade.
 */
export async function syncTenantsAfterStatusWrite(tenantIds: number[]): Promise<void> {
  for (const tenantId of tenantIds) {
    try {
      await syncTenantRetentionState(tenantId);
    } catch (err) {
      log.error(
        { err, tenantId },
        "retention: post-status-write sync failed (non-fatal — the daily sweep will reconcile it)",
      );
    } finally {
      invalidateSubscriptionGateCache(tenantId);
    }
  }
}

/**
 * Every tenant whose `status` and `subscription_lapsed_at` disagree — i.e. every
 * customer whose clocks are in the wrong state right now.
 *
 * Expressed as a query rather than "read all tenants and filter in JS" so the daily
 * sweep costs one indexed pass and does nothing at all on the normal day where every
 * tenant agrees with itself.
 */
export async function findTenantsNeedingRetentionSync(): Promise<number[]> {
  const rows = await db
    .select({ id: tenantsTable.id })
    .from(tenantsTable)
    .where(
      or(
        // lapsed but never stamped → needs freezing
        and(
          notInArray(tenantsTable.status, RUNNING_STATUSES),
          isNull(tenantsTable.subscriptionLapsedAt),
        ),
        // running but still stamped → needs resuming
        and(
          inArray(tenantsTable.status, RUNNING_STATUSES),
          isNotNull(tenantsTable.subscriptionLapsedAt),
        ),
      ),
    );
  return rows.map((r) => r.id);
}

export interface RetentionSyncSweepResult {
  examined: number;
  frozen: number;
  resumed: number;
  clocksFrozen: number;
  clocksResumed: number;
}

/**
 * The daily reconciliation sweep. Load-bearing, not a safety net: a cancelled customer
 * makes no further requests, so this is the only thing that will ever notice them.
 */
export async function runRetentionSubscriptionSync(): Promise<RetentionSyncSweepResult> {
  const tenantIds = await findTenantsNeedingRetentionSync();
  const result: RetentionSyncSweepResult = {
    examined: tenantIds.length,
    frozen: 0,
    resumed: 0,
    clocksFrozen: 0,
    clocksResumed: 0,
  };

  for (const tenantId of tenantIds) {
    try {
      const synced = await syncTenantRetentionState(tenantId);
      if (synced.action === "frozen") {
        result.frozen += 1;
        result.clocksFrozen += synced.clocksAffected;
      } else if (synced.action === "resumed") {
        result.resumed += 1;
        result.clocksResumed += synced.clocksAffected;
      }
    } catch (err) {
      // One tenant's failure must not stop the rest of the sweep — the next tenant in
      // the list may be the one whose purge window needs starting.
      log.error({ err, tenantId }, "retention: subscription sync failed for tenant (continuing)");
    }
  }

  if (result.frozen > 0 || result.resumed > 0) {
    log.info(result, "retention: subscription state reconciled");
  }
  return result;
}
