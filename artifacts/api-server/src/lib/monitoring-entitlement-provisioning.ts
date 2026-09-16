/**
 * monitoring-entitlement-provisioning.ts — Git #4403 (Feature #4401).
 *
 * A paid Buy.tsx Monitoring purchase used to write nothing the Portal reads:
 * payment-confirmed marked the checkout session paid and stopped, so every
 * `requireTierFeature` gate answered 402 for a customer who had just paid for
 * Premier. #4402 traced the read side exactly — the ENTIRE contract is one row:
 *
 *     client_services (status = 'active', client_user_id = the buyer's users.id)
 *       -> services (service_type = 'monitoring_tier')
 *
 * read by portal-tier-features.ts's resolveCustomerIncludedFeatures /
 * resolveCustomerTierEntitlement. This module writes that row and nothing else
 * (no Stripe subscription — still out of scope, per public-purchase-payment.ts's
 * header; `min_bundled_tier` / write_action_catalog is a separate Launch Control
 * axis and is not touched).
 *
 * ── Idempotency ───────────────────────────────────────────────────────────────
 * payment-confirmed is legitimately hit more than once for the same
 * PaymentIntent (reload, retry, a lost response), and set-password /
 * portal-handoff re-run this as backstops. The row carries the checkout session
 * that provisioned it, and the unique index on (checkout_session_id, service_id)
 * (lib/db/migrations/manual/4403-client-services-checkout-session-id.sql) turns
 * any repeat — including two confirms racing each other — into ON CONFLICT DO
 * NOTHING rather than a second entitlement.
 *
 * ── Which users row ───────────────────────────────────────────────────────────
 * `accountUserId` on the session: the account created THROUGH this session
 * (pre-consent door, #4374) or completed through it (set-password `ok`). It is
 * the same gate the portal handoff trusts, so an entitlement can only ever land
 * on the account this purchase actually made — never on an email lookup. A
 * session with no accountUserId yet (legacy pay-then-account, before
 * set-password) is a no-op here; set-password's `ok` branch provisions it.
 */

import { db, clientServicesTable, servicesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { PaidPurchaseSession } from "./purchase-account-flow.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "billing" });

export type MonitoringEntitlementResult =
  | { provisioned: true; reason: "provisioned"; clientServiceId: number; serviceId: number; clientUserId: number }
  | { provisioned: false; reason: "already_provisioned"; clientServiceId: number | null; serviceId: number; clientUserId: number }
  | { provisioned: false; reason: "not_monitoring" | "product_not_found" | "account_not_completed" };

export async function ensureMonitoringEntitlement(
  session: Pick<PaidPurchaseSession, "id" | "productSlug" | "accountUserId">,
): Promise<MonitoringEntitlementResult> {
  const [svc] = await db
    .select({ id: servicesTable.id, serviceType: servicesTable.serviceType, tier: servicesTable.tier })
    .from(servicesTable)
    .where(eq(servicesTable.slug, session.productSlug))
    .limit(1);

  if (!svc) return { provisioned: false, reason: "product_not_found" };
  // The reader filters on service_type, so the writer keys on it too — a row
  // this gate would never read is not an entitlement.
  if (svc.serviceType !== "monitoring_tier") return { provisioned: false, reason: "not_monitoring" };
  if (session.accountUserId == null) return { provisioned: false, reason: "account_not_completed" };

  const clientUserId = session.accountUserId;
  const inserted = await db
    .insert(clientServicesTable)
    .values({
      clientUserId,
      serviceId: svc.id,
      status: "active",
      progress: 0,
      startDate: new Date(),
      billingInterval: "month",
      checkoutSessionId: session.id,
    })
    .onConflictDoNothing()
    .returning({ id: clientServicesTable.id });

  if (inserted.length > 0) {
    log.info(
      { checkoutSessionId: session.id, clientUserId, serviceId: svc.id, tier: svc.tier, clientServiceId: inserted[0].id },
      "monitoring entitlement: client_services row provisioned for paid purchase",
    );
    return { provisioned: true, reason: "provisioned", clientServiceId: inserted[0].id, serviceId: svc.id, clientUserId };
  }

  const [existing] = await db
    .select({ id: clientServicesTable.id })
    .from(clientServicesTable)
    .where(and(eq(clientServicesTable.checkoutSessionId, session.id), eq(clientServicesTable.serviceId, svc.id)))
    .limit(1);

  return {
    provisioned: false,
    reason: "already_provisioned",
    clientServiceId: existing?.id ?? null,
    serviceId: svc.id,
    clientUserId,
  };
}
