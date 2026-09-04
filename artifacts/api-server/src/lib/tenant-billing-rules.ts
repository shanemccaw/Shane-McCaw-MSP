/**
 * PER-CUSTOMER BILLING — the decision, as a pure function (Git #2847).
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
 *
 * Both halves are load-bearing, and the reasoning for each is in
 * `tenant-billing-state.ts`'s header alongside the queries that apply it.
 */

import {
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

/** Which of the two rules decided `active`. Surfaces report this rather than implying one. */
export type TenantBillingSource =
  /** At least one `tenant_subscriptions` row exists; the subscription decided. */
  | "subscription"
  /** No subscription has ever been recorded for this tenant; `tenants.status` decided. */
  | "tenant_status";

/**
 * The whole decision. `resolveTenantBillingState()` applies exactly this in TypeScript
 * and `tenantBillingActiveCondition()` applies exactly this in SQL; the three must agree,
 * because a sweep that disagreed with the gate would either freeze a paying customer's
 * clocks or never start a lapsed customer's purge window.
 */
export function decideTenantBillingActive(params: {
  tenantStatus: string;
  subscriptionStatuses: readonly string[];
}): { active: boolean; source: TenantBillingSource } {
  const tenantStatusRunning = isRunningTenantStatus(params.tenantStatus);
  const hasAny = params.subscriptionStatuses.length > 0;
  const hasActive = params.subscriptionStatuses.some(isActiveSubscriptionStatus);
  return {
    active: tenantStatusRunning && (!hasAny || hasActive),
    source: hasAny ? "subscription" : "tenant_status",
  };
}
