/**
 * MSP SOW Route Tests
 *
 * Tests the offer→SOW→sign→charge flow, including:
 *   - Offer acceptance → SOW creation for project serviceClass
 *   - Offer acceptance → checkout URL for add_on/subscription
 *   - $0 free checkout path
 *   - Public share-token read and sign
 *   - Manual SOW creation (standalone)
 *   - SOW expiry enforcement
 *   - Customer agreement clickwrap
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import request from "supertest";

// ── Universal mock-chain factory ───────────────────────────────────────────────
// A "thenable chain" — you can await at ANY point in the chain (after from(),
// where(), limit(), orderBy().limit().offset(), etc.) and get `rows` back.
// This matches all the drizzle-orm query patterns used in msp-sow.ts.

function makeChain(rows: unknown[]) {
  const p = Promise.resolve(rows);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  chain.from      = vi.fn().mockReturnValue(chain);
  chain.where     = vi.fn().mockReturnValue(chain);
  chain.orderBy   = vi.fn().mockReturnValue(chain);
  chain.limit     = vi.fn().mockReturnValue(chain);
  chain.offset    = vi.fn().mockReturnValue(chain);
  chain.set       = vi.fn().mockReturnValue(chain);
  chain.values    = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockReturnValue(chain);
  chain.onConflictDoNothing = vi.fn().mockReturnValue(chain);
  // Make the chain itself awaitable at any point
  chain.then    = p.then.bind(p);
  chain.catch   = p.catch.bind(p);
  chain.finally = p.finally.bind(p);
  return chain;
}

// ── Hoisted db mock ────────────────────────────────────────────────────────────
// selectResults / insertResults / updateResult are filled per-test via helpers.
// The mock reads from these arrays in call-order.

const { mockDb, mockState, mockStripeSessionCreate, mockFulfillAcceptedProjectOffer, mockResolveCustomerPortalUserId } = vi.hoisted(() => {
  const mockState = {
    selectResults: [] as unknown[][],
    insertResults: [] as unknown[][],
    selectCall: 0,
    insertCall: 0,
  };

  const mockDb = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  };

  // Shared across every `new Stripe(key)` instantiation the route makes, so a test
  // can inspect the real params a checkout.sessions.create() call was made with —
  // an inline `vi.fn()` per Stripe mock instance (the old shape) can't be reached
  // from the test body at all.
  const mockStripeSessionCreate = vi.fn().mockResolvedValue({
    id: "cs_test",
    url: "https://checkout.stripe.com/pay/cs_test",
  });

  // Git #2009 — the sign routes dynamically `import()` project-sow-fulfillment.ts
  // to kick off real project creation. Mocked for the same reason
  // ../lib/workflow-executor.ts is: the real module transitively pulls in
  // document-engine-sow.ts -> the Anthropic AI integration client, which
  // throws at module-load time if its env vars aren't provisioned.
  const mockFulfillAcceptedProjectOffer = vi.fn().mockResolvedValue({
    status: "sow_generating", projectId: 501, documentId: 9001,
  });

  // #3650 — msp-sow.ts resolves the offer's real customer contact email via
  // this canonical resolver (tenant-signals.ts) rather than reinventing the
  // portal-user lookup. Mocked directly (default: no portal user found) the
  // same way msp-staff.test.ts does, since its real implementation orders by
  // canonicalPortalUserOrder() via db.select(...).orderBy(...), which this
  // file's simpler queue-based mock db does not model.
  const mockResolveCustomerPortalUserId = vi.fn().mockResolvedValue(null);

  return { mockDb, mockState, mockStripeSessionCreate, mockFulfillAcceptedProjectOffer, mockResolveCustomerPortalUserId };
});

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: mockDb,
  mspSowsTable:               { sowId: "sow_id", mspId: "msp_id", status: "status", shareToken: "share_token", customerId: "customer_id", offerId: "offer_id", expiresAt: "expires_at", customerUserId: "customer_user_id", amountCents: "amount_cents", shareTokenExpiresAt: "share_token_expires_at", title: "title", description: "description", signedAt: "signed_at", signerName: "signer_name", documentHtml: "document_html", customerAgreementSnapshotText: "customer_agreement_snapshot_text", createdAt: "created_at" },
  mspSowEventsTable:          { sowId: "sow_id", eventName: "event_name" },
  mspChargesTable:            { sowId: "sow_id", mspId: "msp_id", status: "status", stripePaymentIntentId: "stripe_payment_intent_id" },
  mspCustomerClickwrapsTable: { mspId: "msp_id", customerUserId: "customer_user_id", id: "id", acceptedAt: "accepted_at" },
  mspSubscriptionsTable:      { mspId: "msp_id", stripeCustomerId: "stripe_customer_id" },
  mspConnectorConfigsTable:   { mspId: "msp_id", customerAgreementTemplate: "customer_agreement_template" },
  mspsTable:                  { id: "id", name: "name", slug: "slug" },
  tenantsTable:               { id: "id", mspId: "msp_id", tenantId: "tenant_id" },
  salesOffersTable:           { id: "id", state: "state", mspId: "msp_id", serviceId: "service_id", tenantId: "tenant_id", title: "title", adjustedPriceCents: "adjusted_price_cents" },
  servicesTable:              { id: "id", name: "name", description: "description", serviceClass: "service_class", billingType: "billing_type", allowFreeCheckout: "allow_free_checkout", trialPeriodDays: "trial_period_days", fulfillmentTypeKey: "fulfillment_type_key" },
  usersTable:                 { id: "id", email: "email" },
  mspEventStoreTable:         { eventType: "event_type" },
  fulfillmentQueueTable:      { id: "id", sourceType: "source_type", sourceId: "source_id", deliveryStatus: "delivery_status" },
}));

vi.mock("drizzle-orm", () => ({
  eq:    vi.fn((_col: unknown, _val: unknown) => "eq_cond"),
  and:   vi.fn((..._args: unknown[]) => "and_cond"),
  or:    vi.fn((..._args: unknown[]) => "or_cond"),
  desc:  vi.fn((col: unknown) => col),
  count: vi.fn(() => ({ as: vi.fn() })),
}));

// The private sign route (unlike the public share-token one) fires a real
// "sow.signed" workflow event after signing. Left unmocked, `msp-sow.ts`'s
// `await import("../lib/workflow-executor.ts")` pulls in the REAL module, which
// transitively imports lib/ps-script-gen.ts -> lib/integrations-anthropic-ai,
// and that throws at import time when AI_INTEGRATIONS_ANTHROPIC_BASE_URL
// isn't set — turning a non-fatal, fire-and-forget event emission into a
// route-crashing 500. Every other route test file with this same lazy import
// (admin-write-actions, consent, msp-remediation-tracker, portal-checkout,
// portal-delivery-kanban, portal-remediation-tracker) mocks this module for
// exactly this reason; this file was just missing it.
vi.mock("../lib/workflow-executor.ts", () => ({
  emitWorkflowEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../middlewares/requireAuth.ts", () => ({
  requireCapability: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAuth:  (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// `logger.child(...)` chains — msp-sow.ts pulls in msp-entitlement.ts, which binds
// its own child logger off the shared `logger` singleton, so the mock must support
// `.child()` returning another logger-shaped object, not just info/warn/error.
function makeLoggerMock(): { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; child: ReturnType<typeof vi.fn> } {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => makeLoggerMock()),
  };
}

vi.mock("../lib/logger.ts", () => ({
  logger: makeLoggerMock(),
}));

vi.mock("../lib/stripe.ts", () => ({
  getStripeKey: vi.fn(() => "sk_test_mock"),
}));

vi.mock("../lib/tenant-signals.ts", () => ({
  resolveCustomerPortalUserId: mockResolveCustomerPortalUserId,
}));

vi.mock("stripe", () => {
  // Must use `function` keyword — arrow functions cannot be used as constructors
  // (the route calls `new Stripe(key)` so the mock must be a constructible fn).
  const MockStripe = vi.fn().mockImplementation(function MockStripeImpl() {
    return {
      checkout: {
        sessions: {
          create: mockStripeSessionCreate,
        },
      },
      paymentIntents: {
        create: vi.fn().mockResolvedValue({ id: "pi_test", status: "succeeded" }),
      },
      customers: {
        retrieve: vi.fn().mockResolvedValue({ invoice_settings: { default_payment_method: "pm_test" } }),
      },
      paymentMethods: {
        list: vi.fn().mockResolvedValue({ data: [{ id: "pm_test" }] }),
      },
    };
  });
  return { default: MockStripe };
});

vi.mock("express-rate-limit", () => ({
  default: vi.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
}));

// The sign route dynamically `import()`s the workflow executor to fire the
// "MSP SOW Charge Approval" workflow. The real module is ~11k lines and pulls
// in transitive integrations (e.g. the Anthropic AI client, which throws at
// module-load time if its env vars aren't provisioned) — mocking it here keeps
// this a unit test of msp-sow.ts and avoids a real, expensive, flaky-timeout
// transitive import.
vi.mock("../lib/workflow-executor.ts", () => ({
  emitWorkflowEvent: vi.fn().mockResolvedValue(undefined),
}));

// Git #2009 — see mockFulfillAcceptedProjectOffer's own comment above.
vi.mock("../lib/project-sow-fulfillment.ts", () => ({
  fulfillAcceptedProjectOffer: mockFulfillAcceptedProjectOffer,
}));

// ── Import router AFTER all mocks ─────────────────────────────────────────────

import router from "./msp-sow.ts";
import { LEGACY_ROLE } from "@workspace/db/rbac/legacy-ladder";

// ── App builder ────────────────────────────────────────────────────────────────
// User has mspRole: `MSPAdmin` + mspId: 42 so getMspIdFromRequest() returns
// user.mspId directly (no ?mspId= query param needed).

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as Request & { user: unknown }).user = {
      id: 1,
      role: "client",
      mspRole: LEGACY_ROLE.mspAdmin,
      mspId: 42,
      email: "admin@msp.test",
    };
    next();
  });
  app.use(router);
  return app;
}

// ── Per-test mock setup ────────────────────────────────────────────────────────
// resetAllMocks() flushes all mockReturnValueOnce queues and implementations.
// We re-install fresh call-counter implementations in each beforeEach so the
// db mock works correctly across all tests without state leakage.

beforeEach(() => {
  // clearAllMocks resets call history but preserves module-level mock implementations
  // (e.g. the Stripe constructor mock set in vi.mock()). We must NOT use
  // resetAllMocks() here because it would wipe the Stripe mock and cause 500s.
  vi.clearAllMocks();

  mockState.selectResults = [];
  mockState.insertResults = [];
  mockState.selectCall = 0;
  mockState.insertCall = 0;

  mockDb.select.mockImplementation(() => {
    const rows = mockState.selectResults[mockState.selectCall++] ?? [];
    return makeChain(rows);
  });

  mockDb.insert.mockImplementation(() => {
    const rows = mockState.insertResults[mockState.insertCall++] ?? [];
    return makeChain(rows);
  });

  mockDb.update.mockImplementation(() => makeChain([]));
});

/** Queue rows to return on the n-th select() call (in call order). */
function queueSelect(...rowSets: unknown[][]) {
  mockState.selectResults.push(...rowSets);
}

/** Queue rows to return on the n-th insert() call (in call order). */
function queueInsert(...rowSets: unknown[][]) {
  mockState.insertResults.push(...rowSets);
}

/**
 * The sign routes kick off project fulfillment fire-and-forget (a dynamic
 * `import()` followed by an async call) — it is not awaited by the request
 * handler. Flush the microtask queue a few times so it settles before a test
 * asserts on it.
 */
async function flushMicrotasks(times = 5) {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /msp/offers/:offerId/accept", () => {
  it("creates a SOW for project serviceClass", async () => {
    const app = buildApp();

    queueSelect(
      // Offer lookup
      [{ id: 1, state: "sent", mspId: 42, serviceId: 10, tenantId: 99, title: "M365 Assessment", adjustedPriceCents: 500000 }],
      // Service lookup
      [{ name: "M365 Assessment", description: "Full M365 assessment", serviceClass: "project", allowFreeCheckout: true, trialPeriodDays: null }],
      // Customer lookup
      [{ id: 5 }],
      // Connector config (no agreement template)
      [{ customerAgreementTemplate: null }],
    );
    queueInsert(
      // SOW insert → returns new row
      [{ sowId: "abc-uuid", status: "sent" }],
      // SOW lifecycle event
      [],
      // MSP event store
      [],
    );

    const res = await request(app).post("/msp/offers/1/accept").send({});
    expect(res.status).toBe(201);
    expect(res.body.outcome).toBe("sow_created");
    expect(res.body.sowId).toBe("abc-uuid");
    expect(res.body.shareToken).toBeTruthy();
  });

  it("returns checkout URL for add_on serviceClass", async () => {
    const app = buildApp();

    queueSelect(
      [{ id: 2, state: "sent", mspId: 42, serviceId: 20, tenantId: null, title: "Security Add-On", adjustedPriceCents: 9900 }],
      [{ name: "Security Add-On", description: null, serviceClass: "add_on", allowFreeCheckout: true, trialPeriodDays: null }],
      // MSP lookup for success_url
      [{ name: "Contoso MSP", slug: "contoso" }],
    );

    const res = await request(app).post("/msp/offers/2/accept").send({});
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("checkout_required");
    expect(res.body.checkoutUrl).toContain("stripe.com");

    // #3650 — the offer carries no resolvable customer (no customerId field
    // on this fixture), so there is no real contact email to send. The old
    // bug defaulted customer_email to the accepting staffer's own email
    // (admin@msp.test) in that case; the fix omits the field entirely and
    // lets Stripe collect an email at checkout instead.
    const sessionParams = mockStripeSessionCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sessionParams).not.toHaveProperty("customer_email");
    expect(sessionParams["metadata"]).toMatchObject({ fulfillment_type: "msp_offer" });
  });

  // #3650 — the checkout session must be addressed to the offer's own customer,
  // not the MSP staffer who called this endpoint (req.user.email), and must
  // carry the metadata msp-billing-webhook.ts's checkout.session.completed
  // handler needs to actually provision the purchase.
  it("#3650: resolves the offer's real customer email for customer_email and enriches checkout metadata", async () => {
    const app = buildApp();

    queueSelect(
      [{ id: 6, state: "sent", mspId: 42, serviceId: 25, customerId: 77, title: "Backup Add-On", adjustedPriceCents: 1500 }],
      [{ name: "Backup Add-On", description: null, serviceClass: "add_on", allowFreeCheckout: true, trialPeriodDays: null, fulfillmentTypeKey: "backup_addon" }],
      // MSP lookup for success_url
      [{ name: "Contoso MSP", slug: "contoso" }],
      // Customer (tenant) lookup — resolveOfferCustomerId
      [{ id: 88 }],
      // Customer contact email lookup — usersTable, keyed off resolveCustomerPortalUserId's result
      [{ email: "jane@customer.example" }],
    );
    mockResolveCustomerPortalUserId.mockResolvedValueOnce(501);

    const res = await request(app).post("/msp/offers/6/accept").send({});
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("checkout_required");

    const sessionParams = mockStripeSessionCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sessionParams["customer_email"]).toBe("jane@customer.example");
    expect(sessionParams["customer_email"]).not.toBe("admin@msp.test"); // the staffer's email — the bug this regresses
    expect(sessionParams["metadata"]).toMatchObject({
      offerId: "6",
      mspId: "42",
      serviceClass: "add_on",
      fulfillment_type: "msp_offer",
      customerId: "88",
      serviceId: "25",
      fulfillmentTypeKey: "backup_addon",
      amountCents: "1500",
      serviceName: "Backup Add-On",
    });
  });

  // #3634 — a real live catalog shape: retainer items carry serviceClass="retainer"
  // (not "subscription") but billingType="recurring_monthly". Must route through a
  // real Stripe subscription-mode Checkout Session, not the one-time "payment" mode
  // branch — same trap #3403 fixed for msp-marketplace-purchase.ts, plus a second,
  // deeper bug this file had on its own: even a service already correctly flagged
  // serviceClass="subscription" never got a subscription-mode session because
  // `sessionParams["mode"]` was force-reset to "payment" immediately after being set.
  it("#3634: retainer (serviceClass=retainer, billingType=recurring_monthly) creates a subscription-mode Checkout Session with a recurring line item", async () => {
    const app = buildApp();

    queueSelect(
      [{ id: 3, state: "sent", mspId: 42, serviceId: 30, tenantId: null, title: "vCISO Retainer", adjustedPriceCents: 450000 }],
      [{ name: "vCISO Retainer", description: "Monthly vCISO engagement", serviceClass: "retainer", billingType: "recurring_monthly", allowFreeCheckout: false, trialPeriodDays: 14 }],
      // MSP lookup for success_url
      [{ name: "Contoso MSP", slug: "contoso" }],
    );

    const res = await request(app).post("/msp/offers/3/accept").send({});
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("checkout_required");
    expect(res.body.checkoutUrl).toContain("stripe.com");

    expect(mockStripeSessionCreate).toHaveBeenCalledOnce();
    const sessionParams = mockStripeSessionCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sessionParams["mode"]).toBe("subscription");
    expect(sessionParams["subscription_data"]).toEqual({ trial_period_days: 14 });
    const lineItems = sessionParams["line_items"] as Array<{ price_data: Record<string, unknown> }>;
    expect(lineItems[0]?.price_data["recurring"]).toEqual({ interval: "month" });
    expect(lineItems[0]?.price_data["unit_amount"]).toBe(450000);
  });

  it("free-activates a $0 offer with allowFreeCheckout", async () => {
    const app = buildApp();

    queueSelect(
      [{ id: 3, state: "sent", mspId: 42, serviceId: 30, tenantId: null, title: "Free Trial Add-On", adjustedPriceCents: 0 }],
      [{ name: "Free Trial", description: null, serviceClass: "add_on", allowFreeCheckout: true, trialPeriodDays: null }],
    );
    queueInsert([]);  // MSP event

    const res = await request(app).post("/msp/offers/3/accept").send({});
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("free_activated");
  });

  it("rejects acceptance if offer is already expired", async () => {
    const app = buildApp();

    queueSelect([{ id: 4, state: "expired", mspId: 42, serviceId: null, tenantId: null, title: "Old Offer", adjustedPriceCents: 100000 }]);

    const res = await request(app).post("/msp/offers/4/accept").send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("expired");
  });

  it("returns 404 if offer not found", async () => {
    const app = buildApp();
    queueSelect([]);

    const res = await request(app).post("/msp/offers/999/accept").send({});
    expect(res.status).toBe(404);
  });

  it("rejects offerId that is not a number", async () => {
    const app = buildApp();
    const res = await request(app).post("/msp/offers/not-a-number/accept").send({});
    expect(res.status).toBe(400);
  });
});

describe("POST /msp/sows (standalone creation)", () => {
  it("creates a standalone SOW with required fields", async () => {
    const app = buildApp();

    queueSelect([{ customerAgreementTemplate: null }]); // connector config
    queueInsert(
      [{ sowId: "standalone-uuid", title: "Custom Project", status: "draft" }],
      [],
    );

    const res = await request(app).post("/msp/sows").send({
      mspId: 42, title: "Custom Project", amountCents: 250000,
    });
    expect(res.status).toBe(201);
    expect(res.body.sowId).toBe("standalone-uuid");
  });

  it("rejects missing title", async () => {
    const app = buildApp();
    const res = await request(app).post("/msp/sows").send({ mspId: 42, amountCents: 1000 });
    expect(res.status).toBe(400);
  });
});

describe("GET /msp/sows/:sowId", () => {
  it("returns SOW detail for MSP operator", async () => {
    const app = buildApp();
    queueSelect([{ sowId: "test-sow-id", title: "Test SOW", status: "sent", amountCents: 100000 }]);

    const res = await request(app).get("/msp/sows/test-sow-id");
    expect(res.status).toBe(200);
    expect(res.body.sowId).toBe("test-sow-id");
  });

  it("returns 404 if SOW not found", async () => {
    const app = buildApp();
    queueSelect([]);

    const res = await request(app).get("/msp/sows/does-not-exist");
    expect(res.status).toBe(404);
  });
});

describe("POST /msp/sows/:sowId/sign", () => {
  const validSignature = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  it("signs a sent SOW", async () => {
    const app = buildApp();

    queueSelect([{
      sowId: "sign-test-uuid", status: "sent", mspId: 42, customerId: 5,
      amountCents: 100000, customerUserId: 1,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    }]);
    queueInsert([], []); // signed event + MSP event

    const res = await request(app).post("/msp/sows/sign-test-uuid/sign").send({
      signerName: "Jane Customer",
      signatureData: validSignature,
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe("signed");
  });

  // Git #2009 — signing a project-class SOW is what should trigger real
  // project creation, reusing the same fulfillAcceptedProjectOffer() pipeline
  // the customer-facing accept route already uses.
  it("kicks off project fulfillment for a signed SOW that carries an offerId", async () => {
    const app = buildApp();

    queueSelect([{
      sowId: "sign-test-uuid-with-offer", status: "sent", mspId: 42, customerId: 5,
      amountCents: 100000, customerUserId: 2, offerId: 77,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    }]);
    queueInsert([], []); // signed event + MSP event

    // The signer here is the MSP operator (mspId matches; buildApp()'s user.id
    // is 1, which does NOT match this SOW's customerUserId: 2), so
    // acceptedByUserId falls through as null and fulfillAcceptedProjectOffer
    // resolves the customer's own portal user itself.
    const res = await request(app).post("/msp/sows/sign-test-uuid-with-offer/sign").send({
      signerName: "Jane Customer",
      signatureData: validSignature,
    });
    expect(res.status).toBe(200);

    await flushMicrotasks();
    expect(mockFulfillAcceptedProjectOffer).toHaveBeenCalledWith({ offerId: 77, acceptedByUserId: null });
  });

  it("passes the signer's own user id when the assigned customer signs directly", async () => {
    const app = buildApp();

    queueSelect([{
      sowId: "sign-test-customer-signer", status: "sent", mspId: 999, customerId: 5,
      amountCents: 100000, customerUserId: 1, offerId: 88,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    }]);
    queueInsert([], []); // signed event + MSP event

    // buildApp()'s req.user has id: 1, mspId: 42 — mspId 999 on this SOW means
    // isMspUser is false, but customerUserId: 1 matches user.id, so this is
    // the assigned-customer signing path.
    const res = await request(app).post("/msp/sows/sign-test-customer-signer/sign").send({
      signerName: "Jane Customer",
      signatureData: validSignature,
    });
    expect(res.status).toBe(200);

    await flushMicrotasks();
    expect(mockFulfillAcceptedProjectOffer).toHaveBeenCalledWith({ offerId: 88, acceptedByUserId: 1 });
  });

  it("does not attempt project fulfillment for a standalone SOW with no offerId", async () => {
    const app = buildApp();

    queueSelect([{
      sowId: "sign-test-standalone", status: "sent", mspId: 42, customerId: 5,
      amountCents: 100000, customerUserId: 1, offerId: null,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    }]);
    queueInsert([], []); // signed event + MSP event

    const res = await request(app).post("/msp/sows/sign-test-standalone/sign").send({
      signerName: "Jane Customer",
      signatureData: validSignature,
    });
    expect(res.status).toBe(200);

    await flushMicrotasks();
    expect(mockFulfillAcceptedProjectOffer).not.toHaveBeenCalled();
  });

  it("rejects signing an already-signed SOW", async () => {
    const app = buildApp();

    queueSelect([{
      sowId: "already-signed", status: "signed", mspId: 42, customerId: 5,
      amountCents: 100000, customerUserId: 1,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    }]);

    const res = await request(app).post("/msp/sows/already-signed/sign").send({
      signerName: "Jane Customer",
      signatureData: validSignature,
    });
    expect(res.status).toBe(409);
  });

  it("returns 410 for an expired SOW", async () => {
    const app = buildApp();

    queueSelect([{
      sowId: "expired-sow", status: "sent", mspId: 42, customerId: 5,
      amountCents: 100000, customerUserId: 1,
      expiresAt: new Date(Date.now() - 86_400_000), // Date object — route uses > comparison
    }]);

    const res = await request(app).post("/msp/sows/expired-sow/sign").send({
      signerName: "Jane Customer",
      signatureData: validSignature,
    });
    expect(res.status).toBe(410);
    expect(res.body.error).toContain("expired");
  });

  it("rejects a sign request with missing signer name", async () => {
    const app = buildApp();
    const res = await request(app).post("/msp/sows/any-id/sign").send({ signatureData: validSignature });
    expect(res.status).toBe(400);
  });

  it("rejects a sign request with missing signature data", async () => {
    const app = buildApp();
    const res = await request(app).post("/msp/sows/any-id/sign").send({ signerName: "Jane Customer" });
    expect(res.status).toBe(400);
  });
});

describe("POST /msp/sows/:sowId/expire", () => {
  it("expires a sent SOW", async () => {
    const app = buildApp();
    queueSelect([{ status: "sent", mspId: 42 }]);
    queueInsert([]); // expire event

    const res = await request(app).post("/msp/sows/test-id/expire");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("refuses to expire a paid SOW", async () => {
    const app = buildApp();
    queueSelect([{ status: "paid", mspId: 42 }]);

    const res = await request(app).post("/msp/sows/paid-id/expire");
    expect(res.status).toBe(409);
  });

  it("returns 404 if SOW not found", async () => {
    const app = buildApp();
    queueSelect([]);

    const res = await request(app).post("/msp/sows/not-found/expire");
    expect(res.status).toBe(404);
  });
});

describe("GET /public/sows/:shareToken", () => {
  it("returns public SOW data for a valid share token", async () => {
    const app = buildApp();

    queueSelect([{
      sowId: "pub-sow-id",
      title: "Public Project SOW",
      description: "A project",
      amountCents: 500000,
      currency: "usd",
      status: "sent",
      documentHtml: "<html>SOW content</html>",
      shareTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      signedAt: null,
      signerName: null,
      customerAgreementSnapshotText: null,
    }]);

    const res = await request(app).get("/public/sows/valid-share-token");
    expect(res.status).toBe(200);
    expect(res.body.sowId).toBe("pub-sow-id");
    expect(res.body.title).toBe("Public Project SOW");
  });

  it("returns 404 for an unknown share token", async () => {
    const app = buildApp();
    queueSelect([]);

    const res = await request(app).get("/public/sows/unknown-token");
    expect(res.status).toBe(404);
  });

  it("returns 410 for an expired share token", async () => {
    const app = buildApp();

    queueSelect([{
      sowId: "expired-share",
      title: "Expired",
      amountCents: 0,
      currency: "usd",
      status: "sent",
      documentHtml: null,
      shareTokenExpiresAt: new Date(Date.now() - 1000), // Date object — route uses > comparison
      expiresAt: null,
      signedAt: null,
      signerName: null,
      customerAgreementSnapshotText: null,
    }]);

    const res = await request(app).get("/public/sows/old-token");
    expect(res.status).toBe(410);
  });
});

describe("POST /public/sows/:shareToken/sign", () => {
  const validSignature = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  it("signs a $0 SOW via share token", async () => {
    const app = buildApp();

    queueSelect([{
      sowId: "pub-sign-id", status: "sent", mspId: 42, customerId: 5,
      amountCents: 0, // free — skips Stripe
      shareTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    }]);
    queueInsert([], []); // signed event + MSP event

    const res = await request(app).post("/public/sows/valid-token/sign").send({
      signerName: "John Public",
      signatureData: validSignature,
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  // Git #2009 — the public share-link sign path is unauthenticated, so
  // acceptedByUserId is always null there; fulfillAcceptedProjectOffer falls
  // back to resolving the customer's own canonical portal user.
  it("kicks off project fulfillment for a project-class SOW signed via share link", async () => {
    const app = buildApp();

    queueSelect([{
      sowId: "pub-sign-with-offer", status: "sent", mspId: 42, customerId: 5,
      amountCents: 0, offerId: 55,
      shareTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    }]);
    queueInsert([], []); // signed event + MSP event

    const res = await request(app).post("/public/sows/offer-token/sign").send({
      signerName: "John Public",
      signatureData: validSignature,
    });
    expect(res.status).toBe(200);

    await flushMicrotasks();
    expect(mockFulfillAcceptedProjectOffer).toHaveBeenCalledWith({ offerId: 55, acceptedByUserId: null });
  });

  it("does not attempt project fulfillment for a standalone SOW signed via share link", async () => {
    const app = buildApp();

    queueSelect([{
      sowId: "pub-sign-standalone", status: "sent", mspId: 42, customerId: 5,
      amountCents: 0, offerId: null,
      shareTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    }]);
    queueInsert([], []); // signed event + MSP event

    const res = await request(app).post("/public/sows/no-offer-token/sign").send({
      signerName: "John Public",
      signatureData: validSignature,
    });
    expect(res.status).toBe(200);

    await flushMicrotasks();
    expect(mockFulfillAcceptedProjectOffer).not.toHaveBeenCalled();
  });

  it("rejects signing an already-signed SOW via public endpoint", async () => {
    const app = buildApp();

    queueSelect([{
      sowId: "already-signed-pub", status: "signed", mspId: 42, customerId: 5,
      amountCents: 0,
      shareTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    }]);

    const res = await request(app).post("/public/sows/valid-token/sign").send({
      signerName: "John Duplicate",
      signatureData: validSignature,
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("already been signed");
  });

  it("returns 410 if the share link has expired", async () => {
    const app = buildApp();

    queueSelect([{
      sowId: "link-expired", status: "sent", mspId: 42, customerId: 5,
      amountCents: 0,
      shareTokenExpiresAt: new Date(Date.now() - 1000), // Date object — route uses > comparison
      expiresAt: new Date(Date.now() + 86_400_000),
    }]);

    const res = await request(app).post("/public/sows/expired-link/sign").send({
      signerName: "John Stale",
      signatureData: validSignature,
    });
    expect(res.status).toBe(410);
  });
});

describe("GET + POST /msp/customers/:customerId/clickwrap", () => {
  it("returns required=false when MSP has no agreement template", async () => {
    const app = buildApp();

    queueSelect(
      [{ mspId: 42 }],                    // customer ownership
      [{ customerAgreementTemplate: null }], // connector config
    );

    const res = await request(app).get("/msp/customers/5/clickwrap");
    expect(res.status).toBe(200);
    expect(res.body.required).toBe(false);
    expect(res.body.accepted).toBe(true);
  });

  it("returns required=true + accepted=false when template exists but not yet accepted", async () => {
    const app = buildApp();

    queueSelect(
      [{ mspId: 42 }],
      [{ customerAgreementTemplate: "You agree to our terms..." }],
      [],  // no clickwrap row yet
    );

    const res = await request(app).get("/msp/customers/5/clickwrap");
    expect(res.status).toBe(200);
    expect(res.body.required).toBe(true);
    expect(res.body.accepted).toBe(false);
    expect(res.body.agreementText).toBeTruthy();
  });

  it("returns required=true + accepted=true when user already accepted", async () => {
    const app = buildApp();

    queueSelect(
      [{ mspId: 42 }],
      [{ customerAgreementTemplate: "You agree to our terms..." }],
      [{ id: 1, acceptedAt: new Date().toISOString() }], // existing row
    );

    const res = await request(app).get("/msp/customers/5/clickwrap");
    expect(res.status).toBe(200);
    expect(res.body.required).toBe(true);
    expect(res.body.accepted).toBe(true);
  });

  it("records clickwrap acceptance on POST", async () => {
    const app = buildApp();

    queueSelect(
      [{ mspId: 42 }],
      [{ customerAgreementTemplate: "You agree to our terms..." }],
    );
    queueInsert([]); // insert acceptance row

    const res = await request(app).post("/msp/customers/5/clickwrap").send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("returns 404 if customer not found", async () => {
    const app = buildApp();
    queueSelect([]); // customer lookup → empty

    const res = await request(app).get("/msp/customers/999/clickwrap");
    expect(res.status).toBe(404);
  });

  it("GET rejects a caller from a different MSP with 403 (Access denied)", async () => {
    const app = buildApp();
    queueSelect([{ mspId: 99 }]); // customer belongs to a different MSP than the caller's mspId (42)

    const res = await request(app).get("/msp/customers/5/clickwrap");
    expect(res.status).toBe(403);
  });

  it("POST rejects a caller from a different MSP with 403 (Access denied) — regression for #2725", async () => {
    const app = buildApp();
    queueSelect([{ mspId: 99 }]); // customer belongs to a different MSP than the caller's mspId (42)

    const res = await request(app).post("/msp/customers/5/clickwrap").send({});
    expect(res.status).toBe(403);
    // Must not have reached the insert — no unauthorized clickwrap acceptance recorded.
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});
