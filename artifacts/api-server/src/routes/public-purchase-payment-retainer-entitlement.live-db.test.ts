/**
 * Live-Postgres acceptance test for #4404 (Feature #4401) — a paid Buy.tsx
 * Retainer purchase now provisions its real entitlement records.
 *
 * Drives the REAL /api/public/purchase/payment-confirmed handler against the
 * real database, then reads the result back through the REAL customer-facing
 * GET /api/portal/retainer handler (the My Architect page's only data source)
 * as that buyer. Only the Stripe SDK (a real PaymentIntent retrieve needs a
 * real charge), outbound mail/CRM, and the auth middleware (which here just
 * stamps the buyer's own real users row onto req.user) are stubbed.
 *
 * Proves:
 *   - before payment the Portal answers `configured: false` (the bug #4401 found)
 *   - after payment-confirmed: one active client_services row keyed on the
 *     checkout session, one active retainer_settings row carrying the purchased
 *     row's real hours_per_month, and the Portal answers `configured: true`
 *   - a duplicate payment-confirmed (and a set-password-style re-run of the
 *     helper) never provisions a second row
 *   - an AdminV2-configured retainer_settings row is never overwritten
 *   - the legacy pay-then-account order (no accountUserId at payment) is a
 *     no-op until the account exists
 *
 * Synthetic identities only: `zz-test-4404-<tag>@example.invalid`, deleted in afterAll.
 *
 * Run: DATABASE_URL=... pnpm --filter @workspace/api-server exec vitest run public-purchase-payment-retainer-entitlement.live-db
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
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

const mockPaymentIntentsRetrieve = vi.fn();
vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(function () {
    return { paymentIntents: { retrieve: mockPaymentIntentsRetrieve } };
  }),
}));
vi.mock("../lib/stripe.ts", () => ({
  getStripeKey: vi.fn().mockReturnValue("sk_test_xxx"),
  getStripePublishableKey: vi.fn().mockReturnValue("pk_test_xxx"),
}));
vi.mock("../lib/mailer.ts", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  purchaseConfirmationEmail: vi.fn().mockReturnValue("<html></html>"),
}));
vi.mock("../lib/crm-pipeline.ts", () => ({ markAssessmentLeadPurchased: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../middlewares/requireAuth.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../middlewares/requireAuth.ts")>()),
  requireAuth:(req: express.Request, res: express.Response, next: express.NextFunction) => {
    const raw = req.headers["x-test-customer-id"];
    if (!raw) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.user = { id: Number(req.headers["x-test-user-id"]), customerId: Number(raw) } as unknown as Express.Request["user"];
    next();
  },
}));

const hasDb = Boolean(process.env.DATABASE_URL);
const describeLive = hasDb ? describe : describe.skip;

const TAG = `zz-test-4404-${randomUUID().slice(0, 8)}`;
const FLOW_TAG = "buy_purchase_flow";

describeLive("#4404 — paid Retainer purchase provisions client_services + retainer_settings", () => {
  let app: express.Express;
  let entitlement: typeof import("../lib/purchase-retainer-entitlement.ts");

  let retainer: { id: number; slug: string; hoursPerMonth: string | null };
  let mspId: number;
  const tenantIds: number[] = [];
  const userIds: number[] = [];
  const sessionIds: string[] = [];

  async function makeBuyer(label: string, opts: { accountFirst: boolean }) {
    const [tenant] = await db
      .insert(tenantsTable)
      .values({ mspId, customerName: `${TAG} ${label}`, tenantId: randomUUID() })
      .returning({ id: tenantsTable.id, tenantId: tenantsTable.tenantId });
    tenantIds.push(tenant.id);
    const email = `${TAG}-${label}@example.invalid`;
    const [user] = await db
      .insert(usersTable)
      .values({ email, passwordHash: "not-a-real-hash", mspRole: "RetainerConsented", mspId, tenantId: tenant.id })
      .returning({ id: usersTable.id });
    userIds.push(user.id);
    const [session] = await db
      .insert(checkoutSessionsTable)
      .values({
        productSlug: retainer.slug,
        fullName: `${TAG} ${label}`,
        email,
        company: `${TAG} Co`,
        status: "consented",
        tenantId: tenant.tenantId,
        accountUserId: opts.accountFirst ? user.id : null,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })
      .returning({ id: checkoutSessionsTable.id });
    sessionIds.push(session.id);
    return { customerId: tenant.id, userId: user.id, sessionId: session.id };
  }

  function stubSucceededIntent(sessionId: string) {
    mockPaymentIntentsRetrieve.mockResolvedValue({
      id: `pi_${TAG}`,
      status: "succeeded",
      amount_received: 1,
      metadata: { flow: FLOW_TAG, checkoutSessionId: sessionId, productType: "retainer" },
    });
  }

  const confirm = (sessionId: string) =>
    request(app).post("/api/public/purchase/payment-confirmed").send({ sessionId, paymentIntentId: `pi_${TAG}` });

  const portalRetainer = (b: { customerId: number; userId: number }) =>
    request(app)
      .get("/api/portal/retainer")
      .set("x-test-customer-id", String(b.customerId))
      .set("x-test-user-id", String(b.userId));

  const rowsFor = (sessionId: string) =>
    db.select().from(clientServicesTable).where(eq(clientServicesTable.checkoutSessionId, sessionId));

  beforeAll(async () => {
    entitlement = await import("../lib/purchase-retainer-entitlement.ts");
    const { default: paymentRouter } = await import("./public-purchase-payment.ts");
    const { default: portalRetainerRouter } = await import("./portal-retainer.ts");
    app = express();
    app.use(express.json());
    app.use("/api", paymentRouter);
    app.use("/api", portalRetainerRouter);

    const [svc] = await db
      .select({ id: servicesTable.id, slug: servicesTable.slug, hoursPerMonth: servicesTable.hoursPerMonth })
      .from(servicesTable)
      .where(and(eq(servicesTable.category, "retainer"), eq(servicesTable.visibility, "public")))
      .limit(1);
    if (!svc?.slug) throw new Error("live catalog must carry at least one public retainer service row");
    retainer = { id: svc.id, slug: svc.slug, hoursPerMonth: svc.hoursPerMonth };

    const [msp] = await db.insert(mspsTable).values({ name: `${TAG} MSP`, slug: TAG }).returning({ id: mspsTable.id });
    mspId = msp.id;
  });

  afterAll(async () => {
    if (sessionIds.length) {
      await db.delete(clientServicesTable).where(inArray(clientServicesTable.checkoutSessionId, sessionIds));
      await db.delete(auditLogsTable).where(inArray(auditLogsTable.entityId, sessionIds));
      if (tenantIds.length) await db.delete(auditLogsTable).where(inArray(auditLogsTable.tenantId, tenantIds));
      await db.delete(checkoutSessionsTable).where(inArray(checkoutSessionsTable.id, sessionIds));
    }
    if (tenantIds.length) await db.delete(retainerSettingsTable).where(inArray(retainerSettingsTable.customerId, tenantIds));
    if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    if (tenantIds.length) await db.delete(tenantsTable).where(inArray(tenantsTable.id, tenantIds));
    if (mspId) await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
  });

  it("parses the catalog's free-text hours_per_month into minutes, never guessing", () => {
    expect(entitlement.retainedMinutesFromHoursText("16")).toBe(960);
    expect(entitlement.retainedMinutesFromHoursText("10 hours")).toBe(600);
    expect(entitlement.retainedMinutesFromHoursText("2.5")).toBe(150);
    expect(entitlement.retainedMinutesFromHoursText(null)).toBeNull();
    expect(entitlement.retainedMinutesFromHoursText("ask us")).toBeNull();
    expect(entitlement.retainedMinutesFromHoursText("0")).toBeNull();
  });

  it("account-first buyer: payment-confirmed provisions the entitlement and the Portal reflects it; a duplicate confirm does not double-provision", async () => {
    const buyer = await makeBuyer("af", { accountFirst: true });
    const expectedMinutes = entitlement.retainedMinutesFromHoursText(retainer.hoursPerMonth);
    expect(expectedMinutes, "live retainer row must carry hours_per_month").not.toBeNull();

    const before = await portalRetainer(buyer);
    expect(before.status).toBe(200);
    expect(before.body.configured).toBe(false);

    stubSucceededIntent(buyer.sessionId);
    const first = await confirm(buyer.sessionId);
    expect(first.status, JSON.stringify(first.body)).toBe(200);

    const rows = await rowsFor(buyer.sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ clientUserId: buyer.userId, serviceId: retainer.id, status: "active", billingInterval: "month" });

    const [settings] = await db.select().from(retainerSettingsTable).where(eq(retainerSettingsTable.customerId, buyer.customerId));
    expect(settings).toMatchObject({ mspId, active: true, retainedMinutesPerMonth: expectedMinutes });

    const after = await portalRetainer(buyer);
    expect(after.status).toBe(200);
    expect(after.body.configured).toBe(true);
    expect(after.body.settings.retainedHours).toBe(expectedMinutes! / 60);

    // Replayed confirm (reload / lost response) + two concurrent confirms.
    const replays = await Promise.all([confirm(buyer.sessionId), confirm(buyer.sessionId), confirm(buyer.sessionId)]);
    for (const r of replays) expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await rowsFor(buyer.sessionId)).toHaveLength(1);
    const settingsRows = await db.select().from(retainerSettingsTable).where(eq(retainerSettingsTable.customerId, buyer.customerId));
    expect(settingsRows).toHaveLength(1);

    // set-password's re-run of the helper is also a no-op for this session.
    const rerun = await entitlement.ensureRetainerEntitlement({
      id: buyer.sessionId, productSlug: retainer.slug, email: "", fullName: "", company: null, industry: null,
      tenantId: null, accountUserId: buyer.userId,
    });
    expect(rerun).toMatchObject({ provisioned: true, clientServiceCreated: false, clientServiceId: rows[0].id, settings: "already_configured" });
  });

  it("never overwrites a retainer_settings row Shane configured in AdminV2", async () => {
    const buyer = await makeBuyer("admin", { accountFirst: true });
    await db.insert(retainerSettingsTable).values({
      customerId: buyer.customerId, mspId, retainedMinutesPerMonth: 1234, architectName: `${TAG} Architect`, active: true,
    });

    stubSucceededIntent(buyer.sessionId);
    const res = await confirm(buyer.sessionId);
    expect(res.status).toBe(200);

    expect(await rowsFor(buyer.sessionId)).toHaveLength(1);
    const [settings] = await db.select().from(retainerSettingsTable).where(eq(retainerSettingsTable.customerId, buyer.customerId));
    expect(settings).toMatchObject({ retainedMinutesPerMonth: 1234, architectName: `${TAG} Architect`, active: true });
  });

  it("legacy pay-then-account order: nothing provisioned at payment (no account yet), provisioned once the account exists", async () => {
    const buyer = await makeBuyer("legacy", { accountFirst: false });

    stubSucceededIntent(buyer.sessionId);
    const res = await confirm(buyer.sessionId);
    expect(res.status).toBe(200);
    expect(await rowsFor(buyer.sessionId)).toHaveLength(0);

    // What set-password's `ok` outcome now does, with the account it just completed.
    const [session] = await db.select().from(checkoutSessionsTable).where(eq(checkoutSessionsTable.id, buyer.sessionId));
    const result = await entitlement.ensureRetainerEntitlement({
      id: session.id, productSlug: session.productSlug, email: session.email, fullName: session.fullName,
      company: session.company, industry: session.industry, tenantId: session.tenantId, accountUserId: buyer.userId,
    });
    expect(result).toMatchObject({ provisioned: true, clientServiceCreated: true, settings: "created" });
    expect(await rowsFor(buyer.sessionId)).toHaveLength(1);
    expect((await portalRetainer(buyer)).body.configured).toBe(true);
  });

  it("is a no-op for a non-retainer product", async () => {
    const [monitoring] = await db
      .select({ slug: servicesTable.slug })
      .from(servicesTable)
      .where(eq(servicesTable.category, "monitoring"))
      .limit(1);
    const result = await entitlement.ensureRetainerEntitlement({
      id: randomUUID(), productSlug: monitoring.slug!, email: "", fullName: "", company: null, industry: null,
      tenantId: null, accountUserId: 1,
    });
    expect(result).toEqual({ provisioned: false, reason: "not_retainer" });
  });
});
