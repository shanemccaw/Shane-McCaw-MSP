/**
 * portal-retainer-billing-scope.test.ts (#3648, part of #1696)
 *
 * Route-level proof that portal-retainer-billing.ts's three billing-gated handlers
 * (GET retainer-intervals, POST switch-interval, POST cancel-interval-switch) are
 * wired to `billingScopeUserIds()` the same way portal-billing.ts's reads are
 * (see portal-billing.test.ts's own "#3648 tenant-wide visibility" describes, and
 * ../lib/portal-billing-scope.test.ts for the helper's own unit coverage):
 *
 *  - GET retainer-intervals returns a colleague's client_service, not just the
 *    caller's own;
 *  - POST switch-interval and POST cancel-interval-switch can find and act on a
 *    colleague's client_service row, and — the real correctness risk a scope
 *    widening like this creates — the audit log's `clientId` records the row's
 *    ACTUAL owner, never the acting caller, so "who did this" and "whose bill was
 *    touched" stay distinguishable once they can differ.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

let mockSelectResultsQueue: any[][] = [];
const mockUpdateSet = vi.fn();

vi.mock("@workspace/db", () => {
  const makeSelectChain = () => {
    const chain: any = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      limit: () => chain,
      then: (onfulfilled: any, onrejected?: any) =>
        Promise.resolve(mockSelectResultsQueue.length > 0 ? mockSelectResultsQueue.shift()! : []).then(onfulfilled, onrejected),
    };
    return chain;
  };
  const updateChain: any = {
    set: (vals: unknown) => { mockUpdateSet(vals); return updateChain; },
    where: () => Promise.resolve({}),
  };
  return {
    db: {
      select: vi.fn(() => makeSelectChain()),
      update: vi.fn(() => updateChain),
    },
    usersTable: { id: "id", tenantId: "tenant_id" },
    clientServicesTable: {
      id: "id", clientUserId: "client_user_id", serviceId: "service_id", status: "status",
      billingInterval: "billing_interval", pendingBillingInterval: "pending_billing_interval",
      stripeScheduleId: "stripe_schedule_id", stripeSubscriptionId: "stripe_subscription_id",
    },
    servicesTable: { id: "id", billingType: "billing_type", price: "price", annualPriceCents: "annual_price_cents", name: "name" },
    tenantsTable: { id: "id", mspId: "msp_id" },
    mspStaffCustomerScopesTable: { customerId: "customer_id" },
  };
});

vi.mock("../lib/retainer-pricing.ts", () => ({
  getOrCreateRetainerPrice: vi.fn().mockResolvedValue("price_test_123"),
  monthlyPriceCentsOf: vi.fn(() => null),
  scheduleIntervalSwitchAtPeriodEnd: vi.fn().mockResolvedValue({ scheduleId: "sched_test_1", effectiveAt: new Date("2026-10-01") }),
  RetainerPricingError: class RetainerPricingError extends Error {},
}));
vi.mock("../lib/stripe.ts", () => ({ getStripeKey: vi.fn().mockReturnValue("sk_test_fake") }));
vi.mock("../lib/sms.ts", () => ({ sendAdminSms: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/logger.ts", () => {
  const child = vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child }));
  return { logger: { child, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});
const mockCreateAuditLog = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/audit.ts", () => ({ createAuditLog: (e: unknown) => mockCreateAuditLog(e) }));
vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(function () {
    return { subscriptionSchedules: { release: vi.fn().mockResolvedValue({}) } };
  }),
}));

import router from "./portal-retainer-billing.ts";
import { setGrantRole } from "../middlewares/rbac-capability.ts";
import { CUSTOMER_PLATFORM_ROLE_KEYS } from "@workspace/db/rbac/legacy-ladder";

const JWT_SECRET = "test-secret";
process.env.JWT_SECRET = JWT_SECRET;

// #3629 narrowed billing.view/billing.manage off every rung onto Customer Admin,
// Billing and MSP staff — a plain "Customer" rung token needs the Billing grant row
// to pass the gate at all, same as portal-billing.test.ts's grantBilling().
async function grantBilling(userId: number): Promise<void> {
  expect(await setGrantRole("customer", userId, CUSTOMER_PLATFORM_ROLE_KEYS.billing, true, null)).toEqual({ ok: true });
}

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as any).log = { child: () => (req as any).log, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  next();
});
app.use("/api", router);

/** A Customer Admin / Billing holder's token — see makeClientToken in portal-billing.test.ts. */
function makeBillingToken(userId: number): string {
  return jwt.sign(
    { id: userId, email: "billing@example.com", role: "client", mspRole: "Customer", mspId: 1, customerId: 1 },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSelectResultsQueue = [];
});

describe("GET /api/portal/billing/retainer-intervals (#3648 tenant-wide visibility)", () => {
  it("returns a colleague's client_service once the tenant scope resolves it, not just the caller's own", async () => {
    const callerId = 21;
    const colleagueId = 99;
    const token = makeBillingToken(callerId);
    await grantBilling(callerId);

    mockSelectResultsQueue = [
      [{ id: callerId }, { id: colleagueId }], // billingScopeUserIds' users-table lookup
      [{ clientServiceId: 5, billingInterval: "month", pendingBillingInterval: null, stripeScheduleId: null, price: "199.00", annualPriceCents: 199000 }],
    ];

    const res = await request(app)
      .get("/api/portal/billing/retainer-intervals")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].clientServiceId).toBe(5);
  });
});

describe("POST /api/portal/billing/subscriptions/:id/switch-interval (#3648)", () => {
  it("acts on a colleague's client_service, and audit-logs the ACTUAL owner as clientId, not the caller", async () => {
    const callerId = 21;
    const colleagueId = 99;
    const token = makeBillingToken(callerId);
    await grantBilling(callerId);

    mockSelectResultsQueue = [
      [{ id: callerId }, { id: colleagueId }], // billingScopeUserIds' users-table lookup
      [{
        cs: { id: 5, clientUserId: colleagueId, serviceId: 3, billingInterval: "month", stripeScheduleId: null, stripeSubscriptionId: "sub_test_1", status: "active" },
        svc: { id: 3, name: "Managed IT Retainer", billingType: "recurring_monthly" },
      }],
    ];

    const res = await request(app)
      .post("/api/portal/billing/subscriptions/5/switch-interval")
      .set("Authorization", `Bearer ${token}`)
      .send({ targetInterval: "year" });

    expect(res.status).toBe(200);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: callerId,
      clientId: colleagueId,
    }));
  });
});

describe("POST /api/portal/billing/subscriptions/:id/cancel-interval-switch (#3648)", () => {
  it("acts on a colleague's client_service, and audit-logs the ACTUAL owner as clientId, not the caller", async () => {
    const callerId = 21;
    const colleagueId = 99;
    const token = makeBillingToken(callerId);
    await grantBilling(callerId);

    mockSelectResultsQueue = [
      [{ id: callerId }, { id: colleagueId }], // billingScopeUserIds' users-table lookup
      [{ id: 5, clientUserId: colleagueId, serviceId: 3, stripeScheduleId: "sched_existing", pendingBillingInterval: "year" }],
    ];

    const res = await request(app)
      .post("/api/portal/billing/subscriptions/5/cancel-interval-switch")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: callerId,
      clientId: colleagueId,
    }));
  });
});
