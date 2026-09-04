/**
 * Consent Flow Tests (vitest)
 *
 * Covers:
 *   1. REQUIRED_MT_SCOPES — full union of 35 scopes
 *   2. buildAdminConsentUrl — URL structure
 *   3. ConsentRevokedError — instanceof, tenantId, message
 *   4. mtAppCredentialsPresent — env var checks
 *   5. markTenantConsentRevoked — evicts cache + calls db.update
 *   6. POST /consent/invite-link route handler — generates token & consent URL
 *   7. GET  /consent/callback success — burns token, stamps the consent record
 *   8. GET  /consent/callback declined — marks declined, redirects
 *   9. GET  /consent/callback expired token — 400
 *  10. PATCH /admin/consent/:tenantId/revoke — flips status or 404
 *
 * Storage note (Phase 6, #99): the three consent tables are gone — every grant
 * is now an UPDATE stamping one key of the tenants.consent jsonb, never an
 * INSERT/upsert keyed by tenant GUID. Assertions below track db.update for the
 * consent write accordingly; db.insert on these paths now only ever means the
 * consent_invite_tokens row.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";
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
  consentInviteTokensTable: { token: "cit.token", customerId: "cit.customer_id", clientUserId: "cit.client_user_id", usedAt: "cit.used_at", expiresAt: "cit.expires_at", tenantId: "cit.tenant_id" },
  mspsTable: { id: "m.id", isDirectBusiness: "m.is_direct_business" },
  // Phase 6 (#99): tenant_consent / tenant_write_consent /
  // tenant_sharepoint_consent and msp_customers are dropped — both graph.ts's
  // revoke path and every consent write in consent.ts now go through this one
  // table's `consent` jsonb column.
  tenantsTable: {
    id: "t.id", mspId: "t.msp_id", customerName: "t.customer_name", tenantId: "t.tenant_id",
    consent: "t.consent", status: "t.status", isTestbed: "t.is_testbed", updatedAt: "t.updated_at",
  },
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

// The consent callback statically imports lib/direct-tenant-provisioning.ts
// for the two functions it needs (resolveOrCreateDirectTenant — the single
// tenant-creation door the consent stamp now depends on — and
// provisionProspectAccount). Mocked here so this test exercises only
// consent.ts's own logic; the real behaviour of both is covered by
// direct-tenant-provisioning's own callers/tests.
const mockResolveOrCreateDirectTenant = vi.fn().mockResolvedValue({ id: 5, mspId: 1 });
vi.mock("../lib/direct-tenant-provisioning.ts", () => ({
  resolveOrCreateDirectTenant: (...args: unknown[]) => mockResolveOrCreateDirectTenant(...args),
  provisionProspectAccount: vi.fn().mockResolvedValue(null),
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
    it("contains exactly 35 scopes", () => {
      // 28 → 31 when #1130 added the read-app Graph scopes for Global Reader
      // role provisioning (commit 81370dba3) without updating this count —
      // the suite sat red at baseline until repaired here (#1312).
      // 31 → 35 (#1811): Tasks.Read.All (found genuinely granted live but never
      // transcribed) plus DeviceManagementApps.Read.All, TeamworkDevice.Read.All
      // and Exchange.ManageAsAppV2 (found via #1812's baseline audit — also
      // genuinely granted live, also never transcribed).
      expect(REQUIRED_MT_SCOPES).toHaveLength(35);
    });

    it("includes all required scopes", () => {
      // Every member of REQUIRED_MT_SCOPES, kept 1:1 with the length assertion
      // above so a passing count can never hide an unasserted member (#1312's
      // original repair, extended by #1811 which found 4 scopes present in the
      // array but absent from this list: RoleEligibilitySchedule.Read.Directory,
      // IdentityRiskEvent.Read.All, Organization.Read.All, Domain.Read.All).
      const required = [
        "Directory.Read.All",
        "SecurityEvents.Read.All",
        "Exchange.ManageAsApp",
        "Sites.Read.All",
        "Reports.Read.All",
        "Policy.Read.All",
        "DeviceManagementConfiguration.Read.All",
        "DeviceManagementManagedDevices.Read.All",
        "BitlockerKey.Read.All",
        "AuditLog.Read.All",
        "ActivityFeed.Read",
        "IdentityRiskyUser.Read.All",
        "IdentityRiskEvent.Read.All",
        "RoleEligibilitySchedule.Read.Directory",
        "AccessReview.Read.All",
        "TeamSettings.Read.All",
        "ServiceMessage.Read.All",
        "ServiceHealth.Read.All",
        "Agreement.Read.All",
        "Application.Read.All",
        "Community.Read.All",
        "DelegatedPermissionGrant.Read.All",
        "IdentityRiskyServicePrincipal.Read.All",
        "InformationProtectionPolicy.Read.All",
        "SensitivityLabels.Read.All",
        "RealTimeActivityFeed.Read.All",
        "RecordsManagement.Read.All",
        "SharePointTenantSettings.Read.All",
        "Team.ReadBasic.All",
        "Organization.Read.All",
        "Domain.Read.All",
        "Tasks.Read.All",
        "DeviceManagementApps.Read.All",
        "TeamworkDevice.Read.All",
        "Exchange.ManageAsAppV2",
      ];
      expect(required).toHaveLength(REQUIRED_MT_SCOPES.length);
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

// Helper: extract handler from router stack. Routes gated by requireAdmin
// carry TWO stack entries for the same method (the guard, then the real
// handler) — this returns only the FIRST, which is fine for ungated routes
// but silently no-ops an admin-gated one (the guard calls next() and stops).
// Use getHandlerChain below for any route mounted behind requireAdmin.
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

// Runs every middleware/handler registered for (method, path) in order, the
// same way Express itself would — required for requireAdmin-gated routes,
// where the guard and the real handler are two separate stack entries under
// the same method and a bare getHandler() would only ever run the guard.
function getHandlerChain(router: IRouter, method: string, path: string): ((...args: unknown[]) => Promise<void>)[] {
  const stack = (router as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ method: string; handle: (...args: unknown[]) => Promise<void> }> } }> }).stack;
  for (const layer of stack) {
    if (layer.route?.path === path) {
      return layer.route.stack.filter(h => h.method === method).map(h => h.handle);
    }
  }
  return [];
}

async function runChain(handlers: ((...args: unknown[]) => Promise<void>)[], req: Request, res: Response): Promise<void> {
  for (const handle of handlers) {
    let calledNext = false;
    await handle(req, res, () => { calledNext = true; });
    if (!calledNext) return;
  }
}

describe("consent route handlers", () => {
  beforeEach(() => {
    mockInsert.mockClear();
    mockUpdate.mockClear();
    mockSelect.mockClear();
    mockResolveOrCreateDirectTenant.mockClear();
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
    it("stamps consent on the invited customer's own tenant and redirects to /consent/success", async () => {
      dbSelectQueue.push([{ customerId: 5, clientUserId: null }]);      // valid token row, names customer 5
      dbSelectQueue.push([{ id: 5, tenantId: "tenant-success" }]);      // customer 5's tenant — matches
      const { res, store } = mockRes();
      const req = mockReq({
        query: { tenant: "tenant-success", admin_consent: "True", state: "valid-tok" },
      });
      const handler = getHandler(consentRouter, "get", "/consent/callback");
      await handler!(req, res, (() => {}) as NextFunction);
      expect(store.redirectUrl).toContain("/consent/success");
      expect(store.redirectUrl).toContain("tenant=tenant-success");
      // A token that names a customer resolves to THAT customer's existing row.
      // It must never take the create path — resolveOrCreateDirectTenant
      // attaches new rows to the isDirectBusiness MSP, which would put an
      // MSP-channel customer under the wrong MSP.
      expect(mockResolveOrCreateDirectTenant).not.toHaveBeenCalled();
      // The grant itself is an UPDATE on tenants.consent, not an upsert.
      expect(mockUpdate).toHaveBeenCalled();
    });

    // The security boundary on the invite path: the customerId on the token is
    // authoritative, the GUID Microsoft returns is not. If an admin from some
    // other Microsoft tenant walks an invite minted for customer 5, nothing may
    // be granted and no second customer object may be created for their GUID.
    it("REFUSES when the consenting tenant is not the invited customer's tenant", async () => {
      dbSelectQueue.push([{ customerId: 5, clientUserId: null }]);
      dbSelectQueue.push([{ id: 5, tenantId: "tenant-on-record" }]);
      const { res, store } = mockRes();
      const req = mockReq({
        query: { tenant: "tenant-someone-else", admin_consent: "True", state: "valid-tok" },
      });
      const handler = getHandler(consentRouter, "get", "/consent/callback");
      await handler!(req, res, (() => {}) as NextFunction);
      expect(store.statusCode).toBe(400);
      expect(store.redirectUrl).toBeNull();
      expect(mockResolveOrCreateDirectTenant).not.toHaveBeenCalled();
    });

    // Regression: resolveOrCreateDirectTenant returns null only when the
    // platform has no isDirectBusiness MSP configured. The admin genuinely
    // approved at Microsoft and there is nowhere to record it — that must fail
    // loudly rather than redirect the buyer to a success page.
    it("fails loudly (500, no success redirect) when no tenants row can be created", async () => {
      dbSelectQueue.push([{ customerId: null, clientUserId: null }]);   // no customer named → create path
      mockResolveOrCreateDirectTenant.mockResolvedValueOnce(null);
      const { res, store } = mockRes();
      const req = mockReq({
        query: { tenant: "tenant-orphan", admin_consent: "True", state: "valid-tok" },
      });
      const handler = getHandler(consentRouter, "get", "/consent/callback");
      await handler!(req, res, (() => {}) as NextFunction);
      expect(store.statusCode).toBe(500);
      expect(store.redirectUrl).toBeNull();
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
      // No customer on the token — this GUID legitimately may not have a
      // customer object yet, so the create path is correct here.
      expect(mockResolveOrCreateDirectTenant).toHaveBeenCalledWith("tenant-case", expect.any(String), undefined);
    });

    // Git #637: the read consent grant already covers SharePoint (Sites.FullControl.All
    // sits on this same MT_APP_CLIENT_ID registration), so the callback must stamp
    // BOTH keys from one Microsoft grant rather than leaving `sharepoint` for a
    // separate, redundant admin-consent round trip.
    it("also stamps the sharepoint key granted, from the same grant, alongside graph", async () => {
      dbSelectQueue.push([{ customerId: null, clientUserId: null }]);
      const { res, store } = mockRes();
      const req = mockReq({
        query: { tenant: "tenant-sp", admin_consent: "True", state: "tok" },
      });
      const handler = getHandler(consentRouter, "get", "/consent/callback");
      await handler!(req, res, (() => {}) as NextFunction);
      expect(store.redirectUrl).toContain("/consent/success");

      const setCalls = mockUpdateSet.mock.calls as Array<[{ consent: { args: unknown[] } }]>;
      const consentSetCalls = setCalls.filter(([arg]) => arg?.consent?.args);
      const keysStamped = consentSetCalls.map(([arg]) => arg.consent.args[2]);
      expect(keysStamped).toContain("graph");
      expect(keysStamped).toContain("sharepoint");

      const sharepointCall = consentSetCalls.find(([arg]) => arg.consent.args[2] === "sharepoint")!;
      const patch = JSON.parse(sharepointCall[0].consent.args[5] as string);
      expect(patch.status).toBe("granted");
      expect(patch.revokedAt).toBeNull();
      expect(Array.isArray(patch.grants)).toBe(true);
      expect(patch.grants.length).toBeGreaterThan(0);
    });
  });

  // Regression: cross-MSP tenant boundary guard on the direct self-service
  // checkout path. A checkout session (UUID state) whose Microsoft tenant is
  // already registered as a customer under a DIFFERENT MSP must be REJECTED
  // before the session is marked consented and before any write happens —
  // never silently cross-linked.
  //
  // NOTE (#474): a UUID state IS the marketing-site popup flow, and a popup
  // callback no longer redirects anywhere — it answers with a self-closing page
  // (an anonymous checkout buyer has no portal session to land in). So these
  // cases assert on the SENT PAGE, not on a redirect URL, while the guard
  // invariants they exist for — no write, no cross-link, no customer row —
  // are unchanged and still asserted directly.
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

      // Popup origin: no redirect at all, and the refusal is stated on a page
      // that deliberately does NOT close itself — the flow behind it will never
      // advance, so the buyer has to be able to read why.
      expect(store.redirectUrl).toBeNull();
      expect(store.sentText).toContain("already connected");
      expect(store.sentText).not.toContain("window.close");
      // Session must NOT be marked consented and no grant may be stamped.
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockInsert).not.toHaveBeenCalled();
      // The guard must also run BEFORE any tenants row is created for the
      // conflicting GUID — rejecting must not leave a customer object behind.
      expect(mockResolveOrCreateDirectTenant).not.toHaveBeenCalled();
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

      expect(store.redirectUrl).toBeNull();
      expect(store.sentText).not.toContain("already connected");
      expect(store.sentText).toContain("Access granted");
      expect(store.sentText).toContain("window.close");
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

      expect(store.redirectUrl).toBeNull();
      expect(store.sentText).not.toContain("already connected");
      expect(store.sentText).toContain("Access granted");
      expect(store.sentText).toContain("window.close");
    });

    // The other half of #474's contract, asserted so it cannot silently regress:
    // a NON-checkout (portal/invite-token) consent must still redirect exactly
    // as it always has, and must never be handed the popup page.
    it("still redirects the portal/invite path to /consent/success (no popup page)", async () => {
      dbSelectQueue.push([{ customerId: null, clientUserId: null }]);   // invite-token lookup
      const { res, store } = mockRes();
      const req = mockReq({
        query: { tenant: "tenant-portal", admin_consent: "True", state: "not-a-uuid-token" },
      });
      const handler = getHandler(consentRouter, "get", "/consent/callback");
      await handler!(req, res, (() => {}) as NextFunction);

      expect(store.redirectUrl).toContain("/portal/consent/success");
      expect(store.redirectUrl).toContain("tenant=tenant-portal");
      expect(store.sentText).toBeNull();
    });

    // A declined popup has to close itself too — otherwise the buyer is left
    // staring at a portal page they cannot use after saying "no".
    it("answers a declined checkout-session consent with a self-closing page", async () => {
      const { res, store } = mockRes();
      const req = mockReq({
        query: { tenant: "tenant-declined", error: "access_denied", state: CHECKOUT_STATE },
      });
      const handler = getHandler(consentRouter, "get", "/consent/callback");
      await handler!(req, res, (() => {}) as NextFunction);

      expect(store.redirectUrl).toBeNull();
      expect(store.sentText).toContain("not granted");
      expect(store.sentText).toContain("window.close");
    });
  });

  // Phase 6 (#99) scope resolution on the write-back callback. The grant is
  // written to the tenants row named by the HMAC-signed customerId; the `tenant`
  // GUID Microsoft appends to the redirect is unsigned and is only a check. If
  // the two disagree, the admin who approved belongs to a different Microsoft
  // tenant than the link was minted for, and NEITHER row may be granted write
  // permissions. This is the case that could otherwise hand one customer's
  // write-back grant to another tenant, so it is asserted directly.
  describe("GET /admin/write-consent/callback — tenant/customer scope binding", () => {
    /** Mirrors signWriteConsentState() in consent.ts (not exported). */
    function writeState(customerId: number, token: string): string {
      const mac = createHmac("sha256", process.env.JWT_SECRET as string)
        .update(`write-consent:${customerId}:${token}`)
        .digest("hex");
      return `wc.${customerId}.${token}.${mac}`;
    }

    /** True if any db.update(...).set(...) in this test wrote the consent column. */
    function consentWasStamped(): boolean {
      return mockUpdateSet.mock.calls.some(
        (args) => args[0] != null && typeof args[0] === "object" && "consent" in (args[0] as object),
      );
    }

    beforeEach(() => { mockUpdateSet.mockClear(); });

    it("REFUSES when the consenting Microsoft tenant is not this customer's tenant", async () => {
      dbSelectQueue.push([{ customerId: 7 }]);                          // token row, bound to customer 7
      dbSelectQueue.push([{ id: 7, tenantId: "tenant-legit" }]);        // customer 7's real tenant
      const { res, store } = mockRes();
      const req = mockReq({
        query: { tenant: "tenant-someone-else", admin_consent: "True", state: writeState(7, "tok-w") },
      });
      const handler = getHandler(consentRouter, "get", "/admin/write-consent/callback");
      expect(handler).not.toBeNull();
      await handler!(req, res, (() => {}) as NextFunction);

      expect(store.statusCode).toBe(400);
      expect(consentWasStamped()).toBe(false);
    });

    it("REFUSES when the customer row no longer exists", async () => {
      dbSelectQueue.push([{ customerId: 7 }]);
      dbSelectQueue.push([]);                                           // customer gone
      const { res, store } = mockRes();
      const req = mockReq({
        query: { tenant: "tenant-legit", admin_consent: "True", state: writeState(7, "tok-w") },
      });
      const handler = getHandler(consentRouter, "get", "/admin/write-consent/callback");
      await handler!(req, res, (() => {}) as NextFunction);

      expect(store.statusCode).toBe(400);
      expect(consentWasStamped()).toBe(false);
    });

    it("grants when the consenting tenant matches the customer's own tenant", async () => {
      dbSelectQueue.push([{ customerId: 7 }]);
      dbSelectQueue.push([{ id: 7, tenantId: "tenant-legit" }]);
      const { res, store } = mockRes();
      const req = mockReq({
        query: { tenant: "tenant-legit", admin_consent: "True", state: writeState(7, "tok-w") },
      });
      const handler = getHandler(consentRouter, "get", "/admin/write-consent/callback");
      await handler!(req, res, (() => {}) as NextFunction);

      expect(store.redirectUrl).toContain("/consent/success");
      expect(store.redirectUrl).toContain("write=1");
      expect(consentWasStamped()).toBe(true);
    });

    // ── #474: the popup-origin state form ────────────────────────────────────
    // The write callback is ONE fixed Azure redirect URI shared by the admin,
    // portal and marketing-site flows, so the only thing that can tell it which
    // UI to answer is the state — and that has to be tamper-proof, hence the
    // origin segment being covered by the same HMAC as customerId and the token.

    /** Mirrors signWriteConsentState(..., "popup") — the 5-segment form. */
    function writeStatePopup(customerId: number, token: string): string {
      const mac = createHmac("sha256", process.env.JWT_SECRET as string)
        .update(`write-consent:${customerId}:${token}:popup`)
        .digest("hex");
      return `wc.${customerId}.${token}.popup.${mac}`;
    }

    it("answers a popup-origin write consent with a self-closing page, not a portal redirect", async () => {
      dbSelectQueue.push([{ customerId: 7 }]);
      dbSelectQueue.push([{ id: 7, tenantId: "tenant-legit" }]);
      const { res, store } = mockRes();
      const req = mockReq({
        query: { tenant: "tenant-legit", admin_consent: "True", state: writeStatePopup(7, "tok-w") },
      });
      const handler = getHandler(consentRouter, "get", "/admin/write-consent/callback");
      await handler!(req, res, (() => {}) as NextFunction);

      expect(store.redirectUrl).toBeNull();
      expect(store.sentText).toContain("Write access granted");
      expect(store.sentText).toContain("window.close");
      // The grant itself is unaffected by which UI asked for it.
      expect(consentWasStamped()).toBe(true);
    });

    it("REFUSES a state whose origin segment was tampered onto a portal MAC", async () => {
      // Take a valid PORTAL state and splice "popup" in front of its MAC. The
      // MAC was computed without the origin, so this must fail closed rather
      // than be accepted as a popup consent.
      const portal = writeState(7, "tok-w");           // wc.7.tok-w.<mac>
      const parts = portal.split(".");
      const forged = `${parts[0]}.${parts[1]}.${parts[2]}.popup.${parts[3]}`;
      const { res, store } = mockRes();
      const req = mockReq({
        query: { tenant: "tenant-legit", admin_consent: "True", state: forged },
      });
      const handler = getHandler(consentRouter, "get", "/admin/write-consent/callback");
      await handler!(req, res, (() => {}) as NextFunction);

      expect(store.statusCode).toBe(400);
      expect(consentWasStamped()).toBe(false);
    });

    it("REFUSES a 5-segment state whose origin segment is not the literal 'popup'", async () => {
      const mac = createHmac("sha256", process.env.JWT_SECRET as string)
        .update(`write-consent:7:tok-w:portal`)
        .digest("hex");
      const { res, store } = mockRes();
      const req = mockReq({
        query: { tenant: "tenant-legit", admin_consent: "True", state: `wc.7.tok-w.portal.${mac}` },
      });
      const handler = getHandler(consentRouter, "get", "/admin/write-consent/callback");
      await handler!(req, res, (() => {}) as NextFunction);

      expect(store.statusCode).toBe(400);
      expect(consentWasStamped()).toBe(false);
    });
  });

  // Phase 10 (Issue #91): the AD Tenant pane's unified revoke action selects
  // which of the three tenants.consent keys to flip via this one route's
  // `key` body param — confirming the default stays "graph" (every pre-Phase-10
  // caller never sent a body) and that the selector actually reaches
  // mergeConsentKey rather than being silently ignored.
  describe("PATCH /admin/consent/:tenantId/revoke — consent-type selector", () => {
    beforeEach(() => {
      mockUpdateSet.mockClear();
      mockUpdateReturning.mockResolvedValue([{ tenantId: "tenant-abc" }]);
    });

    it("defaults to the graph key when no key is provided in the body", async () => {
      const { res, store } = mockRes();
      const req = mockReq({ params: { tenantId: "tenant-abc" }, body: {} });
      const handlers = getHandlerChain(consentRouter, "patch", "/admin/consent/:tenantId/revoke");
      expect(handlers.length).toBeGreaterThan(0);
      await runChain(handlers, req, res);

      expect(store.statusCode).toBe(200);
      expect((store.jsonBody as { key: string }).key).toBe("graph");
    });

    it("flips the sharepoint key when key=sharepoint is passed", async () => {
      const { res, store } = mockRes();
      const req = mockReq({ params: { tenantId: "tenant-abc" }, body: { key: "sharepoint" } });
      await runChain(getHandlerChain(consentRouter, "patch", "/admin/consent/:tenantId/revoke"), req, res);

      expect(store.statusCode).toBe(200);
      expect((store.jsonBody as { key: string }).key).toBe("sharepoint");
    });

    it("flips the writeBack key when key=writeBack is passed", async () => {
      const { res, store } = mockRes();
      const req = mockReq({ params: { tenantId: "tenant-abc" }, body: { key: "writeBack" } });
      await runChain(getHandlerChain(consentRouter, "patch", "/admin/consent/:tenantId/revoke"), req, res);

      expect(store.statusCode).toBe(200);
      expect((store.jsonBody as { key: string }).key).toBe("writeBack");
    });

    it("rejects an invalid key with 400, writing nothing", async () => {
      const { res, store } = mockRes();
      const req = mockReq({ params: { tenantId: "tenant-abc" }, body: { key: "bogus" } });
      await runChain(getHandlerChain(consentRouter, "patch", "/admin/consent/:tenantId/revoke"), req, res);

      expect(store.statusCode).toBe(400);
      expect(mockUpdateSet).not.toHaveBeenCalled();
    });

    it("returns 404 when no tenants row matches the tenantId", async () => {
      mockUpdateReturning.mockResolvedValueOnce([]);
      const { res, store } = mockRes();
      const req = mockReq({ params: { tenantId: "tenant-missing" }, body: {} });
      await runChain(getHandlerChain(consentRouter, "patch", "/admin/consent/:tenantId/revoke"), req, res);

      expect(store.statusCode).toBe(404);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// #1312 (Epic #1309 Phase 3) — write-consent product-type gate on the public
// session-keyed mint. The security property under test: ONLY a session whose
// ordered product is a Quick-Start Pack (services.category 'config_pack') or an
// assessment (the pre-existing #432 path) can mint a write-consent URL;
// Monitoring and Retainer are refused server-side BEFORE any single-use token
// is inserted, regardless of what the caller asks for. Resolution is from the
// services row the session's own productSlug names — never caller input.
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /public/flow/write-consent-url — product-type gate (#1312)", () => {
  const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";

  /** Select-queue rows, in the exact order the route consumes them. */
  const sessionRow = (over: Record<string, unknown> = {}) => ({
    id: SESSION_ID,
    status: "consented",
    tenantId: "tenant-abc",
    productSlug: "entra-id-quickstart-v1",
    ...over,
  });
  const consentedTenantRow = () => ({
    id: 7,
    tenantId: "tenant-abc",
    consent: { graph: { status: "granted" } },
  });

  async function callRoute(queue: unknown[][]): Promise<MockResStore> {
    dbSelectQueue = queue;
    const { res, store } = mockRes();
    const req = mockReq({ headers: {}, query: { sessionId: SESSION_ID } });
    const handler = getHandler(consentRouter, "get", "/public/flow/write-consent-url");
    expect(handler).not.toBeNull();
    await handler!(req, res, (() => {}) as NextFunction);
    return store;
  }

  beforeEach(() => {
    process.env.MT_APP_WRITE_CLIENT_ID = "write-client-id";
    mockInsert.mockClear();
    mockSelect.mockClear();
    dbSelectQueue = [];
  });

  it("mints a write-consent URL for a Quick-Start Pack (category config_pack, NULL service_type)", async () => {
    // 7 of the 12 sellable pack rows carry service_type NULL in the live
    // catalog — category is the discriminator that must carry the decision.
    const store = await callRoute([
      [sessionRow({ productSlug: "break-glass-access-pack-v1" })],
      [{ category: "config_pack", serviceType: null }],
      [consentedTenantRow()],
    ]);

    expect(store.statusCode).toBe(200);
    const body = store.jsonBody as { consentUrl: string };
    // The WRITE app registration, not the read one — and the wc.-prefixed
    // popup state carrying the resolved customerId, aimed at the one fixed
    // write callback the admin flow registered.
    expect(body.consentUrl).toContain("client_id=write-client-id");
    expect(body.consentUrl).toContain("state=wc.7.");
    expect(body.consentUrl).toContain(encodeURIComponent("/api/admin/write-consent/callback"));
    // A single-use consent_invite_tokens row was minted.
    expect(mockInsert).toHaveBeenCalled();
  });

  it("still mints for an assessment product — the pre-#1312 #432 path, unchanged", async () => {
    const store = await callRoute([
      [sessionRow({ productSlug: "copilot-readiness-assessment" })],
      [{ category: "assessment", serviceType: "assessment" }],
      [consentedTenantRow()],
    ]);

    expect(store.statusCode).toBe(200);
    expect((store.jsonBody as { consentUrl: string }).consentUrl).toContain("client_id=write-client-id");
  });

  it("REFUSES a Monitoring session with 403 and mints no token", async () => {
    const store = await callRoute([
      [sessionRow({ productSlug: "monitoring-foundation-smb" })],
      [{ category: "monitoring", serviceType: "monitoring_tier" }],
      // No third row: the route must never reach resolveConsentedTenant.
    ]);

    expect(store.statusCode).toBe(403);
    expect((store.jsonBody as { error: string }).error).toBe("write_consent_not_available_for_product");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("REFUSES a Retainer session with 403 and mints no token", async () => {
    const store = await callRoute([
      [sessionRow({ productSlug: "architect-enterprise-retainer" })],
      [{ category: "retainer", serviceType: "retainer" }],
    ]);

    expect(store.statusCode).toBe(403);
    expect((store.jsonBody as { error: string }).error).toBe("write_consent_not_available_for_product");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("fails CLOSED when the session's slug names no services row (e.g. sow-cart)", async () => {
    const store = await callRoute([
      [sessionRow({ productSlug: "sow-cart" })],
      [], // no services row resolves this slug
    ]);

    expect(store.statusCode).toBe(403);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("refuses an ineligible product BEFORE read-consent state is even considered", async () => {
    // A Monitoring session that never granted read consent still gets the
    // definitive product refusal (403), not read_consent_required (409) —
    // nothing about retrying a Monitoring purchase can ever make it eligible.
    const store = await callRoute([
      [sessionRow({ productSlug: "monitoring-growth-smb", tenantId: null, status: "pending" })],
      [{ category: "monitoring", serviceType: "monitoring_tier" }],
    ]);

    expect(store.statusCode).toBe(403);
    expect((store.jsonBody as { error: string }).error).toBe("write_consent_not_available_for_product");
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// #1311 (Epic #1309 Phase 2) — generalized READ-consent flow for purchase
// sessions. Properties under test: the requirement mapping is fail-closed
// (only "retainer" may ever skip), the session-state URL mint reuses the one
// shared builder, the skip route refuses required products and already-landed
// consents server-side, and the callback clears a recorded skip the moment a
// real grant lands. Existing flows (invite, reconsent, assessment funnel)
// are covered above and untouched.
// ═══════════════════════════════════════════════════════════════════════════════

import {
  readConsentRequirementForServiceType,
  buildSessionReadConsentUrl,
} from "../lib/read-consent-flow.ts";

describe("read-consent-flow (#1311) — requirement mapping + session URL", () => {
  it("marks ONLY retainer optional; every other/unknown serviceType is required (fail closed)", () => {
    expect(readConsentRequirementForServiceType("retainer")).toBe("optional");
    expect(readConsentRequirementForServiceType("monitoring_tier")).toBe("required");
    expect(readConsentRequirementForServiceType("config_pack")).toBe("required");
    expect(readConsentRequirementForServiceType("assessment")).toBe("required");
    expect(readConsentRequirementForServiceType("some-future-type")).toBe("required");
    expect(readConsentRequirementForServiceType(null)).toBe("required");
    expect(readConsentRequirementForServiceType(undefined)).toBe("required");
  });

  it("builds the session-state URL on the READ app aimed at /api/consent/callback", () => {
    const url = buildSessionReadConsentUrl(
      "https://example.test",
      "323e4567-e89b-42d3-a456-426614174000",
      "mt-client-id",
    );
    expect(url).toContain("https://login.microsoftonline.com/common/adminconsent?");
    expect(url).toContain("client_id=mt-client-id");
    expect(url).toContain("state=323e4567-e89b-42d3-a456-426614174000");
    expect(url).toContain(encodeURIComponent("https://example.test/api/consent/callback"));
  });
});

describe("GET /public/flow/read-consent-url (#1311)", () => {
  const SESSION_ID = "223e4567-e89b-42d3-a456-426614174000";

  const flowSessionRow = (over: Record<string, unknown> = {}) => ({
    id: SESSION_ID,
    status: "pending",
    tenantId: null,
    productSlug: "architect-essentials-retainer",
    consentSkippedAt: null,
    ...over,
  });

  async function callUrlRoute(queue: unknown[][]): Promise<MockResStore> {
    dbSelectQueue = queue;
    const { res, store } = mockRes();
    const req = mockReq({ headers: {}, query: { sessionId: SESSION_ID } });
    const handler = getHandler(consentRouter, "get", "/public/flow/read-consent-url");
    expect(handler).not.toBeNull();
    await handler!(req, res, (() => {}) as NextFunction);
    return store;
  }

  beforeEach(() => {
    dbSelectQueue = [];
    mockSelect.mockClear();
    mockUpdate.mockClear();
  });

  it("returns an optional, skippable session-state URL for a Retainer session", async () => {
    const store = await callUrlRoute([
      [flowSessionRow()],
      [{ serviceType: "retainer" }],
    ]);
    expect(store.statusCode).toBe(200);
    const body = store.jsonBody as {
      url: string; requirement: string; skippable: boolean; scopes: string[]; readConsentSkipped: boolean;
    };
    expect(body.requirement).toBe("optional");
    expect(body.skippable).toBe(true);
    expect(body.url).toContain("client_id=mt-client-id");
    expect(body.url).toContain(`state=${SESSION_ID}`);
    expect(body.url).toContain("/common/adminconsent");
    expect(body.scopes.length).toBeGreaterThan(0);
    expect(body.readConsentSkipped).toBe(false);
  });

  it("returns required + not skippable for a Monitoring session", async () => {
    const store = await callUrlRoute([
      [flowSessionRow({ productSlug: "monitoring-foundation-smb" })],
      [{ serviceType: "monitoring_tier" }],
    ]);
    expect(store.statusCode).toBe(200);
    const body = store.jsonBody as { requirement: string; skippable: boolean; url: string };
    expect(body.requirement).toBe("required");
    expect(body.skippable).toBe(false);
    expect(body.url).toContain(`state=${SESSION_ID}`);
  });

  it("fails CLOSED to required when the slug names no services row", async () => {
    const store = await callUrlRoute([
      [flowSessionRow({ productSlug: "no-such-product" })],
      [], // no services row
    ]);
    expect(store.statusCode).toBe(200);
    expect((store.jsonBody as { requirement: string }).requirement).toBe("required");
    expect((store.jsonBody as { skippable: boolean }).skippable).toBe(false);
  });

  it("404s an unknown/expired session (same resolveFlowSession contract as its siblings)", async () => {
    const store = await callUrlRoute([[]]);
    expect(store.statusCode).toBe(404);
    expect((store.jsonBody as { error: string }).error).toBe("session_expired");
  });
});

describe("POST /public/flow/read-consent-skip (#1311)", () => {
  const SESSION_ID = "223e4567-e89b-42d3-a456-426614174000";

  const flowSessionRow = (over: Record<string, unknown> = {}) => ({
    id: SESSION_ID,
    status: "pending",
    tenantId: null,
    productSlug: "architect-essentials-retainer",
    consentSkippedAt: null,
    ...over,
  });

  async function callSkipRoute(queue: unknown[][], sessionId: unknown = SESSION_ID): Promise<MockResStore> {
    dbSelectQueue = queue;
    const { res, store } = mockRes();
    const req = mockReq({ headers: {}, body: { sessionId } });
    const handler = getHandler(consentRouter, "post", "/public/flow/read-consent-skip");
    expect(handler).not.toBeNull();
    await handler!(req, res, (() => {}) as NextFunction);
    return store;
  }

  beforeEach(() => {
    dbSelectQueue = [];
    mockSelect.mockClear();
    mockUpdate.mockClear();
    mockUpdateSet.mockClear();
  });

  it("records the skip for a Retainer session — a real UPDATE stamping consentSkippedAt", async () => {
    const store = await callSkipRoute([
      [flowSessionRow()],
      [{ serviceType: "retainer" }],
    ]);
    expect(store.statusCode).toBe(200);
    const body = store.jsonBody as { ok: boolean; requirement: string; readConsentSkipped: boolean };
    expect(body.ok).toBe(true);
    expect(body.requirement).toBe("optional");
    expect(body.readConsentSkipped).toBe(true);
    const skipSet = (mockUpdateSet.mock.calls as Array<[Record<string, unknown>]>)
      .find(([arg]) => arg["consentSkippedAt"] instanceof Date);
    expect(skipSet).toBeDefined();
  });

  it("REFUSES a Monitoring session with 409 consent_required and writes NOTHING", async () => {
    const store = await callSkipRoute([
      [flowSessionRow({ productSlug: "monitoring-foundation-smb" })],
      [{ serviceType: "monitoring_tier" }],
    ]);
    expect(store.statusCode).toBe(409);
    expect((store.jsonBody as { error: string }).error).toBe("consent_required");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("fails CLOSED for a slug with no services row — refused, nothing written", async () => {
    const store = await callSkipRoute([
      [flowSessionRow({ productSlug: "sow-cart" })],
      [], // no services row resolves this slug
    ]);
    expect(store.statusCode).toBe(409);
    expect((store.jsonBody as { error: string }).error).toBe("consent_required");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("REFUSES once consent has landed (tenant connected) — 409 already_consented, before any catalog read", async () => {
    const store = await callSkipRoute([
      [flowSessionRow({ tenantId: "tenant-abc", status: "consented" })],
      // No second row: the route must refuse before reading the services row.
    ]);
    expect(store.statusCode).toBe(409);
    expect((store.jsonBody as { error: string }).error).toBe("already_consented");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("400s a non-UUID sessionId without touching anything", async () => {
    const store = await callSkipRoute([], "not-a-uuid");
    expect(store.statusCode).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("GET /consent/callback — read-consent skip is cleared by a real grant (#1311)", () => {
  const CHECKOUT_STATE = "44444444-4444-4444-8444-444444444444";

  it("sets consentSkippedAt back to null in the same update that marks the session consented", async () => {
    dbSelectQueue = [];
    mockUpdateSet.mockClear();
    dbSelectQueue.push([{ id: 89 }]); // isDirectBusiness MSP id (cross-MSP guard)
    dbSelectQueue.push([]);           // no conflicting customer for this tenant
    const { res } = mockRes();
    const req = mockReq({
      query: { tenant: "tenant-skip-clear", admin_consent: "True", state: CHECKOUT_STATE },
    });
    const handler = getHandler(consentRouter, "get", "/consent/callback");
    await handler!(req, res, (() => {}) as NextFunction);

    const sessionSet = (mockUpdateSet.mock.calls as Array<[Record<string, unknown>]>)
      .find(([arg]) => arg["status"] === "consented");
    expect(sessionSet).toBeDefined();
    // The property must be PRESENT and explicitly null — a buyer who skipped,
    // changed their mind, and connected is no longer "skipped".
    expect(Object.prototype.hasOwnProperty.call(sessionSet![0], "consentSkippedAt")).toBe(true);
    expect(sessionSet![0]["consentSkippedAt"]).toBeNull();
  });
});
