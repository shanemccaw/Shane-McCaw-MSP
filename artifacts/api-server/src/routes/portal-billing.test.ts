import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

// Top level variables prefixed with 'mock' to bypass hoisting checks.
// mockSelectResultsQueue is consumed in FIFO order by successive db.select()
// chains, falling back to [] once exhausted — same pattern as
// portal-team.test.ts / admin-clients.test.ts.
let mockSelectResultsQueue: any[][] = [];
let mockDefaultSelectResult: any[] = [];

vi.mock("@workspace/db", () => {
  const makeSelectChain = () => {
    const chain: any = {
      from: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (onfulfilled: any, onrejected?: any) => {
        const result = mockSelectResultsQueue.length > 0
          ? mockSelectResultsQueue.shift()!
          : mockDefaultSelectResult;
        return Promise.resolve(result).then(onfulfilled, onrejected);
      },
    };
    return chain;
  };

  const updateChain: any = {
    set: () => updateChain,
    where: () => updateChain,
    then: (onfulfilled: any) => Promise.resolve({}).then(onfulfilled),
  };

  const mockDb = {
    select: vi.fn().mockImplementation(() => makeSelectChain()),
    update: vi.fn().mockImplementation(() => updateChain),
  };

  const table = (name: string) => ({ __table: name });

  // Trimmed to exactly the tables portal-billing.ts imports directly from
  // @workspace/db, plus tenantsTable/mspStaffCustomerScopesTable so the real
  // ../middlewares/requireAuth.ts (used un-mocked here) resolves its own
  // @workspace/db imports to a defined value.
  return {
    db: mockDb,
    invoicesTable: table("invoices"),
    projectsTable: table("projects"),
    usersTable: { id: "id", email: "email", role: "role", name: "name", tenantId: "tenant_id", mspId: "msp_id", mspRole: "msp_role" },
    contractsTable: table("contracts"),
    servicesTable: table("services"),
    clientServicesTable: table("clientServices"),
    tenantsTable: { id: "id", mspId: "msp_id" },
    mspStaffCustomerScopesTable: table("mspStaffCustomerScopes"),
  };
});

vi.mock("../lib/audit.ts", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/sms.ts", () => ({
  sendAdminSms: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/mailer.ts", () => ({
  sendEmailFromTemplate: vi.fn().mockResolvedValue(undefined),
  getTenantHealthBlockHtml: vi.fn().mockResolvedValue(""),
  canSendAutomatedCustomerEmail: vi.fn().mockResolvedValue(false),
  retainerResumedEmail: vi.fn().mockReturnValue(""),
}));

// portal-billing.ts does `const log = logger.child(...)` at module scope.
vi.mock("../lib/logger.ts", () => {
  const child = vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child,
  }));
  return { logger: { child, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

vi.mock("../lib/stripe.ts", () => ({
  getStripeKey: vi.fn().mockReturnValue("sk_test_fake"),
}));

// Deliberately NOT mocking ../lib/portal-url.ts — the whole point of this
// regression test is to exercise the REAL getMspPortalBaseUrl() and prove
// it, not a stub, drives the Stripe success_url/cancel_url.

const mockCheckoutSessionsCreate = vi.fn().mockResolvedValue({ id: "cs_test_123", url: "https://checkout.stripe.com/test" });
const mockCustomersSearch = vi.fn().mockResolvedValue({ data: [] });
const mockCustomersCreate = vi.fn().mockResolvedValue({ id: "cus_test_123" });
const mockCustomersUpdate = vi.fn().mockResolvedValue({});

const mockBillingPortalSessionsCreate = vi.fn().mockResolvedValue({ id: "bps_test_123", url: "https://billing.stripe.com/test" });
const mockSubscriptionsRetrieve = vi.fn();

vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(function () {
    return {
      checkout: { sessions: { create: mockCheckoutSessionsCreate } },
      billingPortal: { sessions: { create: mockBillingPortalSessionsCreate } },
      subscriptions: { retrieve: mockSubscriptionsRetrieve },
      customers: {
        search: mockCustomersSearch,
        create: mockCustomersCreate,
        update: mockCustomersUpdate,
      },
    };
  }),
}));

import router from "./portal-billing.ts";
import { setGrantRole } from "../middlewares/rbac-capability.ts";
import { CUSTOMER_PLATFORM_ROLE_KEYS } from "@workspace/db/rbac/legacy-ladder";

// getMspPortalBaseUrl() resolves off PORTAL_BASE_URL (highest priority, see
// ../lib/portal-url.ts) so this test drives it deterministically rather than
// falling through to REPLIT_DOMAINS/REPLIT_DEV_DOMAIN or the "" default.
const REAL_PORTAL_BASE_URL = "https://msp.example.com";
process.env.PORTAL_BASE_URL = REAL_PORTAL_BASE_URL;

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  // Minimal req.log stub — real requests get this from pino-http; requireAuth
  // calls req.log.child(...) when present.
  (req as any).log = { child: () => (req as any).log, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  next();
});
// portal-billing.ts's own routes already carry the literal "/portal/billing/..."
// prefix, so mounting at "/api" hits the real
// "/api/portal/billing/subscriptions/:id/resubscribe" path.
app.use("/api", router);

const JWT_SECRET = "test-secret";
process.env.JWT_SECRET = JWT_SECRET;

// #3465 — every route here now asks a customer capability, which is decided from the
// caller's rung. A real customer session always carries one (auth.ts buildUserPayload),
// so the token does too; a claim-less token is refused, see
// portal-billing-capability-gates.test.ts.
function makeClientToken(userId: number): string {
  return jwt.sign(
    { id: userId, email: "client@example.com", role: "client", mspRole: "Customer", mspId: 1, customerId: 1 },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

// #3629 — billing is no longer every rung: it is the Customer Admin and Billing roles
// plus MSP staff. The subscriber these routes act for holds Billing (the migration's
// client_services trigger grants it to whoever a subscription is addressed to), so the
// test principal is granted it the same way — a membership row, not a wider fixture.
async function grantBilling(userId: number): Promise<void> {
  expect(await setGrantRole("customer", userId, CUSTOMER_PLATFORM_ROLE_KEYS.billing, true, null)).toEqual({ ok: true });
}

// #3648 (part of #1696): the read routes below used to scope to the caller's own
// userId regardless of the capability requireCustomerCapability just checked, so a
// Customer Admin / Billing holder without a bill of their own saw an empty ledger.
// billingScopeUserIds() (unit-tested directly in ../lib/portal-billing-scope.test.ts)
// resolves the tenant's user ids first — this proves the ROUTES actually call it: a
// tenant-carrying caller does the extra users-table lookup before the real query, and
// a caller with no tenant (the MSP-staff token shape) skips it and falls back to
// their own id, matching the pre-#3648 behavior exactly for that case.
describe("GET /api/portal/invoices (#3648 tenant-wide visibility)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectResultsQueue = [];
    mockDefaultSelectResult = [];
  });

  it("resolves the caller's tenant first, then returns every invoice under it — not just the caller's own", async () => {
    const userId = 21;
    const token = makeClientToken(userId);
    await grantBilling(userId);

    const tenantInvoices = [
      { id: 1, clientUserId: userId, amount: 1000 },
      { id: 2, clientUserId: 99, amount: 2000 }, // a colleague's invoice
    ];
    mockSelectResultsQueue = [
      [{ id: userId }, { id: 99 }], // billingScopeUserIds' users-table lookup
      tenantInvoices, // the invoices query itself
    ];

    const res = await request(app)
      .get("/api/portal/invoices")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(tenantInvoices);
    // The FIRST select was the tenant-user-id lookup, keyed on usersTable.id.
    const { db } = await import("@workspace/db");
    expect((db.select as any).mock.calls[0][0]).toEqual({ id: "id" });
  });

  it("falls back to a single own-id lookup, no tenant query, for a caller with no customerId", async () => {
    const userId = 21;
    // No customerId claim at all — the MSP-staff token shape.
    const token = jwt.sign(
      { id: userId, email: "staff@example.com", role: "admin", mspRole: "MSPAdmin", mspId: 1 },
      JWT_SECRET,
      { expiresIn: "1h" },
    );
    await grantBilling(userId);

    mockSelectResultsQueue = [[{ id: 1, clientUserId: userId, amount: 500 }]];

    const res = await request(app)
      .get("/api/portal/invoices")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const { db } = await import("@workspace/db");
    // Only ONE select call — no tenant-scope lookup ran, matching pre-#3648 behavior
    // for a caller with nothing to widen against.
    expect((db.select as any).mock.calls.length).toBe(1);
  });
});

describe("GET /api/portal/invoices/:id (#3648 cross-user invoice detail)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectResultsQueue = [];
    mockDefaultSelectResult = [];
  });

  it("keys the project/contracts lookups off the invoice's OWNER, not the caller viewing it", async () => {
    const callerId = 21; // a Customer Admin / Billing holder
    const ownerId = 99; // the colleague the invoice actually belongs to
    const token = makeClientToken(callerId);
    await grantBilling(callerId);

    const invoice = { id: 7, clientUserId: ownerId, projectId: 3, amount: 1000 };
    mockSelectResultsQueue = [
      [{ id: callerId }, { id: ownerId }], // billingScopeUserIds' users-table lookup
      [invoice], // the invoice lookup itself
      [{ id: 3, title: "Owner's Project" }], // project lookup
      [{ name: "Owner Name" }], // clientUser lookup
      [{ id: 55, serviceId: 4, serviceName: "Managed IT", signedAt: new Date(), signerName: null, contractVersion: "v1", finalPrice: null, wizardSelections: null, orderWorkflow: null }], // contracts lookup
    ];

    const res = await request(app)
      .get(`/api/portal/invoices/${invoice.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.project).toEqual({ id: 3, title: "Owner's Project" });
    expect(res.body.contracts).toHaveLength(1);
  });
});

describe("GET /api/portal/billing/subscriptions (#3648 tenant-wide visibility)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectResultsQueue = [];
    mockDefaultSelectResult = [];
  });

  it("returns a colleague's subscription too, once the tenant scope resolves it", async () => {
    const callerId = 21;
    const token = makeClientToken(callerId);
    await grantBilling(callerId);

    mockSelectResultsQueue = [
      [{ id: callerId }, { id: 99 }], // billingScopeUserIds' users-table lookup
      [{
        cs: { id: 1, clientUserId: 99, serviceId: 3, status: "active", stripeSubscriptionId: null, billingInterval: "month", pendingBillingInterval: null, startDate: null, purchasedAt: new Date() },
        svc: { id: 3, name: "Managed IT Retainer", slug: "managed-it", billingType: "recurring_monthly" },
      }],
    ];

    const res = await request(app)
      .get("/api/portal/billing/subscriptions")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(1);
  });
});

// #175 (portal.ts route decommission, carrying forward the #172 mailer.ts
// PORTAL_URL fix): when this resubscribe route was moved out of portal.ts
// into portal-billing.ts, its Stripe checkout session's success_url/
// cancel_url were also fixed off a hardcoded dead `/crm/portal/billing`
// artifact path onto the real getMspPortalBaseUrl(). Guard against that
// dead path silently coming back.
describe("POST /api/portal/billing/subscriptions/:id/resubscribe (#175)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectResultsQueue = [];
    mockDefaultSelectResult = [];
    mockCheckoutSessionsCreate.mockResolvedValue({ id: "cs_test_123", url: "https://checkout.stripe.com/test" });
    mockCustomersSearch.mockResolvedValue({ data: [] });
    mockCustomersCreate.mockResolvedValue({ id: "cus_test_123" });
  });

  it("builds the Stripe checkout session's success_url/cancel_url off getMspPortalBaseUrl(), never the retired /crm path", async () => {
    const userId = 21;
    const clientServiceId = 7;
    const token = makeClientToken(userId);
    await grantBilling(userId);

    mockSelectResultsQueue = [
      // clientServicesTable innerJoin servicesTable lookup
      [{
        cs: { id: clientServiceId, clientUserId: userId, serviceId: 3, status: "cancelled" },
        svc: { id: 3, name: "Managed IT Retainer", description: "Monthly managed services", price: "199.00" },
      }],
      // usersTable profile lookup (for getOrCreateStripeCustomer)
      [{
        email: "client@example.com",
        name: "Test Client",
        address: null,
        addressCity: null,
        addressState: null,
        addressZip: null,
      }],
    ];

    const res = await request(app)
      .post(`/api/portal/billing/subscriptions/${clientServiceId}/resubscribe`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(mockCheckoutSessionsCreate).toHaveBeenCalledTimes(1);

    const [sessionArgs] = mockCheckoutSessionsCreate.mock.calls[0];
    expect(sessionArgs.success_url).toBe(`${REAL_PORTAL_BASE_URL}/portal/billing?payment=success`);
    expect(sessionArgs.cancel_url).toBe(`${REAL_PORTAL_BASE_URL}/portal/billing?payment=cancelled`);
    expect(sessionArgs.success_url.startsWith(`${REAL_PORTAL_BASE_URL}/portal/billing`)).toBe(true);
    expect(sessionArgs.cancel_url.startsWith(`${REAL_PORTAL_BASE_URL}/portal/billing`)).toBe(true);
    expect(sessionArgs.success_url).not.toContain("/crm");
    expect(sessionArgs.cancel_url).not.toContain("/crm");
  });
});

// #177 (follow-up to #175): the Stripe customer-portal route
// (POST /portal/billing/customer-portal, a separate route from the
// resubscribe one covered above) still hardcoded its return_url off a
// retired `/crm/portal/billing` artifact path. Guard against that dead path
// coming back.
describe("POST /api/portal/billing/customer-portal (#177)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectResultsQueue = [];
    mockDefaultSelectResult = [];
    mockBillingPortalSessionsCreate.mockResolvedValue({ id: "bps_test_123", url: "https://billing.stripe.com/test" });
    mockSubscriptionsRetrieve.mockResolvedValue({
      customer: { id: "cus_test_123", deleted: false },
    });
  });

  it("builds the Stripe billing portal session's return_url off getMspPortalBaseUrl(), never the retired /crm path", async () => {
    const userId = 21;
    const token = makeClientToken(userId);
    await grantBilling(userId);

    mockSelectResultsQueue = [
      // clientServicesTable innerJoin servicesTable lookup for an active subscription
      [{
        client_services: { id: 7, clientUserId: userId, stripeSubscriptionId: "sub_test_123" },
        services: { id: 3, billingType: "recurring_monthly" },
      }],
    ];

    const res = await request(app)
      .post("/api/portal/billing/customer-portal")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(mockBillingPortalSessionsCreate).toHaveBeenCalledTimes(1);

    const [sessionArgs] = mockBillingPortalSessionsCreate.mock.calls[0];
    expect(sessionArgs.return_url).toBe(`${REAL_PORTAL_BASE_URL}/portal/billing`);
    expect(sessionArgs.return_url).not.toContain("/crm");
  });
});
