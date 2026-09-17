/**
 * purchase-buyer-stripe-customer.ts — the Stripe Customer for a Buy.tsx monthly
 * purchase that has no tenant behind it (Git #4438, Feature #4401).
 *
 * /api/public/purchase/payment-intent resolved its customer only through
 * `tenants.stripe_customer_id` (ensureFlowStripeCustomer, #490). A Retainer
 * bought with read consent skipped (#1311) has no tenant GUID, so no tenants
 * row, so no customer: month 1 was charged as an anonymous PaymentIntent with no
 * card kept on file, and #4431's recurring subscription could never be created —
 * month 2 never billed. Retainer is the one product that lawfully sells without
 * consent (a buyer may want only the architect's hours, no monitoring), so the
 * customer is resolved from the BUYER instead of from a tenant:
 *
 *   1. The session's own account (`checkout_sessions.account_user_id`, recorded
 *      by #4374's pre-consent door — Retainer is account-first since #4383):
 *        a. already linked to a tenant → that tenant's customer, via the same
 *           ensureFlowStripeCustomer every tenant-backed purchase uses (after
 *           adopting any customer the account already owns, so the buyer is
 *           never split across two customers);
 *        b. otherwise the account's own `users.stripe_customer_id`, created once
 *           and recorded there.
 *   2. No account on the session (a legacy pay-then-account order, whose account
 *      only exists after set-password): a customer keyed on the checkout session
 *      itself. It is not recorded locally — the intent carries it, which is all
 *      #4431 reads, and a session lives 24h, inside Stripe's idempotency-key
 *      window, so every retry recovers the same customer.
 *
 * Scope is the caller's job, not this module's: payment-intent only calls this
 * for a tenant-less RETAINER (a monthly product). Packs are one-time and
 * Monitoring requires consent, so neither can reach it.
 */

import type Stripe from "stripe";
import { db, tenantsTable, usersTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { ensureFlowStripeCustomer } from "./assessment-flow-rescan-addon.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "billing" });

export type BuyerStripeCustomerSource = "tenant" | "account" | "session";

export type BuyerStripeCustomer = { customerId: string; source: BuyerStripeCustomerSource };

/**
 * Copy the account's own Stripe customer onto the tenant it is now linked to —
 * only when the tenant has none yet, so a customer an earlier tenant-backed
 * purchase (or an operator) set is never overwritten. Returns the customer id
 * the tenant ends up with, or null when neither side has one.
 */
export async function adoptBuyerStripeCustomerOntoTenant(userId: number, tenantRowId: number): Promise<string | null> {
  const [user] = await db
    .select({ stripeCustomerId: usersTable.stripeCustomerId })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  const accountCustomer = user?.stripeCustomerId?.trim();

  if (accountCustomer) {
    const adopted = await db
      .update(tenantsTable)
      .set({ stripeCustomerId: accountCustomer, updatedAt: new Date() })
      .where(and(eq(tenantsTable.id, tenantRowId), isNull(tenantsTable.stripeCustomerId)))
      .returning({ id: tenantsTable.id });
    if (adopted.length > 0) {
      log.info(
        { userId, tenantRowId, stripeCustomerId: accountCustomer },
        "buyer stripe customer: account's Stripe customer adopted onto its newly linked tenant",
      );
      return accountCustomer;
    }
  }

  const [tenant] = await db
    .select({ stripeCustomerId: tenantsTable.stripeCustomerId })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantRowId))
    .limit(1);
  const tenantCustomer = tenant?.stripeCustomerId?.trim() || null;
  if (accountCustomer && tenantCustomer && tenantCustomer !== accountCustomer) {
    // Not merged automatically — which customer carries a live subscription is a
    // billing decision, not something to guess at here.
    log.warn(
      { userId, tenantRowId, accountStripeCustomerId: accountCustomer, tenantStripeCustomerId: tenantCustomer },
      "buyer stripe customer: account and tenant already hold DIFFERENT Stripe customers — left as-is",
    );
  }
  return tenantCustomer;
}

/**
 * Resolve (creating once when needed) the Stripe customer for a tenant-less
 * purchase. Throws on a Stripe or database failure; payment-intent's caller
 * already degrades that to an anonymous intent and logs it.
 */
export async function ensureBuyerStripeCustomer(
  stripe: Stripe,
  params: {
    checkoutSessionId: string;
    accountUserId: number | null;
    email: string;
    fullName: string;
    company: string | null;
  },
): Promise<BuyerStripeCustomer> {
  const name = params.company?.trim() || params.fullName;

  if (params.accountUserId == null) {
    const customer = await stripe.customers.create(
      {
        email: params.email,
        name,
        description: `Direct customer — checkout session ${params.checkoutSessionId} (no account yet)`,
        metadata: { source: "buy_purchase_flow", checkoutSessionId: params.checkoutSessionId },
      },
      { idempotencyKey: `buy-purchase-flow:customer:session:${params.checkoutSessionId}` },
    );
    log.info(
      { checkoutSessionId: params.checkoutSessionId, stripeCustomerId: customer.id },
      "buyer stripe customer: resolved for a tenant-less purchase with no account yet (session-keyed)",
    );
    return { customerId: customer.id, source: "session" };
  }

  const [user] = await db
    .select({ id: usersTable.id, tenantId: usersTable.tenantId, stripeCustomerId: usersTable.stripeCustomerId })
    .from(usersTable)
    .where(eq(usersTable.id, params.accountUserId))
    .limit(1);
  if (!user) throw new Error(`checkout session ${params.checkoutSessionId} names account ${params.accountUserId}, which does not exist`);

  if (user.tenantId != null) {
    await adoptBuyerStripeCustomerOntoTenant(user.id, user.tenantId);
    const [tenant] = await db
      .select({ tenantId: tenantsTable.tenantId })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, user.tenantId))
      .limit(1);
    const customerId = await ensureFlowStripeCustomer(stripe, {
      tenantRowId: user.tenantId,
      tenantGuid: tenant?.tenantId ?? null,
      email: params.email,
      fullName: params.fullName,
      company: params.company,
    });
    return { customerId, source: "tenant" };
  }

  const existing = user.stripeCustomerId?.trim();
  if (existing) return { customerId: existing, source: "account" };

  // Keyed on the account, not the session: two sessions for the same account
  // racing here get the same customer back from Stripe.
  const customer = await stripe.customers.create(
    {
      email: params.email,
      name,
      description: `Direct customer — users.id ${user.id} (no tenant yet)`,
      metadata: { source: "buy_purchase_flow", userId: String(user.id), checkoutSessionId: params.checkoutSessionId },
    },
    { idempotencyKey: `buy-purchase-flow:customer:user:${user.id}` },
  );

  const saved = await db
    .update(usersTable)
    .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
    .where(and(eq(usersTable.id, user.id), isNull(usersTable.stripeCustomerId)))
    .returning({ stripeCustomerId: usersTable.stripeCustomerId });
  if (saved.length === 0) {
    // Someone recorded a customer first (a concurrent intent for this account,
    // which the idempotency key above gives the same id) — theirs stands.
    const [current] = await db
      .select({ stripeCustomerId: usersTable.stripeCustomerId })
      .from(usersTable)
      .where(eq(usersTable.id, user.id))
      .limit(1);
    const winner = current?.stripeCustomerId?.trim();
    if (winner) return { customerId: winner, source: "account" };
  }

  log.info(
    { checkoutSessionId: params.checkoutSessionId, userId: user.id, stripeCustomerId: customer.id },
    "buyer stripe customer: created for a tenant-less purchase and recorded on the account",
  );
  return { customerId: customer.id, source: "account" };
}
