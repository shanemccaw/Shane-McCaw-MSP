/**
 * #3465 (part of #1696) — every billing route answers to a customer capability.
 *
 * Before #3465 all 13 routes below were `requireAuth` and nothing else, so any
 * authenticated principal could read the invoice ledger, pay an invoice, cancel a
 * subscription or open the Stripe customer portal. The portal's UserMenu already hid
 * the Billing link on `customer:billing.view` (#2459), which made the UI imply a gate
 * the server did not have.
 *
 * What this file proves, against the REAL routers and the REAL gate
 * (`requireCustomerCapability` → `userHasCapability` → the #2455 evaluator), with only
 * the capability ROWS substituted:
 *
 *  - a role whose mapping row does not allow the capability is refused 403, and the
 *    handler never runs (no database read happens at all);
 *  - reads ask `billing.view` and writes ask `billing.manage`, independently — holding
 *    one does not grant the other;
 *  - a capability with no mapping row (an unseeded database) answers 503, never 403;
 *  - a token carrying no recognised rung is refused (the #3360 shape).
 *
 * The rows are this file's own. A file-level mock of rbac-capability-source.ts
 * overrides the global src/test-setup/rbac-capability-rows.ts fixture (see its header).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

/**
 * capability key → the rung keys its platform mapping row allows. A key that is
 * absent has NO mapping row, which is what an unseeded database looks like.
 */
const mockRows = vi.hoisted(() => ({ allow: {} as Record<string, string[]> }));

vi.mock("../middlewares/rbac-capability-source.ts", () => {
  const roleId = (key: string) => `role-${key}`;
  return {
    readPlatformRoleId: (_system: string, key: string) => Promise.resolve(roleId(key)),
    // Nobody holds a `cap.*` grant — the rung comes from the JWT claim.
    readHeldRoles: () => Promise.resolve([]),
    readMappings: (system: string, capability: string) => {
      const allow = mockRows.allow[capability];
      return Promise.resolve(
        allow === undefined
          ? []
          : [{ system, capabilityKey: capability, orgId: null, allow: allow.map(roleId), deny: [] }],
      );
    },
    readRoleKeys: () => Promise.resolve([]),
    readRoleMembers: () => Promise.resolve([]),
    readUsersWithRung: () => Promise.resolve([]),
    readMembersAmong: () => Promise.resolve([]),
    writeMembership: () => Promise.resolve(),
  };
});

vi.mock("@workspace/db", () => {
  // Every chain resolves to no rows. An ALLOWED request therefore reaches its handler
  // and ends in a 200-empty or a 404; a REFUSED one must never get this far.
  const makeChain = () => {
    const chain: any = {
      from: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      set: () => chain,
      then: (onfulfilled: any, onrejected?: any) => Promise.resolve([]).then(onfulfilled, onrejected),
    };
    return chain;
  };
  const table = (name: string) => ({ __table: name });
  return {
    db: {
      select: vi.fn(() => makeChain()),
      update: vi.fn(() => makeChain()),
    },
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

vi.mock("../lib/retainer-pricing.ts", () => ({
  getOrCreateRetainerPrice: vi.fn(),
  monthlyPriceCentsOf: vi.fn(() => null),
  scheduleIntervalSwitchAtPeriodEnd: vi.fn(),
  RetainerPricingError: class RetainerPricingError extends Error {},
}));
vi.mock("../lib/audit.ts", () => ({ createAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/sms.ts", () => ({ sendAdminSms: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/mailer.ts", () => ({
  sendEmailFromTemplate: vi.fn().mockResolvedValue(undefined),
  getTenantHealthBlockHtml: vi.fn().mockResolvedValue(""),
  canSendAutomatedCustomerEmail: vi.fn().mockResolvedValue(false),
  retainerResumedEmail: vi.fn().mockReturnValue(""),
}));
vi.mock("../lib/stripe.ts", () => ({ getStripeKey: vi.fn().mockReturnValue("sk_test_fake") }));
vi.mock("../lib/logger.ts", () => {
  const child = vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child }));
  return { logger: { child, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});
// Never reached on any path below — every Stripe call sits behind a row lookup that
// finds nothing — but a real client must not be constructable here regardless.
vi.mock("stripe", () => ({ default: vi.fn() }));

import { db } from "@workspace/db";
import billingRouter from "./portal-billing.ts";
import retainerBillingRouter from "./portal-retainer-billing.ts";

const JWT_SECRET = "test-secret";
process.env.JWT_SECRET = JWT_SECRET;

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as any).log = { child: () => (req as any).log, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  next();
});
app.use("/api", billingRouter);
app.use("/api", retainerBillingRouter);

const ALL_RUNGS = ["Free", "Customer", "ServiceAccount", "MSPOperator", "MSPAdmin", "PlatformAdmin"];

type Capability = "billing.view" | "billing.manage";

interface BillingRoute {
  readonly method: "get" | "post";
  readonly path: string;
  readonly capability: Capability;
  readonly body?: Record<string, unknown>;
}

/** Every billing route, with the capability #3465 requires of it. */
const ROUTES: readonly BillingRoute[] = [
  { method: "get", path: "/api/portal/invoices", capability: "billing.view" },
  { method: "get", path: "/api/portal/invoices/1", capability: "billing.view" },
  { method: "get", path: "/api/portal/invoices/1/download", capability: "billing.view" },
  { method: "get", path: "/api/portal/billing/stripe-receipts", capability: "billing.view" },
  { method: "get", path: "/api/portal/billing/subscriptions", capability: "billing.view" },
  { method: "get", path: "/api/portal/billing/retainer-intervals", capability: "billing.view" },
  { method: "post", path: "/api/portal/invoices/1/pay", capability: "billing.manage" },
  { method: "post", path: "/api/portal/billing/subscriptions/1/cancel", capability: "billing.manage" },
  { method: "post", path: "/api/portal/billing/subscriptions/1/resume", capability: "billing.manage" },
  { method: "post", path: "/api/portal/billing/customer-portal", capability: "billing.manage" },
  { method: "post", path: "/api/portal/billing/subscriptions/1/resubscribe", capability: "billing.manage" },
  { method: "post", path: "/api/portal/billing/subscriptions/1/switch-interval", capability: "billing.manage", body: { targetInterval: "year" } },
  { method: "post", path: "/api/portal/billing/subscriptions/1/cancel-interval-switch", capability: "billing.manage" },
];

/** A real customer session's shape (auth.ts buildUserPayload). `null` omits the rung claim. */
function customerToken(mspRole: string | null = "Customer"): string {
  return jwt.sign(
    { id: 21, email: "client@example.com", role: "client", ...(mspRole ? { mspRole } : {}), mspId: 1, customerId: 1 },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

function call(route: BillingRoute, token: string) {
  const req = route.method === "get" ? request(app).get(route.path) : request(app).post(route.path).send(route.body ?? {});
  return req.set("Authorization", `Bearer ${token}`);
}

const dbSelect = vi.mocked(db.select);

beforeEach(() => {
  vi.clearAllMocks();
  mockRows.allow = { "billing.view": [...ALL_RUNGS], "billing.manage": [...ALL_RUNGS] };
});

describe("#3465 — billing routes are gated on a customer capability, not requireAuth alone", () => {
  it("covers 13 routes: six reads on billing.view, seven writes on billing.manage", () => {
    expect(ROUTES.filter((r) => r.capability === "billing.view")).toHaveLength(6);
    expect(ROUTES.filter((r) => r.capability === "billing.manage")).toHaveLength(7);
  });

  it.each(ROUTES)("$method $path — refused 403 when no role holds $capability, before the handler reads anything", async (route) => {
    mockRows.allow = { "billing.view": [], "billing.manage": [] };
    const res = await call(route, customerToken());
    expect(res.status).toBe(403);
    expect(dbSelect).not.toHaveBeenCalled();
  });

  it.each(ROUTES)("$method $path — reaches its handler when the caller's rung holds $capability", async (route) => {
    const res = await call(route, customerToken());
    // Every lookup returns no rows, so an admitted request ends in a 200-empty, a 404,
    // or the handler's own 400/500 — anything but the gate's own answers.
    expect([401, 403, 503]).not.toContain(res.status);
    expect(dbSelect).toHaveBeenCalled();
  });

  it("billing.view alone admits the reads and refuses every write", async () => {
    mockRows.allow = { "billing.view": ["Customer"], "billing.manage": [] };
    for (const route of ROUTES) {
      const res = await call(route, customerToken());
      if (route.capability === "billing.view") expect(res.status, route.path).not.toBe(403);
      else expect(res.status, route.path).toBe(403);
    }
  });

  it("billing.manage alone admits the writes and refuses every read — the two are independent", async () => {
    mockRows.allow = { "billing.view": [], "billing.manage": ["Customer"] };
    for (const route of ROUTES) {
      const res = await call(route, customerToken());
      if (route.capability === "billing.manage") expect(res.status, route.path).not.toBe(403);
      else expect(res.status, route.path).toBe(403);
    }
  });

  it("a rung outside the allow set is refused while a rung inside it is admitted", async () => {
    mockRows.allow = { "billing.view": ["MSPAdmin"], "billing.manage": ["MSPAdmin"] };
    const invoices = ROUTES[0]!;
    expect((await call(invoices, customerToken("Customer"))).status).toBe(403);
    expect((await call(invoices, customerToken("MSPAdmin"))).status).toBe(200);
  });

  it.each(ROUTES)("$method $path — answers 503, not 403, when $capability has no mapping row (unseeded)", async (route) => {
    mockRows.allow = {};
    const res = await call(route, customerToken());
    expect(res.status).toBe(503);
    expect(dbSelect).not.toHaveBeenCalled();
  });

  it("refuses a token that carries no recognised rung (#3360), even with every rung allowed", async () => {
    for (const route of ROUTES) {
      const res = await call(route, customerToken(null));
      expect(res.status, route.path).toBe(403);
    }
    expect(dbSelect).not.toHaveBeenCalled();
  });

  it("still answers 401 with no token at all — requireAuth runs first", async () => {
    const res = await request(app).get("/api/portal/invoices");
    expect(res.status).toBe(401);
  });
});
