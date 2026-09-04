/**
 * public-purchase-payment.test.ts — Git #1307 (Phase 2 of #1302).
 *
 * Drives the REAL express handlers in public-purchase-payment.ts against the
 * REAL local Postgres (the same DATABASE_URL the dev api-server uses), because
 * the property under test is that every charged cent resolves from the REAL
 * catalog rows — monitoring tiers priced only through type_attributes,
 * retainers priced through price_cents, packs summed from real config_pack
 * rows — through the same un-mocked catalog-pricing resolvers checkout uses.
 * Expected amounts are computed from the live rows via those same resolvers,
 * never hardcoded, so a catalog price edit cannot silently rot this suite.
 *
 * Only the Stripe SDK and the outbound side effects (mail, CRM, audit) are
 * mocked. Sessions (and one tenants row) are created under this run's own ids
 * and deleted in afterAll.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { randomBytes, randomUUID } from "crypto";
import { db, checkoutSessionsTable, servicesTable, tenantsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  resolveServicePriceCents,
  resolveTypeAttributesMonthlyPriceCents,
} from "../lib/catalog-pricing.ts";

// ── Mocks: Stripe SDK + outbound side effects only ────────────────────────────

const mockCustomersCreate = vi.fn();
const mockPaymentIntentsCreate = vi.fn();
const mockPaymentIntentsRetrieve = vi.fn();

vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(function () {
    return {
      customers: { create: mockCustomersCreate },
      paymentIntents: { create: mockPaymentIntentsCreate, retrieve: mockPaymentIntentsRetrieve },
    };
  }),
}));

vi.mock("../lib/stripe", () => ({
  getStripeKey: vi.fn().mockReturnValue("sk_test_xxx"),
  getStripePublishableKey: vi.fn().mockReturnValue("pk_test_xxx"),
}));

const mockCreateAuditLog = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/audit", () => ({ createAuditLog: (...args: unknown[]) => mockCreateAuditLog(...args) }));

const mockSendEmail = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/mailer", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
  purchaseConfirmationEmail: vi.fn().mockReturnValue("<html></html>"),
}));

vi.mock("../lib/crm-pipeline", () => ({ markAssessmentLeadPurchased: vi.fn().mockResolvedValue(undefined) }));

// ── Real catalog anchors (queried live in the suite itself) ───────────────────

const MONITORING_SMB_SLUG = "monitoring-growth-smb"; // seat band 26–100
const RETAINER_SLUG = "architect-essentials-retainer";
// A service_type-tagged pack, an untagged (service_type NULL) pack, and the
// session's own pack — proving category, not service_type, decides realness.
const PACK_SESSION_SLUG = "entra-id-quickstart-v1";
const PACK_EXTRA_TAGGED = "break-glass-access-pack-v1";
const PACK_EXTRA_UNTAGGED = "identity-hygiene-pack-v1";
const ASSESSMENT_SLUG = "copilot-readiness-assessment";

async function loadService(slug: string) {
  const [row] = await db
    .select({
      id: servicesTable.id,
      slug: servicesTable.slug,
      name: servicesTable.name,
      category: servicesTable.category,
      priceCents: servicesTable.priceCents,
      price: servicesTable.price,
      basePrice: servicesTable.basePrice,
      isFreeOffering: servicesTable.isFreeOffering,
      typeAttributes: servicesTable.typeAttributes,
    })
    .from(servicesTable)
    .where(eq(servicesTable.slug, slug))
    .limit(1);
  if (!row) throw new Error(`live catalog is missing expected row: ${slug}`);
  return row;
}

// ── Test rows, swept in afterAll ──────────────────────────────────────────────

const RUN_TAG = randomBytes(4).toString("hex");
const createdSessionIds: string[] = [];
const createdTenantRowIds: number[] = [];

async function createSession(overrides: Partial<typeof checkoutSessionsTable.$inferInsert> = {}) {
  const [row] = await db
    .insert(checkoutSessionsTable)
    .values({
      productSlug: MONITORING_SMB_SLUG,
      fullName: "Test Buyer 1307",
      email: `test-1307-${RUN_TAG}@purchase-payment-test.invalid`,
      company: "Contoso Test",
      seats: 60,
      status: "consented",
      tenantId: randomUUID(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      ...overrides,
    })
    .returning({ id: checkoutSessionsTable.id });
  createdSessionIds.push(row.id);
  return row.id;
}

afterAll(async () => {
  if (createdSessionIds.length > 0) {
    await db.delete(checkoutSessionsTable).where(inArray(checkoutSessionsTable.id, createdSessionIds));
  }
  if (createdTenantRowIds.length > 0) {
    await db.delete(tenantsTable).where(inArray(tenantsTable.id, createdTenantRowIds));
  }
});

async function buildApp() {
  const { default: router } = await import("./public-purchase-payment.ts");
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return app;
}

beforeEach(() => {
  mockCustomersCreate.mockReset().mockResolvedValue({ id: "cus_new_1307" });
  mockPaymentIntentsCreate.mockReset().mockResolvedValue({
    id: "pi_1307",
    client_secret: "cs_1307",
    status: "requires_payment_method",
  });
  mockPaymentIntentsRetrieve.mockReset();
  mockCreateAuditLog.mockClear();
  mockSendEmail.mockClear();
});

// ── Monitoring: tier × seats via the one real per-seat resolver ───────────────

describe("payment-intent — monitoring", () => {
  it("charges the tier's real type_attributes price at the SESSION's seat count", async () => {
    const seats = 60;
    const sessionId = await createSession({ productSlug: MONITORING_SMB_SLUG, seats });
    const row = await loadService(MONITORING_SMB_SLUG);
    const expected = resolveTypeAttributesMonthlyPriceCents(row, seats);
    expect(expected).toBeGreaterThan(0); // the live row genuinely prices per seat

    const app = await buildApp();
    const res = await request(app).post("/api/public/purchase/payment-intent").send({ sessionId });

    expect(res.status).toBe(200);
    expect(res.body.amountCents).toBe(expected);
    expect(res.body.productType).toBe("monitoring");
    expect(res.body.billingInterval).toBe("month");
    expect(res.body.seats).toBe(seats);
    const [piParams] = mockPaymentIntentsCreate.mock.calls[0];
    expect(piParams.amount).toBe(expected);
    expect(piParams.metadata.flow).toBe("buy_purchase_flow");
    expect(piParams.metadata.checkoutSessionId).toBe(sessionId);
    expect(piParams.metadata.seats).toBe(String(seats));
  });

  it("refuses a seat count outside the purchased band row instead of mispricing it", async () => {
    // 10 seats on the 26–100 band row: the floor-clamped price would silently
    // overcharge or (on a bigger band) undercharge — fail loudly instead.
    const sessionId = await createSession({ productSlug: MONITORING_SMB_SLUG, seats: 10 });
    const app = await buildApp();

    const res = await request(app).post("/api/public/purchase/payment-intent").send({ sessionId });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("seat_band_mismatch");
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("attaches the resolved Stripe customer and keeps the card for the later subscription", async () => {
    const tenantGuid = randomUUID();
    const [tenant] = await db
      .insert(tenantsTable)
      .values({
        mspId: 1,
        customerName: `Test Tenant 1307 ${RUN_TAG}`,
        tenantId: tenantGuid,
        stripeCustomerId: "cus_existing_1307",
      })
      .returning({ id: tenantsTable.id });
    createdTenantRowIds.push(tenant.id);
    const sessionId = await createSession({ productSlug: MONITORING_SMB_SLUG, seats: 60, tenantId: tenantGuid });

    const app = await buildApp();
    const res = await request(app).post("/api/public/purchase/payment-intent").send({ sessionId });

    expect(res.status).toBe(200);
    expect(mockCustomersCreate).not.toHaveBeenCalled(); // reused, never a duplicate
    const [piParams, piOpts] = mockPaymentIntentsCreate.mock.calls[0];
    expect(piParams.customer).toBe("cus_existing_1307");
    expect(piParams.setup_future_usage).toBe("off_session");
    expect(piOpts.idempotencyKey).toContain(sessionId);
    expect(piOpts.idempotencyKey).toContain("cust-save");
  });

  it("reports a recovered already-succeeded intent so a reloaded buyer is not double-charged", async () => {
    mockPaymentIntentsCreate.mockResolvedValue({ id: "pi_1307", client_secret: "cs_1307", status: "succeeded" });
    const sessionId = await createSession({ productSlug: MONITORING_SMB_SLUG, seats: 60 });
    const app = await buildApp();

    const res = await request(app).post("/api/public/purchase/payment-intent").send({ sessionId });

    expect(res.status).toBe(200);
    expect(res.body.alreadyPaid).toBe(true);
  });
});

// ── Retainer: fixed price, and #1311's lawful consent skip ────────────────────

describe("payment-intent — retainer", () => {
  it("charges the retainer row's real fixed price for a session that SKIPPED consent (no tenant at all)", async () => {
    const sessionId = await createSession({
      productSlug: RETAINER_SLUG,
      status: "pending",
      tenantId: null,
      consentSkippedAt: new Date(),
    });
    const row = await loadService(RETAINER_SLUG);
    const expected = resolveServicePriceCents(row);
    expect(expected).toBeGreaterThan(0);

    const app = await buildApp();
    const res = await request(app).post("/api/public/purchase/payment-intent").send({ sessionId });

    expect(res.status).toBe(200);
    expect(res.body.amountCents).toBe(expected);
    expect(res.body.productType).toBe("retainer");
    expect(res.body.billingInterval).toBe("month");
    const [piParams] = mockPaymentIntentsCreate.mock.calls[0];
    expect(piParams.amount).toBe(expected);
    // No tenant → anonymous intent, and no card kept without a customer to keep it on.
    expect(piParams).not.toHaveProperty("customer");
    expect(piParams).not.toHaveProperty("setup_future_usage");
  });

  it("still requires consent when the session neither consented nor recorded a skip", async () => {
    const sessionId = await createSession({ productSlug: RETAINER_SLUG, status: "pending", tenantId: null });
    const app = await buildApp();

    const res = await request(app).post("/api/public/purchase/payment-intent").send({ sessionId });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("consent_required");
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
  });
});

// ── Packs: summed real config_pack rows, fail-closed on anything else ─────────

describe("payment-intent — packs", () => {
  it("sums the session's pack plus validated extras — including an untagged (service_type NULL) real pack", async () => {
    const sessionId = await createSession({ productSlug: PACK_SESSION_SLUG });
    const slugs = [PACK_SESSION_SLUG, PACK_EXTRA_TAGGED, PACK_EXTRA_UNTAGGED];
    let expected = 0;
    for (const slug of slugs) expected += resolveServicePriceCents(await loadService(slug));
    expect(expected).toBeGreaterThan(0);

    const app = await buildApp();
    const res = await request(app)
      .post("/api/public/purchase/payment-intent")
      .send({ sessionId, packSlugs: [PACK_EXTRA_TAGGED, PACK_EXTRA_UNTAGGED] });

    expect(res.status).toBe(200);
    expect(res.body.amountCents).toBe(expected);
    expect(res.body.productType).toBe("pack");
    expect(res.body.billingInterval).toBeNull();
    expect(res.body.lineItems).toHaveLength(3);
    const [piParams] = mockPaymentIntentsCreate.mock.calls[0];
    expect(piParams.amount).toBe(expected);
    expect(piParams.metadata.packSlugs.split(",").sort()).toEqual([...slugs].sort());
    // One-time charge: never asks to keep the card.
    expect(piParams).not.toHaveProperty("setup_future_usage");
  });

  it("rejects the WHOLE order when any slug has no real config_pack row behind it (#1304's not-yet-real packs)", async () => {
    const sessionId = await createSession({ productSlug: PACK_SESSION_SLUG });
    const app = await buildApp();

    // "mfa-enforcement-pack-v1" was this test's original not-yet-real slug,
    // but #1182 (lib/db/migrations/manual/2026-08-26-mfa-enforcement-pack-1182.sql)
    // built it as a genuine config_pack row, so it no longer proves the
    // fail-closed path. Swapped for a slug guaranteed to never be real.
    const res = await request(app)
      .post("/api/public/purchase/payment-intent")
      .send({ sessionId, packSlugs: [PACK_EXTRA_TAGGED, "definitely-not-a-real-pack-v1"] });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("pack_not_found");
    expect(res.body.packSlugs).toEqual(["definitely-not-a-real-pack-v1"]);
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("rejects a REAL services row that is not a config_pack offered as a pack slug", async () => {
    const sessionId = await createSession({ productSlug: PACK_SESSION_SLUG });
    const app = await buildApp();

    const res = await request(app)
      .post("/api/public/purchase/payment-intent")
      .send({ sessionId, packSlugs: [ASSESSMENT_SLUG] });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("pack_not_found");
    expect(res.body.packSlugs).toEqual([ASSESSMENT_SLUG]);
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("rejects packSlugs on a non-pack session", async () => {
    const sessionId = await createSession({ productSlug: RETAINER_SLUG });
    const app = await buildApp();

    const res = await request(app)
      .post("/api/public/purchase/payment-intent")
      .send({ sessionId, packSlugs: [PACK_EXTRA_TAGGED] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("packs_not_applicable");
  });
});

// ── Fail-closed product gate ──────────────────────────────────────────────────

describe("payment-intent — unsupported products", () => {
  it("refuses a session whose product has no pricing rule on this route (assessments stay on /public/flow)", async () => {
    const sessionId = await createSession({ productSlug: ASSESSMENT_SLUG });
    const app = await buildApp();

    const res = await request(app).post("/api/public/purchase/payment-intent").send({ sessionId });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("product_not_supported");
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("rejects a non-UUID session id and an expired session", async () => {
    const app = await buildApp();
    const bad = await request(app).post("/api/public/purchase/payment-intent").send({ sessionId: "nope" });
    expect(bad.status).toBe(400);

    const expiredId = await createSession({ expiresAt: new Date(Date.now() - 1000) });
    const expired = await request(app).post("/api/public/purchase/payment-intent").send({ sessionId: expiredId });
    expect(expired.status).toBe(404);
    expect(expired.body.error).toBe("session_expired");
  });
});

// ── The confirm handshake: the client's word is not evidence ──────────────────

describe("payment-confirmed", () => {
  it("marks paid only after Stripe itself reports succeeded for THIS session and THIS flow", async () => {
    const sessionId = await createSession({ productSlug: MONITORING_SMB_SLUG, seats: 60 });
    const row = await loadService(MONITORING_SMB_SLUG);
    const amount = resolveTypeAttributesMonthlyPriceCents(row, 60);
    mockPaymentIntentsRetrieve.mockResolvedValue({
      id: "pi_1307",
      status: "succeeded",
      amount_received: amount,
      metadata: { checkoutSessionId: sessionId, flow: "buy_purchase_flow", serviceIds: String(row.id) },
    });

    const app = await buildApp();
    const res = await request(app)
      .post("/api/public/purchase/payment-confirmed")
      .send({ sessionId, paymentIntentId: "pi_1307" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, amountCents: amount, productType: "monitoring" });

    const [dbRow] = await db
      .select({ status: checkoutSessionsTable.status })
      .from(checkoutSessionsTable)
      .where(eq(checkoutSessionsTable.id, sessionId))
      .limit(1);
    expect(dbRow.status).toBe("paid");
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "purchase_flow_payment_succeeded", entityId: sessionId }),
    );
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it("refuses an intent whose metadata names a DIFFERENT session", async () => {
    const sessionId = await createSession({ productSlug: MONITORING_SMB_SLUG, seats: 60 });
    mockPaymentIntentsRetrieve.mockResolvedValue({
      id: "pi_other",
      status: "succeeded",
      amount_received: 1,
      metadata: { checkoutSessionId: randomUUID(), flow: "buy_purchase_flow" },
    });

    const app = await buildApp();
    const res = await request(app)
      .post("/api/public/purchase/payment-confirmed")
      .send({ sessionId, paymentIntentId: "pi_other" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("intent_session_mismatch");
  });

  it("refuses a same-session intent minted by a DIFFERENT flow", async () => {
    const sessionId = await createSession({ productSlug: MONITORING_SMB_SLUG, seats: 60 });
    mockPaymentIntentsRetrieve.mockResolvedValue({
      id: "pi_assessment",
      status: "succeeded",
      amount_received: 1,
      metadata: { checkoutSessionId: sessionId, flow: "home_assessment_flow" },
    });

    const app = await buildApp();
    const res = await request(app)
      .post("/api/public/purchase/payment-confirmed")
      .send({ sessionId, paymentIntentId: "pi_assessment" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("intent_flow_mismatch");
  });

  it("does NOT trust a client success claim when Stripe says the intent has not succeeded", async () => {
    const sessionId = await createSession({ productSlug: MONITORING_SMB_SLUG, seats: 60 });
    mockPaymentIntentsRetrieve.mockResolvedValue({
      id: "pi_1307",
      status: "requires_payment_method",
      metadata: { checkoutSessionId: sessionId, flow: "buy_purchase_flow" },
    });

    const app = await buildApp();
    const res = await request(app)
      .post("/api/public/purchase/payment-confirmed")
      .send({ sessionId, paymentIntentId: "pi_1307" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("payment_not_succeeded");
    const [dbRow] = await db
      .select({ status: checkoutSessionsTable.status })
      .from(checkoutSessionsTable)
      .where(eq(checkoutSessionsTable.id, sessionId))
      .limit(1);
    expect(dbRow.status).toBe("consented"); // never marked paid on the client's word
  });

  it("treats a replayed confirm on an already-paid session as a no-op, not a second fulfilment", async () => {
    const sessionId = await createSession({ productSlug: RETAINER_SLUG, status: "paid" });
    const row = await loadService(RETAINER_SLUG);
    mockPaymentIntentsRetrieve.mockResolvedValue({
      id: "pi_1307",
      status: "succeeded",
      amount_received: resolveServicePriceCents(row),
      metadata: { checkoutSessionId: sessionId, flow: "buy_purchase_flow", serviceIds: String(row.id) },
    });

    const app = await buildApp();
    const res = await request(app)
      .post("/api/public/purchase/payment-confirmed")
      .send({ sessionId, paymentIntentId: "pi_1307" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockCreateAuditLog).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("names the full paid pack set from the intent's own server-written metadata", async () => {
    const sessionId = await createSession({ productSlug: PACK_SESSION_SLUG });
    const slugs = [PACK_SESSION_SLUG, PACK_EXTRA_TAGGED, PACK_EXTRA_UNTAGGED];
    let amount = 0;
    for (const slug of slugs) amount += resolveServicePriceCents(await loadService(slug));
    mockPaymentIntentsRetrieve.mockResolvedValue({
      id: "pi_1307",
      status: "succeeded",
      amount_received: amount,
      metadata: {
        checkoutSessionId: sessionId,
        flow: "buy_purchase_flow",
        packSlugs: slugs.join(","),
      },
    });

    const app = await buildApp();
    const res = await request(app)
      .post("/api/public/purchase/payment-confirmed")
      .send({ sessionId, paymentIntentId: "pi_1307" });

    expect(res.status).toBe(200);
    expect(res.body.amountCents).toBe(amount);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ packSlugs: slugs }),
      }),
    );
  });
});
