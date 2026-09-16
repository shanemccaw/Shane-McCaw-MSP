/**
 * Live Stripe TEST-MODE + live-Postgres acceptance test for #4431 (Feature #4401)
 * — a paid Buy.tsx Monitoring/Retainer purchase creates its recurring Stripe
 * Subscription, anchored so month 1 (already charged by the PaymentIntent) is
 * never billed twice, with its id on the purchase's client_services row, exactly
 * once per checkout session.
 *
 * Nothing about Stripe is mocked: the REAL /payment-intent handler creates a real
 * test-mode PaymentIntent, it is confirmed with Stripe's `pm_card_visa` test
 * card, and the REAL /payment-confirmed handler creates the real subscription.
 * Assertions read back from Stripe itself (subscription, charges, invoices,
 * upcoming-invoice preview) and from the real database.
 *
 * Mocked: mail/CRM side effects, the monitoring scan kickoff (a real
 * runDiagnostics reaches Microsoft Graph), and lib/stripe.ts's key getters —
 * pinned to the TEST keys in the environment; the suite refuses anything that
 * is not `sk_test_`.
 *
 * Opt-in (it makes real Stripe test-mode API calls):
 *   LIVE_STRIPE=1 DATABASE_URL=... STRIPE_SECRET_KEY=sk_test_... STRIPE_PUBLISHABLE_KEY=pk_test_... \
 *     pnpm --filter @workspace/api-server exec vitest run public-purchase-payment-recurring-subscription.live-stripe
 *
 * Synthetic identities only (`zz-test-4431-<tag>@example.invalid`); DB rows and
 * the Stripe customers (which cancels their subscriptions) are deleted in afterAll.
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

const TAG = `zz-test-4431-${randomUUID().slice(0, 8)}`;
const MONITORING_SLUG = "monitoring-growth-smb"; // seat band 26–100
const SEATS = 60;

describe("#4431 — oneMonthAfterUtc", () => {
  it("adds one calendar month in UTC, clamping to the target month's length", async () => {
    const { oneMonthAfterUtc } = await import("../lib/purchase-recurring-subscription.ts");
    const s = (iso: string) => Date.parse(iso) / 1000;
    expect(oneMonthAfterUtc(s("2026-09-16T20:24:17Z"))).toBe(s("2026-10-16T20:24:17Z"));
    expect(oneMonthAfterUtc(s("2026-01-31T10:00:00Z"))).toBe(s("2026-02-28T10:00:00Z"));
    expect(oneMonthAfterUtc(s("2028-01-31T10:00:00Z"))).toBe(s("2028-02-29T10:00:00Z"));
    expect(oneMonthAfterUtc(s("2026-12-15T23:59:59Z"))).toBe(s("2027-01-15T23:59:59Z"));
    expect(oneMonthAfterUtc(s("2026-03-31T00:00:00Z"))).toBe(s("2026-04-30T00:00:00Z"));
  });
});

describeLive("#4431 — payment-confirmed creates the recurring subscription (real Stripe test mode)", () => {
  let stripe: Stripe;
  let app: express.Express;
  let subs: typeof import("../lib/purchase-recurring-subscription.ts");
  let retainerEntitlement: typeof import("../lib/purchase-retainer-entitlement.ts");

  let mspId: number;
  let retainer: { id: number; slug: string };
  let monitoring: { id: number };
  const tenantIds: number[] = [];
  const userIds: number[] = [];
  const sessionIds: string[] = [];

  async function makeBuyer(label: string, opts: { productSlug: string; accountFirst: boolean; seats?: number }) {
    const tenantGuid = randomUUID();
    const [tenant] = await db
      .insert(tenantsTable)
      .values({ mspId, customerName: `${TAG} ${label}`, tenantId: tenantGuid })
      .returning({ id: tenantsTable.id });
    tenantIds.push(tenant.id);
    const email = `${TAG}-${label}@example.invalid`;
    const [user] = await db
      .insert(usersTable)
      .values({ email, passwordHash: "not-a-real-hash", mspRole: opts.productSlug === MONITORING_SLUG ? "MonitoringConsented" : "RetainerConsented", mspId, tenantId: tenant.id })
      .returning({ id: usersTable.id });
    userIds.push(user.id);
    const [session] = await db
      .insert(checkoutSessionsTable)
      .values({
        productSlug: opts.productSlug,
        fullName: `${TAG} ${label}`,
        email,
        company: `${TAG} Co`,
        seats: opts.seats ?? 1,
        status: "consented",
        tenantId: tenantGuid,
        accountUserId: opts.accountFirst ? user.id : null,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })
      .returning({ id: checkoutSessionsTable.id });
    sessionIds.push(session.id);
    return { tenantRowId: tenant.id, userId: user.id, sessionId: session.id };
  }

  /** The buyer's side: Buy.tsx's Payment Element, done server-side with Stripe's test card. */
  async function pay(sessionId: string) {
    const created = await request(app).post("/api/public/purchase/payment-intent").send({ sessionId });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const pi = await stripe.paymentIntents.confirm(created.body.paymentIntentId, {
      payment_method: "pm_card_visa",
      return_url: "https://example.invalid/return",
    });
    expect(pi.status).toBe("succeeded");
    return pi;
  }

  const confirm = (sessionId: string, paymentIntentId: string) =>
    request(app).post("/api/public/purchase/payment-confirmed").send({ sessionId, paymentIntentId });

  const customerOf = (pi: Stripe.PaymentIntent) => (typeof pi.customer === "string" ? pi.customer : pi.customer!.id);

  const sessionRow = async (sessionId: string) =>
    (await db.select().from(checkoutSessionsTable).where(eq(checkoutSessionsTable.id, sessionId)))[0];

  const clientServiceRows = (sessionId: string) =>
    db.select().from(clientServicesTable).where(eq(clientServicesTable.checkoutSessionId, sessionId));

  /** Everything Stripe says was billed and will bill — the "no double charge" proof. */
  async function assertAnchoredNoDoubleCharge(pi: Stripe.PaymentIntent, subscriptionId: string) {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    const anchor = subs.oneMonthAfterUtc(pi.created);
    expect(sub.status).toBe("active");
    expect(sub.customer).toBe(customerOf(pi));
    expect(sub.default_payment_method).toBe(pi.payment_method);
    expect(sub.billing_cycle_anchor).toBe(anchor);
    expect(sub.metadata).toMatchObject({ flow: "buy_purchase_flow", checkoutSessionId: pi.metadata.checkoutSessionId, firstMonthPaymentIntentId: pi.id });
    expect(sub.items.data).toHaveLength(1);
    expect(sub.items.data[0].price.unit_amount).toBe(pi.amount);
    expect(sub.items.data[0].price.recurring?.interval).toBe("month");
    expect(sub.items.data[0].current_period_end).toBe(anchor);

    // Month 1: exactly one charge on the customer (the PaymentIntent), and no
    // invoice the subscription raised has taken any money.
    const charges = await stripe.charges.list({ customer: customerOf(pi) });
    expect(charges.data).toHaveLength(1);
    expect(charges.data[0].payment_intent).toBe(pi.id);
    const invoices = await stripe.invoices.list({ subscription: subscriptionId });
    for (const inv of invoices.data) expect(inv.amount_paid).toBe(0);

    // Month 2: the next invoice bills the full monthly amount, attempted at the anchor.
    const upcoming = await stripe.invoices.createPreview({ subscription: subscriptionId });
    expect(upcoming.amount_due).toBe(pi.amount);
    expect(upcoming.next_payment_attempt ?? 0).toBeGreaterThanOrEqual(anchor);
  }

  beforeAll(async () => {
    stripe = new Stripe(secretKey);
    subs = await import("../lib/purchase-recurring-subscription.ts");
    retainerEntitlement = await import("../lib/purchase-retainer-entitlement.ts");
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
    const [mon] = await db.select({ id: servicesTable.id }).from(servicesTable).where(eq(servicesTable.slug, MONITORING_SLUG)).limit(1);
    if (!mon) throw new Error(`live catalog is missing ${MONITORING_SLUG}`);
    monitoring = mon;

    const [msp] = await db.insert(mspsTable).values({ name: `${TAG} MSP`, slug: TAG }).returning({ id: mspsTable.id });
    mspId = msp.id;
  });

  afterAll(async () => {
    const stripeCustomers = tenantIds.length
      ? await db.select({ c: tenantsTable.stripeCustomerId }).from(tenantsTable).where(inArray(tenantsTable.id, tenantIds))
      : [];
    for (const { c } of stripeCustomers) if (c) await stripe.customers.del(c).catch(() => undefined);
    if (sessionIds.length) {
      await db.delete(clientServicesTable).where(inArray(clientServicesTable.checkoutSessionId, sessionIds));
      await db.delete(auditLogsTable).where(inArray(auditLogsTable.entityId, sessionIds));
      if (tenantIds.length) await db.delete(auditLogsTable).where(inArray(auditLogsTable.tenantId, tenantIds));
      await db.delete(checkoutSessionsTable).where(inArray(checkoutSessionsTable.id, sessionIds));
    }
    if (userIds.length) await db.delete(auditLogsTable).where(inArray(auditLogsTable.actorUserId, userIds));
    if (tenantIds.length) await db.delete(retainerSettingsTable).where(inArray(retainerSettingsTable.customerId, tenantIds));
    if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    if (tenantIds.length) await db.delete(tenantsTable).where(inArray(tenantsTable.id, tenantIds));
    if (mspId) await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
  });

  it("Monitoring, account-first: one anchored subscription, id on the client_services row, replays create nothing", async () => {
    const buyer = await makeBuyer("mon", { productSlug: MONITORING_SLUG, accountFirst: true, seats: SEATS });
    const pi = await pay(buyer.sessionId);

    const first = await confirm(buyer.sessionId, pi.id);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.recurringSubscription.status).toBe("created");
    const subscriptionId: string = first.body.recurringSubscription.subscriptionId;
    expect(first.body.recurringSubscription.monthlyAmountCents).toBe(pi.amount);

    await assertAnchoredNoDoubleCharge(pi, subscriptionId);

    const session = await sessionRow(buyer.sessionId);
    expect(session.purchasePaymentIntentId).toBe(pi.id);
    expect(session.purchaseSubscriptionId).toBe(subscriptionId);
    const rows = await clientServiceRows(buyer.sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ serviceId: monitoring.id, clientUserId: buyer.userId, stripeSubscriptionId: subscriptionId });

    const audits = await db
      .select()
      .from(auditLogsTable)
      .where(and(eq(auditLogsTable.entityId, buyer.sessionId), eq(auditLogsTable.actionType, "purchase_flow_subscription_created")));
    expect(audits).toHaveLength(1);

    // Reload / retry / lost response, fired concurrently.
    const replays = await Promise.all([confirm(buyer.sessionId, pi.id), confirm(buyer.sessionId, pi.id), confirm(buyer.sessionId, pi.id)]);
    for (const r of replays) {
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.recurringSubscription).toEqual({ status: "already", subscriptionId });
    }
    const all = await stripe.subscriptions.list({ customer: customerOf(pi), status: "all" });
    expect(all.data.map((s) => s.id)).toEqual([subscriptionId]);
    expect((await stripe.charges.list({ customer: customerOf(pi) })).data).toHaveLength(1);

    // Local record lost after the Stripe create: the backstop adopts the real
    // subscription from Stripe instead of creating a second one.
    await db.update(checkoutSessionsTable).set({ purchaseSubscriptionId: null }).where(eq(checkoutSessionsTable.id, buyer.sessionId));
    await db.update(clientServicesTable).set({ stripeSubscriptionId: null }).where(eq(clientServicesTable.checkoutSessionId, buyer.sessionId));
    const adopted = await subs.ensurePurchaseSubscription(buyer.sessionId);
    expect(adopted).toEqual({ status: "already", subscriptionId });
    expect((await sessionRow(buyer.sessionId)).purchaseSubscriptionId).toBe(subscriptionId);
    expect((await clientServiceRows(buyer.sessionId))[0].stripeSubscriptionId).toBe(subscriptionId);
    expect((await stripe.subscriptions.list({ customer: customerOf(pi), status: "all" })).data).toHaveLength(1);
  }, 120_000);

  it("Retainer, concurrent FIRST confirms: exactly one subscription at Stripe", async () => {
    const buyer = await makeBuyer("ret-race", { productSlug: retainer.slug, accountFirst: true });
    const pi = await pay(buyer.sessionId);

    const results = await Promise.all([confirm(buyer.sessionId, pi.id), confirm(buyer.sessionId, pi.id), confirm(buyer.sessionId, pi.id)]);
    for (const r of results) expect(r.status, JSON.stringify(r.body)).toBe(200);

    const all = await stripe.subscriptions.list({ customer: customerOf(pi), status: "all" });
    expect(all.data).toHaveLength(1);
    const subscriptionId = all.data[0].id;
    for (const r of results) {
      expect(["created", "already"]).toContain(r.body.recurringSubscription.status);
      expect(r.body.recurringSubscription.subscriptionId).toBe(subscriptionId);
    }
    await assertAnchoredNoDoubleCharge(pi, subscriptionId);
    const rows = await clientServiceRows(buyer.sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ serviceId: retainer.id, stripeSubscriptionId: subscriptionId });
  }, 120_000);

  it("Retainer, legacy pay-then-account: subscription created at confirm, linked once set-password provisions the row", async () => {
    const buyer = await makeBuyer("ret-legacy", { productSlug: retainer.slug, accountFirst: false });
    const pi = await pay(buyer.sessionId);

    const res = await confirm(buyer.sessionId, pi.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.recurringSubscription.status).toBe("created");
    const subscriptionId: string = res.body.recurringSubscription.subscriptionId;
    expect(await clientServiceRows(buyer.sessionId)).toHaveLength(0);
    expect((await sessionRow(buyer.sessionId)).purchaseSubscriptionId).toBe(subscriptionId);

    // What set-password's `ok` outcome does, in order, with the account it just completed.
    const s = await sessionRow(buyer.sessionId);
    await retainerEntitlement.ensureRetainerEntitlement({
      id: s.id, productSlug: s.productSlug, email: s.email, fullName: s.fullName,
      company: s.company, industry: s.industry, tenantId: s.tenantId, accountUserId: buyer.userId,
    });
    expect(await subs.ensurePurchaseSubscription(buyer.sessionId)).toEqual({ status: "already", subscriptionId });
    const rows = await clientServiceRows(buyer.sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].stripeSubscriptionId).toBe(subscriptionId);
    expect((await stripe.subscriptions.list({ customer: customerOf(pi), status: "all" })).data).toHaveLength(1);
  }, 120_000);

  it("a one-time pack purchase never creates a subscription", async () => {
    const buyer = await makeBuyer("pack", { productSlug: "entra-id-quickstart-v1", accountFirst: true });
    const pi = await pay(buyer.sessionId);
    const res = await confirm(buyer.sessionId, pi.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.recurringSubscription).toEqual({ status: "not_recurring" });
    expect((await sessionRow(buyer.sessionId)).purchaseSubscriptionId).toBeNull();
    if (pi.customer) {
      expect((await stripe.subscriptions.list({ customer: customerOf(pi), status: "all" })).data).toHaveLength(0);
    }
  }, 120_000);
});
