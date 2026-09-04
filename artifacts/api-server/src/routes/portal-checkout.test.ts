/**
 * portal-checkout.test.ts
 *
 * Unit tests for the customer-initiated checkout endpoint.
 *
 * Covers all four checkout branches:
 *   1. add_on  — non-zero price → Stripe payment checkout session created
 *   2. subscription — non-zero price + trialPeriodDays → Stripe subscription checkout
 *   3. $0 (free) — skips Stripe, rate-limits, calls resolveFulfillment
 *   4. project  — creates MSP SOW, returns shareToken
 *
 * Rate-limit scenarios:
 *   5. email rate-limit (1 per 90 days) → 429
 *   6. IP rate-limit (3 per 24 h) → 429
 *
 * Guard cases:
 *   7. 404 for unknown offer / wrong customer
 *   8. 422 for non-sent offer
 *   9. 401 without auth
 *
 * Run: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import express, { type IRouter } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

// #2876 — the one `await import("./portal-checkout")` this file needs is paid
// for exactly once, in the beforeAll below, NOT inside a test body. When it sat
// inside makeApp() (called per test) the route module's cold Vite transform was
// billed against the first test's 5000ms budget; on a loaded machine that
// transform takes 15-40s, so the first several tests all timed out waiting on
// the same in-flight import — and then the first test to run AFTER it resolved
// got a 500, because the timed-out tests' handlers resumed and consumed the
// mockReturnValueOnce() chains that test had just queued in beforeEach. That
// cascade is what #2876 saw as "expected 500 to be 200" — a consequence of the
// import timeout, not a checkout defect (full analysis on the issue).
// Hoisting the import into a hook removes the cascade entirely: a slow
// transform can now only make one hook slow, never corrupt a test's mock queue.
// The raised budgets are the backstop for that hook on a saturated box, scoped
// to this file only rather than a global vitest.config.ts change (same
// precedent as #2865).
vi.setConfig({ testTimeout: 20_000, hookTimeout: 120_000 });

// ── Env setup ─────────────────────────────────────────────────────────────────

const JWT_SECRET = "portal-checkout-test-secret";
process.env["JWT_SECRET"] = JWT_SECRET;
process.env["DATABASE_URL"] = "postgres://test";

const CUSTOMER_ID = 42;
const MSP_ID = 10;
const SERVICE_ID = 7;

const customerToken = jwt.sign(
  {
    id: 1,
    email: "customer@example.com",
    role: "client",
    mspRole: "CustomerUser",
    customerId: CUSTOMER_ID,
    mspId: MSP_ID,
  },
  JWT_SECRET,
  { expiresIn: "1h" },
);

// ── vi.hoisted: shared mock functions available to vi.mock() factories ────────
// vi.hoisted() runs before vi.mock() factories, making these variables available
// inside factory closures without triggering the temporal dead zone.

const {
  mockDbSelect,
  mockDbInsert,
  mockDbUpdate,
  mockResolveFulfillment,
  mockStripeSessionCreate,
} = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbInsert: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockResolveFulfillment: vi.fn(),
  mockStripeSessionCreate: vi.fn(),
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
  },
  salesOffersTable: {
    id: "id", tenantId: "tenant_id", mspId: "msp_id", serviceId: "service_id",
    title: "title", adjustedPriceCents: "adjusted_price_cents", state: "state",
    trialPeriodDays: "trial_period_days",
    internalCostCents: "internal_cost_cents",
    priceCents: "price_cents",
  },
  servicesTable: {
    id: "id", name: "name", description: "description", serviceClass: "service_class",
    fulfillmentTypeKey: "fulfillment_type_key", allowFreeCheckout: "allow_free_checkout",
    trialPeriodDays: "trial_period_days",
    internalCostCents: "internal_cost_cents",
    priceCents: "price_cents",
  },
  mspSowsTable: {
    sowId: "sow_id", offerId: "offer_id", mspId: "msp_id", customerId: "customer_id",
    customerUserId: "customer_user_id", serviceId: "service_id",
  },
  mspSowEventsTable: { sowId: "sow_id", eventName: "event_name" },
  mspConnectorConfigsTable: {
    mspId: "msp_id", customerAgreementTemplate: "customer_agreement_template",
  },
  tenantsTable: { id: "id", mspId: "msp_id" },
  mspsTable: { id: "id", customCustomerAgreement: "custom_customer_agreement" },
  mspEventStoreTable: { id: "id" },
  freeCheckoutAttemptsTable: {
    id: "id", offerId: "offer_id", customerEmail: "customer_email",
    ipAddress: "ip_address", mspId: "msp_id", createdAt: "created_at",
  },
  platformAgreementsTable: {
    id: "id", version: "version", title: "title", isCurrentVersion: "is_current_version",
  },
  mspAgreementAcceptancesTable: {
    mspId: "msp_id", userId: "user_id", agreementVersion: "agreement_version",
  },
  mspSubscriptionsTable: {
    id: "id", mspId: "msp_id", stripeCustomerId: "stripe_customer_id",
  },
  usersTable: {
    id: "id", mspId: "msp_id",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => ({ eq: [_col, _val] })),
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  or: vi.fn((...args: unknown[]) => ({ or: args })),
  count: vi.fn(() => ({ count: true })),
  gte: vi.fn((_col: unknown, _val: unknown) => ({ gte: [_col, _val] })),
}));

vi.mock("../lib/resolve-fulfillment", () => ({
  resolveFulfillment: mockResolveFulfillment,
}));

vi.mock("../lib/sales-offer-engine", () => ({
  transitionOfferState: vi.fn(),
}));

vi.mock("../lib/sse-channels", () => ({
  broadcastCustomerOfferChange: vi.fn(),
  broadcastMspOfferChange: vi.fn(),
  registerCustomerOfferSSEClient: vi.fn(),
}));

vi.mock("../lib/workflow-executor", () => ({
  emitWorkflowEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/logger", () => {
  const stub = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});

// #2876 — verifyCaptchaToken() makes a REAL outbound HTTPS POST to
// challenges.cloudflare.com whenever TURNSTILE_SECRET_KEY is set in the
// environment the tests run in; it only short-circuits because that variable
// happens to be unset locally. Every test below except the 401 guard reaches
// this call, so leaving it unmocked makes the whole file depend on an env var
// being absent and on Cloudflare being reachable. Mocked to the same
// bypassed-success shape the real function returns when the key is missing.
vi.mock("../lib/captcha", () => ({
  verifyCaptchaToken: vi.fn().mockResolvedValue({ success: true, bypassed: true }),
}));

// #2876 — portal-checkout.ts imports provisionDirectMarketingPurchase and
// DIRECT_MARKETING_CHECKOUT_KIND from ./portal-checkout-direct, whose own
// import graph pulls in mailer.ts -> graph.ts, tenant-signals.ts (1,864 lines)
// -> sla-engine.ts, and crm-pipeline.ts -> zoho-lead-sync/zoho-client. That is
// the entire outbound-email + Microsoft Graph + Zoho stack being transformed
// for a checkout unit test that mocks Stripe and the database, and it was the
// bulk of the cold-transform cost behind #2876's timeouts. Neither export is
// exercised by the ten tests here (both are reached only from the Stripe
// webhook's direct-marketing branch), so the module is stubbed out.
// DIRECT_MARKETING_CHECKOUT_KIND mirrors the real literal at
// portal-checkout-direct.ts:69.
vi.mock("./portal-checkout-direct", () => ({
  DIRECT_MARKETING_CHECKOUT_KIND: "direct_marketing",
  provisionDirectMarketingPurchase: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/stripe", () => ({
  getStripeKey: vi.fn().mockReturnValue("sk_test_xxx"),
  getMspDefaultPaymentMethod: vi.fn().mockResolvedValue("pm_test"),
}));

const mockStripeProductsCreate = vi.fn().mockResolvedValue({ id: "prod_test" });
const mockStripeSubscriptionsCreate = vi.fn().mockResolvedValue({ id: "sub_test", status: "active" });
const mockStripePaymentIntentsCreate = vi.fn().mockResolvedValue({ id: "pi_test", status: "succeeded" });
const mockStripeCustomersRetrieve = vi.fn().mockResolvedValue({
  invoice_settings: { default_payment_method: "pm_test" }
});
const mockStripePaymentMethodsList = vi.fn().mockResolvedValue({
  data: [{ id: "pm_test" }]
});

vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(function () {
    return {
      checkout: { sessions: { create: mockStripeSessionCreate } },
      webhooks: { constructEvent: vi.fn() },
      products: { create: mockStripeProductsCreate },
      subscriptions: { create: mockStripeSubscriptionsCreate },
      paymentIntents: { create: mockStripePaymentIntentsCreate },
      customers: { retrieve: mockStripeCustomersRetrieve },
      paymentMethods: { list: mockStripePaymentMethodsList },
    };
  }),
}));

// ── Fixture offers ────────────────────────────────────────────────────────────

const baseSentOffer = {
  id: 1,
  tenantId: CUSTOMER_ID,
  mspId: MSP_ID,
  serviceId: SERVICE_ID,
  title: "Microsoft 365 Security Audit",
  adjustedPriceCents: 150_000,
  state: "sent",
  trialPeriodDays: null,
};

const freeOffer = { ...baseSentOffer, id: 2, adjustedPriceCents: 0 };
const projectOffer = { ...baseSentOffer, id: 3, adjustedPriceCents: 500_000 };
const subscriptionOffer = { ...baseSentOffer, id: 4, adjustedPriceCents: 9_900, trialPeriodDays: 14 };
const acceptedOffer = { ...baseSentOffer, id: 5, state: "accepted" };

const addOnService = {
  name: "M365 Security Audit",
  description: "Comprehensive audit",
  serviceClass: "add_on",
  fulfillmentTypeKey: "assessment",
  allowFreeCheckout: true,
  trialPeriodDays: null,
};
const subscriptionService = { ...addOnService, serviceClass: "subscription", fulfillmentTypeKey: "bundle_subscription", trialPeriodDays: 7 };
const freeService = { ...addOnService, serviceClass: "add_on", fulfillmentTypeKey: "assessment", allowFreeCheckout: true };
const projectService = { ...addOnService, serviceClass: "project", fulfillmentTypeKey: "retainer" };

// ── DB chain helpers ──────────────────────────────────────────────────────────

/**
 * Returns a thenable drizzle-like query chain.
 *
 * Both termination patterns work:
 *   await db.select().from(t).where(cond).limit(1)   → rows via .limit()
 *   await db.select().from(t).where(cond)             → rows via chain.then()
 *
 * The chain has a .then() method so `await chain` resolves to rows without
 * requiring a final .limit() call (needed for count/aggregate queries).
 */
function selectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn().mockImplementation(() => Promise.resolve(rows)),
    orderBy: vi.fn().mockImplementation(() => Promise.resolve(rows)),
    then: (resolve: (v: unknown[]) => void) => Promise.resolve(rows).then(resolve),
  };
  chain.from.mockImplementation(() => chain);
  chain.where.mockImplementation(() => chain);
  return chain;
}

function insertChain(rows: unknown[] = []) {
  const chain = {
    values: vi.fn(),
    returning: vi.fn().mockImplementation(() => Promise.resolve(rows)),
    onConflictDoNothing: vi.fn(),
    // Thenable so `await db.insert().values()` works without .returning()
    then: (resolve: (v: unknown[]) => void) => Promise.resolve(rows).then(resolve),
  };
  chain.values.mockImplementation(() => chain);
  chain.onConflictDoNothing.mockImplementation(() => chain);
  return chain;
}

function updateChain() {
  const chain = {
    set: vi.fn(),
    where: vi.fn().mockImplementation(() => Promise.resolve([])),
  };
  chain.set.mockImplementation(() => chain);
  return chain;
}

// ── App factory ───────────────────────────────────────────────────────────────

// Resolved once by the beforeAll below — see the #2876 note at the top of the
// file for why this must not happen inside a test body.
let checkoutRouter: IRouter;

beforeAll(async () => {
  ({ default: checkoutRouter } = await import("./portal-checkout"));
});

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", checkoutRouter);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/portal/offers/:id/checkout", () => {
  beforeEach(() => {
    // clearAllMocks() only clears call history — per @vitest/spy's own
    // mockClear() (called for every mock by clearAllMocks()), the queued
    // mockReturnValueOnce()/mockImplementationOnce() implementations are
    // untouched; only mockReset() drops them (config.onceMockImplementations
    // = []). mockDbSelect/mockDbInsert/mockDbUpdate get fresh .mockReturnValueOnce()
    // chains built per-test below, so any left over from a prior test that
    // exited before consuming its full chain (e.g. via an early guard
    // response) would otherwise leak into this test's query order — reset
    // them explicitly so each test starts with an empty once-queue.
    vi.clearAllMocks();
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    mockDbUpdate.mockReset();
    mockStripeSessionCreate.mockResolvedValue({
      id: "cs_test_001",
      url: "https://checkout.stripe.com/pay/cs_test_001",
    });
    mockResolveFulfillment.mockResolvedValue({ status: "emitted", eventName: "fulfillment.assessment" });
  });

  // ── Guard tests ─────────────────────────────────────────────────────────────

  it("9. returns 401 without Authorization header", async () => {
    const app = await makeApp();
    const res = await request(app).post("/api/portal/offers/1/checkout");
    expect(res.status).toBe(401);
  });

  it("7. returns 404 for unknown offer", async () => {
    mockDbSelect.mockReturnValueOnce(selectChain([]));
    const app = await makeApp();
    const res = await request(app)
      .post("/api/portal/offers/999/checkout")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ captchaToken: "test-turnstile-token" });
    expect(res.status).toBe(404);
  });

  it("8. returns 422 for an already-accepted offer", async () => {
    mockDbSelect.mockReturnValueOnce(selectChain([acceptedOffer]));
    const app = await makeApp();
    const res = await request(app)
      .post("/api/portal/offers/5/checkout")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ captchaToken: "test-turnstile-token" });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/accepted/);
  });

  // ── Branch 1: add_on ───────────────────────────────────────────────────────

  it("1. add_on: processes payment directly against MSP card-on-file", async () => {
    mockDbSelect
      .mockReturnValueOnce(selectChain([baseSentOffer])) // offer
      .mockReturnValueOnce(selectChain([addOnService])) // service
      .mockReturnValueOnce(selectChain([{ customCustomerAgreement: null }])) // parent MSP custom agreement
      .mockReturnValueOnce(selectChain([]))             // platform agreements
      .mockReturnValueOnce(selectChain([{ stripeCustomerId: "cus_test" }])); // msp subscription
    mockDbUpdate.mockReturnValueOnce(updateChain());

    const app = await makeApp();
    const res = await request(app)
      .post("/api/portal/offers/1/checkout")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ captchaToken: "test-turnstile-token" });

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("payment_processed");
    expect(res.body.paymentIntentId).toBe("pi_test");
    expect(mockStripePaymentIntentsCreate).toHaveBeenCalledOnce();
    const piCall = mockStripePaymentIntentsCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(piCall["amount"]).toBe(105000); // 70% of 150_000
    expect(piCall["customer"]).toBe("cus_test");
    expect(mockResolveFulfillment).toHaveBeenCalledOnce();
  });

  // ── Branch 2: subscription with trial ─────────────────────────────────────

  it("2a. subscription: creates Stripe subscription directly with offer-level trial", async () => {
    mockDbSelect
      .mockReturnValueOnce(selectChain([subscriptionOffer]))   // offer (trialPeriodDays: 14)
      .mockReturnValueOnce(selectChain([subscriptionService])) // service (trialPeriodDays: 7)
      .mockReturnValueOnce(selectChain([{ customCustomerAgreement: null }])) // parent MSP custom agreement
      .mockReturnValueOnce(selectChain([]))                    // platform agreements
      .mockReturnValueOnce(selectChain([{ stripeCustomerId: "cus_test" }])); // msp subscription
    mockDbUpdate.mockReturnValueOnce(updateChain());

    const app = await makeApp();
    const res = await request(app)
      .post("/api/portal/offers/4/checkout")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ captchaToken: "test-turnstile-token" });

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("payment_processed");
    expect(res.body.subscriptionId).toBe("sub_test");
    const subCall = mockStripeSubscriptionsCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(subCall["customer"]).toBe("cus_test");
    expect(subCall["trial_period_days"]).toBe(14);
  });

  it("2b. subscription: falls back to service-level trial when offer has none", async () => {
    const offerNoTrial = { ...subscriptionOffer, trialPeriodDays: null };
    mockDbSelect
      .mockReturnValueOnce(selectChain([offerNoTrial]))
      .mockReturnValueOnce(selectChain([subscriptionService]))  // service has trialPeriodDays: 7
      .mockReturnValueOnce(selectChain([{ customCustomerAgreement: null }])) // parent MSP custom agreement
      .mockReturnValueOnce(selectChain([]))                     // platform agreements
      .mockReturnValueOnce(selectChain([{ stripeCustomerId: "cus_test" }])); // msp subscription
    mockDbUpdate.mockReturnValueOnce(updateChain());

    const app = await makeApp();
    const res = await request(app)
      .post("/api/portal/offers/4/checkout")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ captchaToken: "test-turnstile-token" });

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("payment_processed");
    const subCall = mockStripeSubscriptionsCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(subCall["customer"]).toBe("cus_test");
    expect(subCall["trial_period_days"]).toBe(7);
  });

  // ── Branch 3: $0 free assessment ─────────────────────────────────────────

  it("3. free: skips Stripe, calls resolveFulfillment, returns free_activated", async () => {
    mockDbSelect
      .mockReturnValueOnce(selectChain([freeOffer]))    // offer
      .mockReturnValueOnce(selectChain([freeService]))  // service
      .mockReturnValueOnce(selectChain([{ customCustomerAgreement: null }])) // parent MSP custom agreement
      .mockReturnValueOnce(selectChain([]))             // platform agreements
      .mockReturnValueOnce(selectChain([{ n: 0 }]))     // email rate-limit (0 prior)
      .mockReturnValueOnce(selectChain([{ n: 0 }]))     // IP rate-limit (0 prior)
      .mockReturnValueOnce(selectChain([{ n: 0 }]));    // MSP daily count (below threshold)
    mockDbUpdate.mockReturnValueOnce(updateChain());
    mockDbInsert.mockReturnValueOnce(insertChain());    // freeCheckoutAttemptsTable insert

    const app = await makeApp();
    const res = await request(app)
      .post("/api/portal/offers/2/checkout")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ captchaToken: "test-turnstile-token" });

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("free_activated");
    expect(mockStripeSessionCreate).not.toHaveBeenCalled();
    expect(mockResolveFulfillment).toHaveBeenCalledOnce();
    expect(mockResolveFulfillment).toHaveBeenCalledWith(
      expect.objectContaining({
        fulfillmentTypeKey: "assessment",
        trigger: "purchase",
        payload: expect.objectContaining({ amountCents: 0, customerId: CUSTOMER_ID }),
      }),
    );
  });

  // ── Rate limits ────────────────────────────────────────────────────────────

  it("5. free: email rate-limit returns 429 after 1 attempt within 90 days", async () => {
    mockDbSelect
      .mockReturnValueOnce(selectChain([freeOffer]))
      .mockReturnValueOnce(selectChain([freeService]))
      .mockReturnValueOnce(selectChain([{ customCustomerAgreement: null }])) // parent MSP custom agreement
      .mockReturnValueOnce(selectChain([]))             // platform agreements
      .mockReturnValueOnce(selectChain([{ n: 1 }])); // email: 1 prior → blocked
    mockDbUpdate.mockReturnValueOnce(updateChain());

    const app = await makeApp();
    const res = await request(app)
      .post("/api/portal/offers/2/checkout")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ captchaToken: "test-turnstile-token" });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/90 days/);
    expect(mockResolveFulfillment).not.toHaveBeenCalled();
    expect(mockStripeSessionCreate).not.toHaveBeenCalled();
  });

  it("6. free: IP rate-limit returns 429 after 3 attempts within 24 h", async () => {
    mockDbSelect
      .mockReturnValueOnce(selectChain([freeOffer]))
      .mockReturnValueOnce(selectChain([freeService]))
      .mockReturnValueOnce(selectChain([{ customCustomerAgreement: null }])) // parent MSP custom agreement
      .mockReturnValueOnce(selectChain([]))             // platform agreements
      .mockReturnValueOnce(selectChain([{ n: 0 }]))   // email: ok
      .mockReturnValueOnce(selectChain([{ n: 3 }]));  // IP: 3 → blocked
    mockDbUpdate.mockReturnValueOnce(updateChain());

    const app = await makeApp();
    const res = await request(app)
      .post("/api/portal/offers/2/checkout")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ captchaToken: "test-turnstile-token" });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/IP/i);
    expect(mockResolveFulfillment).not.toHaveBeenCalled();
  });

  // ── Branch 4: project ─────────────────────────────────────────────────────

  it("4. project: creates SOW, returns sow_created with sowId and shareUrl", async () => {
    mockDbSelect
      .mockReturnValueOnce(selectChain([projectOffer]))    // offer
      .mockReturnValueOnce(selectChain([projectService]))  // service
      .mockReturnValueOnce(selectChain([{ customCustomerAgreement: null }])) // parent MSP custom agreement
      .mockReturnValueOnce(selectChain([]))                // platform agreements
      .mockReturnValueOnce(selectChain([{ id: 99 }]))      // msp customer lookup
      .mockReturnValueOnce(selectChain([{ customerAgreementTemplate: null }])); // conn config
    mockDbUpdate.mockReturnValueOnce(updateChain());
    mockDbInsert
      .mockReturnValueOnce(insertChain([{ sowId: "sow-uuid-123" }]))  // mspSowsTable
      .mockReturnValueOnce(insertChain())   // mspSowEventsTable (emitSowEvent)
      .mockReturnValueOnce(insertChain());  // mspEventStoreTable (emitMspEvent)

    const app = await makeApp();
    const res = await request(app)
      .post("/api/portal/offers/3/checkout")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ captchaToken: "test-turnstile-token" });

    expect(res.status).toBe(201);
    expect(res.body.outcome).toBe("sow_created");
    expect(res.body).toHaveProperty("sowId");
    expect(res.body).toHaveProperty("shareToken");
    expect(res.body).toHaveProperty("shareUrl");
    expect(mockStripeSessionCreate).not.toHaveBeenCalled();
    expect(mockResolveFulfillment).not.toHaveBeenCalled();
  });
});
