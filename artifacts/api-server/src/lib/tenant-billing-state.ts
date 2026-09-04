/**
 * PER-CUSTOMER BILLING STATE — the one answer to "is this customer paying" (Git #2847).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Why this module exists
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * #1944 part 8 gates the entire customer portal on an active-subscription check and
 * justified it this way:
 *
 *   *"It reuses a fact the platform already has to track for billing anyway — whether
 *   a subscription is active — rather than inventing a parallel 'is this tenant locked
 *   down' concept... One source of truth for 'is this customer paying,' not two."*
 *
 * #2847 established that the fact did not exist. `msp_subscriptions` is `msp_id`-unique
 * — the MSP's own subscription to the platform — and the only per-customer signal in
 * the schema was `tenants.status`, an operational lifecycle enum that no billing event
 * has ever written. #2765 shipped the gate and the retention clock reading it anyway,
 * correctly and deliberately isolated to one constant, so that this module could
 * replace it in one place.
 *
 * `tenant_subscriptions` is now that fact, and this module is the single reader of it.
 * The gate, the retention freeze/resume clock and the 7-year post-termination purge all
 * go through `resolveTenantBillingState()`; nothing else decides for itself.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The resolution rule, and why it is shaped this way
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   active  =  tenants.status is clock-running
 *              AND ( the tenant has NO subscription rows
 *                    OR at least one of them is in an active status )
 *
 * Two halves, each load-bearing:
 *
 * **`tenants.status` still participates.** An operator archiving or deactivating a
 * customer is a real end-of-relationship signal, and it is the behaviour that shipped
 * in #2765. Keeping it as a conjunct means this change can only ever *narrow* who
 * counts as active, never widen it — nobody gated today becomes ungated because a
 * subscription row appeared.
 *
 * **Absence of a row is not cancellation.** Every tenant in the database predates this
 * table. If "no row" meant "not paying", deploying #2847 would gate every existing
 * customer, freeze their retention clocks and start a 7-year purge window for all of
 * them — a destructive change delivered by a migration, which is the exact failure
 * #2847 was filed to prevent. A customer must have been *recorded as subscribing* and
 * then have that subscription end before the billing signal can close their portal.
 * `source` on the resolved state says which of the two rules actually decided, so a
 * surface can be honest about it rather than implying a billing fact it does not have.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * What this module deliberately does NOT decide
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * **An MSP's own platform subscription lapsing does not cascade to its customers.**
 * `msp_subscriptions.dunning_state` reaching `access_revoked` closes the *MSP's* access
 * (`msp-entitlement.ts`), and in the wholesale channel it is the MSP's card that funds
 * every customer subscription underneath it — so there is a real argument that those
 * customers' portals should close too. There is an equally real argument that they
 * should not: those customers paid their MSP, and the retention gate does not merely
 * lock a portal — it starts a 7-year purge clock. Cascading would start that clock for
 * an entire book of business because one partner's card expired. That is a product
 * decision about money and a customer-facing promise, not a coding one, so it is not
 * made here and no cascade is implemented. Filed as a decision issue under #1944.
 */

import { and, desc, eq, exists, inArray, notExists, or, sql, type SQL } from "drizzle-orm";
import {
  db,
  tenantsTable,
  tenantSubscriptionsTable,
  RETENTION_CLOCK_RUNNING_TENANT_STATUSES,
  TENANT_SUBSCRIPTION_ACTIVE_STATUSES,
  type Tenant,
  type TenantSubscriptionBillingParty,
  type TenantSubscriptionSource,
  type TenantSubscriptionStatus,
} from "@workspace/db";
import {
  decideTenantBillingActive,
  isActiveSubscriptionStatus,
  isRunningTenantStatus,
  type TenantBillingSource,
} from "./tenant-billing-rules";

// The pure rule lives in `tenant-billing-rules.ts` (no database import, so it is
// testable exhaustively). Re-exported here so callers have one place to import from.
export {
  decideTenantBillingActive,
  isActiveSubscriptionStatus,
  isRunningTenantStatus,
  type TenantBillingSource,
};

type TenantStatus = Tenant["status"];

/**
 * The same two vocabularies as the pure rule, retyped as each column's own enum union
 * so drizzle's `inArray` accepts them and so adding a value to either enum forces a
 * decision here rather than silently defaulting to "not active".
 *
 * Mutable rather than `readonly` because drizzle's array helpers reject a readonly one.
 */
const RUNNING_TENANT_STATUSES: TenantStatus[] = [...RETENTION_CLOCK_RUNNING_TENANT_STATUSES];
const ACTIVE_SUBSCRIPTION_STATUSES: TenantSubscriptionStatus[] = [...TENANT_SUBSCRIPTION_ACTIVE_STATUSES];

/** One customer subscription, as a surface needs to read it. */
export interface TenantBillingSubscription {
  id: number;
  status: TenantSubscriptionStatus;
  planName: string | null;
  serviceId: number | null;
  billingParty: TenantSubscriptionBillingParty;
  unitAmountCents: number | null;
  currency: string;
  billingInterval: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  endedAt: Date | null;
}

export interface TenantBillingState {
  tenantId: number;
  mspId: number;
  /** Raw `tenants.status`. */
  tenantStatus: string;
  /** True when `tenants.status` alone says the relationship is live. */
  tenantStatusRunning: boolean;
  /** THE fact. True when this customer's portal is open. */
  active: boolean;
  source: TenantBillingSource;
  /** How many subscriptions have ever been recorded for this customer. */
  subscriptionCount: number;
  /**
   * The subscription currently keeping the portal open, or null. When several are
   * active — a customer can hold more than one product — this is the one ending
   * latest, because that is the one that determines how long they stay open.
   */
  activeSubscription: TenantBillingSubscription | null;
  /**
   * The most recent subscription of any status. What a "Come back!" screen names when
   * telling a lapsed customer what they used to have. Null only when nothing was ever
   * recorded for this tenant.
   */
  latestSubscription: TenantBillingSubscription | null;
}

/** The shape both the row select and the mapper agree on. */
interface SubscriptionRow {
  id: number;
  status: TenantSubscriptionStatus;
  planName: string | null;
  serviceId: number | null;
  billingParty: TenantSubscriptionBillingParty;
  unitAmountCents: number | null;
  currency: string;
  billingInterval: "month" | "year" | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  endedAt: Date | null;
  startedAt: Date;
}

function toBillingSubscription(row: SubscriptionRow): TenantBillingSubscription {
  return {
    id: row.id,
    status: row.status,
    planName: row.planName,
    serviceId: row.serviceId,
    billingParty: row.billingParty,
    unitAmountCents: row.unitAmountCents,
    currency: row.currency,
    billingInterval: row.billingInterval,
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    canceledAt: row.canceledAt,
    endedAt: row.endedAt,
  };
}

/**
 * Resolve one customer's real billing state. Returns null when the tenant does not
 * exist — the caller decides what that means, because the callers want opposite things
 * from it (the gate denies, the sweep skips).
 *
 * Two indexed lookups rather than a join: joining would repeat the tenant row once per
 * subscription for no gain, and the gate caches this for a few seconds so it runs far
 * less often than once per request.
 */
export async function resolveTenantBillingState(tenantId: number): Promise<TenantBillingState | null> {
  const [tenant] = await db
    .select({
      id: tenantsTable.id,
      mspId: tenantsTable.mspId,
      status: tenantsTable.status,
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  if (!tenant) return null;

  const subscriptions: SubscriptionRow[] = await db
    .select({
      id: tenantSubscriptionsTable.id,
      status: tenantSubscriptionsTable.status,
      planName: tenantSubscriptionsTable.planName,
      serviceId: tenantSubscriptionsTable.serviceId,
      billingParty: tenantSubscriptionsTable.billingParty,
      unitAmountCents: tenantSubscriptionsTable.unitAmountCents,
      currency: tenantSubscriptionsTable.currency,
      billingInterval: tenantSubscriptionsTable.billingInterval,
      currentPeriodEnd: tenantSubscriptionsTable.currentPeriodEnd,
      cancelAtPeriodEnd: tenantSubscriptionsTable.cancelAtPeriodEnd,
      canceledAt: tenantSubscriptionsTable.canceledAt,
      endedAt: tenantSubscriptionsTable.endedAt,
      startedAt: tenantSubscriptionsTable.startedAt,
    })
    .from(tenantSubscriptionsTable)
    .where(eq(tenantSubscriptionsTable.tenantId, tenantId))
    .orderBy(desc(tenantSubscriptionsTable.startedAt), desc(tenantSubscriptionsTable.id));

  const activeRows = subscriptions.filter((r) => isActiveSubscriptionStatus(r.status));

  // Latest-ending active subscription. A null `currentPeriodEnd` — a manual row, or one
  // whose period Stripe has not reported yet — loses to any row that has a real date
  // rather than being treated as ending at the epoch: an unknown end is not an early one.
  const activeRow = activeRows.reduce<SubscriptionRow | null>((best, r) => {
    if (best === null) return r;
    const a = r.currentPeriodEnd?.getTime();
    const b = best.currentPeriodEnd?.getTime();
    if (a === undefined) return best;
    if (b === undefined) return r;
    return a > b ? r : best;
  }, null);

  const decision = decideTenantBillingActive({
    tenantStatus: tenant.status,
    subscriptionStatuses: subscriptions.map((r) => r.status),
  });

  return {
    tenantId: tenant.id,
    mspId: tenant.mspId,
    tenantStatus: tenant.status,
    tenantStatusRunning: isRunningTenantStatus(tenant.status),
    active: decision.active,
    source: decision.source,
    subscriptionCount: subscriptions.length,
    activeSubscription: activeRow ? toBillingSubscription(activeRow) : null,
    latestSubscription: subscriptions[0] ? toBillingSubscription(subscriptions[0]) : null,
  };
}

/**
 * The same rule as `decideTenantBillingActive`, expressed as a correlated SQL condition
 * over a `tenants` row, so a sweep can evaluate it for every customer in one indexed
 * pass instead of resolving each tenant in JS.
 *
 * Kept literally adjacent to the TypeScript above because the two MUST agree: a sweep
 * that disagreed with the gate would freeze the clocks of a customer the gate is
 * letting through, or leave a lapsed customer's purge window unstarted. Both are
 * asserted against the same cases in `tenant-billing-state.test.ts`.
 */
export function tenantBillingActiveCondition(): SQL {
  const anySubscription = db
    .select({ one: sql`1` })
    .from(tenantSubscriptionsTable)
    .where(eq(tenantSubscriptionsTable.tenantId, tenantsTable.id));

  const activeSubscription = db
    .select({ one: sql`1` })
    .from(tenantSubscriptionsTable)
    .where(
      and(
        eq(tenantSubscriptionsTable.tenantId, tenantsTable.id),
        inArray(tenantSubscriptionsTable.status, ACTIVE_SUBSCRIPTION_STATUSES),
      ),
    );

  return and(
    inArray(tenantsTable.status, RUNNING_TENANT_STATUSES),
    or(notExists(anySubscription), exists(activeSubscription)),
  )!;
}

// ─────────────────────────────────────────────────────────────────────────────
// Write paths
// ─────────────────────────────────────────────────────────────────────────────

export interface RecordTenantSubscriptionInput {
  tenantId: number;
  mspId: number;
  billingParty: TenantSubscriptionBillingParty;
  source: TenantSubscriptionSource;
  status: TenantSubscriptionStatus;
  serviceId?: number | null;
  planName?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripePriceId?: string | null;
  billingInterval?: "month" | "year" | null;
  unitAmountCents?: number | null;
  currency?: string;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
  startedAt?: Date;
  notes?: string | null;
}

/**
 * Record a subscription for a customer.
 *
 * Idempotent on `stripe_subscription_id` where one is present — the partial unique
 * index makes a replayed purchase or webhook update the existing row rather than create
 * a second one, which would keep a cancelled customer's portal open forever. A `manual`
 * row with no Stripe id always inserts, which is correct: there is no key to be
 * idempotent on, and an operator writing one means it.
 */
export async function recordTenantSubscription(
  input: RecordTenantSubscriptionInput,
): Promise<{ id: number }> {
  const now = new Date();
  const values = {
    tenantId: input.tenantId,
    mspId: input.mspId,
    serviceId: input.serviceId ?? null,
    planName: input.planName ?? null,
    billingParty: input.billingParty,
    status: input.status,
    stripeCustomerId: input.stripeCustomerId ?? null,
    stripeSubscriptionId: input.stripeSubscriptionId ?? null,
    stripePriceId: input.stripePriceId ?? null,
    billingInterval: input.billingInterval ?? null,
    unitAmountCents: input.unitAmountCents ?? null,
    currency: input.currency ?? "usd",
    currentPeriodStart: input.currentPeriodStart ?? null,
    currentPeriodEnd: input.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
    startedAt: input.startedAt ?? now,
    notes: input.notes ?? null,
    source: input.source,
    updatedAt: now,
  };

  if (input.stripeSubscriptionId) {
    const [row] = await db
      .insert(tenantSubscriptionsTable)
      .values(values)
      .onConflictDoUpdate({
        target: tenantSubscriptionsTable.stripeSubscriptionId,
        set: {
          status: values.status,
          planName: values.planName,
          serviceId: values.serviceId,
          stripePriceId: values.stripePriceId,
          billingInterval: values.billingInterval,
          unitAmountCents: values.unitAmountCents,
          currentPeriodStart: values.currentPeriodStart,
          currentPeriodEnd: values.currentPeriodEnd,
          cancelAtPeriodEnd: values.cancelAtPeriodEnd,
          updatedAt: now,
        },
      })
      .returning({ id: tenantSubscriptionsTable.id });
    return { id: row!.id };
  }

  const [row] = await db
    .insert(tenantSubscriptionsTable)
    .values(values)
    .returning({ id: tenantSubscriptionsTable.id });
  return { id: row!.id };
}

export interface StripeSubscriptionSyncResult {
  matched: boolean;
  tenantId: number | null;
  status: TenantSubscriptionStatus | null;
}

/**
 * Apply a Stripe `customer.subscription.*` event to the matching customer subscription.
 *
 * Returns `matched: false` when the Stripe subscription is not one of these — the same
 * Stripe customer also carries the MSP's own platform subscription, and that one belongs
 * to `msp_subscriptions`, not here.
 *
 * Reconciling retention afterwards is the caller's job. This function deliberately does
 * not reach into the retention module, so billing has no dependency on retention and the
 * two stay separately reasonable.
 */
export async function syncTenantSubscriptionFromStripe(params: {
  stripeSubscriptionId: string;
  status: TenantSubscriptionStatus;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: Date | null;
  endedAt?: Date | null;
}): Promise<StripeSubscriptionSyncResult> {
  const [existing] = await db
    .select({ id: tenantSubscriptionsTable.id, tenantId: tenantSubscriptionsTable.tenantId })
    .from(tenantSubscriptionsTable)
    .where(eq(tenantSubscriptionsTable.stripeSubscriptionId, params.stripeSubscriptionId))
    .limit(1);

  if (!existing) return { matched: false, tenantId: null, status: null };

  const now = new Date();
  const terminal = !isActiveSubscriptionStatus(params.status);

  await db
    .update(tenantSubscriptionsTable)
    .set({
      status: params.status,
      ...(params.currentPeriodStart !== undefined ? { currentPeriodStart: params.currentPeriodStart } : {}),
      ...(params.currentPeriodEnd !== undefined ? { currentPeriodEnd: params.currentPeriodEnd } : {}),
      ...(params.cancelAtPeriodEnd !== undefined ? { cancelAtPeriodEnd: params.cancelAtPeriodEnd } : {}),
      ...(params.canceledAt !== undefined ? { canceledAt: params.canceledAt } : {}),
      // `ended_at` is the billing instant the retention window is measured against, so
      // it is stamped when the subscription reaches a terminal status and the caller
      // supplied no real one — never guessed while it is still running.
      ...(params.endedAt !== undefined ? { endedAt: params.endedAt } : terminal ? { endedAt: now } : {}),
      updatedAt: now,
    })
    .where(eq(tenantSubscriptionsTable.id, existing.id));

  return { matched: true, tenantId: existing.tenantId, status: params.status };
}
