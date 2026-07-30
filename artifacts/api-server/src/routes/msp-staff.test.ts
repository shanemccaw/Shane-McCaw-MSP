/**
 * Tests for MSP impersonation token issuance:
 *   POST /api/msp/:mspId/customers/:customerId/impersonate  (msp-staff.ts)
 *
 * Critical behaviours verified:
 *   1. MSPAdmin can impersonate a customer within their own MSP → 200 + token
 *   2. MSPAdmin CANNOT impersonate a customer in a different MSP → 403
 *      (requireMspScope enforcement — cross-MSP isolation)
 *   3. PlatformAdmin can impersonate any customer regardless of MSP → 200
 *   4. A user below MSPAdmin cannot reach the endpoint at all → 403
 *
 * requireAuth.ts is intentionally NOT mocked here so that requireRole and
 * requireMspScope enforce real JWT-based scope checks against genuine tokens.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */
import { describe, it, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";
import type { AddressInfo } from "node:net";

const TEST_JWT_SECRET = "impersonation-portal-test-secret-xyz";
process.env.JWT_SECRET = TEST_JWT_SECRET;

// ── JWT helpers ────────────────────────────────────────────────────────────────

function makeJwt(claims: Record<string, unknown>): string {
  return jwt.sign(claims, TEST_JWT_SECRET, { expiresIn: "15m" });
}

const mspAdminMsp1Token = makeJwt({
  id: 10,
  email: "admin@msp1.test",
  role: "client",
  mspId: 1,
  mspRole: "MSPAdmin",
});

const platformAdminToken = makeJwt({
  id: 99,
  email: "platform@admin.test",
  role: "admin",
});

const mspOperatorMsp1Token = makeJwt({
  id: 11,
  email: "op@msp1.test",
  role: "client",
  mspId: 1,
  mspRole: "MSPOperator",
});

// ── Mock DB state ─────────────────────────────────────────────────────────────
// Queue-based: each select() call shifts one item off the front.

let dbSelectQueue: unknown[][] = [];

function makeMockDb() {
  return {
    select: (_cols?: unknown) => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => ({
          limit: async (_n: number) => dbSelectQueue.shift() ?? [],
        }),
      }),
    }),
    insert: (_table: unknown) => ({
      values: async (_vals: unknown) => [],
    }),
    update: (_table: unknown) => ({
      set: (_vals: unknown) => ({
        where: async (_cond: unknown) => [],
      }),
    }),
    delete: (_table: unknown) => ({
      where: async (_cond: unknown) => [],
    }),
  };
}

// ── Register all mocks BEFORE msp-staff.ts is imported ─────────────────────────
// NOTE: requireAuth.ts is NOT mocked — we rely on the real middleware.

mock.module("@workspace/db", {
  namedExports: {
    db: makeMockDb(),
    tenantsTable: {},
    mspsTable: {},
    usersTable: {},
    // Not used by msp-staff.ts itself, but required because requireAuth.ts
    // (intentionally left unmocked below) imports it from @workspace/db too.
    mspStaffCustomerScopesTable: {},
    impersonationTokensTable: {},
    mspAuditLogsTable: {},
    fulfillmentQueueTable: {},
    FULFILLMENT_DELIVERY_STATUSES: ["not_started", "in_progress", "delivered", "blocked"],
    FULFILLMENT_SOURCE_TYPES: ["offer", "sow", "bundle"],
  },
});

const noop = () => {};
const noopLogger = {
  info: noop, warn: noop, error: noop, debug: noop,
  fatal: noop, trace: noop,
  child: () => noopLogger,
};
mock.module("../lib/logger.ts", { namedExports: { logger: noopLogger } });

// The handler dynamically imports resolveCustomerPortalUserId to look up the
// customer's active portal user. Its real implementation orders by
// canonicalPortalUserOrder() via db.select(...).orderBy(...), which the
// queue-based mock db above does not model — so it is mocked directly here
// to resolve to the same target-user id (50) used by fakeTargetUser below.
mock.module("../lib/tenant-signals.ts", {
  namedExports: {
    resolveCustomerPortalUserId: async (_customerId: number) => 50,
  },
});

// ── Import real msp-staff router AFTER all mocks are registered ───────────────
const { default: mspStaffRouter } = await import("./msp-staff.ts");

const { default: express } = await import("express");
const app = express();
app.use(express.json());
app.use((_req: unknown, _res: unknown, next: () => void) => {
  ((_req as Record<string, unknown>).log = noopLogger);
  next();
});
app.use("/api", mspStaffRouter);

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

// ── Canned DB rows ────────────────────────────────────────────────────────────

const fakeCustomer = {
  id: 10,
  mspId: 1,
  customerName: "Acme Corp",
  domain: "acme.com",
  status: "active",
  ownerType: "customer",
};

const fakeCustomerMsp2 = {
  id: 20,
  mspId: 2,
  customerName: "Beta Inc",
  domain: "beta.com",
  status: "active",
  ownerType: "customer",
};

// The owning MSP's slug row, read via mspsTable — resolveImpersonationTarget
// itself is mocked above, so this only feeds the ownerMsp lookup that happens
// before it.
const fakeOwnerMsp = { slug: "msp1" };
const fakeOwnerMspMsp2 = { slug: "msp2" };

const fakeTargetUser = {
  id: 50,
  email: "customer@acme.com",
  name: "Alice Customer",
  role: "client",
  passwordHash: null,
  company: null,
  phone: null,
  address: null,
  addressCity: null,
  addressState: null,
  addressZip: null,
};

// ── Request helper ────────────────────────────────────────────────────────────

async function postImpersonate(
  mspId: number,
  customerId: number,
  authToken: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(
    `${baseUrl}/api/msp/${mspId}/customers/${customerId}/impersonate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
    },
  );
  const json = await res.json() as Record<string, unknown>;
  return { status: res.status, json };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("MSP impersonation endpoint — POST /api/msp/:mspId/customers/:customerId/impersonate", () => {

  describe("MSPAdmin → own MSP's customer → 200", () => {
    let status: number;
    let json: Record<string, unknown>;

    before(async () => {
      // Handler makes 3 selects: tenantsTable (the customer), mspsTable (the
      // owning MSP's slug), usersTable (target user; resolveCustomerPortalUserId
      // itself is mocked separately above and does not consume this queue).
      dbSelectQueue = [[fakeCustomer], [fakeOwnerMsp], [fakeTargetUser]];
      ({ status, json } = await postImpersonate(1, 10, mspAdminMsp1Token));
    });

    it("returns HTTP 200", () => {
      assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(json)}`);
    });

    it("returns a token string", () => {
      assert.ok(
        typeof json.token === "string" && json.token.length > 0,
        `expected non-empty token, got: ${JSON.stringify(json.token)}`,
      );
    });

    it("returns customer info", () => {
      const customer = json.customer as Record<string, unknown>;
      assert.equal(customer?.id, fakeCustomer.id);
      assert.equal(customer?.name, fakeCustomer.customerName);
    });

    it("returns target user info", () => {
      const targetUser = json.targetUser as Record<string, unknown>;
      assert.equal(targetUser?.email, fakeTargetUser.email);
    });
  });

  describe("MSPAdmin → different MSP's customer → 403 (cross-MSP isolation)", () => {
    let status: number;
    let json: Record<string, unknown>;

    before(async () => {
      // requireMspScope blocks before hitting the DB — queue should remain untouched
      dbSelectQueue = [];
      // MSPAdmin from MSP#1 trying to access MSP#2's customer
      ({ status, json } = await postImpersonate(2, 20, mspAdminMsp1Token));
    });

    it("returns HTTP 403", () => {
      assert.equal(status, 403, `expected 403 (cross-MSP isolation), got ${status}; body: ${JSON.stringify(json)}`);
    });

    it("error message indicates access is not permitted", () => {
      assert.ok(
        typeof json.error === "string" && json.error.toLowerCase().includes("not permitted"),
        `expected "not permitted" in error, got: ${JSON.stringify(json.error)}`,
      );
    });

    it("DB was not touched (middleware blocked before handler)", () => {
      assert.equal(dbSelectQueue.length, 0, "DB queue should still be empty — handler was never reached");
    });
  });

  describe("PlatformAdmin → any MSP's customer → 200 (bypasses scope check)", () => {
    let status: number;
    let json: Record<string, unknown>;

    before(async () => {
      dbSelectQueue = [[fakeCustomerMsp2], [fakeOwnerMspMsp2], [fakeTargetUser]];
      ({ status, json } = await postImpersonate(2, 20, platformAdminToken));
    });

    it("returns HTTP 200", () => {
      assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(json)}`);
    });

    it("returns a token string", () => {
      assert.ok(
        typeof json.token === "string" && json.token.length > 0,
        `expected non-empty token, got: ${JSON.stringify(json.token)}`,
      );
    });
  });

  describe("MSPOperator (below MSPAdmin) → own MSP's customer → 200", () => {
    let status: number;
    let json: Record<string, unknown>;

    before(async () => {
      dbSelectQueue = [[fakeCustomer], [fakeOwnerMsp], [fakeTargetUser]];
      ({ status, json } = await postImpersonate(1, 10, mspOperatorMsp1Token));
    });

    it("returns HTTP 200 (ok)", () => {
      assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(json)}`);
    });

    it("returns a token string", () => {
      assert.ok(
        typeof json.token === "string" && json.token.length > 0,
        `expected non-empty token, got: ${JSON.stringify(json.token)}`,
      );
    });
  });

  describe("unauthenticated request → 401", () => {
    let status: number;
    let json: Record<string, unknown>;

    before(async () => {
      dbSelectQueue = [];
      const res = await fetch(`${baseUrl}/api/msp/1/customers/10/impersonate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      json = await res.json() as Record<string, unknown>;
      status = res.status;
    });

    it("returns HTTP 401", () => {
      assert.equal(status, 401, `expected 401, got ${status}; body: ${JSON.stringify(json)}`);
    });
  });
});
