/**
 * MSP → CUSTOMER LAPSE CASCADE (Git #2936, EPIC #1944 parts 7-8).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The decision this implements
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * #2847 shipped the per-customer billing state and deliberately refused to answer one
 * question, filing it as #2936: when an MSP's own platform subscription lapses, do that
 * MSP's customers' portals close too, and do their 7-year purge clocks start? Shane's
 * answer (2026-09-05):
 *
 *   *"Yes, an MSP's lapsed platform subscription DOES cascade and start the 7-year purge
 *   clock on that MSP's customers. But it is not a hard lockout — the customer retains
 *   real limited access: they can still log in, download their data, delete their own
 *   data, and request reinstatement."*
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Why this file is so small — and must stay that way
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The cascade is NOT implemented here. It is one extra conjunct in
 * `decideTenantBillingActive()` and its SQL twin `tenantBillingActiveCondition()`:
 *
 *   active = ... AND the parent MSP's own platform subscription has not lapsed
 *
 * Everything #2765 built then follows with no further wiring, because it all reads that
 * one predicate: `syncTenantRetentionState()` stamps `subscription_lapsed_at` and freezes
 * the per-record clocks, `post-termination.ts` starts the 7-year window from that instant,
 * and the gate middleware turns every non-allowlisted route into the wall. The un-cascade
 * is the same predicate flipping back — the *"JUST RETURNED"* branch resumes the clocks
 * from exactly where they froze and clears the lapse instant, with no notion that it was
 * the MSP rather than the customer who came back. That is the whole point of Shane's
 * instruction to *"reuse that exact mechanism, don't build a parallel one, since the real
 * behavior ... is identical regardless of WHOSE lapse triggered it."*
 *
 * So what is left for this module is only timeliness, and it is the exact analogue of
 * `syncTenantsAfterStatusWrite()`: the daily sweep would reconcile these tenants anyway,
 * and this makes it happen at the moment the MSP's billing state actually changed rather
 * than within a day. A resume in particular should not leave a customer looking at a
 * cancellation wall overnight after their MSP has paid.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Why one function for both directions
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * There is no `cascadeLapse` / `cascadeResume` pair, because the reconciliation is a
 * two-field comparison and not a transition hook — the caller does not have to know
 * which way the MSP moved, and a caller that guessed wrong would be worse than one that
 * did not call at all. Call this after ANY write to `msp_subscriptions.status` or
 * `.dunning_state`; each customer settles into whichever state their own row plus the
 * MSP's row now implies.
 */

import { eq } from "drizzle-orm";
import { db, tenantsTable } from "@workspace/db";
import { logger } from "../logger.ts";
import {
  invalidateSubscriptionGateCache,
  syncTenantRetentionState,
} from "./subscription-state.ts";

const log = logger.child({ channel: "billing" });
const auditLog = logger.child({ channel: "audit" });

export interface MspCascadeResult {
  mspId: number;
  /** How many customer tenants were examined. */
  customers: number;
  /** How many were closed and had their post-termination window started. */
  frozen: number;
  /** How many were reopened, with their per-record clocks resumed where they froze. */
  resumed: number;
  /** Per-record clocks moved, summed across every affected customer. */
  clocksFrozen: number;
  clocksResumed: number;
  /** Tenants whose reconciliation threw. Non-fatal here; the daily sweep retries them. */
  failed: number;
}

/**
 * Reconcile every customer tenant under one MSP against the current billing rule.
 *
 * Never throws. A failure here is a delay and not a loss — the state is still
 * inconsistent in exactly the way `findTenantsNeedingRetentionSync()` is built to find,
 * and failing a Stripe webhook or the nightly dunning workflow because one customer's
 * reconciliation stumbled would be the wrong trade. Same reasoning, and same guarantee,
 * as `syncTenantsAfterStatusWrite()`.
 */
export async function cascadeMspSubscriptionToCustomers(mspId: number): Promise<MspCascadeResult> {
  const result: MspCascadeResult = {
    mspId,
    customers: 0,
    frozen: 0,
    resumed: 0,
    clocksFrozen: 0,
    clocksResumed: 0,
    failed: 0,
  };

  let customerIds: number[];
  try {
    const rows = await db
      .select({ id: tenantsTable.id })
      .from(tenantsTable)
      .where(eq(tenantsTable.mspId, mspId));
    customerIds = rows.map((r) => r.id);
  } catch (err) {
    log.error(
      { err, mspId },
      "retention: MSP lapse cascade could not list customers (non-fatal — the daily sweep will reconcile them)",
    );
    return result;
  }

  result.customers = customerIds.length;

  for (const tenantId of customerIds) {
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
      result.failed += 1;
      // One customer's failure must not stop the rest: the next tenant in the list may
      // be the one whose purge window needs starting, or the one still staring at a wall
      // after their MSP has paid.
      log.error({ err, mspId, tenantId }, "retention: MSP lapse cascade failed for one customer (continuing)");
    } finally {
      // Unconditional, and deliberately in `finally`: a stale cached "gated" entry is the
      // failure a returning customer actually notices, and it must be dropped even when
      // the reconciliation itself threw.
      invalidateSubscriptionGateCache(tenantId);
    }
  }

  if (result.frozen > 0 || result.resumed > 0) {
    auditLog.info(
      {
        actionType: "retention.msp.cascade",
        mspId,
        customersExamined: result.customers,
        customersFrozen: result.frozen,
        customersResumed: result.resumed,
        clocksFrozen: result.clocksFrozen,
        clocksResumed: result.clocksResumed,
        failed: result.failed,
        occurredAt: new Date().toISOString(),
      },
      "audit: MSP platform subscription state cascaded to its customer tenants (#2936)",
    );
  }

  return result;
}

/**
 * Fire-and-forget wrapper for the billing write sites.
 *
 * The webhook handlers and the nightly dunning node care about their own work
 * completing, not about how long the cascade takes, and the sweep is the real guarantee
 * that it happens at all. This keeps the cascade off those paths' critical latency while
 * still making it immediate in practice.
 */
export function cascadeMspSubscriptionToCustomersInBackground(mspId: number): void {
  void cascadeMspSubscriptionToCustomers(mspId).catch((err: unknown) => {
    log.error({ err, mspId }, "retention: MSP lapse cascade rejected unexpectedly (the daily sweep is the backstop)");
  });
}
