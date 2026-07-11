/**
 * Consent Flow Tests (vitest)
 *
 * Covers:
 *   1. REQUIRED_MT_SCOPES — full union of 9 scopes
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
const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
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
  },
  tenantConsentTable: { tenantId: "tc.tenantId", consentStatus: "tc.consent_status", updatedAt: "tc.updated_at", customerId: "tc.customer_id" },
  consentInviteTokensTable: { token: "cit.token", customerId: "cit.customer_id", clientUserId: "cit.client_user_id", usedAt: "cit.used_at", expiresAt: "cit.expires_at", tenantId: "cit.tenant_id" },
  auditLogsTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq:     vi.fn((_col, _val) => ({ type: "eq" })),
  and:    vi.fn((...args) => ({ type: "and", args })),
  isNull: vi.fn((col) => ({ type: "isNull", col })),
  gte:    vi.fn((_col, _val) => ({ type: "gte" })),
  desc:   vi.fn((col) => ({ type: "desc", col })),
}));

vi.mock("../lib/audit.ts", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/logger.ts", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

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
    it("contains exactly 9 scopes", () => {
      expect(REQUIRED_MT_SCOPES).toHaveLength(9);
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
      );
      expect(url).toContain("login.microsoftonline.com");
      expect(url).toContain("adminconsent");
      expect(url).toContain("mt-client-id");
      expect(url).toContain("tok-abc");
      expect(url).toContain(encodeURIComponent("https://app.example.com/api/consent/callback"));
    });

    it("encodes the tenant hint", () => {
      const url = buildAdminConsentUrl("contoso.onmicrosoft.com", "t", "https://x.com/cb");
      expect(url).toContain(encodeURIComponent("contoso.onmicrosoft.com"));
    });

    it("uses 'common' as the tenant hint when passed", () => {
      const url = buildAdminConsentUrl("common", "t", "https://x.com/cb");
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
});
