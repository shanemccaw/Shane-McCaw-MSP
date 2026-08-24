/**
 * Tests for portal-checkout-direct.ts's `POST /portal/checkout/create-session`
 * — the direct-customer paid checkout (Git #1165, Blocker B3).
 *
 * Uses the same node:test + mock.module() harness as
 * portal-checkout-webhook.test.ts. The REAL catalog-pricing.ts is deliberately
 * NOT mocked so the server-side amount + seat-band logic is exercised for real
 * against #1163's per-seat monitoring rows; everything with a side effect
 * (@workspace/db, stripe, captcha, the webhook-only libs) is stubbed.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-test-module-mocks \
 *     --test 'src/routes/portal-checkout-direct.test.ts'
 */
import { describe, it, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

let dbQueue: unknown[][] = [];
let stripeSessionArgs: Record<string, unknown> | null = null;

function makeChain(result: unknown[]): Record<string, unknown> {
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: () => chain,
    limit: () => chain,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
    catch: (reject: (e: unknown) => unknown) => Promise.resolve(result).catch(reject),
  };
  return chain;
}

function makeMockDb() {
  return {
    select: (_cols?: unknown) => makeChain(dbQueue.shift() ?? []),
    insert: () => ({ values: () => ({ returning: async () => [], onConflictDoNothing: () => ({ returning: async () => [] }) }) }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
  };
}

mock.module("stripe", {
  defaultExport: class MockStripe {
    constructor(_key: string) {}
    checkout = {
      sessions: {
        create: async (args: Record<string, unknown>) => {
          stripeSessionArgs = args;
          return { id: "cs_test_created_123", url: "https://checkout.stripe.com/c/pay/cs_test_created_123" };
        },
      },
    };
  },
});

mock.module("@workspace/db", {
  namedExports: {
    db: makeMockDb(),
    servicesTable: {},
    usersTable: {},
    contractsTable: {},
  },
});

mock.module("../lib/stripe.ts", {
  namedExports: { getStripeKey: () => "sk_test_direct_checkout" },
});

mock.module("../lib/captcha.ts", {
  namedExports: { verifyCaptchaToken: async () => ({ success: true }) },
});

mock.module("../lib/resolve-fulfillment.ts", {
  namedExports: { resolveFulfillment: async () => ({ status: "emitted" }) },
});

mock.module("../lib/tenant-signals.ts", {
  namedExports: { resolveCustomerIdForPortalUser: async () => 42 },
});

mock.module("../lib/audit.ts", { namedExports: { createAuditLog: async () => {} } });
mock.module("../lib/mailer.ts", {
  namedExports: { sendEmail: async () => {}, purchaseConfirmationEmail: () => "<p>ok</p>" },
});
mock.module("../lib/crm-pipeline.ts", { namedExports: { markAssessmentLeadPurchased: async () => {} } });

const noop = () => {};
const noopLogger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, trace: noop, child: () => noopLogger };
mock.module("../lib/logger.ts", { namedExports: { logger: noopLogger } });

const { default: router } = await import("./portal-checkout-direct.ts");
const { default: express } = await import("express");

const app = express();
app.use(express.json());
app.use("/api", router);

let server: http.Server;
let baseUrl: string;

before(
  () =>
    new Promise<void>((resolve) => {
      server = http.createServer(app);
      server.listen(0, "127.0.0.1", () => {
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        resolve();
      });
    }),
);

after(() => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))));

async function createSession(body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/api/portal/checkout/create-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

// #1163 Foundation Monitoring — Micro row (ppu 12, floor 15, band 1-25).
const microRow = {
  id: 1,
  slug: "monitoring-foundation-micro",
  name: "Foundation Monitoring — Micro",
  description: "Core monitoring",
  serviceClass: "subscription",
  billingType: "recurring_monthly",
  fulfillmentTypeKey: "monitoring_subscription",
  priceCents: null,
  price: null,
  basePrice: null,
  isFreeOffering: false,
  typeAttributes: { pricePerUserMonth: "12.00", seatCountFloor: "15", seatMin: "1", seatMax: "25", packageKey: "core:foundation" },
};
// Foundation SMB row (band 26-100) — used for the seat-band-violation case.
const smbRow = { ...microRow, id: 2, slug: "monitoring-foundation-smb", name: "Foundation Monitoring — SMB", typeAttributes: { pricePerUserMonth: "9.00", seatCountFloor: "26", seatMin: "26", seatMax: "100" } };

const okBody = {
  serviceIds: [1],
  contractIds: [],
  guestEmail: "buyer@example.com",
  successUrl: "https://shanemccaw.com/checkout/monitoring-foundation-micro?checkout_status=success",
  cancelUrl: "https://shanemccaw.com/checkout/monitoring-foundation-micro?checkout_status=canceled",
  seats: 10,
  captchaToken: "tok",
};

describe("create-session: happy path builds a subscription Stripe Checkout Session", () => {
  let status: number;
  let body: Record<string, unknown>;

  before(async () => {
    stripeSessionArgs = null;
    // 1) services lookup, 2) buyer lookup
    dbQueue = [[microRow], [{ id: 5, name: "Buyer Co" }]];
    ({ status, body } = await createSession(okBody));
  });

  it("returns 200 with the Stripe redirect url", () => {
    assert.equal(status, 200);
    assert.equal(body.url, "https://checkout.stripe.com/c/pay/cs_test_created_123");
  });

  it("uses subscription mode with a monthly recurring line item", () => {
    assert.ok(stripeSessionArgs);
    assert.equal(stripeSessionArgs!.mode, "subscription");
    const li = (stripeSessionArgs!.line_items as Array<Record<string, unknown>>)[0];
    const pd = li.price_data as Record<string, unknown>;
    assert.deepEqual(pd.recurring, { interval: "month" });
  });

  it("charges the server-resolved per-seat amount (12 × max(10,floor 15) = $180.00)", () => {
    const li = (stripeSessionArgs!.line_items as Array<Record<string, unknown>>)[0];
    const pd = li.price_data as Record<string, unknown>;
    assert.equal(pd.unit_amount, 18000);
  });

  it("stamps the direct_marketing marker + serviceIds in metadata", () => {
    const meta = stripeSessionArgs!.metadata as Record<string, string>;
    assert.equal(meta.checkout_kind, "direct_marketing");
    assert.equal(meta.serviceIds, "1");
    assert.equal(meta.guestEmail, "buyer@example.com");
  });
});

describe("create-session: a free service is rejected (belongs on the $0 path)", () => {
  it("returns 409", async () => {
    dbQueue = [[{ ...microRow, isFreeOffering: true, typeAttributes: {} }]];
    const { status } = await createSession(okBody);
    assert.equal(status, 409);
  });
});

describe("create-session: consent-first — an email with no account is rejected", () => {
  it("returns 409 when no buyer row exists", async () => {
    dbQueue = [[microRow], []]; // services found, buyer NOT found
    const { status, body } = await createSession(okBody);
    assert.equal(status, 409);
    assert.match(String(body.error), /Microsoft 365 connection/i);
  });
});

describe("create-session: seat count below the tier band is rejected", () => {
  it("returns 409 for 10 seats against a 26-100 band tier", async () => {
    dbQueue = [[smbRow]];
    const { status } = await createSession({ ...okBody, serviceIds: [2] });
    assert.equal(status, 409);
  });
});

describe("create-session: missing captcha is rejected", () => {
  it("returns 400 without a captcha token", async () => {
    dbQueue = [];
    const { status } = await createSession({ ...okBody, captchaToken: undefined });
    assert.equal(status, 400);
  });
});
