/**
 * retainer-period-anchor.ts — resolves the real anniversary anchor day a
 * customer's retainer hours reset on (Git #3473).
 *
 * Confirmed bug: `retainer-hours.ts`'s period bucketing used to key on the
 * shared calendar month, disconnected from the customer's real Stripe billing
 * cycle. This module resolves that real cycle's anchor day-of-month
 * (1-31) so `periodKeyOf`/`periodKeyBefore`/`periodKeyAfter`/
 * `computeMonthBucket` (`./retainer-hours.ts`) can bucket against it — one
 * resolution, shared by all 4 real consumers (portal-retainer.ts,
 * admin-retainer.ts, retainer-work-logger.ts, and AdminV2's own
 * admin-retainer.ts customers list).
 *
 * Priority, most-authoritative first:
 *
 *   1. The tenant's currently ACTIVE `tenant_subscriptions` row's real
 *      `currentPeriodStart`. This is the live source of truth — Stripe's own
 *      webhook (`msp-billing-webhook.ts`) keeps it current on every renewal
 *      AND on a mid-cycle plan change (upgrade/downgrade/swap), so reading it
 *      fresh on every bucket computation means a plan change is handled for
 *      free, with no separate logic — exactly what #3473 asked for rather
 *      than inventing bespoke plan-change handling.
 *   2. The most recent `tenant_subscriptions` row of ANY status (e.g. a
 *      lapsed/canceled one) with a real `currentPeriodStart` — still a real
 *      anchor day, for a customer currently between subscriptions.
 *   3. The retainer_settings row's own `createdAt` — when Shane turned the
 *      retainer on for this customer — for a customer with a configured
 *      retainer but no Stripe subscription row at all (a manually
 *      administered account).
 *   4. Absolute fallback: day 1 (the old calendar-month behaviour), only for
 *      a customer with none of the above, so bucketing never throws or
 *      silently misbehaves for lack of an anchor.
 */

import { db, retainerSettingsTable, tenantSubscriptionsTable } from "@workspace/db";
import { TENANT_SUBSCRIPTION_ACTIVE_STATUSES } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";

const ACTIVE_STATUSES = new Set<string>(TENANT_SUBSCRIPTION_ACTIVE_STATUSES);

/** The one shape the priority rule needs from a subscription row. */
export interface AnchorSubscriptionRow {
  readonly status: string;
  readonly currentPeriodStart: Date | null;
}

/**
 * The pure priority rule (see module doc), given rows already ordered
 * most-recent-first (matching `resolveTenantBillingState`'s own
 * `orderBy(desc(startedAt), desc(id))` convention — one ordering rule for
 * "most recent subscription" everywhere it's decided). Exported so a bulk
 * caller (AdminV2's customers-list route) can apply the same rule per
 * customer over rows it already fetched in one query, instead of resolving
 * each customer with its own round trip.
 */
export function anchorDayFromRows(
  subs: ReadonlyArray<AnchorSubscriptionRow>,
  fallbackAnchorDate: Date | null,
): number {
  const active = subs.find((s) => ACTIVE_STATUSES.has(s.status) && s.currentPeriodStart);
  if (active?.currentPeriodStart) return active.currentPeriodStart.getUTCDate();

  const anyAnchor = subs.find((s) => s.currentPeriodStart);
  if (anyAnchor?.currentPeriodStart) return anyAnchor.currentPeriodStart.getUTCDate();

  if (fallbackAnchorDate) return fallbackAnchorDate.getUTCDate();

  return 1;
}

/**
 * One-shot resolution for a single customer. Pass `settingsCreatedAt` when
 * the caller already has the customer's `retainer_settings` row loaded (every
 * route here does, for its own `settings` read) to skip a second query;
 * omitted, this fetches it itself (the byproduct hook has no settings row
 * loaded at all).
 */
export async function resolveRetainerAnchorDay(
  customerId: number,
  opts?: { settingsCreatedAt?: Date | null },
): Promise<number> {
  const subs = await db
    .select({
      status: tenantSubscriptionsTable.status,
      currentPeriodStart: tenantSubscriptionsTable.currentPeriodStart,
    })
    .from(tenantSubscriptionsTable)
    .where(eq(tenantSubscriptionsTable.tenantId, customerId))
    .orderBy(desc(tenantSubscriptionsTable.startedAt), desc(tenantSubscriptionsTable.id));

  let fallback = opts?.settingsCreatedAt;
  if (fallback === undefined) {
    const [settings] = await db
      .select({ createdAt: retainerSettingsTable.createdAt })
      .from(retainerSettingsTable)
      .where(eq(retainerSettingsTable.customerId, customerId))
      .limit(1);
    fallback = settings?.createdAt ?? null;
  }

  return anchorDayFromRows(subs, fallback ?? null);
}
