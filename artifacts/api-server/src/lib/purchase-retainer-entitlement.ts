/**
 * purchase-retainer-entitlement.ts — provision the real entitlement records a
 * paid Buy.tsx Retainer purchase grants (Git #4404, Feature #4401).
 *
 * /api/public/purchase/payment-confirmed used to stop at "session marked paid"
 * (its own header: "fulfilment/provisioning work, deliberately out of scope"),
 * so a paying Retainer buyer got nothing the platform could see. #4402 traced
 * the read side; for a Retainer that is two records, not a monitoring tier
 * (retainer services carry no `services.tier` and no `includedFeatures`):
 *
 *   1. `client_services` — the direct customer's owned recurring purchase
 *      (status 'active', service_id -> the purchased retainer row). Read by the
 *      MSP console's retainer billing list (msp-retainer-billing.ts, filtered
 *      billing_type 'recurring_monthly' + status 'active'), AdminV2 fulfilment,
 *      auth's setup-context "products you own", and the RBAC billed-party
 *      trigger (client_services_rbac_billing_on_write).
 *   2. `retainer_settings` — one row per customer (tenants.id), the monthly
 *      hour allotment. This is what the Portal's My Architect page reads:
 *      GET /api/portal/retainer answers `configured: settings.active`
 *      (portal-retainer.ts), and my-architect.tsx renders "not configured"
 *      without it.
 *
 * Idempotency: payment-confirmed is legitimately hit more than once for the
 * same PaymentIntent (reload, retry, lost response), and set-password re-runs
 * this for the legacy pay-then-account order. The client_services write is
 * keyed on #4403's `(checkout_session_id, service_id)` unique index — ON
 * CONFLICT DO NOTHING, so a replay or a concurrent confirm can never provision
 * a second row. The retainer_settings write is ON CONFLICT (customer_id) DO
 * NOTHING: an existing row — including one Shane configured by hand in AdminV2
 * (architect name, a negotiated allotment) — is never overwritten by a replay.
 * The one exception is a row that exists but is inactive when THIS call
 * genuinely provisioned a new purchase (a lapsed retainer bought again): that
 * row is switched back on at the purchased allotment.
 *
 * What is NOT provisioned, honestly:
 *   - A tenant-less (skipped-consent, #1311) Retainer buyer has no tenants.id,
 *     so no retainer_settings row can exist for them (customer_id is NOT NULL,
 *     and GET /portal/retainer has no customer scope for them either). Their
 *     client_services row is still written. `settings` reports `no_tenant`.
 *   - The Stripe subscription itself — this pair charges the first month and
 *     keeps the card on file; subscription creation is still separate work.
 *   - `hourly_rate_cents` is left at the table default (30000), the same
 *     default AdminV2's PUT /admin/retainer/:customerId/settings applies when
 *     none is supplied; the catalog carries no per-retainer rate.
 */

import {
  db,
  clientServicesTable,
  retainerSettingsTable,
  servicesTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { PaidPurchaseSession } from "./purchase-account-flow.ts";
import { createAuditLog } from "./audit.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "billing" });

export type RetainerSettingsOutcome =
  | "created"
  | "reactivated"
  | "already_configured"
  | "no_tenant"
  | "no_msp"
  | "hours_unresolved";

export type RetainerEntitlementResult =
  | { provisioned: false; reason: "not_retainer" | "product_not_found" | "account_not_completed" | "account_missing" }
  | {
      provisioned: true;
      clientServiceId: number;
      /** false when an earlier call for this same checkout session already wrote the row. */
      clientServiceCreated: boolean;
      customerId: number | null;
      settings: RetainerSettingsOutcome;
    };

/**
 * `services.hours_per_month` is free text — live rows hold "5"/"16", older
 * admin input reads "10 hours". Returns whole minutes, or null when the text
 * carries no positive number (never guessed).
 */
export function retainedMinutesFromHoursText(hours: string | null | undefined): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)/.exec(hours ?? "");
  if (!match) return null;
  const minutes = Math.round(Number(match[1]) * 60);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

/**
 * Provision a paid Retainer session's entitlement. Safe to call for any paid
 * session (non-retainer products are a no-op) and safe to call repeatedly.
 *
 * `session.accountUserId` must be the account completed through this session:
 * set at pre-consent account creation for the account-first order (so it is
 * present at payment-confirmed), or at set-password's `ok` outcome for the
 * legacy pay-then-account order (whose caller passes it explicitly).
 */
export async function ensureRetainerEntitlement(session: PaidPurchaseSession): Promise<RetainerEntitlementResult> {
  const [service] = await db
    .select({
      id: servicesTable.id,
      category: servicesTable.category,
      hoursPerMonth: servicesTable.hoursPerMonth,
    })
    .from(servicesTable)
    .where(eq(servicesTable.slug, session.productSlug))
    .limit(1);

  if (!service) return { provisioned: false, reason: "product_not_found" };
  if (service.category !== "retainer") return { provisioned: false, reason: "not_retainer" };
  if (session.accountUserId == null) return { provisioned: false, reason: "account_not_completed" };

  const [user] = await db
    .select({ id: usersTable.id, tenantId: usersTable.tenantId })
    .from(usersTable)
    .where(eq(usersTable.id, session.accountUserId))
    .limit(1);
  if (!user) return { provisioned: false, reason: "account_missing" };

  const now = new Date();
  const inserted = await db
    .insert(clientServicesTable)
    .values({
      clientUserId: user.id,
      serviceId: service.id,
      status: "active",
      progress: 0,
      startDate: now,
      billingInterval: "month",
      checkoutSessionId: session.id,
    })
    .onConflictDoNothing({ target: [clientServicesTable.checkoutSessionId, clientServicesTable.serviceId] })
    .returning({ id: clientServicesTable.id });

  const clientServiceCreated = inserted.length > 0;
  let clientServiceId: number;
  if (clientServiceCreated) {
    clientServiceId = inserted[0].id;
  } else {
    const [existing] = await db
      .select({ id: clientServicesTable.id })
      .from(clientServicesTable)
      .where(and(eq(clientServicesTable.checkoutSessionId, session.id), eq(clientServicesTable.serviceId, service.id)))
      .limit(1);
    clientServiceId = existing.id;
  }

  const customerId = user.tenantId ?? null;
  const settings = await ensureRetainerSettings({
    sessionId: session.id,
    customerId,
    retainedMinutes: retainedMinutesFromHoursText(service.hoursPerMonth),
    reactivateIfInactive: clientServiceCreated,
    now,
  });

  if (clientServiceCreated) {
    await createAuditLog({
      actorUserId: user.id,
      actorName: "public:purchase-flow",
      actorRole: "client",
      actionType: "purchase_flow_retainer_entitlement_provisioned",
      entityType: "client_service",
      entityId: String(clientServiceId),
      tenantId: customerId,
      metadata: {
        checkoutSessionId: session.id,
        productSlug: session.productSlug,
        serviceId: service.id,
        retainerSettings: settings,
      },
    });
    log.info(
      { checkoutSessionId: session.id, userId: user.id, clientServiceId, customerId, settings },
      "retainer entitlement: provisioned client_services row for paid Retainer purchase",
    );
  } else {
    log.info(
      { checkoutSessionId: session.id, clientServiceId, settings },
      "retainer entitlement: already provisioned for this checkout session — no second row written",
    );
  }

  return { provisioned: true, clientServiceId, clientServiceCreated, customerId, settings };
}

async function ensureRetainerSettings(opts: {
  sessionId: string;
  customerId: number | null;
  retainedMinutes: number | null;
  reactivateIfInactive: boolean;
  now: Date;
}): Promise<RetainerSettingsOutcome> {
  const { sessionId, customerId, retainedMinutes, reactivateIfInactive, now } = opts;
  if (customerId == null) {
    log.info(
      { checkoutSessionId: sessionId },
      "retainer entitlement: buyer has no tenant (skipped consent) — retainer_settings not written",
    );
    return "no_tenant";
  }

  const [tenant] = await db
    .select({ mspId: tenantsTable.mspId })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, customerId))
    .limit(1);
  if (typeof tenant?.mspId !== "number") {
    log.error(
      { checkoutSessionId: sessionId, customerId },
      "retainer entitlement: buyer's tenant has no MSP — retainer_settings not written",
    );
    return "no_msp";
  }

  if (retainedMinutes == null) {
    log.error(
      { checkoutSessionId: sessionId, customerId },
      "retainer entitlement: purchased retainer row has no usable hours_per_month — retainer_settings not written",
    );
    return "hours_unresolved";
  }

  const created = await db
    .insert(retainerSettingsTable)
    .values({
      customerId,
      mspId: tenant.mspId,
      retainedMinutesPerMonth: retainedMinutes,
      active: true,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: retainerSettingsTable.customerId })
    .returning({ id: retainerSettingsTable.id });
  if (created.length > 0) return "created";

  if (reactivateIfInactive) {
    const reactivated = await db
      .update(retainerSettingsTable)
      .set({ active: true, retainedMinutesPerMonth: retainedMinutes, updatedAt: now })
      .where(and(eq(retainerSettingsTable.customerId, customerId), eq(retainerSettingsTable.active, false)))
      .returning({ id: retainerSettingsTable.id });
    if (reactivated.length > 0) return "reactivated";
  }
  return "already_configured";
}
