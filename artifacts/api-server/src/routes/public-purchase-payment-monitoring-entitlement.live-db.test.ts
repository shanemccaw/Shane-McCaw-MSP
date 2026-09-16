/**
 * Live-Postgres acceptance test for #4403 — a paid Monitoring purchase must
 * provision the entitlement the Portal's tier gate actually reads (#4402's
 * traced contract: client_services status='active' -> services
 * service_type='monitoring_tier'), exactly once per checkout session.
 *
 * Drives the REAL /api/public/purchase/payment-confirmed express handler
 * against the real local database, then reads the result back through the
 * Portal's own resolver (portal-tier-features.ts resolveCustomerTierEntitlement)
 * — the same function evaluateAccess()/requireTierFeature consult — so "the
 * Portal reflects the purchased tier" is asserted on the reader, not on the
 * row alone. Expected features come from the live services row, never
 * hardcoded.
 *
 * Mocked: the Stripe SDK (a succeeded PaymentIntent carrying this session's
 * server-written metadata), mail/CRM/audit side effects, and the monitoring
 * scan kickoff (a real runDiagnostics call reaches Microsoft Graph).
 *
 * Synthetic identities only: `zz-test-4403-<tag>@example.invalid`, deleted in
 * afterAll.
 *
 * Run: DATABASE_URL=... pnpm --filter @workspace/api-server exec vitest run public-purchase-payment-monitoring-entitlement.live-db
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  checkoutSessionsTable,
  clientServicesTable,
  mspsTable,
  servicesTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";

const mockPaymentIntentsRetrieve = vi.fn();
vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(function () {
    return {
      customers: { create: vi.fn() },
      paymentIntents: { create: vi.fn(), retrieve: mockPaymentIntentsRetrieve },
    };
  }),
}));
vi.mock("../lib/stripe.ts", () => ({
  getStripeKey: vi.fn().mockReturnValue("sk_test_xxx"),
  getStripePublishableKey: vi.fn().mockReturnValue("pk_test_xxx"),
}));
vi.mock("../lib/audit.ts", () => ({ createAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/mailer.ts", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  purchaseConfirmationEmail: vi.fn().mockReturnValue("<html></html>"),
}));
vi.mock("../lib/crm-pipeline.ts", () => ({ markAssessmentLeadPurchased: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/monitoring-onboarding-scan.ts", () => ({
  ensureMonitoringScanKickoff: vi.fn().mockResolvedValue({ fired: false, reason: "already_kicked_off" }),
}));

const hasDb = Boolean(process.env.DATABASE_URL);
const describeLive = hasDb ? describe : describe.skip;

const TAG = `zz-test-4403-${randomUUID().slice(0, 8)}`;
const PREMIER_SLUG = "monitoring-premier-smb"; // seat band shared with the -smb rows (26–100)
const SEATS = 60;

describeLive("#4403 — payment-confirmed provisions the Monitoring entitlement the Portal reads", () => {
  let app: express.Express;
  let tierFeatures: typeof import("../lib/portal-tier-features.ts");
  let provisioning: typeof import("../lib/monitoring-entitlement-provisioning.ts");

  let mspId: number;
  const tenantRowIds: number[] = [];
  const userIds: number[] = [];
  const sessionIds: string[] = [];
  let premier: { id: number; tier: string | null; includedFeatures: string[] };

  async function createBuyer(label: string) {
    const tenantGuid = randomUUID();
    const [tenant] = await db
      .insert(tenantsTable)
      .values({ mspId, customerName: `${TAG} ${label}`, tenantId: tenantGuid })
      .returning({ id: tenantsTable.id });
    tenantRowIds.push(tenant.id);
    const [user] = await db
      .insert(usersTable)
      .values({
        email: `${TAG}-${label}@example.invalid`,
        passwordHash: "not-a-real-hash",
        mspRole: "MonitoringConsented",
        mspId,
        tenantId: tenant.id,
      })
      .returning({ id: usersTable.id });
    userIds.push(user.id);
    return { tenantRowId: tenant.id, tenantGuid, userId: user.id };
  }

  async function createSession(opts: { productSlug: string; tenantGuid: string; accountUserId: number | null; label: string }) {
    const [row] = await db
      .insert(checkoutSessionsTable)
      .values({
        productSlug: opts.productSlug,
        fullName: `${TAG} Buyer`,
        email: `${TAG}-${opts.label}@example.invalid`,
        company: `${TAG} Co`,
        seats: SEATS,
        status: "consented",
        tenantId: opts.tenantGuid,
        accountUserId: opts.accountUserId,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })
      .returning({ id: checkoutSessionsTable.id });
    sessionIds.push(row.id);
    return row.id;
  }

  function succeededIntentFor(sessionId: string) {
    return {
      id: `pi_${TAG}_${sessionId.slice(0, 8)}`,
      status: "succeeded",
      amount_received: 100,
      metadata: { flow: "buy_purchase_flow", checkoutSessionId: sessionId, productType: "monitoring" },
    };
  }

  async function confirm(sessionId: string) {
    mockPaymentIntentsRetrieve.mockResolvedValue(succeededIntentFor(sessionId));
    return request(app)
      .post("/api/public/purchase/payment-confirmed")
      .send({ sessionId, paymentIntentId: succeededIntentFor(sessionId).id });
  }

  async function rowsFor(sessionId: string) {
    return db
      .select({ id: clientServicesTable.id, clientUserId: clientServicesTable.clientUserId, serviceId: clientServicesTable.serviceId, status: clientServicesTable.status })
      .from(clientServicesTable)
      .where(eq(clientServicesTable.checkoutSessionId, sessionId));
  }

  beforeAll(async () => {
    tierFeatures = await import("../lib/portal-tier-features.ts");
    provisioning = await import("../lib/monitoring-entitlement-provisioning.ts");
    const { default: router } = await import("./public-purchase-payment.ts");
    app = express();
    app.use(express.json());
    app.use("/api", router);

    const [svc] = await db
      .select({ id: servicesTable.id, tier: servicesTable.tier, typeAttributes: servicesTable.typeAttributes })
      .from(servicesTable)
      .where(and(eq(servicesTable.slug, PREMIER_SLUG), eq(servicesTable.serviceType, "monitoring_tier")))
      .limit(1);
    if (!svc) throw new Error(`live catalog is missing ${PREMIER_SLUG}`);
    const included = (svc.typeAttributes as Record<string, unknown> | null)?.["includedFeatures"];
    premier = { id: svc.id, tier: svc.tier, includedFeatures: Array.isArray(included) ? (included as string[]) : [] };
    expect(premier.includedFeatures.length).toBeGreaterThan(0);

    const [msp] = await db.insert(mspsTable).values({ name: `${TAG} MSP`, slug: TAG }).returning({ id: mspsTable.id });
    mspId = msp.id;
  });

  afterAll(async () => {
    if (sessionIds.length) await db.delete(clientServicesTable).where(inArray(clientServicesTable.checkoutSessionId, sessionIds));
    if (userIds.length) {
      await db.delete(clientServicesTable).where(inArray(clientServicesTable.clientUserId, userIds));
      await db.execute(sql`DELETE FROM customer_user_roles WHERE user_id IN (${sql.join(userIds.map((id) => sql`${id}`), sql`, `)})`);
    }
    if (sessionIds.length) await db.delete(checkoutSessionsTable).where(inArray(checkoutSessionsTable.id, sessionIds));
    if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    if (tenantRowIds.length) await db.delete(tenantsTable).where(inArray(tenantsTable.id, tenantRowIds));
    if (mspId) await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
  });

  it("account-first Premier buyer: before payment the Portal reads no tier; after confirm it reads Premier with the row's real features", async () => {
    const buyer = await createBuyer("af");
    const sessionId = await createSession({ productSlug: PREMIER_SLUG, tenantGuid: buyer.tenantGuid, accountUserId: buyer.userId, label: "af" });

    const before = await tierFeatures.resolveCustomerTierEntitlement(buyer.tenantRowId);
    expect(before).toEqual({ includedFeatures: [], currentTier: null });

    const res = await confirm(sessionId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.ok).toBe(true);

    const rows = await rowsFor(sessionId);
    expect(rows).toEqual([{ id: expect.any(Number), clientUserId: buyer.userId, serviceId: premier.id, status: "active" }]);

    const after = await tierFeatures.resolveCustomerTierEntitlement(buyer.tenantRowId);
    expect(after.currentTier).toBe(premier.tier);
    expect(after.includedFeatures).toEqual(premier.includedFeatures);
    expect(await tierFeatures.resolveCustomerIncludedFeatures(buyer.tenantRowId)).toEqual(premier.includedFeatures);
  });

  it("a replayed confirm (session already paid) and concurrent duplicate confirms never double-provision", async () => {
    const buyer = await createBuyer("dup");
    const sessionId = await createSession({ productSlug: PREMIER_SLUG, tenantGuid: buyer.tenantGuid, accountUserId: buyer.userId, label: "dup" });

    const concurrent = await Promise.all([confirm(sessionId), confirm(sessionId), confirm(sessionId)]);
    for (const r of concurrent) expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await rowsFor(sessionId)).toHaveLength(1);

    const replay = await confirm(sessionId);
    expect(replay.status).toBe(200);
    const rows = await rowsFor(sessionId);
    expect(rows).toHaveLength(1);

    const again = await provisioning.ensureMonitoringEntitlement({ id: sessionId, productSlug: PREMIER_SLUG, accountUserId: buyer.userId });
    expect(again).toEqual({ provisioned: false, reason: "already_provisioned", clientServiceId: rows[0].id, serviceId: premier.id, clientUserId: buyer.userId });
    expect(await rowsFor(sessionId)).toHaveLength(1);
  });

  it("legacy pay-then-account: confirm writes nothing without an account; set-password's call provisions it", async () => {
    const buyer = await createBuyer("legacy");
    const sessionId = await createSession({ productSlug: PREMIER_SLUG, tenantGuid: buyer.tenantGuid, accountUserId: null, label: "legacy" });

    const res = await confirm(sessionId);
    expect(res.status).toBe(200);
    expect(await rowsFor(sessionId)).toHaveLength(0);

    // The exact call set-password's `ok` branch makes once the account exists.
    const result = await provisioning.ensureMonitoringEntitlement({ id: sessionId, productSlug: PREMIER_SLUG, accountUserId: buyer.userId });
    expect(result.reason).toBe("provisioned");
    expect((await tierFeatures.resolveCustomerTierEntitlement(buyer.tenantRowId)).currentTier).toBe(premier.tier);
  });

  it("is a no-op for a non-monitoring product", async () => {
    const [retainer] = await db
      .select({ slug: servicesTable.slug })
      .from(servicesTable)
      .where(eq(servicesTable.category, "retainer"))
      .limit(1);
    if (!retainer?.slug) throw new Error("live catalog must carry a retainer row");
    const buyer = await createBuyer("nonmon");
    const result = await provisioning.ensureMonitoringEntitlement({ id: randomUUID(), productSlug: retainer.slug, accountUserId: buyer.userId });
    expect(result).toEqual({ provisioned: false, reason: "not_monitoring" });
  });
});
