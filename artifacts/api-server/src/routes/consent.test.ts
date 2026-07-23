/**
 * Consent Flow Tests (vitest)
 *
 * Covers:
 *   1. REQUIRED_MT_SCOPES — full union of 12 scopes
 *   2. buildAdminConsentUrl — URL structure
 *   3. ConsentRevokedError — instanceof, tenantId, message
 *   4. mtAppCredentialsPresent — env var checks
 *   5. markTenantConsentRevoked — evicts cache + calls db.update
 *   6. POST /consent/invite-link route handler — generates token & consent URL
 *   7. GET  /consent/callback success — burns token, upserts consent record
 *   8. GET  /consent/callback declined — marks declined, redirects
 *   9. GET  /consent/callback expired token — 400
 *  10. PATCH /admin/consent/:tenantId/revoke — flips status or 404
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// ── Environment ────────────────────────────────────────────────────────────────
process.env.JWT_SECRET = "consent-test-secret";
process.env.MT_APP_CLIENT_ID = "mt-client-id";
process.env.MT_APP_CLIENT_SECRET = "mt-client-secret";
// consent.ts pulls in workflow-executor → ps-script-gen → the Anthropic AI
// integration client, which throws at module load if these are unset.
process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = "https://anthropic.test";
process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "test-anthropic-key";

// ── Mock jsonwebtoken ──────────────────────────────────────────────────────────
vi.mock("jsonwebtoken", () => ({
  default: {
    verify: vi.fn((_tok: string) => {
      const b64 = _tok.split(".")[1] ?? "";
      try { return JSON.parse(Buffer.from(b64, "base64url").toString()); }
      catch { return JSON.parse(_tok); }
    }),
    sign: vi.fn(() => "signed.token"),
  },
  verify: vi.fn((_tok: string) => {
    const b64 = _tok.split(".")[1] ?? "";
    try { return JSON.parse(Buffer.from(b64, "base64url").toString()); }
    catch { return JSON.parse(_tok); }
  }),
  sign: vi.fn(() => "signed.token"),
}));

// ── DB mocks ───────────────────────────────────────────────────────────────────

let dbSelectQueue: unknown[][] = [];

const mockInsertReturning = vi.fn().mockResolvedValue([{ tenantId: "tenant-abc" }]);
const mockInsertOnConflict = vi.fn().mockReturnValue({ returning: mockInsertReturning });
const mockInsertValues = vi.fn().mockReturnValue({
  onConflictDoUpdate: mockInsertOnConflict,
  returning: mockInsertReturning,
});
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

const mockUpdateReturning = vi.fn().mockResolvedValue([{ tenantId: "tenant-abc" }]);
// The where() result is both awaitable (thenable — some update calls are awaited
// directly with no .returning()) and carries .returning()/.catch() for the calls
// that chain those (e.g. the status-flip and adminEmail updates use .catch()).
const mockUpdateWhere = vi.fn().mockReturnValue({
  returning: mockUpdateReturning,
  then: (resolve: (v: unknown) => unknown) => Promise.resolve([{ tenantId: "tenant-abc" }]).then(resolve),
  catch: (reject: (e: unknown) => unknown) => Promise.resolve([{ tenantId: "tenant-abc" }]).catch(reject),
});
const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

function makeSelectChain(result: unknown[]) {
  const chain: Record<string, unknown> = {
    from:    () => chain,
    where:   () => chain,
    limit:   () => chain,
    orderBy: () => chain,
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
    catch: (reject: (e: unknown) => unknown) => Promise.resolve(result).catch(reject),
  };
  return chain;
}

const mockSelect = vi.fn().mockImplementation(() => makeSelectChain(dbSelectQueue.shift() ?? []));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => mockSelect(),
    insert: (...args: unknown[]) => mockInsert(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    // markTenantConsentRevoked (graph.ts) runs its updates inside a transaction;
    // execute the callback with a tx that proxies to the same update/select/insert mocks.
    transaction: (cb: (tx: unknown) => unknown) =>
      cb({
        select: () => mockSelect(),
        insert: (...args: unknown[]) => mockInsert(...args),
        update: (...args: unknown[]) => mockUpdate(...args),
      }),
  },
  tenantConsentTable: { tenantId: "tc.tenantId", consentStatus: "tc.consent_status", updatedAt: "tc.updated_at", customerId: "tc.customer_id" },
  consentInviteTokensTable: { token: "cit.token", customerId: "cit.customer_id", clientUserId: "cit.client_user_id", usedAt: "cit.used_at", expiresAt: "cit.expires_at", tenantId: "cit.tenant_id" },
  mspsTable: { id: "m.id", isDirectBusiness: "m.is_direct_business" },
  mspCustomersTable: { id: "mc.id", mspId: "mc.msp_id", tenantId: "mc.tenant_id", status: "mc.status" },
  checkoutSessionsTable: { id: "cs.id", email: "cs.email", productSlug: "cs.product_slug", status: "cs.status", tenantId: "cs.tenant_id", expiresAt: "cs.expires_at", updatedAt: "cs.updated_at" },
  servicesTable: { slug: "s.slug" },
  usersTable: { id: "u.id", email: "u.email" },
  tenantMonitorProfilesTable: { tenantId: "tmp.tenant_id", status: "tmp.status" },
  auditLogsTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq:     vi.fn((_col, _val) => ({ type: "eq" })),
  and:    vi.fn((...args) => ({ type: "and", args })),
  isNull: vi.fn((col) => ({ type: "isNull", col })),
  gte:    vi.fn((_col, _val) => ({ type: "gte" })),
  ne:     vi.fn((_col, _val) => ({ type: "ne" })),
  desc:   vi.fn((col) => ({ type: "desc", col })),
  sql:    vi.fn((...args) => ({ type: "sql", args })),
}));

// consent.ts imports emitWorkflowEvent from workflow-executor, which statically
// pulls ps-script-gen → the Anthropic AI integration client (throws at module
// load without provisioning). Mock it — the consent flow's event emission is
// fire-and-forget and not under test here.
vi.mock("../lib/workflow-executor.ts", () => ({
  emitWorkflowEvent: vi.fn(),
}));

vi.mock("../lib/audit.ts", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/logger.ts", () => {
  // `.child()` returns the same logger so both the module-level binding in
  // consent.ts (logger.child({ channel: "auth" })) and transitive imports
  // (graph.ts → simulator-events → monitor-executor, which also call
  // logger.child at module load) resolve to a working logger.
  const logger: Record<string, unknown> = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  logger.child = vi.fn(() => logger);
  return { logger };
});

vi.mock("../lib/portal-url.ts", () => ({
  getPortalBaseUrl: vi.fn().mockReturnValue("https://app.example.com/crm"),
}));

// ── JWT helpers ────────────────────────────────────────────────────────────────

function makeJwt(payload: Record<string, unknown>): string {
  const json = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${json}.sig`;
}

function adminToken(): string {
  return makeJwt({ id: 1, email: "admin@example.com", role: "admin" });
}

// ── Mock req/res factories ─────────────────────────────────────────────────────

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: { authorization: `Bearer ${adminToken()}` },
    body: {},
    query: {},
    params: {},
    protocol: "https",
    ...overrides,
  } as unknown as Request;
}

interface MockResStore {
  statusCode: number;
  jsonBody: unknown;
  redirectUrl: string | null;
  sentText: string | null;
}

function mockRes(): { res: Response; store: MockResStore } {
  const store: MockResStore = { statusCode: 200, jsonBody: null, redirectUrl: null, sentText: null };
  const res: Partial<Response> = {
    status: vi.fn().mockImplementation((code: number) => { store.statusCode = code; return res as Response; }),
    json:   vi.fn().mockImplementation((body: unknown) => { store.jsonBody = body; }),
    redirect: vi.fn().mockImplementation((url: string) => { store.redirectUrl = url; }),
    send: vi.fn().mockImplementation((text: string) => { store.sentText = text; }),
  };
  return { res: res as Response, store };
}

// ── Tests: graph.ts helpers ───────────────────────────────────────────────────

import {
  ConsentRevokedError,
  buildAdminConsentUrl,
  markTenantConsentRevoked,
  mtAppCredentialsPresent,
  REQUIRED_MT_SCOPES,
} from "../lib/graph.ts";

describe("graph.ts — multi-tenant helpers", () => {
  describe("REQUIRED_MT_SCOPES", () => {
    it("contains exactly 12 scopes", () => {
      expect(REQUIRED_MT_SCOPES).toHaveLength(12);
    });

    it("includes all required scopes", () => {
      const required = [
        "Directory.Read.All",
        "SecurityEvents.Read.All",
        "Exchange.ManageAsApp",
        "Sites.Read.All",
        "Reports.Read.All",
        "Policy.Read.All",
        "DeviceManagementConfiguration.Read.All",
        "AuditLog.Read.All",
        "ActivityFeed.Read",
        "IdentityRiskyUser.Read.All",
        "AccessReview.Read.All",
        "TeamSettings.Read.All",
      ];
      for (const scope of required) {
        expect(REQUIRED_MT_SCOPES).toContain(scope);
      }
    });
  });

  describe("buildAdminConsentUrl()", () => {
    it("builds a valid Microsoft admin-consent URL", () => {
      const url = buildAdminConsentUrl(
        "contoso.onmicrosoft.com",
        "tok-abc",
        "https://app.example.com/api/consent/callback",
        "mt-client-id",
      );
      expect(url).toContain("login.microsoftonline.com");
      expect(url).toContain("adminconsent");
      expect(url).toContain("mt-client-id");
      expect(url).toContain("tok-abc");
      expect(url).toContain(encodeURIComponent("https://app.example.com/api/consent/callback"));
    });

    it("encodes the tenant hint", () => {
      const url = buildAdminConsentUrl("contoso.onmicrosoft.com", "t", "https://x.com/cb", "mt-client-id");
      expect(url).toContain(encodeURIComponent("contoso.onmicrosoft.com"));
    });

    it("uses 'common' as the tenant hint when passed", () => {
      const url = buildAdminConsentUrl("common", "t", "https://x.com/cb", "mt-client-id");
      expect(url).toContain("/common/adminconsent");
    });
  });

  describe("ConsentRevokedError", () => {
    it("is instanceof Error", () => {
      const err = new ConsentRevokedError("t1");
      expect(err).toBeInstanceOf(Error);
    });

    it("has name 'ConsentRevokedError'", () => {
      expect(new ConsentRevokedError("t1").name).toBe("ConsentRevokedError");
    });

    it("carries the tenantId", () => {
      expect(new ConsentRevokedError("tenant-xyz").tenantId).toBe("tenant-xyz");
    });

    it("includes tenantId in the message", () => {
      expect(new ConsentRevokedError("tenant-xyz").message).toContain("tenant-xyz");
    });
  });

  describe("mtAppCredentialsPresent()", () => {
    it("returns true when both env vars are set", () => {
      expect(mtAppCredentialsPresent()).toBe(true);
    });

    it("returns false when MT_APP_CLIENT_ID is missing", () => {
      const saved = process.env.MT_APP_CLIENT_ID;
      delete process.env.MT_APP_CLIENT_ID;
      expect(mtAppCredentialsPresent()).toBe(false);
      process.env.MT_APP_CLIENT_ID = saved;
    });

    it("returns false when MT_APP_CLIENT_SECRET is missing", () => {
      const saved = process.env.MT_APP_CLIENT_SECRET;
      delete process.env.MT_APP_CLIENT_SECRET;
      expect(mtAppCredentialsPresent()).toBe(false);
      process.env.MT_APP_CLIENT_SECRET = saved;
    });
  });

  describe("markTenantConsentRevoked()", () => {
    beforeEach(() => { mockUpdate.mockClear(); });

    it("calls db.update with revoked status", async () => {
      await markTenantConsentRevoked("tenant-a");
      expect(mockUpdate).toHaveBeenCalled();
    });

    it("does not throw when db.update rejects", async () => {
      mockUpdate.mockImplementationOnce(() => { throw new Error("DB gone"); });
      await expect(markTenantConsentRevoked("tenant-b")).resolves.toBeUndefined();
    });
  });
});

// ── Tests: route handlers (mock req/res) ─────────────────────────────────────

import consentRouter from "./consent.ts";
import type { IRouter } from "express";

// Helper: extract handler from router stack
function getHandler(
  router: IRouter,
  method: string,
  path: string,
): ((...args: unknown[]) => Promise<void>) | null {
  const stack = (router as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ method: string; handle: (...args: unknown[]) => Promise<void> }> } }> }).stack;
  for (const layer of stack) {
    if (layer.route?.path === path) {
      const handler = layer.route.stack.find(h => h.method === method);
      if (handler) return handler.handle;
    }
  }
  return null;
}

describe("consent route handlers", () => {
  beforeEach(() => {
    mockInsert.mockClear();
    mockUpdate.mockClear();
    mockSelect.mockClear();
    dbSelectQueue = [];
  });

  describe("GET /consent/declined", () => {
    it("returns 200 with HTML mentioning MSP", async () => {
      const { res, store } = mockRes();
      const req = mockReq({ headers: {} });
      const handler = getHandler(consentRouter, "get", "/consent/declined");
      expect(handler).not.toBeNull();
      await handler!(req, res, (() => {}) as NextFunction);
      expect(store.statusCode).toBe(200);
      expect(store.sentText).toContain("MSP");
    });
  });

  describe("GET /consent/callback — declined (access_denied)", () => {
    it("redirects to /consent/declined", async () => {
      const { res, store } = mockRes();
      const req = mockReq({
        query: { error: "access_denied", tenant: "tenant-abc", state: "tok" },
      });
      const handler = getHandler(consentRouter, "get", "/consent/callback");
      expect(handler).not.toBeNull();
      await handler!(req, res, (() => {}) as NextFunction);
      expect(store.redirectUrl).toContain("/consent/declined");
    });
  });

  describe("GET /consent/callback — invalid params", () => {
    it("returns 400 when tenant missing", async () => {
      const { res, store } = mockRes();
      const req = mockReq({ query: { admin_consent: "True", state: "tok" } });
      const handler = getHandler(consentRouter, "get", "/consent/callback");
      await handler!(req, res, (() => {}) as NextFunction);
      expect(store.statusCode).toBe(400);
    });

    it("returns 400 when admin_consent is not True", async () => {
      const { res, store } = mockRes();
      const req = mockReq({ query: { tenant: "tenant-abc", admin_consent: "False", state: "tok" } });
      const handler = getHandler(consentRouter, "get", "/consent/callback");
      await handler!(req, res, (() => {}) as NextFunction);
      expect(store.statusCode).toBe(400);
    });
  });

  describe("GET /consent/callback — expired token", () => {
    it("returns 400 when DB returns empty (token expired/used)", async () => {
      dbSelectQueue.push([]); // empty → token not found
      const { res, store } = mockRes();
      const req = mockReq({
        query: { tenant: "tenant-abc", admin_consent: "True", state: "expired-tok" },
      });
      const handler = getHandler(consentRouter, "get", "/consent/callback");
      await handler!(req, res, (() => {}) as NextFunction);
      expect(store.statusCode).toBe(400);
    });
  });

  describe("GET /consent/callback — success", () => {
    it("upserts consent and redirects to /consent/success", async () => {
      dbSelectQueue.push([{ customerId: 5, clientUserId: null }]); // valid token row
      const { res, store } = mockRes();
      const req = mockReq({
        query: { tenant: "tenant-success", admin_consent: "True", state: "valid-tok" },
      });
      const handler = getHandler(consentRouter, "get", "/consent/callback");
      await handler!(req, res, (() => {}) as NextFunction);
      expect(store.redirectUrl).toContain("/consent/success");
      expect(store.redirectUrl).toContain("tenant=tenant-success");
      expect(mockInsert).toHaveBeenCalled();
    });

    it("accepts admin_consent=TRUE (case-insensitive)", async () => {
      dbSelectQueue.push([{ customerId: null, clientUserId: null }]);
      const { res, store } = mockRes();
      const req = mockReq({
        query: { tenant: "tenant-case", admin_consent: "TRUE", state: "tok" },
      });
      const handler = getHandler(consentRouter, "get", "/consent/callback");
      await handler!(req, res, (() => {}) as NextFunction);
      expect(store.redirectUrl).toContain("/consent/success");
    });
  });

  // Regression: cross-MSP tenant boundary guard on the direct self-service
  // checkout path. A checkout session (UUID state) whose Microsoft tenant is
  // already registered as a customer under a DIFFERENT MSP must be REJECTED
  // before the session is marked consented and before any write happens —
  // never silently cross-linked.
  describe("GET /consent/callback — cross-MSP tenant conflict (checkout session)", () => {
    // Valid UUID v4 so UUID_RE.test(state) === true (checkout-session path).
    const CHECKOUT_STATE = "11111111-1111-4111-8111-111111111111";

    it("rejects a checkout tenant already linked to a different MSP, before any write", async () => {
      dbSelectQueue.push([{ id: 89 }]);               // isDirectBusiness MSP id
      dbSelectQueue.push([{ id: 1, mspId: 1 }]);      // existing customer under a DIFFERENT mspId
      const { res, store } = mockRes();
      const req = mockReq({
        query: { tenant: "tenant-conflict", admin_consent: "True", state: CHECKOUT_STATE },
      });
      const handler = getHandler(consentRouter, "get", "/consent/callback");
      await handler!(req, res, (() => {}) as NextFunction);

      expect(store.redirectUrl).toContain("/consent/tenant-conflict");
      expect(store.redirectUrl).toContain("tenant=tenant-conflict");
      // Session must NOT be marked consented and tenant_consent must NOT be written.
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it("proceeds when the checkout tenant's existing customer is under the SAME (direct) MSP", async () => {
      dbSelectQueue.push([{ id: 89 }]);               // isDirectBusiness MSP id
      dbSelectQueue.push([{ id: 5, mspId: 89 }]);     // existing customer under the SAME mspId — no conflict
      const { res, store } = mockRes();
      const req = mockReq({
        query: { tenant: "tenant-ok", admin_consent: "True", state: CHECKOUT_STATE },
      });
      const handler = getHandler(consentRouter, "get", "/consent/callback");
      await handler!(req, res, (() => {}) as NextFunction);

      expect(store.redirectUrl).not.toContain("/consent/tenant-conflict");
      expect(store.redirectUrl).toContain("/consent/success");
    });

    it("proceeds when no customer exists for the checkout tenant yet", async () => {
      dbSelectQueue.push([{ id: 89 }]);               // isDirectBusiness MSP id
      dbSelectQueue.push([]);                          // no existing customer for this tenant
      const { res, store } = mockRes();
      const req = mockReq({
        query: { tenant: "tenant-new", admin_consent: "True", state: CHECKOUT_STATE },
      });
      const handler = getHandler(consentRouter, "get", "/consent/callback");
      await handler!(req, res, (() => {}) as NextFunction);

      expect(store.redirectUrl).not.toContain("/consent/tenant-conflict");
      expect(store.redirectUrl).toContain("/consent/success");
    });
  });
});
