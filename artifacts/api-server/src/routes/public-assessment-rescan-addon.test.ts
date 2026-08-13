/**
 * public-assessment-rescan-addon.test.ts — #490.
 *
 * Drives the REAL express handlers in public-assessment-payment.ts (db and the
 * Stripe SDK are the only things mocked) and asserts the two things that carry
 * money:
 *
 *   - the Stripe call SHAPES: one customer, a PaymentIntent that hangs off it,
 *     `setup_future_usage` asked for ONLY on the opt-in path, and a monthly
 *     Subscription created against that same customer with the price the buyer
 *     actually agreed to;
 *   - that the declined path is byte-for-byte the pre-#490 flow — no customer
 *     reuse surprises, no saved card, no subscription.
 *
 * The catalog-pricing module is deliberately NOT mocked: the add-on's price has
 * to resolve through the same real resolver the rest of checkout uses, because
 * every existing `recurring_addon` row in this catalog prices itself through
 * `type_attributes.flatMonthlyPrice` with all flat price columns NULL — a
 * resolver that only read the flat columns would read the add-on as free.
 *
 * Run: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

process.env["DATABASE_URL"] = "postgres://test";

const SESSION_ID = "11111111-2222-4333-8444-555555555555";
const TENANT_GUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TENANT_ROW_ID = 77;
const ASSESSMENT_SERVICE_ID = 6800;
const ADDON_SERVICE_ID = 9001;

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockDbSelect, mockDbInsert, mockDbUpdate } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbInsert: vi.fn(),
  mockDbUpdate: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { select: mockDbSelect, insert: mockDbInsert, update: mockDbUpdate },
  checkoutSessionsTable: {
    id: "id", status: "status", email: "email", fullName: "full_name", company: "company",
    tenantId: "tenant_id", productSlug: "product_slug", expiresAt: "expires_at",
    updatedAt: "updated_at",
    rescanAddonOptIn: "rescan_addon_opt_in",
    rescanAddonServiceId: "rescan_addon_service_id",
    rescanAddonPriceCents: "rescan_addon_price_cents",
    rescanSubscriptionId: "rescan_subscription_id",
  },
  servicesTable: {
    id: "id", slug: "slug", name: "name", description: "description",
    priceCents: "price_cents", price: "price", basePrice: "base_price",
    typeAttributes: "type_attributes", inclusions: "inclusions", features: "features",
    deliverables: "deliverables", isFreeOffering: "is_free_offering",
  },
  tenantsTable: { id: "id", tenantId: "tenant_id", stripeCustomerId: "stripe_customer_id", updatedAt: "updated_at" },
  usersTable: { id: "id", email: "email" },
  clientServicesTable: { id: "id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((c: unknown, v: unknown) => ({ eq: [c, v] })),
  and: vi.fn((...a: unknown[]) => ({ and: a })),
  gte: vi.fn((c: unknown, v: unknown) => ({ gte: [c, v] })),
}));

vi.mock("../lib/stripe", () => ({
  getStripeKey: vi.fn().mockReturnValue("sk_test_xxx"),
  getStripePublishableKey: vi.fn().mockReturnValue("pk_test_xxx"),
}));

vi.mock("../lib/logger", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock("../lib/audit", () => ({ createAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/mailer", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  purchaseConfirmationEmail: vi.fn().mockReturnValue("<html></html>"),
}));
vi.mock("../lib/crm-pipeline", () => ({ markAssessmentLeadPurchased: vi.fn().mockResolvedValue(undefined) }));

const mockCustomersCreate = vi.fn();
const mockPaymentIntentsCreate = vi.fn();
const mockPaymentIntentsRetrieve = vi.fn();
const mockProductsCreate = vi.fn();
const mockSubscriptionsCreate = vi.fn();

vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(function () {
    return {
      customers: { create: mockCustomersCreate },
      paymentIntents: { create: mockPaymentIntentsCreate, retrieve: mockPaymentIntentsRetrieve },
      products: { create: mockProductsCreate },
      subscriptions: { create: mockSubscriptionsCreate },
    };
  }),
}));

// ── DB chain plumbing ─────────────────────────────────────────────────────────

function selectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(rows)),
    then: (resolve: (v: unknown[]) => void) => Promise.resolve(rows).then(resolve),
  };
  return chain;
}

/** Each entry answers the NEXT db.select() call, in order. */
let selectQueue: unknown[][] = [];

function queueSelects(...batches: unknown[][]) {
  selectQueue = batches;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const paidSession = {
  id: SESSION_ID,
  status: "consented",
  email: "buyer@example.com",
  fullName: "Real Buyer",
  company: "Contoso",
  tenantId: TENANT_GUID,
  productSlug: "copilot-readiness-assessment",
};

const assessmentService = {
  id: ASSESSMENT_SERVICE_ID,
  name: "Copilot Readiness Assessment",
  priceCents: null,
  price: null,
  basePrice: "5000.00",
  isFreeOffering: false,
  typeAttributes: null,
};

/** Priced exactly the way every existing `recurring_addon` row in the live
 *  catalog is: flat columns NULL, real price in type_attributes. */
const addonService = {
  id: ADDON_SERVICE_ID,
  slug: "copilot-assessment-recurring-rescan",
  name: "Copilot Readiness — Recurring Rescan",
  description: "Weekly re-scan of the tenant, tracked over time.",
  priceCents: null,
  price: null,
  basePrice: null,
  typeAttributes: { flatMonthlyPrice: "250.00" },
  inclusions: ["Weekly read-only re-scan", "Drift kept over time"],
  features: null,
  deliverables: null,
  isFreeOffering: false,
};

const ADDON_CENTS = 25_000;

const noSelection = { optIn: null, serviceId: null, priceCents: null, subscriptionId: null };
const optedInSelection = { optIn: true, serviceId: ADDON_SERVICE_ID, priceCents: ADDON_CENTS, subscriptionId: null };
const declinedSelection = { optIn: false, serviceId: null, priceCents: null, subscriptionId: null };

async function buildApp() {
  const { default: router } = await import("./public-assessment-payment.ts");
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue = [];
  mockDbSelect.mockImplementation(() => selectChain(selectQueue.shift() ?? []));
  mockDbUpdate.mockImplementation(() => ({ set: () => ({ where: () => Promise.resolve() }) }));
  mockDbInsert.mockImplementation(() => ({ values: () => Promise.resolve() }));
  mockCustomersCreate.mockResolvedValue({ id: "cus_new" });
  mockPaymentIntentsCreate.mockResolvedValue({ id: "pi_1", client_secret: "cs_1", status: "requires_payment_method" });
  mockProductsCreate.mockResolvedValue({ id: "prod_1" });
  mockSubscriptionsCreate.mockResolvedValue({ id: "sub_1", status: "active" });
});

// ── The offer ─────────────────────────────────────────────────────────────────

describe("GET /api/public/flow/rescan-addon", () => {
  it("reports unavailable — not an error — when no catalog row exists (the state as of #490 shipping)", async () => {
    queueSelects([paidSession], [assessmentService], [{ id: TENANT_ROW_ID }], [], [noSelection]);
    const app = await buildApp();

    const res = await request(app).get(`/api/public/flow/rescan-addon?sessionId=${SESSION_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.reason).toBe("not_in_catalog");
    expect(res.body).not.toHaveProperty("priceCents");
  });

  it("reports unavailable rather than offering a row that carries no price", async () => {
    queueSelects(
      [paidSession],
      [assessmentService],
      [{ id: TENANT_ROW_ID }],
      [{ ...addonService, typeAttributes: null }],
      [noSelection],
    );
    const app = await buildApp();

    const res = await request(app).get(`/api/public/flow/rescan-addon?sessionId=${SESSION_ID}`);

    expect(res.body).toMatchObject({ available: false, reason: "unpriced" });
  });

  it("resolves the price out of type_attributes, the way every recurring_addon row in this catalog is priced", async () => {
    queueSelects([paidSession], [assessmentService], [{ id: TENANT_ROW_ID }], [addonService], [noSelection]);
    const app = await buildApp();

    const res = await request(app).get(`/api/public/flow/rescan-addon?sessionId=${SESSION_ID}`);

    expect(res.body).toMatchObject({
      available: true,
      priceCents: ADDON_CENTS,
      interval: "month",
      optIn: null,
    });
    expect(res.body.included).toEqual(["Weekly read-only re-scan", "Drift kept over time"]);
  });
});

// ── The decision ──────────────────────────────────────────────────────────────

describe("POST /api/public/flow/rescan-addon-decision", () => {
  it("refuses an opt-in when there is nothing priced to opt into", async () => {
    queueSelects([paidSession], [assessmentService], [{ id: TENANT_ROW_ID }], []);
    const app = await buildApp();

    const res = await request(app)
      .post("/api/public/flow/rescan-addon-decision")
      .send({ sessionId: SESSION_ID, optIn: true });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("addon_unavailable");
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("snapshots the agreed price on opt-in", async () => {
    queueSelects([paidSession], [assessmentService], [{ id: TENANT_ROW_ID }], [addonService]);
    const setSpy = vi.fn(() => ({ where: () => Promise.resolve() }));
    mockDbUpdate.mockImplementation(() => ({ set: setSpy }));
    const app = await buildApp();

    const res = await request(app)
      .post("/api/public/flow/rescan-addon-decision")
      .send({ sessionId: SESSION_ID, optIn: true });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, optIn: true, priceCents: ADDON_CENTS });
    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        rescanAddonOptIn: true,
        rescanAddonServiceId: ADDON_SERVICE_ID,
        rescanAddonPriceCents: ADDON_CENTS,
      }),
    );
  });

  it("records a decline without needing the catalog at all", async () => {
    queueSelects([paidSession], [assessmentService], [{ id: TENANT_ROW_ID }]);
    const setSpy = vi.fn(() => ({ where: () => Promise.resolve() }));
    mockDbUpdate.mockImplementation(() => ({ set: setSpy }));
    const app = await buildApp();

    const res = await request(app)
      .post("/api/public/flow/rescan-addon-decision")
      .send({ sessionId: SESSION_ID, optIn: false });

    expect(res.status).toBe(200);
    expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ rescanAddonOptIn: false }));
  });
});

// ── The PaymentIntent ─────────────────────────────────────────────────────────

describe("POST /api/public/flow/payment-intent", () => {
  it("creates ONE Stripe customer and charges against it, without saving the card, when the add-on was declined", async () => {
    queueSelects(
      [paidSession],
      [assessmentService],
      [{ id: TENANT_ROW_ID }],
      [declinedSelection],
      [{ stripeCustomerId: null }],
    );
    const app = await buildApp();

    const res = await request(app).post("/api/public/flow/payment-intent").send({ sessionId: SESSION_ID });

    expect(res.status).toBe(200);
    expect(mockCustomersCreate).toHaveBeenCalledTimes(1);
    const [piParams] = mockPaymentIntentsCreate.mock.calls[0];
    expect(piParams.customer).toBe("cus_new");
    expect(piParams.amount).toBe(500_000);
    expect(piParams).not.toHaveProperty("setup_future_usage");
    expect(piParams.metadata.rescanAddon).toBe("declined");
    expect(res.body.rescanAddOn).toBeNull();
  });

  it("asks Stripe to keep the card on file ONLY when the buyer opted in", async () => {
    queueSelects(
      [paidSession],
      [assessmentService],
      [{ id: TENANT_ROW_ID }],
      [optedInSelection],
      [{ stripeCustomerId: null }],
    );
    const app = await buildApp();

    const res = await request(app).post("/api/public/flow/payment-intent").send({ sessionId: SESSION_ID });

    const [piParams, piOpts] = mockPaymentIntentsCreate.mock.calls[0];
    expect(piParams.customer).toBe("cus_new");
    expect(piParams.setup_future_usage).toBe("off_session");
    expect(piParams.metadata.rescanAddon).toBe("opted_in");
    // The decision is part of the idempotency identity: changing it must mint a
    // new intent rather than replay a key with different parameters.
    expect(piOpts.idempotencyKey).toContain("save");
    expect(res.body.rescanAddOn).toEqual({ priceCents: ADDON_CENTS, interval: "month" });
  });

  it("reuses an existing Stripe customer instead of minting a second one", async () => {
    queueSelects(
      [paidSession],
      [assessmentService],
      [{ id: TENANT_ROW_ID }],
      [optedInSelection],
      [{ stripeCustomerId: "cus_existing" }],
    );
    const app = await buildApp();

    await request(app).post("/api/public/flow/payment-intent").send({ sessionId: SESSION_ID });

    expect(mockCustomersCreate).not.toHaveBeenCalled();
    expect(mockPaymentIntentsCreate.mock.calls[0][0].customer).toBe("cus_existing");
  });

  it("still takes the payment when the add-on columns are unreadable (migration not yet run)", async () => {
    queueSelects([paidSession], [assessmentService], [{ id: TENANT_ROW_ID }]);
    // 4th select (the add-on decision) and 5th (the customer column) both throw.
    let call = 0;
    mockDbSelect.mockImplementation(() => {
      call += 1;
      if (call >= 4) throw new Error('column "rescan_addon_opt_in" does not exist');
      return selectChain(selectQueue.shift() ?? []);
    });
    const app = await buildApp();

    const res = await request(app).post("/api/public/flow/payment-intent").send({ sessionId: SESSION_ID });

    expect(res.status).toBe(200);
    const [piParams] = mockPaymentIntentsCreate.mock.calls[0];
    expect(piParams.amount).toBe(500_000);
    expect(piParams).not.toHaveProperty("customer");
    expect(piParams).not.toHaveProperty("setup_future_usage");
    expect(res.body.rescanAddOn).toBeNull();
  });
});

// ── The Subscription ──────────────────────────────────────────────────────────

const succeededIntent = {
  id: "pi_1",
  status: "succeeded",
  amount_received: 500_000,
  customer: "cus_new",
  payment_method: "pm_saved",
  metadata: { checkoutSessionId: SESSION_ID },
};

describe("POST /api/public/flow/payment-confirmed", () => {
  it("creates a monthly subscription on the SAME customer, funded by the card just used", async () => {
    mockPaymentIntentsRetrieve.mockResolvedValue(succeededIntent);
    queueSelects(
      [paidSession],
      [assessmentService],
      [{ id: TENANT_ROW_ID }],
      [optedInSelection], // createRescanSubscription → loadRescanSelection
      [addonService], // the drift check against the live catalog price
      [{ id: 501 }], // the buyer's users row
    );
    const insertValues = vi.fn(() => Promise.resolve());
    mockDbInsert.mockImplementation(() => ({ values: insertValues }));
    const app = await buildApp();

    const res = await request(app)
      .post("/api/public/flow/payment-confirmed")
      .send({ sessionId: SESSION_ID, paymentIntentId: "pi_1" });

    expect(res.status).toBe(200);
    expect(res.body.rescanAddOn).toMatchObject({ status: "created", subscriptionId: "sub_1" });

    const [subParams, subOpts] = mockSubscriptionsCreate.mock.calls[0];
    expect(subParams.customer).toBe("cus_new");
    expect(subParams.default_payment_method).toBe("pm_saved");
    expect(subParams.items[0].price_data).toMatchObject({
      currency: "usd",
      product: "prod_1",
      recurring: { interval: "month" },
      unit_amount: ADDON_CENTS,
    });
    expect(subOpts.idempotencyKey).toBe(`home-assessment-flow:sub:${SESSION_ID}`);

    // Mirrored into client_services — the existing home for a direct
    // customer's recurring purchases, no new table.
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        clientUserId: 501,
        serviceId: ADDON_SERVICE_ID,
        stripeSubscriptionId: "sub_1",
        billingInterval: "month",
      }),
    );
  });

  it("charges the price the buyer agreed to, not a catalog price edited since", async () => {
    mockPaymentIntentsRetrieve.mockResolvedValue(succeededIntent);
    queueSelects(
      [paidSession],
      [assessmentService],
      [{ id: TENANT_ROW_ID }],
      [optedInSelection],
      [{ ...addonService, typeAttributes: { flatMonthlyPrice: "999.00" } }],
      [{ id: 501 }],
    );
    const app = await buildApp();

    await request(app)
      .post("/api/public/flow/payment-confirmed")
      .send({ sessionId: SESSION_ID, paymentIntentId: "pi_1" });

    expect(mockSubscriptionsCreate.mock.calls[0][0].items[0].price_data.unit_amount).toBe(ADDON_CENTS);
  });

  it("creates nothing recurring when the buyer declined", async () => {
    mockPaymentIntentsRetrieve.mockResolvedValue({ ...succeededIntent, customer: null, payment_method: null });
    queueSelects([paidSession], [assessmentService], [{ id: TENANT_ROW_ID }], [declinedSelection]);
    const app = await buildApp();

    const res = await request(app)
      .post("/api/public/flow/payment-confirmed")
      .send({ sessionId: SESSION_ID, paymentIntentId: "pi_1" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.amountCents).toBe(500_000);
    expect(mockSubscriptionsCreate).not.toHaveBeenCalled();
    expect(mockProductsCreate).not.toHaveBeenCalled();
    expect(res.body.rescanAddOn).toEqual({ status: "not_requested" });
  });

  it("does not create a second subscription on a replayed confirm", async () => {
    mockPaymentIntentsRetrieve.mockResolvedValue(succeededIntent);
    queueSelects(
      [{ ...paidSession, status: "paid" }],
      [assessmentService],
      [{ id: TENANT_ROW_ID }],
      [{ ...optedInSelection, subscriptionId: "sub_1" }],
    );
    const app = await buildApp();

    const res = await request(app)
      .post("/api/public/flow/payment-confirmed")
      .send({ sessionId: SESSION_ID, paymentIntentId: "pi_1" });

    expect(mockSubscriptionsCreate).not.toHaveBeenCalled();
    expect(res.body.rescanAddOn).toEqual({ status: "already", subscriptionId: "sub_1" });
  });

  it("reports the purchase as SUCCESSFUL when only the add-on fails — the assessment was paid for", async () => {
    mockPaymentIntentsRetrieve.mockResolvedValue(succeededIntent);
    mockSubscriptionsCreate.mockRejectedValue(new Error("card declined for subscription"));
    queueSelects(
      [paidSession],
      [assessmentService],
      [{ id: TENANT_ROW_ID }],
      [optedInSelection],
      [addonService],
    );
    const app = await buildApp();

    const res = await request(app)
      .post("/api/public/flow/payment-confirmed")
      .send({ sessionId: SESSION_ID, paymentIntentId: "pi_1" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.amountCents).toBe(500_000);
    expect(res.body.rescanAddOn).toEqual({ status: "failed", reason: "stripe_error" });
  });
});
