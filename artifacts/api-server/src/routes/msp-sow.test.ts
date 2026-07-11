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

const { mockDb, mockState } = vi.hoisted(() => {
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

  return { mockDb, mockState };
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
  mspCustomersTable:          { id: "id", mspId: "msp_id", tenantId: "tenant_id" },
  salesOffersTable:           { id: "id", state: "state", mspId: "msp_id", serviceId: "service_id", tenantId: "tenant_id", title: "title", adjustedPriceCents: "adjusted_price_cents" },
  servicesTable:              { id: "id", name: "name", description: "description", serviceClass: "service_class", allowFreeCheckout: "allow_free_checkout", trialPeriodDays: "trial_period_days" },
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

vi.mock("../middlewares/requireAuth.ts", () => ({
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAuth:  (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../lib/logger.ts", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../lib/stripe.ts", () => ({
  getStripeKey: vi.fn(() => "sk_test_mock"),
}));

vi.mock("stripe", () => {
  // Must use `function` keyword — arrow functions cannot be used as constructors
  // (the route calls `new Stripe(key)` so the mock must be a constructible fn).
  const MockStripe = vi.fn().mockImplementation(function MockStripeImpl() {
    return {
      checkout: {
        sessions: {
          create: vi.fn().mockResolvedValue({ id: "cs_test", url: "https://checkout.stripe.com/pay/cs_test" }),
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

// ── Import router AFTER all mocks ─────────────────────────────────────────────

import router from "./msp-sow.ts";

// ── App builder ────────────────────────────────────────────────────────────────
// User has mspRole: "MSPAdmin" + mspId: 42 so getMspIdFromRequest() returns
// user.mspId directly (no ?mspId= query param needed).

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as Request & { user: unknown }).user = {
      id: 1,
      role: "client",
      mspRole: "MSPAdmin",
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
});
