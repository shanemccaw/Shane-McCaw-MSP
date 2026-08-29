/**
 * subscriptionsWire.ts — the wire shape and normalisation behind
 * GET /api/portal/billing/subscriptions, the real source for the Billing
 * page's plan-state section (Git #1611).
 *
 * `portal-billing.ts:268-334` joins clientServicesTable to servicesTable
 * (billingType = "recurring_monthly") for the calling customer and, for any
 * row with a linked Stripe subscription, layers on a live read from Stripe.
 * Pure functions, no React — the fetching lives in `subscriptionsLive.ts`.
 *
 * Two status vocabularies are on this wire, deliberately not merged:
 *  - `status` is the platform's own clientServicesTable.status enum —
 *    "active" | "completed" | "paused" (schema/index.ts:627).
 *  - `stripe.status` is Stripe's own subscription-status vocabulary — active,
 *    past_due, canceled, incomplete, incomplete_expired, trialing, unpaid,
 *    paused — passed through raw by the route (portal-billing.ts:303). Per
 *    #1611 this pack renders it honestly rather than inventing a narrowing.
 */

export interface WireSubscriptionStripe {
  readonly status?: unknown;
  readonly cancelAtPeriodEnd?: unknown;
  readonly cancelAt?: unknown;
  readonly billingCycleAnchor?: unknown;
  readonly currentPeriodEnd?: unknown;
  readonly amount?: unknown;
  readonly currency?: unknown;
  /** Subscription line-item quantity — the real seat count for a
   *  quantity-metered price. null for a flat, non-seat-metered price. */
  readonly quantity?: unknown;
}

export interface WireSubscription {
  readonly id?: unknown;
  readonly serviceId?: unknown;
  readonly serviceName?: unknown;
  readonly serviceSlug?: unknown;
  readonly status?: unknown;
  readonly startDate?: unknown;
  readonly purchasedAt?: unknown;
  readonly stripeSubscriptionId?: unknown;
  readonly billingInterval?: unknown;
  readonly pendingBillingInterval?: unknown;
  readonly stripe?: WireSubscriptionStripe | null;
}

/** clientServicesTable.status — schema/index.ts:627. Real enum, no invented values. */
export type PlanPlatformStatus = "active" | "completed" | "paused";
const PLATFORM_STATUSES: readonly PlanPlatformStatus[] = ["active", "completed", "paused"];

/** clientServicesTable.billingInterval / pendingBillingInterval — schema/index.ts:618-619. */
export type PlanBillingInterval = "month" | "year";
const BILLING_INTERVALS: readonly PlanBillingInterval[] = ["month", "year"];

export interface SubscriptionPlanRow {
  readonly id: number;
  readonly serviceName: string;
  /** The platform's own record of this service's lifecycle state. */
  readonly platformStatus: PlanPlatformStatus | null;
  /** Stripe's raw subscription-status string, rendered honestly, not narrowed
   *  by this page. null when there is no linked Stripe subscription, or the
   *  live Stripe read failed. */
  readonly stripeStatus: string | null;
  readonly cancelAtPeriodEnd: boolean;
  /** "29 Jul 2026" formatted renewal date — the current billing period's end,
   *  or (when cancelling) the date access actually ends. null when there is
   *  no live Stripe subscription to read a period from. */
  readonly renewsOn: string | null;
  readonly cancelling: boolean;
  /** Real seat count from the Stripe subscription's line-item quantity. null
   *  for a flat, non-seat-metered price, or when there is no live Stripe read. */
  readonly seats: number | null;
  /** "$1,180/mo" style — Stripe's own integer-cent amount, formatted once at
   *  the render boundary. null when there is no live Stripe read to price from. */
  readonly amountLabel: string | null;
  readonly billingInterval: PlanBillingInterval | null;
  readonly pendingBillingInterval: PlanBillingInterval | null;
  readonly hasStripeLink: boolean;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function enumOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/** Unix-seconds → "29 Jul 2026", the same date style as billingWire.ts's fmtDate. */
function fmtUnixDate(seconds: unknown): string | null {
  const n = num(seconds);
  if (n === null) return null;
  const d = new Date(n * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** Stripe's own integer-cent amount → "$1,180/mo" — converted to display
 *  dollars only here, at the render boundary (money contract §4). */
function fmtAmount(cents: unknown, interval: PlanBillingInterval | null): string | null {
  const n = num(cents);
  if (n === null) return null;
  const dollars = Math.round(n) / 100;
  const hasCents = Math.round(n) % 100 !== 0;
  const suffix = interval === "year" ? "/yr" : "/mo";
  return "$" + dollars.toLocaleString("en-US", { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: 2 }) + suffix;
}

function toSubscriptionRow(raw: WireSubscription): SubscriptionPlanRow | null {
  const id = typeof raw.id === "number" ? raw.id : Number.parseInt(str(raw.id), 10);
  if (!Number.isFinite(id)) return null;

  const stripe = raw.stripe ?? null;
  const stripeStatus = stripe ? (typeof stripe.status === "string" ? stripe.status : null) : null;
  const cancelAtPeriodEnd = stripe ? stripe.cancelAtPeriodEnd === true : false;
  const billingInterval = enumOf(raw.billingInterval, BILLING_INTERVALS);
  const cancelAt = stripe ? num(stripe.cancelAt) : null;
  const currentPeriodEnd = stripe ? num(stripe.currentPeriodEnd) : null;

  return {
    id,
    serviceName: str(raw.serviceName) || "Untitled service",
    platformStatus: enumOf(raw.status, PLATFORM_STATUSES),
    stripeStatus,
    cancelAtPeriodEnd,
    cancelling: cancelAtPeriodEnd,
    renewsOn: cancelAtPeriodEnd && cancelAt !== null ? fmtUnixDate(cancelAt) : fmtUnixDate(currentPeriodEnd),
    seats: stripe ? num(stripe.quantity) : null,
    amountLabel: stripe ? fmtAmount(stripe.amount, billingInterval) : null,
    billingInterval,
    pendingBillingInterval: enumOf(raw.pendingBillingInterval, BILLING_INTERVALS),
    hasStripeLink: !!str(raw.stripeSubscriptionId),
  };
}

/** The subscriptions list as plan rows — newest-purchased first (the endpoint
 *  already orders by purchasedAt desc). Rows with no usable id are dropped. */
export function toSubscriptionPlanRows(payload: readonly WireSubscription[] | null | undefined): readonly SubscriptionPlanRow[] {
  if (!Array.isArray(payload)) return [];
  return payload.map(toSubscriptionRow).filter((r): r is SubscriptionPlanRow => r !== null);
}
