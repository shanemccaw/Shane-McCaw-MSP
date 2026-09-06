/**
 * PER-CUSTOMER BILLING — the decision, as a pure function (Git #2847, extended by #2936).
 *
 * Split from `tenant-billing-state.ts` for the same reason `retention/subscription-gate.ts`
 * is split from `retention/subscription-state.ts`: this file imports no database, so the
 * rule that decides whether a customer's portal is open — and whether a 7-year purge
 * window starts — is testable exhaustively, with no connection string and no mock.
 *
 * The rule:
 *
 *   active  =  tenants.status is clock-running
 *              AND ( the tenant has NO subscription rows
 *                    OR at least one of them is in an active status )
 *              AND the parent MSP's own platform subscription has not lapsed
 *
 * All three conjuncts are load-bearing, and the reasoning for each is in
 * `tenant-billing-state.ts`'s header alongside the queries that apply it. The third is
 * #2936's cascade: Shane's decision (2026-09-05) is that an MSP's lapsed platform
 * subscription closes its customers' portals and starts their 7-year purge clocks,
 * through this same rule rather than a parallel one — *"the real behavior (freeze clocks,
 * start 7-year window, gate normal views) is identical regardless of WHOSE lapse
 * triggered it."*
 */

import {
  MSP_DUNNING_LAPSED_STATES,
  MSP_SUBSCRIPTION_LAPSED_STATUSES,
  RETENTION_CLOCK_RUNNING_TENANT_STATUSES,
  TENANT_SUBSCRIPTION_ACTIVE_STATUSES,
} from "@workspace/db/schema";

/** Does this `tenants.status` value mean the operational relationship is live? */
export function isRunningTenantStatus(status: string | null | undefined): boolean {
  return status != null && (RETENTION_CLOCK_RUNNING_TENANT_STATUSES as readonly string[]).includes(status);
}

/** Does this `tenant_subscriptions.status` value mean the customer's portal is open? */
export function isActiveSubscriptionStatus(status: string | null | undefined): boolean {
  return status != null && (TENANT_SUBSCRIPTION_ACTIVE_STATUSES as readonly string[]).includes(status);
}

/** Does this `msp_subscriptions.status` value mean the MSP has stopped paying for good? */
export function isLapsedMspSubscriptionStatus(status: string | null | undefined): boolean {
  return status != null && (MSP_SUBSCRIPTION_LAPSED_STATUSES as readonly string[]).includes(status);
}

/** Has the MSP's dunning ladder reached a rung that revokes access? */
export function isLapsedMspDunningState(state: string | null | undefined): boolean {
  return state != null && (MSP_DUNNING_LAPSED_STATES as readonly string[]).includes(state);
}

/**
 * The parent MSP's own platform subscription, as this rule needs to read it.
 *
 * `null` means the MSP has NO `msp_subscriptions` row at all, and that is emphatically
 * not a lapse — see the vocabulary's own comment in `schema/msp.ts`. It is modelled as a
 * distinct value rather than an optional argument so that every call site has to say
 * which case it is in, and none can cascade by forgetting to pass it.
 */
export interface MspSubscriptionFacts {
  status: string | null;
  dunningState: string | null;
}

/** True when the MSP's own platform subscription has lapsed in the #2936 sense. */
export function decideMspSubscriptionLapsed(msp: MspSubscriptionFacts | null): boolean {
  if (!msp) return false;
  return isLapsedMspSubscriptionStatus(msp.status) || isLapsedMspDunningState(msp.dunningState);
}

/** Which rule decided `active`. Surfaces report this rather than implying one. */
export type TenantBillingSource =
  /** At least one `tenant_subscriptions` row exists; the subscription decided. */
  | "subscription"
  /** No subscription has ever been recorded for this tenant; `tenants.status` decided. */
  | "tenant_status"
  /**
   * #2936 — this customer's own billing is fine and the portal is closed anyway,
   * because the MSP above them stopped paying the platform. The distinction is not
   * cosmetic: the wall's copy is *"your MSP hasn't paid"*, and telling a customer
   * whose own subscription is current that THEIR subscription ended would be a lie.
   */
  | "msp_subscription";

export interface TenantBillingDecision {
  active: boolean;
  source: TenantBillingSource;
  /** True when the MSP above this customer has lapsed, whether or not it is what closed them. */
  mspLapsed: boolean;
}

/**
 * The whole decision. `resolveTenantBillingState()` applies exactly this in TypeScript
 * and `tenantBillingActiveCondition()` applies exactly this in SQL; the three must agree,
 * because a sweep that disagreed with the gate would either freeze a paying customer's
 * clocks or never start a lapsed customer's purge window.
 *
 * `msp` is required, not optional: a caller that has not looked up the MSP's subscription
 * has not applied #2936's rule, and defaulting it to "fine" would silently disable the
 * cascade at that call site.
 */
export function decideTenantBillingActive(params: {
  tenantStatus: string;
  subscriptionStatuses: readonly string[];
  msp: MspSubscriptionFacts | null;
}): TenantBillingDecision {
  const tenantStatusRunning = isRunningTenantStatus(params.tenantStatus);
  const hasAny = params.subscriptionStatuses.length > 0;
  const hasActive = params.subscriptionStatuses.some(isActiveSubscriptionStatus);
  const ownActive = tenantStatusRunning && (!hasAny || hasActive);
  const mspLapsed = decideMspSubscriptionLapsed(params.msp);
  const ownSource: TenantBillingSource = hasAny ? "subscription" : "tenant_status";

  return {
    active: ownActive && !mspLapsed,
    // The customer's own state is reported first when it is what closed them — it is the
    // more specific fact, and "your MSP hasn't paid" is only the true cause when the
    // customer's own billing would otherwise have kept the portal open.
    source: ownActive && mspLapsed ? "msp_subscription" : ownSource,
    mspLapsed,
  };
}
