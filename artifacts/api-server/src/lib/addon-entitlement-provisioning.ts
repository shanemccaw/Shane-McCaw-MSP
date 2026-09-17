/**
 * addon-entitlement-provisioning.ts — Git #4462 (Feature #1486).
 *
 * Nothing used to write `tenant_add_on_entitlements` except a one-time #1173 seed
 * and a test, so `requireAddOnEntitlement` answered 402 for every non-Premier
 * tenant on the platform and there was no way to change that by paying. This
 * module is the writer, in the same shape #4403's monitoring-entitlement-
 * provisioning.ts gave the Monitoring tier: one idempotent function the paid
 * confirm callback and the webhook backstop both call, writing the one row the
 * reader keys on and nothing else.
 *
 * ── The contract it writes ───────────────────────────────────────────────────
 * portal-addon-entitlements.ts reads (tenant_id, feature_key, status = 'active').
 * The feature key comes off the purchased services row's own
 * `type_attributes.featureKey` (the four `change-control-*` rows carry
 * "change_control"), never from caller input — a row this gate would never read
 * is not an entitlement.
 *
 * ── Idempotency ───────────────────────────────────────────────────────────────
 * The confirm callback and `checkout.session.completed` race each other for the
 * same payment, and either can be replayed. The (tenant_id, feature_key) unique
 * constraint turns every repeat into a no-op: an ACTIVE row is left untouched
 * (reason `already_active`, and its original provenance kept), while a CANCELED
 * row is reactivated by the new purchase — a re-subscribe, not a second row.
 */

import { db, servicesTable, tenantAddOnEntitlementsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "billing" });

export { PORTAL_ADD_ON_CHECKOUT_KIND } from "./addon-checkout-kind.ts";

/** `services.type_attributes.featureKey` off an add-on row; null when absent or not a string. */
export function addOnFeatureKey(typeAttributes: unknown): string | null {
  const key = ((typeAttributes ?? {}) as Record<string, unknown>).featureKey;
  return typeof key === "string" && key.trim() !== "" ? key : null;
}

export type AddOnEntitlementProvisioning = {
  tenantId: number;
  serviceId: number;
  stripeCheckoutSessionId: string | null;
  stripeSubscriptionId: string | null;
};

export type AddOnEntitlementResult =
  | { provisioned: true; reason: "provisioned" | "reactivated"; entitlementId: number; featureKey: string }
  | { provisioned: false; reason: "already_active"; entitlementId: number; featureKey: string }
  | { provisioned: false; reason: "product_not_found" | "not_add_on" };

export async function ensureAddOnEntitlement(input: AddOnEntitlementProvisioning): Promise<AddOnEntitlementResult> {
  const [svc] = await db
    .select({ id: servicesTable.id, serviceClass: servicesTable.serviceClass, typeAttributes: servicesTable.typeAttributes })
    .from(servicesTable)
    .where(eq(servicesTable.id, input.serviceId))
    .limit(1);

  if (!svc) return { provisioned: false, reason: "product_not_found" };
  const featureKey = addOnFeatureKey(svc.typeAttributes);
  if (svc.serviceClass !== "add_on" || featureKey === null) return { provisioned: false, reason: "not_add_on" };

  const [existing] = await db
    .select({ id: tenantAddOnEntitlementsTable.id, status: tenantAddOnEntitlementsTable.status })
    .from(tenantAddOnEntitlementsTable)
    .where(and(eq(tenantAddOnEntitlementsTable.tenantId, input.tenantId), eq(tenantAddOnEntitlementsTable.featureKey, featureKey)))
    .limit(1);

  const values = {
    serviceId: svc.id,
    status: "active" as const,
    purchasedAt: new Date(),
    stripeCheckoutSessionId: input.stripeCheckoutSessionId,
    stripeSubscriptionId: input.stripeSubscriptionId,
  };

  // Insert, or reactivate a canceled row. The WHERE on the conflict update is what
  // keeps an already-active row (and its original provenance) untouched when a
  // replayed confirm or a racing webhook arrives second.
  const written = await db
    .insert(tenantAddOnEntitlementsTable)
    .values({ tenantId: input.tenantId, featureKey, ...values })
    .onConflictDoUpdate({
      target: [tenantAddOnEntitlementsTable.tenantId, tenantAddOnEntitlementsTable.featureKey],
      set: values,
      setWhere: sql`${tenantAddOnEntitlementsTable.status} <> 'active'`,
    })
    .returning({ id: tenantAddOnEntitlementsTable.id });

  if (written.length === 0) {
    const [active] = await db
      .select({ id: tenantAddOnEntitlementsTable.id })
      .from(tenantAddOnEntitlementsTable)
      .where(and(eq(tenantAddOnEntitlementsTable.tenantId, input.tenantId), eq(tenantAddOnEntitlementsTable.featureKey, featureKey)))
      .limit(1);
    return { provisioned: false, reason: "already_active", entitlementId: active?.id ?? existing?.id ?? 0, featureKey };
  }

  const reason = existing ? "reactivated" : "provisioned";
  log.info(
    {
      tenantId: input.tenantId,
      featureKey,
      serviceId: svc.id,
      entitlementId: written[0].id,
      stripeCheckoutSessionId: input.stripeCheckoutSessionId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      reason,
    },
    "add-on entitlement: tenant_add_on_entitlements row written for paid purchase",
  );
  return { provisioned: true, reason, entitlementId: written[0].id, featureKey };
}

export type AddOnEntitlementCancellation =
  | { canceled: true; entitlementId: number; tenantId: number; featureKey: string }
  | { canceled: false; reason: "no_matching_entitlement" };

/**
 * End the entitlement a cancelled add-on subscription paid for (Git #4486).
 *
 * Matches on `stripe_subscription_id`, and only an `active` row: a row a later
 * re-subscribe already reactivated carries the NEW subscription's id, so a late
 * or replayed `customer.subscription.deleted` for the old one matches nothing and
 * cannot revoke what the tenant is paying for now. A replay of the same deletion
 * is a no-op once the row is `canceled`.
 */
export async function cancelAddOnEntitlementForSubscription(stripeSubscriptionId: string): Promise<AddOnEntitlementCancellation> {
  const [row] = await db
    .update(tenantAddOnEntitlementsTable)
    .set({ status: "canceled" })
    .where(
      and(
        eq(tenantAddOnEntitlementsTable.stripeSubscriptionId, stripeSubscriptionId),
        eq(tenantAddOnEntitlementsTable.status, "active"),
      ),
    )
    .returning({
      id: tenantAddOnEntitlementsTable.id,
      tenantId: tenantAddOnEntitlementsTable.tenantId,
      featureKey: tenantAddOnEntitlementsTable.featureKey,
    });

  if (!row) return { canceled: false, reason: "no_matching_entitlement" };

  log.info(
    { tenantId: row.tenantId, featureKey: row.featureKey, entitlementId: row.id, stripeSubscriptionId },
    "add-on entitlement: subscription cancelled — tenant_add_on_entitlements row set to canceled",
  );
  return { canceled: true, entitlementId: row.id, tenantId: row.tenantId, featureKey: row.featureKey };
}
