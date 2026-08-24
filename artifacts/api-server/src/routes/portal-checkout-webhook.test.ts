/**
 * Test for portal-checkout.ts's `POST /portal/stripe/webhook` handling a
 * checkout.session.completed event with metadata.fulfillment_type =
 * "portal_offer" (#153).
 *
 * Context: portal.ts registered the identical `/portal/stripe/webhook` path
 * and was mounted first in routes/index.ts, so its legacy processStripeEvent()
 * dispatcher always won and this handler's resolveFulfillment() call never
 * ran for real traffic. #153 removed portal.ts's registration, making this
 * handler the sole registrant. This test exercises it directly (mounting only
 * portal-checkout.ts's router) rather than relying on route-order behavior.
 *
 * Approach: same node:test + mock.module() pattern as the sibling
 * portal-payment-webhook-idempotency.test.ts — stub @workspace/db,
 * resolve-fulfillment.ts, and other side-effect modules so no real DB/network
 * calls open; capture resolveFulfillment's call args to assert on.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */
import { describe, it, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

// Deliberately unset — PORTAL_STRIPE_WEBHOOK_SECRET/STRIPE_WEBHOOK_SECRET stay
// undefined so the handler takes its no-secret-configured branch (JSON.parse
// of the raw body instead of stripe.webhooks.constructEvent), matching how
// this suite bypasses signature verification without needing a working
// Stripe.webhooks mock.
delete process.env.PORTAL_STRIPE_WEBHOOK_SECRET;
delete process.env.STRIPE_WEBHOOK_SECRET;

let resolveFulfillmentCalls: Array<Record<string, unknown>> = [];
let dbQueue: unknown[][] = [];

function makeChain(result: unknown[]): Record<string, unknown> {
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: () => chain,
    limit: () => chain,
    leftJoin: () => chain,
    innerJoin: () => chain,
    orderBy: () => chain,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
    catch: (reject: (e: unknown) => unknown) => Promise.resolve(result).catch(reject),
  };
  return chain;
}

function makeMockDb() {
  return {
    select: (_cols?: unknown) => makeChain(dbQueue.shift() ?? []),
    insert: () => ({
      values: () => ({
        returning: async () => [],
        onConflictDoNothing: () => ({ returning: async () => [] }),
      }),
      onConflictDoNothing: () => ({ returning: async () => [] }),
    }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
    delete: () => ({ where: async () => [] }),
    execute: async () => ({ rows: [] }),
  };
}

mock.module("stripe", {
  defaultExport: class MockStripe {
    constructor(_key: string) {}
    webhooks = {
      constructEvent: () => {
        throw new Error("not used — webhookSecret path uses JSON.parse in this handler");
      },
    };
  },
});

mock.module("@workspace/db", {
  namedExports: {
    db: makeMockDb(),
    salesOffersTable: {},
    servicesTable: {},
    mspSowsTable: {},
    mspSowEventsTable: {},
    mspConnectorConfigsTable: {},
    tenantsTable: {},
    mspEventStoreTable: {},
    freeCheckoutAttemptsTable: {},
    platformAgreementsTable: {},
    mspAgreementAcceptancesTable: {},
    mspSubscriptionsTable: {},
    usersTable: {},
    mspsTable: {},
    contractsTable: {},
    fulfillmentTypesTable: {},
    fulfillmentIdempotencyTable: {},
    clientServicesTable: {},
  },
});

mock.module("../middlewares/requireAuth.ts", {
  namedExports: {
    requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  },
});

mock.module("../lib/stripe.ts", {
  namedExports: {
    getStripeKey: () => "sk_test_fake_key_for_portal_offer_webhook_test",
    getMspDefaultPaymentMethod: async () => null,
  },
});

mock.module("../lib/resolve-fulfillment.ts", {
  namedExports: {
    resolveFulfillment: async (input: Record<string, unknown>) => {
      resolveFulfillmentCalls.push(input);
      return { status: "emitted", fulfillmentTypeKey: input.fulfillmentTypeKey, idempotencyKey: input.idempotencyKey };
    },
  },
});

mock.module("../lib/catalog-pricing.ts", {
  namedExports: {
    resolveCatalogPricing: (opts: { priceCents: number }) => ({ wholesaleCostCents: Math.round(opts.priceCents * 0.6) }),
    // portal-checkout-direct.ts statically imports these; the webhook path never
    // calls them (that's create-session's job) but the ESM binding must exist.
    isServiceFree: () => false,
    resolveEffectiveChargeCents: () => 0,
    seatBandViolationMessage: () => null,
  },
});

const noop = () => {};
const noopLogger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, trace: noop, child: () => noopLogger };
mock.module("../lib/logger.ts", { namedExports: { logger: noopLogger } });

mock.module("../lib/sales-offer-engine.ts", {
  namedExports: { transitionOfferState: async () => {} },
});

mock.module("../lib/sse-channels.ts", {
  namedExports: {
    broadcastCustomerOfferChange: () => {},
    broadcastMspOfferChange: () => {},
  },
});

mock.module("../lib/workflow-executor.ts", {
  namedExports: { emitWorkflowEvent: async () => {} },
});

mock.module("../lib/captcha.ts", {
  namedExports: { verifyCaptchaToken: async () => true },
});

// portal-checkout.ts now transitively imports portal-checkout-direct.ts (Git
// #1165), whose module graph pulls in these side-effecting libs. Stub them so
// the router imports cleanly and the direct-marketing handler's provisioning
// tail can be asserted without real DB/Graph/CRM calls.
mock.module("../lib/tenant-signals.ts", {
  namedExports: {
    resolveCustomerIdForPortalUser: async () => 42,
    resolveCustomerPortalUserId: async () => 5,
  },
});

mock.module("../lib/audit.ts", {
  namedExports: { createAuditLog: async () => {} },
});

mock.module("../lib/mailer.ts", {
  namedExports: {
    sendEmail: async () => {},
    purchaseConfirmationEmail: () => "<p>ok</p>",
  },
});

mock.module("../lib/crm-pipeline.ts", {
  namedExports: { markAssessmentLeadPurchased: async () => {} },
});

const { default: portalCheckoutRouter } = await import("./portal-checkout.ts");
const { default: express } = await import("express");

const app = express();
app.use("/api/portal/stripe/webhook", express.raw({ type: "*/*" }));
app.use(express.json());
app.use("/api", portalCheckoutRouter);

let server: http.Server;
let baseUrl: string;

before(
  () =>
    new Promise<void>((resolve) => {
      server = http.createServer(app);
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    }),
);

after(
  () =>
    new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    }),
);

async function postWebhook(event: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/api/portal/stripe/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": "t=fake,v1=fake" },
    body: JSON.stringify(event),
  });
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

function makePortalOfferEvent(): Record<string, unknown> {
  return {
    id: "evt_test_portal_offer_completed",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_portal_offer_abc123",
        object: "checkout.session",
        payment_status: "paid",
        amount_total: 25000,
        subscription: null,
        customer_email: "customer@example.com",
        customer_details: { name: "Test Customer", email: "customer@example.com" },
        metadata: {
          fulfillment_type: "portal_offer",
          offerId: "17",
          customerId: "42",
          fulfillmentTypeKey: "add_on_service",
          serviceClass: "add_on",
          serviceName: "Extra Seats",
        },
      },
    },
  };
}

describe("webhook: portal_offer checkout.session.completed is routed to resolveFulfillment", () => {
  let status: number;
  let body: Record<string, unknown>;

  before(async () => {
    resolveFulfillmentCalls = [];
    // platformAgreementsTable select — no current-version row seeded
    dbQueue = [[]];
    const event = makePortalOfferEvent();
    ({ status, body } = await postWebhook(event));
    // handler processes after acking — give the async tail time to run
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  it("acknowledges the webhook with HTTP 200", () => {
    assert.equal(status, 200);
  });

  it("responds with { received: true }", () => {
    assert.deepEqual(body, { received: true });
  });

  it("calls resolveFulfillment exactly once", () => {
    assert.equal(resolveFulfillmentCalls.length, 1);
  });

  it("resolveFulfillment receives the portal_offer metadata mapped into its payload", () => {
    const call = resolveFulfillmentCalls[0];
    assert.equal(call.fulfillmentTypeKey, "add_on_service");
    assert.equal(call.idempotencyKey, "portal_offer_checkout:session:cs_test_portal_offer_abc123");
    assert.equal(call.trigger, "purchase");
    const payload = call.payload as Record<string, unknown>;
    assert.equal(payload.offerId, 17);
    assert.equal(payload.customerId, 42);
    assert.equal(payload.serviceName, "Extra Seats");
    assert.equal(payload.serviceClass, "add_on");
    assert.equal(payload.amountCents, 25000);
  });
});

describe("webhook: non-portal_offer checkout.session.completed is ignored", () => {
  let status: number;
  let body: Record<string, unknown>;

  before(async () => {
    resolveFulfillmentCalls = [];
    dbQueue = [];
    const event = makePortalOfferEvent();
    (event.data as { object: { metadata: Record<string, unknown> } }).object.metadata = {
      type: "service_purchase",
    };
    ({ status, body } = await postWebhook(event));
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it("still acknowledges with HTTP 200 (no error surfaced to Stripe)", () => {
    assert.equal(status, 200);
  });

  it("responds with { received: true }", () => {
    assert.deepEqual(body, { received: true });
  });

  it("does not call resolveFulfillment for a non-portal_offer session", () => {
    assert.equal(resolveFulfillmentCalls.length, 0);
  });
});

// ── Direct-customer marketing paid checkout (Git #1165) ───────────────────────

function makeDirectMarketingEvent(): Record<string, unknown> {
  return {
    id: "evt_test_direct_marketing_completed",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_direct_marketing_xyz789",
        object: "checkout.session",
        payment_status: "paid",
        amount_total: 12000,
        subscription: "sub_test_123",
        customer_email: "buyer@example.com",
        customer_details: { name: "Buyer Co", email: "buyer@example.com" },
        metadata: {
          checkout_kind: "direct_marketing",
          serviceIds: "1",
          contractIds: "",
          guestEmail: "buyer@example.com",
          buyerUserId: "5",
          seats: "10",
          amountCents: "12000",
        },
      },
    },
  };
}

describe("webhook: direct_marketing checkout.session.completed provisions via resolveFulfillment (Git #1165)", () => {
  let status: number;
  let body: Record<string, unknown>;

  before(async () => {
    resolveFulfillmentCalls = [];
    // 1) buyer lookup by guestEmail, 2) service row lookup in the provisioning loop
    dbQueue = [
      [{ id: 5, name: "Buyer Co", email: "buyer@example.com", passwordHash: null }],
      [{ id: 1, name: "Foundation Monitoring — Micro", serviceClass: "subscription", fulfillmentTypeKey: "monitoring_subscription" }],
    ];
    ({ status, body } = await postWebhook(makeDirectMarketingEvent()));
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  it("acknowledges the webhook with HTTP 200", () => {
    assert.equal(status, 200);
  });

  it("responds with { received: true }", () => {
    assert.deepEqual(body, { received: true });
  });

  it("calls resolveFulfillment exactly once", () => {
    assert.equal(resolveFulfillmentCalls.length, 1);
  });

  it("drives monitoring provisioning (B1) with the buyer's user id, tenant, service and subscription", () => {
    const call = resolveFulfillmentCalls[0];
    assert.equal(call.fulfillmentTypeKey, "monitoring_subscription");
    assert.equal(call.idempotencyKey, "direct_checkout:session:cs_test_direct_marketing_xyz789:svc:1");
    assert.equal(call.trigger, "purchase");
    const payload = call.payload as Record<string, unknown>;
    assert.equal(payload.clientUserId, 5);
    assert.equal(payload.customerId, 42);
    assert.equal(payload.serviceId, 1);
    assert.equal(payload.subscriptionId, "sub_test_123");
    assert.equal(payload.amountCents, 12000);
  });
});

describe("webhook: unpaid direct_marketing session does not provision", () => {
  let status: number;

  before(async () => {
    resolveFulfillmentCalls = [];
    dbQueue = [];
    const event = makeDirectMarketingEvent();
    (event.data as { object: { payment_status: string } }).object.payment_status = "unpaid";
    ({ status } = await postWebhook(event));
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it("acknowledges with HTTP 200 but calls resolveFulfillment zero times", () => {
    assert.equal(status, 200);
    assert.equal(resolveFulfillmentCalls.length, 0);
  });
});
