/**
 * consent-verification (Git #4197) — the pre-grant Microsoft check the consent
 * callbacks run before recording anything. fetch is stubbed with the real
 * response shapes captured live from login.microsoftonline.com on 2026-09-15
 * (AADSTS90002 for a random GUID; a token with tid + roles for the testbed).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./logger.ts", () => {
  const logger: Record<string, unknown> = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  logger.child = vi.fn(() => logger);
  return { logger };
});

import { verifyTenantConsentWithMicrosoft, classifyTokenError } from "./consent-verification.ts";

const TENANT = "c4c814d4-3afe-441e-9145-62461d0a4fd3";
const FABRICATED = "ef825402-eae9-4b6f-8bd8-8b7e674ecfdd";

function tokenFor(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
}
function okResponse(claims: Record<string, unknown>) {
  return new Response(JSON.stringify({ access_token: tokenFor(claims), expires_in: 3599 }), { status: 200 });
}
function errorResponse(status: number, error: string, description: string) {
  return new Response(JSON.stringify({ error, error_description: description }), { status });
}

const fetchMock = vi.fn();

beforeEach(() => {
  process.env.MT_APP_CLIENT_ID = "read-app";
  process.env.MT_APP_CLIENT_SECRET = "read-secret";
  process.env.MT_APP_WRITE_CLIENT_ID = "write-app";
  process.env.MT_APP_WRITE_CLIENT_SECRET = "write-secret";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("verifyTenantConsentWithMicrosoft", () => {
  it("confirms a real, consented tenant and returns the granted roles", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ tid: TENANT, roles: ["Directory.Read.All", "Policy.Read.All"] }));
    const r = await verifyTenantConsentWithMicrosoft(TENANT, { app: "read", resource: "graph", retryDelaysMs: [] });
    expect(r).toEqual({ ok: true, roles: ["Directory.Read.All", "Policy.Read.All"] });

    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toBe(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`);
    const body = new URLSearchParams(init.body);
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("client_id")).toBe("read-app");
    expect(body.get("scope")).toBe("https://graph.microsoft.com/.default");
  });

  it("uses the write app registration for app=write and the SharePoint resource for resource=sharepoint", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ tid: TENANT, roles: ["User.ReadWrite.All"] }));
    await verifyTenantConsentWithMicrosoft(TENANT, { app: "write", resource: "graph", retryDelaysMs: [] });
    expect(new URLSearchParams((fetchMock.mock.calls[0][1] as { body: string }).body).get("client_id")).toBe("write-app");

    fetchMock.mockResolvedValueOnce(okResponse({ tid: TENANT, roles: ["Sites.FullControl.All"] }));
    await verifyTenantConsentWithMicrosoft(TENANT, { app: "read", resource: "sharepoint", retryDelaysMs: [] });
    expect(new URLSearchParams((fetchMock.mock.calls[1][1] as { body: string }).body).get("scope"))
      .toBe("00000003-0000-0ff1-ce00-000000000000/.default");
  });

  it("refuses a tenant Microsoft says does not exist, without retrying", async () => {
    fetchMock.mockResolvedValue(errorResponse(400, "invalid_request", `AADSTS90002: Tenant '${FABRICATED}' not found.`));
    const r = await verifyTenantConsentWithMicrosoft(FABRICATED, { app: "read", resource: "graph", retryDelaysMs: [0, 0, 0] });
    expect(r).toMatchObject({ ok: false, reason: "tenant_not_found" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never calls Microsoft for a value that is not a GUID", async () => {
    const r = await verifyTenantConsentWithMicrosoft("../evil", { app: "read", resource: "graph" });
    expect(r).toMatchObject({ ok: false, reason: "invalid_tenant_id" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries a not-yet-replicated consent and succeeds once Microsoft catches up", async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(400, "invalid_client", "AADSTS7000229: The client application is missing service principal in the tenant"))
      .mockResolvedValueOnce(okResponse({ tid: TENANT, roles: ["Directory.Read.All"] }));
    // AADSTS7000229 must classify as not_consented even though the error field says invalid_client.
    const r = await verifyTenantConsentWithMicrosoft(TENANT, { app: "read", resource: "graph", retryDelaysMs: [0, 0] });
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses a never-consented tenant after exhausting retries", async () => {
    fetchMock.mockImplementation(async () => errorResponse(400, "invalid_client", "AADSTS7000229: missing service principal"));
    const r = await verifyTenantConsentWithMicrosoft(TENANT, { app: "read", resource: "graph", retryDelaysMs: [0, 0] });
    expect(r).toMatchObject({ ok: false, reason: "not_consented" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("refuses a token with no application permissions", async () => {
    fetchMock.mockImplementation(async () => okResponse({ tid: TENANT }));
    const r = await verifyTenantConsentWithMicrosoft(TENANT, { app: "read", resource: "graph", retryDelaysMs: [] });
    expect(r).toMatchObject({ ok: false, reason: "no_permissions" });
  });

  it("refuses when none of the required roles were granted", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ tid: TENANT, roles: ["Sites.Read.All"] }));
    const r = await verifyTenantConsentWithMicrosoft(TENANT, {
      app: "read", resource: "sharepoint", requireAnyRole: ["Sites.FullControl.All"], retryDelaysMs: [],
    });
    expect(r).toMatchObject({ ok: false, reason: "no_permissions" });
  });

  it("refuses a token issued for a different tenant", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ tid: FABRICATED, roles: ["Directory.Read.All"] }));
    const r = await verifyTenantConsentWithMicrosoft(TENANT, { app: "read", resource: "graph", retryDelaysMs: [] });
    expect(r).toMatchObject({ ok: false, reason: "tenant_mismatch" });
  });

  it("reports a platform credential fault or network failure as unverifiable, never as a tenant verdict", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(401, "invalid_client", "AADSTS7000215: Invalid client secret provided."));
    expect(await verifyTenantConsentWithMicrosoft(TENANT, { app: "read", resource: "graph", retryDelaysMs: [] }))
      .toMatchObject({ ok: false, reason: "unverifiable" });

    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    expect(await verifyTenantConsentWithMicrosoft(TENANT, { app: "read", resource: "graph", retryDelaysMs: [] }))
      .toMatchObject({ ok: false, reason: "unverifiable" });

    delete process.env.MT_APP_WRITE_CLIENT_SECRET;
    expect(await verifyTenantConsentWithMicrosoft(TENANT, { app: "write", resource: "graph", retryDelaysMs: [] }))
      .toMatchObject({ ok: false, reason: "unverifiable" });
  });
});

describe("classifyTokenError", () => {
  it("maps the documented AADSTS codes", () => {
    expect(classifyTokenError(400, "AADSTS90002: Tenant not found")).toBe("tenant_not_found");
    expect(classifyTokenError(400, "AADSTS900023: Specified tenant identifier is neither a valid DNS name")).toBe("tenant_not_found");
    expect(classifyTokenError(400, "invalid_grant AADSTS53003: Access has been blocked by Conditional Access")).toBe("blocked_by_tenant_policy");
    expect(classifyTokenError(400, "unauthorized_client AADSTS700016: Application not found in the directory")).toBe("not_consented");
    expect(classifyTokenError(400, "invalid_grant AADSTS65001: consent not granted")).toBe("not_consented");
    expect(classifyTokenError(401, "invalid_client AADSTS7000222: expired client secret")).toBe("unverifiable");
    expect(classifyTokenError(503, "service unavailable")).toBe("unverifiable");
  });
});
