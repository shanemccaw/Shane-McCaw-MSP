/**
 * Live Stripe TEST-MODE + live-Postgres acceptance test for #4438 (Feature #4401)
 * — a Retainer bought with read consent SKIPPED (#1311) has no tenant, and used
 * to be charged as an anonymous PaymentIntent (no customer, no card on file), so
 * #4431's recurring subscription could never be created. The customer is now
 * resolved from the buyer's own account; this proves, against real Stripe:
 *
 *   - account-first skipped-consent Retainer: a real Stripe customer is created
 *     and recorded on users.stripe_customer_id, the intent keeps the card on file,
 *     and payment-confirmed creates the same anchored, no-double-charge
 *     subscription a consented purchase gets, linked to its client_services row;
 *   - a second purchase by the same account reuses that customer;
 *   - a later consent adopts the account's customer onto the tenant;
 *   - a legacy (no-account) skipped-consent Retainer still gets a real customer;
 *   - scope: a Pack or Monitoring order with no tenants row stays anonymous —
 *     no Stripe customer is created for them.
 *
 * Nothing about Stripe is mocked: the REAL /payment-intent handler creates the
 * intent, Stripe's `pm_card_visa` test card confirms it, the REAL
 * /payment-confirmed handler creates the subscription. Mocked: mail/CRM, the
 * monitoring scan kickoff, and lib/stripe.ts's key getters (pinned to TEST keys;
 * the suite refuses anything that is not `sk_test_`).
 *
 * Opt-in (it makes real Stripe test-mode API calls):
 *   LIVE_STRIPE=1 DATABASE_URL=... STRIPE_SECRET_KEY=sk_test_... STRIPE_PUBLISHABLE_KEY=pk_test_... \
 *     pnpm --filter @workspace/api-server exec vitest run public-purchase-payment-skipped-consent-retainer.live-stripe
 *
 * Synthetic identities only (`zz-test-4438-<tag>@example.invalid`); DB rows and
 * every Stripe customer created (which cancels their subscriptions) are deleted
 * in afterAll.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  auditLogsTable,
  checkoutSessionsTable,
  clientServicesTable,
  mspsTable,
  retainerSettingsTable,
  servicesTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";

vi.mock("../lib/stripe.ts", () => ({
  getStripeKey: () => process.env.STRIPE_SECRET_KEY ?? "",
  getStripePublishableKey: () => process.env.STRIPE_PUBLISHABLE_KEY ?? null,
}));
vi.mock("../lib/mailer.ts", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  purchaseConfirmationEmail: vi.fn().mockReturnValue("<html></html>"),
}));
vi.mock("../lib/crm-pipeline.ts", () => ({ markAssessmentLeadPurchased: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/monitoring-onboarding-scan.ts", () => ({
  ensureMonitoringScanKickoff: vi.fn().mockResolvedValue({ fired: false, reason: "already_kicked_off" }),
}));

const secretKey = process.env.STRIPE_SECRET_KEY ?? "";
const enabled =
  process.env.LIVE_STRIPE === "1" &&
  Boolean(process.env.DATABASE_URL) &&
  secretKey.startsWith("sk_test_") &&
  (process.env.STRIPE_PUBLISHABLE_KEY ?? "").startsWith("pk_test_");
const describeLive = enabled ? describe : describe.skip;

const TAG = `zz-test-4438-${randomUUID().slice(0, 8)}`;
const MONITORING_SLUG = "monitoring-growth-smb"; // seat band 26–100
const PACK_SLUG = "entra-id-quickstart-v1";

describeLive("#4438 — skipped-consent Retainer gets a real Stripe customer and its recurring subscription (real Stripe test mode)", () => {
  let stripe: Stripe;
  let app: express.Express;
  let subs: typeof import("../lib/purchase-recurring-subscription.ts");
  let buyerCustomer: typeof import("../lib/purchase-buyer-stripe-customer.ts");

  let mspId: number;
  let retainer: { id: number; slug: string };
  const tenantIds: number[] = [];
  const userIds: number[] = [];
  const sessionIds: string[] = [];
  const stripeCustomerIds = new Set<string>();

  async function makeAccount(label: string) {
    const [user] = await db
      .insert(usersTable)
      .values({ email: `${TAG}-${label}@example.invalid`, passwordHash: "not-a-real-hash", mspRole: "RetainerPending" })
      .returning({ id: usersTable.id, email: usersTable.email });
    userIds.push(user.id);
    return user;
  }

  /** A session exactly as #1311's skip route leaves it: pending, no tenant GUID, consent_skipped_at stamped. */
  async function makeSkippedSession(label: string, opts: { productSlug: string; accountUserId: number | null; email: string }) {
    const [session] = await db
      .insert(checkoutSessionsTable)
      .values({
        productSlug: opts.productSlug,
        fullName: `${TAG} ${label}`,
        email: opts.email,
        company: `${TAG} Co`,
        seats: 1,
        status: "pending",
        tenantId: null,
        consentSkippedAt: new Date(),
        accountUserId: opts.accountUserId,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })
      .returning({ id: checkoutSessionsTable.id });
    sessionIds.push(session.id);
    return session.id;
  }

  const createIntent = (sessionId: string) => request(app).post("/api/public/purchase/payment-intent").send({ sessionId });

  async function pay(sessionId: string) {
    const created = await createIntent(sessionId);
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const pi = await stripe.paymentIntents.confirm(created.body.paymentIntentId, {
      payment_method: "pm_card_visa",
      return_url: "https://example.invalid/return",
    });
    expect(pi.status).toBe("succeeded");
    if (pi.customer) stripeCustomerIds.add(customerOf(pi));
    return pi;
  }

  const confirm = (sessionId: string, paymentIntentId: string) =>
    request(app).post("/api/public/purchase/payment-confirmed").send({ sessionId, paymentIntentId });

  const customerOf = (pi: Stripe.PaymentIntent) => (typeof pi.customer === "string" ? pi.customer : pi.customer!.id);

  const userRow = async (id: number) => (await db.select().from(usersTable).where(eq(usersTable.id, id)))[0];

  /** Same proof #4431's suite applies to a consented purchase: anchored, month 1 charged once, month 2 bills in full. */
  async function assertAnchoredNoDoubleCharge(pi: Stripe.PaymentIntent, subscriptionId: string) {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    const anchor = subs.oneMonthAfterUtc(pi.created);
    expect(sub.status).toBe("active");
    expect(sub.customer).toBe(customerOf(pi));
    expect(sub.default_payment_method).toBe(pi.payment_method);
    expect(sub.billing_cycle_anchor).toBe(anchor);
    expect(sub.metadata).toMatchObject({ flow: "buy_purchase_flow", checkoutSessionId: pi.metadata.checkoutSessionId, firstMonthPaymentIntentId: pi.id });
    expect(sub.items.data[0].price.unit_amount).toBe(pi.amount);
    expect(sub.items.data[0].price.recurring?.interval).toBe("month");

    const charges = await stripe.charges.list({ customer: customerOf(pi) });
    expect(charges.data.filter((c) => c.payment_intent === pi.id)).toHaveLength(1);
    const invoices = await stripe.invoices.list({ subscription: subscriptionId });
    for (const inv of invoices.data) expect(inv.amount_paid).toBe(0);

    const upcoming = await stripe.invoices.createPreview({ subscription: subscriptionId });
    expect(upcoming.amount_due).toBe(pi.amount);
    expect(upcoming.next_payment_attempt ?? 0).toBeGreaterThanOrEqual(anchor);
  }

  beforeAll(async () => {
    stripe = new Stripe(secretKey);
    subs = await import("../lib/purchase-recurring-subscription.ts");
    buyerCustomer = await import("../lib/purchase-buyer-stripe-customer.ts");
    const { default: paymentRouter } = await import("./public-purchase-payment.ts");
    app = express();
    app.use(express.json());
    app.use("/api", paymentRouter);

    const [ret] = await db
      .select({ id: servicesTable.id, slug: servicesTable.slug })
      .from(servicesTable)
      .where(and(eq(servicesTable.category, "retainer"), eq(servicesTable.visibility, "public")))
      .limit(1);
    if (!ret?.slug) throw new Error("live catalog must carry a public retainer row");
    retainer = { id: ret.id, slug: ret.slug };

    const [msp] = await db.insert(mspsTable).values({ name: `${TAG} MSP`, slug: TAG }).returning({ id: mspsTable.id });
    mspId = msp.id;
  });

  afterAll(async () => {
    if (userIds.length) {
      for (const { c } of await db.select({ c: usersTable.stripeCustomerId }).from(usersTable).where(inArray(usersTable.id, userIds))) {
        if (c) stripeCustomerIds.add(c);
      }
    }
    if (tenantIds.length) {
      for (const { c } of await db.select({ c: tenantsTable.stripeCustomerId }).from(tenantsTable).where(inArray(tenantsTable.id, tenantIds))) {
        if (c) stripeCustomerIds.add(c);
      }
    }
    for (const c of stripeCustomerIds) await stripe.customers.del(c).catch(() => undefined);
    if (sessionIds.length) {
      await db.delete(clientServicesTable).where(inArray(clientServicesTable.checkoutSessionId, sessionIds));
      await db.delete(auditLogsTable).where(inArray(auditLogsTable.entityId, sessionIds));
      await db.delete(checkoutSessionsTable).where(inArray(checkoutSessionsTable.id, sessionIds));
    }
    if (userIds.length) await db.delete(auditLogsTable).where(inArray(auditLogsTable.actorUserId, userIds));
    if (tenantIds.length) {
      await db.delete(auditLogsTable).where(inArray(auditLogsTable.tenantId, tenantIds));
      await db.delete(retainerSettingsTable).where(inArray(retainerSettingsTable.customerId, tenantIds));
    }
    if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    if (tenantIds.length) await db.delete(tenantsTable).where(inArray(tenantsTable.id, tenantIds));
    if (mspId) await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
  });

  it("account-first: real customer on the account, card kept on file, anchored subscription created and linked; later consent adopts the customer", async () => {
    const account = await makeAccount("acct");
    const sessionId = await makeSkippedSession("acct", { productSlug: retainer.slug, accountUserId: account.id, email: account.email });

    const pi = await pay(sessionId);
    expect(pi.customer, "a skipped-consent Retainer intent must carry a Stripe customer").toBeTruthy();
    expect(pi.setup_future_usage).toBe("off_session");
    const customerId = customerOf(pi);
    expect((await userRow(account.id)).stripeCustomerId).toBe(customerId);
    const customer = await stripe.customers.retrieve(customerId);
    expect(customer.deleted).toBeFalsy();
    expect((customer as Stripe.Customer).email).toBe(account.email);
    expect((customer as Stripe.Customer).metadata).toMatchObject({ source: "buy_purchase_flow", userId: String(account.id) });

    // The card is attached to the customer — what month 2 bills against.
    const methods = await stripe.customers.listPaymentMethods(customerId);
    expect(methods.data.map((m) => m.id)).toContain(pi.payment_method);

    const res = await confirm(sessionId, pi.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.recurringSubscription.status).toBe("created");
    const subscriptionId: string = res.body.recurringSubscription.subscriptionId;
    await assertAnchoredNoDoubleCharge(pi, subscriptionId);

    const rows = await db.select().from(clientServicesTable).where(eq(clientServicesTable.checkoutSessionId, sessionId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ serviceId: retainer.id, clientUserId: account.id, stripeSubscriptionId: subscriptionId });

    // Replayed confirm creates nothing.
    const replay = await confirm(sessionId, pi.id);
    expect(replay.body.recurringSubscription).toEqual({ status: "already", subscriptionId });
    expect((await stripe.subscriptions.list({ customer: customerId, status: "all" })).data).toHaveLength(1);

    // A second skipped-consent purchase by the same account reuses its customer.
    const second = await makeSkippedSession("acct-2", { productSlug: retainer.slug, accountUserId: account.id, email: account.email });
    const intent2 = await createIntent(second);
    expect(intent2.status, JSON.stringify(intent2.body)).toBe(200);
    expect(customerOf(await stripe.paymentIntents.retrieve(intent2.body.paymentIntentId))).toBe(customerId);

    // Later consent links the account to a tenant: the tenant adopts the customer...
    const [tenant] = await db
      .insert(tenantsTable)
      .values({ mspId, customerName: `${TAG} acct`, tenantId: randomUUID() })
      .returning({ id: tenantsTable.id });
    tenantIds.push(tenant.id);
    await db.update(usersTable).set({ tenantId: tenant.id, mspRole: "RetainerConsented" }).where(eq(usersTable.id, account.id));
    expect(await buyerCustomer.adoptBuyerStripeCustomerOntoTenant(account.id, tenant.id)).toBe(customerId);
    const [tenantRow] = await db.select({ c: tenantsTable.stripeCustomerId }).from(tenantsTable).where(eq(tenantsTable.id, tenant.id));
    expect(tenantRow.c).toBe(customerId);
    // ...and a customer the tenant already has is never overwritten.
    await db.update(tenantsTable).set({ stripeCustomerId: "cus_operator_set" }).where(eq(tenantsTable.id, tenant.id));
    expect(await buyerCustomer.adoptBuyerStripeCustomerOntoTenant(account.id, tenant.id)).toBe("cus_operator_set");
    await db.update(tenantsTable).set({ stripeCustomerId: customerId }).where(eq(tenantsTable.id, tenant.id));
  }, 180_000);

  it("legacy (no account yet): still a real, session-keyed customer, and the subscription is created", async () => {
    const email = `${TAG}-legacy@example.invalid`;
    const sessionId = await makeSkippedSession("legacy", { productSlug: retainer.slug, accountUserId: null, email });

    const pi = await pay(sessionId);
    expect(pi.customer).toBeTruthy();
    expect(pi.setup_future_usage).toBe("off_session");
    const customer = (await stripe.customers.retrieve(customerOf(pi))) as Stripe.Customer;
    expect(customer.metadata).toMatchObject({ source: "buy_purchase_flow", checkoutSessionId: sessionId });

    // Re-creating the intent (reload) recovers the same customer.
    const again = await createIntent(sessionId);
    expect(customerOf(await stripe.paymentIntents.retrieve(again.body.paymentIntentId))).toBe(customerOf(pi));

    const res = await confirm(sessionId, pi.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.recurringSubscription.status).toBe("created");
    await assertAnchoredNoDoubleCharge(pi, res.body.recurringSubscription.subscriptionId);
  }, 180_000);

  it("scope: a Pack or Monitoring order with no tenants row is NOT given a Stripe customer", async () => {
    for (const [label, productSlug, seats] of [["pack", PACK_SLUG, 1], ["mon", MONITORING_SLUG, 60]] as const) {
      const account = await makeAccount(`scope-${label}`);
      // Consented against a GUID with no local tenants row — the one way these
      // products reach payment without a tenantRowId.
      const [session] = await db
        .insert(checkoutSessionsTable)
        .values({
          productSlug,
          fullName: `${TAG} ${label}`,
          email: account.email,
          seats,
          status: "consented",
          tenantId: randomUUID(),
          accountUserId: account.id,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        })
        .returning({ id: checkoutSessionsTable.id });
      sessionIds.push(session.id);

      const created = await createIntent(session.id);
      expect(created.status, JSON.stringify(created.body)).toBe(200);
      const intent = await stripe.paymentIntents.retrieve(created.body.paymentIntentId);
      expect(intent.customer, `${label}: no customer`).toBeNull();
      expect(intent.setup_future_usage).toBeNull();
      expect((await userRow(account.id)).stripeCustomerId).toBeNull();
      await stripe.paymentIntents.cancel(intent.id).catch(() => undefined);
    }
  }, 120_000);
});
