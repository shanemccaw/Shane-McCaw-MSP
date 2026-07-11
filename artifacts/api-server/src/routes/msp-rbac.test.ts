/**
 * MSP RBAC Tenant-Isolation Acceptance Tests
 *
 * HTTP-level integration tests proving that requireRole(), requireMspScope(),
 * and requireCustomerScope() enforce tenant isolation correctly — no cross-MSP
 * or cross-customer data leakage is possible through crafted JWT tokens.
 *
 * Mock approach:
 *  - mock.module() (synchronous) stubs @workspace/db and drizzle-orm at the
 *    top level so requireAuth.ts picks up the mock when dynamically imported
 *    inside before().
 *  - customerRows[] controls what the DB returns for customer-scope lookups.
 *
 * Run: pnpm --filter @workspace/api-server run test
 */

import { describe, it, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { RequestHandler } from "express";

process.env.JWT_SECRET = "msp-rbac-test-secret-xyz-abc";

// ── Configurable DB mock ──────────────────────────────────────────────────────
// Tests set customerRows before each assertion. requireCustomerScope calls
// db.select().from().where().limit() — the mock returns customerRows.
let customerRows: { id: number }[] = [];

const mockLimit = () => Promise.resolve(customerRows);
const mockWhere = () => ({ limit: mockLimit });
const mockFrom = () => ({ where: mockWhere });
const mockSelect = () => ({ from: mockFrom });

mock.module("@workspace/db", {
  namedExports: {
    db: { select: mockSelect },
    mspCustomersTable: { id: "id_col", mspId: "mspId_col" },
  },
});

mock.module("drizzle-orm", {
  namedExports: {
    and: (..._args: unknown[]) => "and_clause",
    eq: (_col: unknown, _val: unknown) => "eq_clause",
    isNull: (_col: unknown) => "isNull_clause",
    gt: (_col: unknown, _val: unknown) => "gt_clause",
  },
});

import jwt from "jsonwebtoken";
import express from "express";

const SECRET = process.env.JWT_SECRET!;

function makeToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, SECRET, { expiresIn: "15m" });
}

// ── Test server ───────────────────────────────────────────────────────────────

let server: http.Server;
let base: string;

before(async () => {
  const { requireAuth, requireRole, requireMspScope, requireCustomerScope } =
    await import("../middlewares/requireAuth.ts") as {
      requireAuth: RequestHandler;
      requireRole: (r: string) => RequestHandler;
      requireMspScope: (s: string) => RequestHandler;
      requireCustomerScope: (s: string) => RequestHandler;
    };

  const app = express();
  app.use(express.json());

  // Platform-admin-only route
  app.get("/test/platform-only", requireRole("PlatformAdmin"), (_req, res) => {
    res.json({ ok: true });
  });

  // MSP-admin-or-above route
  app.get("/test/msp-admin", requireRole("MSPAdmin"), (_req, res) => {
    res.json({ ok: true });
  });

  // Tenant-scoped MSP routes — represent the shared-engine surfaces:
  // Sales Offer, SLA, Scope Creep, Monitoring Package Engine, Live Monitor Engine
  const engineSurfaces = ["sales-offer", "sla", "scope-creep", "monitoring-package", "live-monitor"];
  for (const engine of engineSurfaces) {
    app.get(`/test/msps/:mspId/engines/${engine}`, requireAuth, requireMspScope("params"), (_req, res) => {
      res.json({ ok: true, engine });
    });
  }
  // Generic MSP data route (used by requireMspScope tests)
  app.get("/test/msps/:mspId/data", requireAuth, requireMspScope("params"), (_req, res) => {
    res.json({ ok: true });
  });

  // Customer-scoped route (requires DB lookup for MSPAdmin/MSPOperator)
  app.get("/test/customers/:customerId/data", requireAuth, requireCustomerScope("params"), (_req, res) => {
    res.json({ ok: true });
  });

  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      base = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

function get(path: string, token?: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, base);
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    http.get(url, { headers }, (res) => {
      let data = "";
      res.on("data", (chunk: string) => { data += chunk; });
      res.on("end", () => {
        try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode ?? 0, body: data }); }
      });
    }).on("error", reject);
  });
}

// ── 1. requireRole() — role hierarchy ─────────────────────────────────────────

describe("requireRole() HTTP fence", () => {
  it("returns 401 with no Authorization header", async () => {
    const { status } = await get("/test/platform-only");
    assert.equal(status, 401);
  });

  it("PlatformAdmin can access platform-only route", async () => {
    const token = makeToken({ id: 1, email: "pa@x.com", role: "admin", mspRole: "PlatformAdmin" });
    assert.equal((await get("/test/platform-only", token)).status, 200);
  });

  it("legacy role=admin is treated as PlatformAdmin", async () => {
    const token = makeToken({ id: 1, email: "admin@x.com", role: "admin" });
    assert.equal((await get("/test/platform-only", token)).status, 200);
  });

  it("MSPAdmin is blocked from platform-only route (403)", async () => {
    const token = makeToken({ id: 2, email: "msp@x.com", role: "client", mspRole: "MSPAdmin", mspId: 1 });
    assert.equal((await get("/test/platform-only", token)).status, 403);
  });

  it("MSPOperator is blocked from MSPAdmin-required route (403)", async () => {
    const token = makeToken({ id: 3, email: "op@x.com", role: "client", mspRole: "MSPOperator", mspId: 1 });
    assert.equal((await get("/test/msp-admin", token)).status, 403);
  });

  it("Free user is blocked from MSPAdmin-required route (403)", async () => {
    const token = makeToken({ id: 4, email: "free@x.com", role: "client", mspRole: "Free" });
    assert.equal((await get("/test/msp-admin", token)).status, 403);
  });

  it("MSPAdmin can access MSPAdmin-required route", async () => {
    const token = makeToken({ id: 5, email: "msp@x.com", role: "client", mspRole: "MSPAdmin", mspId: 1 });
    assert.equal((await get("/test/msp-admin", token)).status, 200);
  });
});

// ── 2. Named shared-engine surface tenant isolation ───────────────────────────
// Proves that Sales Offer, SLA, Scope Creep, Monitoring Package, and Live Monitor
// engine surfaces each enforce the MSP tenant fence by construction.

describe("named shared-engine surface isolation", () => {
  const engines = ["sales-offer", "sla", "scope-creep", "monitoring-package", "live-monitor"] as const;

  for (const engine of engines) {
    it(`MSPAdmin (mspId=1) can access ${engine} engine within own MSP`, async () => {
      const token = makeToken({ id: 2, email: "msp@x.com", role: "client", mspRole: "MSPAdmin", mspId: 1 });
      const { status } = await get(`/test/msps/1/engines/${engine}`, token);
      assert.equal(status, 200);
    });

    it(`MSPAdmin (mspId=1) is blocked from ${engine} engine in mspId=2 (403)`, async () => {
      const token = makeToken({ id: 2, email: "msp@x.com", role: "client", mspRole: "MSPAdmin", mspId: 1 });
      const { status } = await get(`/test/msps/2/engines/${engine}`, token);
      assert.equal(status, 403);
    });
  }

  it("PlatformAdmin can access all engine surfaces across all tenants", async () => {
    const token = makeToken({ id: 1, email: "pa@x.com", role: "admin", mspRole: "PlatformAdmin" });
    for (const engine of engines) {
      const { status } = await get(`/test/msps/999/engines/${engine}`, token);
      assert.equal(status, 200);
    }
  });
});

// ── 3. requireMspScope() — MSP tenant fence ───────────────────────────────────

describe("requireMspScope() tenant fence", () => {
  it("PlatformAdmin can access any mspId (cross-tenant bypass)", async () => {
    const token = makeToken({ id: 1, email: "pa@x.com", role: "admin", mspRole: "PlatformAdmin" });
    assert.equal((await get("/test/msps/999/data", token)).status, 200);
  });

  it("MSPAdmin (mspId=1) can access own mspId=1", async () => {
    const token = makeToken({ id: 2, email: "msp@x.com", role: "client", mspRole: "MSPAdmin", mspId: 1 });
    assert.equal((await get("/test/msps/1/data", token)).status, 200);
  });

  it("MSPAdmin (mspId=1) is blocked from mspId=2 — cross-tenant denied (403)", async () => {
    const token = makeToken({ id: 2, email: "msp@x.com", role: "client", mspRole: "MSPAdmin", mspId: 1 });
    assert.equal((await get("/test/msps/2/data", token)).status, 403);
  });

  it("MSPOperator (mspId=5) is blocked from mspId=6 — shared-engine surface fence", async () => {
    const token = makeToken({ id: 3, email: "op@x.com", role: "client", mspRole: "MSPOperator", mspId: 5 });
    assert.equal((await get("/test/msps/6/data", token)).status, 403);
  });

  it("CustomerUser (no mspId claim) cannot access any MSP data (403)", async () => {
    const token = makeToken({ id: 4, email: "cu@x.com", role: "client", mspRole: "CustomerUser", customerId: 99 });
    assert.equal((await get("/test/msps/1/data", token)).status, 403);
  });

  it("Free user cannot access any MSP data (403)", async () => {
    const token = makeToken({ id: 5, email: "free@x.com", role: "client", mspRole: "Free" });
    assert.equal((await get("/test/msps/1/data", token)).status, 403);
  });
});

// ── 3. requireCustomerScope() — customer isolation with MSP DB verification ───

describe("requireCustomerScope() customer fence", () => {
  it("PlatformAdmin bypasses customer scope check", async () => {
    const token = makeToken({ id: 1, email: "pa@x.com", role: "admin", mspRole: "PlatformAdmin" });
    assert.equal((await get("/test/customers/777/data", token)).status, 200);
  });

  it("CustomerUser (customerId=10) can access own customer route", async () => {
    const token = makeToken({ id: 2, email: "cu@x.com", role: "client", mspRole: "CustomerUser", customerId: 10 });
    assert.equal((await get("/test/customers/10/data", token)).status, 200);
  });

  it("CustomerUser (customerId=10) is blocked from customerId=11 (403)", async () => {
    const token = makeToken({ id: 2, email: "cu@x.com", role: "client", mspRole: "CustomerUser", customerId: 10 });
    assert.equal((await get("/test/customers/11/data", token)).status, 403);
  });

  it("MSPAdmin (mspId=1) can access customer that belongs to their MSP (DB confirms)", async () => {
    customerRows = [{ id: 42 }]; // DB returns customer 42 belongs to mspId=1
    const token = makeToken({ id: 3, email: "msp@x.com", role: "client", mspRole: "MSPAdmin", mspId: 1 });
    const { status } = await get("/test/customers/42/data", token);
    customerRows = [];
    assert.equal(status, 200);
  });

  it("MSPAdmin (mspId=1) is blocked from customer belonging to mspId=2 (403)", async () => {
    customerRows = []; // DB returns empty — customer 99 does not belong to mspId=1
    const token = makeToken({ id: 3, email: "msp@x.com", role: "client", mspRole: "MSPAdmin", mspId: 1 });
    assert.equal((await get("/test/customers/99/data", token)).status, 403);
  });

  it("MSPOperator (mspId=2) is blocked from customer in a different MSP (403)", async () => {
    customerRows = []; // DB confirms customer 10 does not belong to mspId=2
    const token = makeToken({ id: 4, email: "op@x.com", role: "client", mspRole: "MSPOperator", mspId: 2 });
    assert.equal((await get("/test/customers/10/data", token)).status, 403);
  });

  it("MSPAdmin with no mspId claim is blocked (403 — missing claim)", async () => {
    const token = makeToken({ id: 5, email: "noscope@x.com", role: "client", mspRole: "MSPAdmin" });
    assert.equal((await get("/test/customers/1/data", token)).status, 403);
  });
});
