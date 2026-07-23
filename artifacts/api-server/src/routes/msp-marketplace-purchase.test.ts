/**
 * msp-marketplace-purchase.test.ts
 *
 * Unit tests for the MSP-initiated "purchase for this customer" endpoint.
 *
 * Uses the REAL requireAuth.ts middleware (not mocked) so requireRole and
 * assertCustomerAccess's staff-scoping logic run for real — only @workspace/db
 * is mocked, exactly like msp-diagnostics.test.ts / msp-alerts.test.ts.
 *
 * assertCustomerAccess issues 2 sequential db.select calls for MSP staff
 * (customer-ownership check, then the staff-scope check); this route's own
 * resolveScopedCustomer does one more (customer lookup for mspId) first —
 * 3 selects total for every request that reaches the handler body.
 *
 * Covers:
 *   - 401 without auth, 403 below MSPOperator
 *   - 404 when the target customer doesn't belong to the caller's MSP
 *   - 404 when a staff-scoped operator is scoped OUT of this customer
 *     (assigned to a different customer set) — the "cannot purchase for a
 *     customer outside their assigned set" requirement
 *   - 422 for a "project" serviceClass item (no self-serve SOW signature path)
 *   - 422 for a consultation-priced (priceCents null) item
 *   - free ($0): skips Stripe, records an accepted sales offer, resolveFulfillment called
 *   - paid (add_on): Stripe PaymentIntent charged to the MSP's card, sales offer recorded accepted
 *
 * Run: pnpm --filter @workspace/api-server run test -- msp-marketplace-purchase
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const JWT_SECRET = "msp-marketplace-purchase-test-secret";
process.env["JWT_SECRET"] = JWT_SECRET;

const MSP_ID = 900;
const CUSTOMER_ID = 5;
const SERVICE_ID = 77;

function mspToken(mspRole: "MSPOperator" | "MSPAdmin" | "CustomerUser" = "MSPOperator"): string {
  return jwt.sign({ id: 1, email: "staff@test.com", role: "client", mspRole, mspId: MSP_ID }, JWT_SECRET, { expiresIn: "1h" });
}

const {
  mockDbSelect,
  mockDbInsert,
  mockResolveFulfillment,
  mockCreateAuditLog,
} = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbInsert: vi.fn(),
  mockResolveFulfillment: vi.fn(),
  mockCreateAuditLog: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { select: mockDbSelect, insert: mockDbInsert },
  servicesTable: {
    id: "id", name: "name", description: "description", serviceClass: "service_class",
    fulfillmentTypeKey: "fulfillment_type_key", allowFreeCheckout: "allow_free_checkout",
    trialPeriodDays: "trial_period_days", internalCostCents: "internal_cost_cents",
    priceCents: "price_cents", visibility: "visibility", serviceType: "service_type",
    sortOrder: "sort_order",
  },
  salesOffersTable: {
    id: "id", customerId: "customer_id", serviceId: "service_id", mspId: "msp_id",
    title: "title", state: "state",
  },
  mspCustomersTable: { id: "id", mspId: "msp_id" },
  mspStaffCustomerScopesTable: { customerId: "customer_id", staffUserId: "staff_user_id", mspId: "msp_id" },
  mspSubscriptionsTable: { mspId: "msp_id", stripeCustomerId: "stripe_customer_id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((c: unknown, v: unknown) => ({ eq: [c, v] })),
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  asc: vi.fn((c: unknown) => ({ asc: c })),
  inArray: vi.fn((c: unknown, v: unknown) => ({ inArray: [c, v] })),
}));

vi.mock("../lib/request-context.ts", () => ({ enrichRequestContext: vi.fn() }));

vi.mock("../lib/logger", () => {
  const stub = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});

vi.mock("../lib/resolve-fulfillment", () => ({ resolveFulfillment: mockResolveFulfillment }));
vi.mock("../lib/audit", () => ({ createAuditLog: mockCreateAuditLog }));
vi.mock("../lib/sse-channels", () => ({
  broadcastCustomerOfferChange: vi.fn(),
  broadcastMspOfferChange: vi.fn(),
}));
vi.mock("../lib/stripe", () => ({
  getStripeKey: vi.fn().mockReturnValue("sk_test_xxx"),
  getMspDefaultPaymentMethod: vi.fn().mockResolvedValue("pm_test"),
}));

const mockStripePaymentIntentsCreate = vi.fn().mockResolvedValue({ id: "pi_test", status: "succeeded" });
const mockStripeSubscriptionsCreate = vi.fn().mockResolvedValue({ id: "sub_test", status: "active" });
const mockStripeProductsCreate = vi.fn().mockResolvedValue({ id: "prod_test" });

vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(function () {
    return {
      paymentIntents: { create: mockStripePaymentIntentsCreate },
      subscriptions: { create: mockStripeSubscriptionsCreate },
      products: { create: mockStripeProductsCreate },
    };
  }),
}));

function selectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain["then"] = (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve);
  return chain;
}

function insertChain(rows: unknown[] = []) {
  const chain: Record<string, unknown> = {};
  chain["values"] = vi.fn().mockReturnValue(chain);
  chain["returning"] = vi.fn().mockResolvedValue(rows);
  chain["then"] = (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve);
  return chain;
}

async function makeApp() {
  const { default: router } = await import("./msp-marketplace-purchase");
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return app;
}

const customerRow = { id: CUSTOMER_ID, mspId: MSP_ID };
const addOnService = {
  id: SERVICE_ID, name: "M365 Security Add-On", description: "desc",
  serviceClass: "add_on", fulfillmentTypeKey: "assessment", allowFreeCheckout: true,
  trialPeriodDays: null, internalCostCents: null, priceCents: 10_000, price: null,
  typeAttributes: {}, deliverables: [], inclusions: [], features: [], billingType: "one_time",
  slug: null, tagline: null, category: null, serviceType: "micro_offer", badge: null, highlighted: false,
};
const freeService = { ...addOnService, priceCents: 0 };
const projectService = { ...addOnService, serviceClass: "project" };
const consultationService = { ...addOnService, priceCents: null };
// A really-priced catalog row whose price lives ONLY in the legacy base_price
// decimal column — the exact shape POST /admin/catalog/import produces for an
// assessment (its import allow-list carries basePrice, not price, and never
// wrote price_cents). toMarketplaceService used to read `price` only, so this
// resolved to null and was rejected here as "priced on consultation" — a real,
// publicly-listed, really-priced product that could not be bought.
const legacyBasePriceService = {
  ...addOnService, priceCents: null, price: null, basePrice: "250.00", serviceType: "assessment",
};
// Non-numeric junk in a legacy column must resolve to "on consultation" (422),
// never to NaN — a NaN would previously have flowed into a Stripe unit_amount.
const junkPriceService = { ...addOnService, priceCents: null, price: "TBD", basePrice: null };

/** Queues the 3 scoping selects (own lookup, assertCustomerAccess ownership, staff-scope). */
function queueScopingSelects(opts?: { unrestricted?: boolean; scopeRows?: unknown[] }) {
  mockDbSelect.mockReturnValueOnce(selectChain([customerRow])); // resolveScopedCustomer's own lookup
  mockDbSelect.mockReturnValueOnce(selectChain([customerRow])); // assertCustomerAccess ownership check
  mockDbSelect.mockReturnValueOnce(selectChain(opts?.scopeRows ?? [])); // staff scope rows (empty = unrestricted)
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveFulfillment.mockResolvedValue({ status: "emitted" });
  mockCreateAuditLog.mockResolvedValue(undefined);
});

describe("GET /msp/customers/:customerId/marketplace/catalog", () => {
  it("rejects unauthenticated requests", async () => {
    const app = await makeApp();
    const res = await request(app).get(`/api/msp/customers/${CUSTOMER_ID}/marketplace/catalog`);
    expect(res.status).toBe(401);
  });

  it("rejects roles below MSPOperator", async () => {
    const app = await makeApp();
    const res = await request(app)
      .get(`/api/msp/customers/${CUSTOMER_ID}/marketplace/catalog`)
      .set("Authorization", `Bearer ${mspToken("CustomerUser")}`);
    expect(res.status).toBe(403);
  });

  it("returns the catalog for an in-scope customer", async () => {
    queueScopingSelects();
    mockDbSelect.mockReturnValueOnce(selectChain([addOnService]));
    const app = await makeApp();
    const res = await request(app)
      .get(`/api/msp/customers/${CUSTOMER_ID}/marketplace/catalog`)
      .set("Authorization", `Bearer ${mspToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.services).toHaveLength(1);
    expect(res.body.services[0].name).toBe("M365 Security Add-On");
  });
});

describe("POST /msp/customers/:customerId/marketplace/checkout", () => {
  it("404s when the customer doesn't belong to the caller's MSP", async () => {
    mockDbSelect.mockReturnValueOnce(selectChain([])); // resolveScopedCustomer's own lookup finds nothing
    const app = await makeApp();
    const res = await request(app)
      .post(`/api/msp/customers/${CUSTOMER_ID}/marketplace/checkout`)
      .set("Authorization", `Bearer ${mspToken()}`)
      .send({ serviceId: SERVICE_ID });
    expect(res.status).toBe(404);
  });

  it("404s a staff-scoped operator assigned to a different customer set", async () => {
    // Customer exists under the caller's MSP, but the staff member is scoped
    // to OTHER customers only — isCustomerBlockedByStaffScope must deny.
    mockDbSelect.mockReturnValueOnce(selectChain([customerRow]));
    mockDbSelect.mockReturnValueOnce(selectChain([customerRow]));
    mockDbSelect.mockReturnValueOnce(selectChain([{ customerId: 999 }]));
    const app = await makeApp();
    const res = await request(app)
      .post(`/api/msp/customers/${CUSTOMER_ID}/marketplace/checkout`)
      .set("Authorization", `Bearer ${mspToken()}`)
      .send({ serviceId: SERVICE_ID });
    expect(res.status).toBe(404);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("422s a project-class item (no self-serve SOW signature path)", async () => {
    queueScopingSelects();
    mockDbSelect.mockReturnValueOnce(selectChain([projectService]));
    const app = await makeApp();
    const res = await request(app)
      .post(`/api/msp/customers/${CUSTOMER_ID}/marketplace/checkout`)
      .set("Authorization", `Bearer ${mspToken()}`)
      .send({ serviceId: SERVICE_ID });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/Statement of Work/);
  });

  it("422s a consultation-priced item (no fixed price)", async () => {
    queueScopingSelects();
    mockDbSelect.mockReturnValueOnce(selectChain([consultationService]));
    const app = await makeApp();
    const res = await request(app)
      .post(`/api/msp/customers/${CUSTOMER_ID}/marketplace/checkout`)
      .set("Authorization", `Bearer ${mspToken()}`)
      .send({ serviceId: SERVICE_ID });
    expect(res.status).toBe(422);
  });

  it("resolves a legacy base_price-only row instead of 422ing it as consultation-priced", async () => {
    queueScopingSelects();
    mockDbSelect.mockReturnValueOnce(selectChain([legacyBasePriceService]));
    mockDbSelect.mockReturnValueOnce(selectChain([{ stripeCustomerId: "cus_test" }])); // mspSubscriptionsTable
    mockDbInsert.mockReturnValueOnce(insertChain([{ id: 503 }])); // salesOffersTable insert

    const app = await makeApp();
    const res = await request(app)
      .post(`/api/msp/customers/${CUSTOMER_ID}/marketplace/checkout`)
      .set("Authorization", `Bearer ${mspToken()}`)
      .send({ serviceId: SERVICE_ID });

    expect(res.status).toBe(201);
    expect(res.body.outcome).toBe("payment_processed");
    const piCall = mockStripePaymentIntentsCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    // $250.00 base_price → 25_000 retail cents → 70% default wholesale margin
    expect(piCall["amount"]).toBe(17_500);
  });

  it("422s a row whose legacy price column holds non-numeric text (never NaN)", async () => {
    queueScopingSelects();
    mockDbSelect.mockReturnValueOnce(selectChain([junkPriceService]));
    const app = await makeApp();
    const res = await request(app)
      .post(`/api/msp/customers/${CUSTOMER_ID}/marketplace/checkout`)
      .set("Authorization", `Bearer ${mspToken()}`)
      .send({ serviceId: SERVICE_ID });
    expect(res.status).toBe(422);
    expect(mockStripePaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("free ($0): skips Stripe, records an accepted offer, calls resolveFulfillment", async () => {
    queueScopingSelects();
    mockDbSelect.mockReturnValueOnce(selectChain([freeService]));
    mockDbInsert.mockReturnValueOnce(insertChain([{ id: 501 }])); // salesOffersTable insert

    const app = await makeApp();
    const res = await request(app)
      .post(`/api/msp/customers/${CUSTOMER_ID}/marketplace/checkout`)
      .set("Authorization", `Bearer ${mspToken()}`)
      .send({ serviceId: SERVICE_ID });

    expect(res.status).toBe(201);
    expect(res.body.outcome).toBe("free_activated");
    expect(mockStripePaymentIntentsCreate).not.toHaveBeenCalled();
    expect(mockResolveFulfillment).toHaveBeenCalledOnce();
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "msp.marketplace.purchase_for_customer", clientId: CUSTOMER_ID }),
    );
  });

  it("paid (add_on): charges the MSP's saved card, records an accepted offer", async () => {
    queueScopingSelects();
    mockDbSelect.mockReturnValueOnce(selectChain([addOnService]));
    mockDbSelect.mockReturnValueOnce(selectChain([{ stripeCustomerId: "cus_test" }])); // mspSubscriptionsTable
    mockDbInsert.mockReturnValueOnce(insertChain([{ id: 502 }])); // salesOffersTable insert

    const app = await makeApp();
    const res = await request(app)
      .post(`/api/msp/customers/${CUSTOMER_ID}/marketplace/checkout`)
      .set("Authorization", `Bearer ${mspToken()}`)
      .send({ serviceId: SERVICE_ID });

    expect(res.status).toBe(201);
    expect(res.body.outcome).toBe("payment_processed");
    expect(mockStripePaymentIntentsCreate).toHaveBeenCalledOnce();
    const piCall = mockStripePaymentIntentsCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(piCall["customer"]).toBe("cus_test");
    expect(piCall["amount"]).toBe(7_000); // 70% default wholesale margin of 10_000
    expect(mockResolveFulfillment).toHaveBeenCalledOnce();
    expect(mockCreateAuditLog).toHaveBeenCalledOnce();
  });
});
