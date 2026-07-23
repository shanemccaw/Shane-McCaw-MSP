/**
 * graph-consent-revoke.test.ts
 *
 * Integration tests for the auto-flip behaviour in graphFetchForTenant:
 * when a live Graph API call returns a response whose BODY carries a documented
 * consent-failure signature (invalid_grant / AADSTS65001 / consent_required /
 * AADSTS700016) the system must atomically:
 *   (a) flip tenantConsentTable.consentStatus → "revoked"  \
 *       and tenantMonitorProfilesTable rows → "consent_revoked"  }  single transaction
 *   (b) emit a canonical audit log entry (actionType=tenant_consent_revoked)
 *   (c) throw ConsentRevokedError (typed, never a raw Error)
 *
 * A bare 401 is NOT a revocation signal (the consent auto-revoke root-cause fix):
 * Graph 401s for non-consent reasons (expired/stale token — InvalidAuthenticationToken,
 * wrong-audience token, missing app scope on Intune/Reports-class workloads). On a
 * non-consent 401 the token cache is evicted and the call retried ONCE with a fresh
 * token; genuine revocation is then detected authoritatively at the token endpoint.
 * A 401 that persists with a fresh token is a per-call scope/endpoint error → plain
 * error response, never a tenant-wide consent flip.
 *
 * Route-level test:
 *   (d) when ConsentRevokedError propagates to the top-level Express handler,
 *       the client receives 403 + { code: "consent_revoked" }
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// ── Environment ────────────────────────────────────────────────────────────────
process.env.MT_APP_CLIENT_ID = "mt-client-id";
process.env.MT_APP_CLIENT_SECRET = "mt-client-secret";
process.env.JWT_SECRET = "test-jwt-secret";

// ── DB mock with transaction support ──────────────────────────────────────────
// db.transaction receives a callback (tx) and invokes it with a "tx" that has
// the same update/insert API. We capture calls via txUpdate spy.

vi.mock("@workspace/db", () => {
  const txUpdateWhere = vi.fn().mockResolvedValue([]);
  const txUpdateSet = vi.fn().mockReturnValue({ where: txUpdateWhere });
  const txUpdate = vi.fn().mockReturnValue({ set: txUpdateSet });
  const tx = { update: txUpdate, insert: vi.fn() };

  const transaction = vi.fn().mockImplementation(async (cb: (arg: typeof tx) => Promise<void>) => {
    await cb(tx);
  });

  const insertValues = vi.fn().mockReturnValue({
    onConflictDoNothing: vi.fn().mockResolvedValue([]),
  });
  const insert = vi.fn().mockReturnValue({ values: insertValues });

  return {
    db: { transaction, insert, tx },
    tenantConsentTable: {},
    tenantMonitorProfilesTable: {},
    auditLogsTable: {},
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ op: "eq", a, b })),
  ne: vi.fn((a: unknown, b: unknown) => ({ op: "ne", a, b })),
  and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
}));

vi.mock("../logger", () => {
  const child = vi.fn();
  const base = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child };
  child.mockReturnValue(base);
  return { logger: base };
});

vi.mock("../audit", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

// ── Import under test (after mocks) ───────────────────────────────────────────

import { graphFetchForTenant, markTenantConsentRevoked, ConsentRevokedError, LicenseGapError, classifyGraphError } from "../graph";
import { db } from "@workspace/db";
import { createAuditLog } from "../audit";

// ── Typed mock accessors ──────────────────────────────────────────────────────

interface MockDb {
  transaction: Mock;
  insert: Mock;
  tx: { update: Mock };
}
const mockDb = db as unknown as MockDb;
const mockCreateAuditLog = createAuditLog as unknown as Mock;

// Helper: get all argument objects passed to tx.update(...).set(...)
function getTxSetCalls(): Array<Record<string, unknown>> {
  type AnyResult = { type: string; value: { set: Mock } };
  return (mockDb.tx.update.mock.results as AnyResult[])
    .filter((r) => r.type === "return")
    .map((r) => r.value.set)
    .flatMap((setFn) => setFn.mock.calls.map((args) => args[0] as Record<string, unknown>));
}

// ── fetch stub ────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Response builders ─────────────────────────────────────────────────────────

const tokenOk = () => ({
  ok: true,
  json: async () => ({ access_token: "tok", expires_in: 3600 }),
});

// A 401 whose body carries a REAL consent-revocation signature (the enterprise
// app was deleted from the customer tenant). This — not the bare status — is
// what must trigger the auto-revoke.
const graph401Consent = () => ({
  ok: false,
  status: 401,
  headers: new Headers(),
  text: async () => '{"error":{"code":"invalid_grant","message":"AADSTS65001: consent revoked"}}',
});

// A 401 with an expired/invalid-token body — a token-lifecycle fault, NOT a
// consent revocation. Previously this misfired the tenant-wide auto-revoke
// (the ~5-min-after-grant bug); now it must retry with a fresh token and, if
// the 401 persists, surface a plain error response with no consent flip.
const graph401StaleToken = () => ({
  ok: false,
  status: 401,
  headers: new Headers(),
  text: async () => '{"error":{"code":"InvalidAuthenticationToken","message":"Expired token"}}',
});

const graph403Consent = (body: string) => ({
  ok: false,
  status: 403,
  headers: new Headers(),
  text: async () => body,
});

const graph403Plain = () => ({
  ok: false,
  status: 403,
  headers: new Headers(),
  text: async () => '{"error":{"code":"Authorization_RequestDenied","message":"Insufficient privileges."}}',
});

const graph200 = () => ({
  ok: true,
  status: 200,
  json: async () => ({ value: [{ id: "u1" }] }),
});

// ── graphFetchForTenant — consent-body auto-revoke + non-consent-401 no-revoke ─

describe("graphFetchForTenant — consent auto-revoke (body signature, not bare 401)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Fully reset the fetch stub's queue+implementation so per-test queues are
    // deterministic regardless of the module-level token cache (unique tenant
    // ids per test keep token-fetch counts predictable).
    mockFetch.mockReset();
    const txUpdateWhere = vi.fn().mockResolvedValue([]);
    const txUpdateSet = vi.fn().mockReturnValue({ where: txUpdateWhere });
    mockDb.tx.update.mockReturnValue({ set: txUpdateSet });
    mockDb.transaction.mockImplementation(async (cb: (tx: { update: Mock }) => Promise<void>) => {
      await cb(mockDb.tx);
    });
    mockCreateAuditLog.mockResolvedValue(undefined);
  });

  it("throws ConsentRevokedError (not a raw Error) on a 401 with a consent-signature body", async () => {
    mockFetch.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(graph401Consent());
    await expect(graphFetchForTenant("tenant-revoke-1", "/users")).rejects.toThrow(ConsentRevokedError);
  });

  it("attaches the correct tenantId to the thrown error", async () => {
    mockFetch.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(graph401Consent());
    let err: unknown;
    try { await graphFetchForTenant("tenant-revoke-2", "/users"); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ConsentRevokedError);
    expect((err as ConsentRevokedError).tenantId).toBe("tenant-revoke-2");
  });

  it("executes DB updates inside a transaction on a consent-body 401", async () => {
    mockFetch.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(graph401Consent());
    await expect(graphFetchForTenant("tenant-revoke-3", "/users")).rejects.toThrow(ConsentRevokedError);
    expect(mockDb.transaction).toHaveBeenCalledOnce();
  });

  it("flips tenantConsentTable.consentStatus to revoked inside transaction", async () => {
    mockFetch.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(graph401Consent());
    await expect(graphFetchForTenant("tenant-revoke-4", "/users")).rejects.toThrow(ConsentRevokedError);
    const setCalls = getTxSetCalls();
    expect(setCalls.some((c) => c?.consentStatus === "revoked")).toBe(true);
  });

  it("flips monitor profiles to consent_revoked inside transaction", async () => {
    mockFetch.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(graph401Consent());
    await expect(graphFetchForTenant("tenant-revoke-5", "/users")).rejects.toThrow(ConsentRevokedError);
    const setCalls = getTxSetCalls();
    expect(setCalls.some((c) => c?.status === "consent_revoked")).toBe(true);
  });

  it("emits audit log with actionType=tenant_consent_revoked on a consent-body 401", async () => {
    mockFetch.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(graph401Consent());
    await expect(graphFetchForTenant("tenant-revoke-6", "/users")).rejects.toThrow(ConsentRevokedError);
    expect(mockCreateAuditLog).toHaveBeenCalledOnce();
    const call = mockCreateAuditLog.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.actionType).toBe("tenant_consent_revoked");
    expect(call.entityId).toBe("tenant-revoke-6");
    expect((call.metadata as Record<string, unknown>)?.autoRevoked).toBe(true);
  });

  it("auto-revokes on 403 with invalid_grant body", async () => {
    mockFetch
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(graph403Consent('{"error":{"code":"invalid_grant"}}'));
    await expect(graphFetchForTenant("tenant-403-a", "/groups")).rejects.toThrow(ConsentRevokedError);
    expect(mockCreateAuditLog).toHaveBeenCalledOnce();
  });

  it("auto-revokes on 403 with AADSTS65001 body", async () => {
    mockFetch
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(graph403Consent("AADSTS65001: The user or administrator has not consented"));
    await expect(graphFetchForTenant("tenant-403-b", "/groups")).rejects.toThrow(ConsentRevokedError);
  });

  it("auto-revokes on 403 with consent_required body", async () => {
    mockFetch
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(graph403Consent('{"error":{"code":"consent_required"}}'));
    await expect(graphFetchForTenant("tenant-403-c", "/groups")).rejects.toThrow(ConsentRevokedError);
  });

  it("auto-revokes on 401 with AADSTS700016 (app deleted from tenant) body", async () => {
    mockFetch
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers(),
        text: async () => "AADSTS700016: Application not found in the directory",
      });
    await expect(graphFetchForTenant("tenant-700016", "/users")).rejects.toThrow(ConsentRevokedError);
  });

  it("does NOT auto-revoke on a plain 403 Forbidden (no consent keywords)", async () => {
    mockFetch.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(graph403Plain());
    const res = await graphFetchForTenant("tenant-403-plain", "/users");
    expect(res.status).toBe(403);
    expect(mockCreateAuditLog).not.toHaveBeenCalled();
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("returns a successful Response on 200 without revoking", async () => {
    mockFetch.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(graph200());
    const res = await graphFetchForTenant("tenant-200", "/users");
    expect(res.ok).toBe(true);
    expect(mockCreateAuditLog).not.toHaveBeenCalled();
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });
});

// ── The root-cause fix: non-consent 401 must NEVER tenant-wide revoke ─────────
// The ~5-min-after-grant auto-revoke: a check in the package run hit a 401 whose
// body was NOT a consent signature (stale token / wrong-audience token / missing
// scope on Intune-Reports-class endpoints) and the old unconditional-401 branch
// flipped the whole tenant to revoked. Now: evict token cache, retry once with a
// fresh token; a persisting 401 is a per-call error, not a revocation.

describe("graphFetchForTenant — non-consent 401 does NOT revoke (fresh-token retry)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    const txUpdateWhere = vi.fn().mockResolvedValue([]);
    const txUpdateSet = vi.fn().mockReturnValue({ where: txUpdateWhere });
    mockDb.tx.update.mockReturnValue({ set: txUpdateSet });
    mockDb.transaction.mockImplementation(async (cb: (tx: { update: Mock }) => Promise<void>) => {
      await cb(mockDb.tx);
    });
    mockCreateAuditLog.mockResolvedValue(undefined);
  });

  it("retries once with a fresh token and succeeds — no revoke, returns the retried response", async () => {
    mockFetch
      .mockResolvedValueOnce(tokenOk())              // initial token
      .mockResolvedValueOnce(graph401StaleToken())   // graph call: stale-token 401
      .mockResolvedValueOnce(tokenOk())              // fresh token (cache was evicted)
      .mockResolvedValueOnce(graph200());            // retried graph call succeeds
    const res = await graphFetchForTenant("tenant-retry-ok", "/users");
    expect(res.ok).toBe(true);
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(mockCreateAuditLog).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("401 persisting with a fresh token → plain 401 Response, NO consent flip", async () => {
    mockFetch
      .mockResolvedValueOnce(tokenOk())              // initial token
      .mockResolvedValueOnce(graph401StaleToken())   // graph call: non-consent 401
      .mockResolvedValueOnce(tokenOk())              // fresh token
      .mockResolvedValueOnce(graph401StaleToken());  // retry still 401
    const res = await graphFetchForTenant("tenant-retry-401", "/deviceManagement/managedDevices");
    expect(res.status).toBe(401);
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(mockCreateAuditLog).not.toHaveBeenCalled();
  });

  it("genuinely revoked consent is still caught: fresh-token request fails at the token endpoint with AADSTS65001", async () => {
    mockFetch
      .mockResolvedValueOnce(tokenOk())              // initial token
      .mockResolvedValueOnce(graph401StaleToken())   // graph call: bare 401 (revoked mid-flight, cached token now dead)
      .mockResolvedValueOnce({                       // fresh token request → the authoritative consent failure
        ok: false,
        status: 400,
        text: async () => '{"error":"invalid_grant","error_description":"AADSTS65001: consent revoked"}',
      });
    await expect(graphFetchForTenant("tenant-retry-revoked", "/users")).rejects.toThrow(ConsentRevokedError);
  });

  it("token endpoint 401 invalid_client (bad MT app secret) is a plain Error, never ConsentRevokedError", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => '{"error":"invalid_client","error_description":"AADSTS7000215: Invalid client secret provided."}',
    });
    let err: unknown;
    try { await graphFetchForTenant("tenant-bad-secret", "/users"); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ConsentRevokedError);
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });
});

// ── License-gap classification — the fix ──────────────────────────────────────
// A tenant that lacks a required M365 SKU (Entra Premium, Defender) returns a
// 403/401 that is NOT a consent problem. It must throw LicenseGapError and must
// NEVER flip tenant consent (no transaction, no audit log). This is the core
// correctness fix: previously a 401 "Account is not provisioned" auto-revoked the
// whole tenant, and a 403 premium error surfaced as a generic technical error.

const graph403Premium = () => ({
  ok: false,
  status: 403,
  headers: new Headers(),
  text: async () =>
    '{"error":{"code":"Authentication_RequestFromNonPremiumTenantOrB2CTenant","message":"Tenant is not a B2C tenant and doesn\'t have premium license"}}',
});

const graph401NotProvisioned = () => ({
  ok: false,
  status: 401,
  headers: new Headers(),
  text: async () => '{"error":{"code":"Unauthorized","message":"Account is not provisioned."}}',
});

describe("graphFetchForTenant — license/feature gap (no consent flip)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Fully reset the fetch stub's queue+implementation. clearAllMocks only clears
    // usage data, not the mockResolvedValueOnce queue, so a prior describe's
    // token-cache-hit test can leave a stale queued response that would otherwise
    // desync our fresh-token calls here.
    mockFetch.mockReset();
    const txUpdateWhere = vi.fn().mockResolvedValue([]);
    const txUpdateSet = vi.fn().mockReturnValue({ where: txUpdateWhere });
    mockDb.tx.update.mockReturnValue({ set: txUpdateSet });
    mockDb.transaction.mockImplementation(async (cb: (tx: { update: Mock }) => Promise<void>) => {
      await cb(mockDb.tx);
    });
    mockCreateAuditLog.mockResolvedValue(undefined);
  });

  it("throws LicenseGapError (not ConsentRevokedError) on an Entra Premium 403", async () => {
    mockFetch.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(graph403Premium());
    let err: unknown;
    try { await graphFetchForTenant("tenant-premium", "/identityProtection/riskyUsers"); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(LicenseGapError);
    expect(err).not.toBeInstanceOf(ConsentRevokedError);
    expect((err as LicenseGapError).feature).toContain("Entra ID Premium");
    // Critically: NO consent revocation side effects.
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(mockCreateAuditLog).not.toHaveBeenCalled();
  });

  it("throws LicenseGapError on a 401 'Account is not provisioned' — does NOT auto-revoke consent", async () => {
    mockFetch.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(graph401NotProvisioned());
    let err: unknown;
    try { await graphFetchForTenant("tenant-notprov", "/security/secureScores"); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(LicenseGapError);
    expect(err).not.toBeInstanceOf(ConsentRevokedError);
    // The whole point of the fix: a provisioning gap must not nuke tenant consent.
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(mockCreateAuditLog).not.toHaveBeenCalled();
  });
});

describe("classifyGraphError", () => {
  it("classifies the Entra Premium error code as a license gap", () => {
    const r = classifyGraphError('{"error":{"code":"Authentication_RequestFromNonPremiumTenantOrB2CTenant"}}', 403);
    expect(r.kind).toBe("license_gap");
    expect(r.feature).toContain("Entra ID Premium");
  });

  it("classifies 'not provisioned' as a license gap (Defender)", () => {
    const r = classifyGraphError('{"error":{"code":"Unauthorized","message":"Account is not provisioned."}}', 401);
    expect(r.kind).toBe("license_gap");
    expect(r.feature).toContain("Defender");
  });

  it("classifies a genuine consent body as consent, never a license gap", () => {
    expect(classifyGraphError('{"error":{"code":"invalid_grant"}}', 400).kind).toBe("consent");
    expect(classifyGraphError("AADSTS65001", 403).kind).toBe("consent");
  });

  it("leaves a plain permission error as 'other' (not a license gap)", () => {
    const r = classifyGraphError('{"error":{"code":"Authorization_RequestDenied","message":"Insufficient privileges."}}', 403);
    expect(r.kind).toBe("other");
  });
});

// ── markTenantConsentRevoked standalone tests ─────────────────────────────────

describe("markTenantConsentRevoked", () => {
  let txUpdateWhere: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    txUpdateWhere = vi.fn().mockResolvedValue([]);
    const txUpdateSet = vi.fn().mockReturnValue({ where: txUpdateWhere });
    mockDb.tx.update.mockReturnValue({ set: txUpdateSet });
    mockDb.transaction.mockImplementation(async (cb: (tx: { update: Mock }) => Promise<void>) => {
      await cb(mockDb.tx);
    });
    mockCreateAuditLog.mockResolvedValue(undefined);
  });

  it("runs both updates inside a single db.transaction call", async () => {
    await markTenantConsentRevoked("tenant-direct");
    expect(mockDb.transaction).toHaveBeenCalledOnce();
    expect(mockDb.tx.update).toHaveBeenCalledTimes(2);
  });

  it("updates tenantConsentTable with consentStatus=revoked inside transaction", async () => {
    await markTenantConsentRevoked("tenant-direct");
    const setCalls = getTxSetCalls();
    expect(setCalls.some((c) => c?.consentStatus === "revoked")).toBe(true);
  });

  it("updates tenantMonitorProfilesTable with status=consent_revoked inside transaction", async () => {
    await markTenantConsentRevoked("tenant-direct");
    const setCalls = getTxSetCalls();
    expect(setCalls.some((c) => c?.status === "consent_revoked")).toBe(true);
  });

  it("excludes already-classified license_gap rows from the monitor-profile bulk update", async () => {
    await markTenantConsentRevoked("tenant-direct");
    // tenantConsentTable is updated first, tenantMonitorProfilesTable second — same order as the source.
    const monitorWhereCall = txUpdateWhere.mock.calls[1]?.[0] as { op: string; args: Array<{ op: string; b: unknown }> };
    expect(monitorWhereCall.op).toBe("and");
    expect(monitorWhereCall.args.some((c) => c.op === "ne" && c.b === "license_gap")).toBe(true);
  });

  it("excludes already-classified error rows from the monitor-profile bulk update", async () => {
    // Same-bug-class follow-up: a genuine, unrelated `error` classification on one
    // check (e.g. a malformed request URL) must not be stomped by a consent revoke
    // thrown by a different check in the same run.
    await markTenantConsentRevoked("tenant-direct");
    const monitorWhereCall = txUpdateWhere.mock.calls[1]?.[0] as { op: string; args: Array<{ op: string; b: unknown }> };
    expect(monitorWhereCall.op).toBe("and");
    expect(monitorWhereCall.args.some((c) => c.op === "ne" && c.b === "error")).toBe(true);
  });

  it("excludes already-classified requires_script rows from the monitor-profile bulk update", async () => {
    // requires_script is also a confirmed, independent fact (the check only runs via
    // customer script) decided before any Graph call — not an uncertain state.
    await markTenantConsentRevoked("tenant-direct");
    const monitorWhereCall = txUpdateWhere.mock.calls[1]?.[0] as { op: string; args: Array<{ op: string; b: unknown }> };
    expect(monitorWhereCall.op).toBe("and");
    expect(monitorWhereCall.args.some((c) => c.op === "ne" && c.b === "requires_script")).toBe(true);
  });

  it("emits audit log with system actor and autoRevoked=true", async () => {
    await markTenantConsentRevoked("tenant-direct");
    expect(mockCreateAuditLog).toHaveBeenCalledOnce();
    const call = mockCreateAuditLog.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.actorName).toBe("system:graph-auto-revoke");
    expect(call.entityId).toBe("tenant-direct");
    expect((call.metadata as Record<string, unknown>)?.autoRevoked).toBe(true);
    expect(call.actionType).toBe("tenant_consent_revoked");
  });

  it("does not throw when db.transaction rejects — logs error instead", async () => {
    mockDb.transaction.mockRejectedValue(new Error("DB connection lost"));
    await expect(markTenantConsentRevoked("tenant-fail")).resolves.toBeUndefined();
  });
});

// ── Route-level: ConsentRevokedError → 403 top-level handler ──────────────────
//
// Creates a minimal Express app that:
//   - Has one route that throws ConsentRevokedError (simulating a Graph-backed endpoint)
//   - Uses the same top-level error handler wired in the real app.ts
//
// Asserts that the client receives 403 + { code: "consent_revoked" } and
// reAuthorizeRequired: true — confirming the portal can surface the re-authorize prompt
// without any operator action.

describe("Top-level Express handler — ConsentRevokedError → 403", () => {
  beforeEach(() => {
    // This test drives a real supertest HTTP round-trip — restore the real
    // global fetch so the stubbed (and by now empty-queued) mockFetch can't
    // hang superagent's fetch-based transport.
    vi.unstubAllGlobals();
  });

  it("returns 403 with { code: consent_revoked, reAuthorizeRequired: true } when ConsentRevokedError reaches the handler", async () => {
    const { default: express } = await import("express");
    const { default: request } = await import("supertest");

    const app = express();
    app.get("/test-consent-route", (_req, _res, next) => {
      next(new ConsentRevokedError("tenant-test-handler"));
    });

    // Same error handler as in the real app.ts
    app.use((err: unknown, _req: unknown, res: unknown, _next: unknown) => {
      if (err instanceof ConsentRevokedError) {
        (res as { status: (c: number) => { json: (b: unknown) => void } })
          .status(403)
          .json({ code: "consent_revoked", tenantId: err.tenantId, reAuthorizeRequired: true });
        return;
      }
      (res as { status: (c: number) => { json: (b: unknown) => void } })
        .status(500)
        .json({ error: "Internal server error" });
    });

    const response = await request(app).get("/test-consent-route");
    expect(response.status).toBe(403);
    expect(response.body.code).toBe("consent_revoked");
    expect(response.body.tenantId).toBe("tenant-test-handler");
    expect(response.body.reAuthorizeRequired).toBe(true);
  });
});
