// Covers CRM decommission Phase 2 (#154): msp-settings.ts's password-reset
// link and mailbox OAuth-callback redirects must resolve against the
// msp-portal artifact (getMspPortalBaseUrl(), /portal) rather than the
// deprecated CRM artifact (getPortalBaseUrl(), /crm) — and the callback's
// own hardcoded `/portal` literal, which used to double up on top of
// getMspPortalBaseUrl()'s own /portal suffix, must be gone.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

let mockSelectResultsQueue: any[][] = [];
let mockDefaultSelectResult: any[] = [];
const insertCalls: { table: unknown; values: unknown }[] = [];

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

  const makeInsertChain = (table: unknown) => {
    const chain: any = {
      values: (v: unknown) => {
        insertCalls.push({ table, values: v });
        return chain;
      },
      onConflictDoUpdate: () => chain,
      returning: () => Promise.resolve([]),
      then: (onfulfilled: any) => Promise.resolve({}).then(onfulfilled),
    };
    return chain;
  };

  const updateChain: any = {
    set: () => updateChain,
    where: () => updateChain,
    then: (onfulfilled: any) => Promise.resolve({}).then(onfulfilled),
  };

  const deleteChain: any = {
    where: () => Promise.resolve({}),
  };

  const mockDb = {
    select: vi.fn().mockImplementation(() => makeSelectChain()),
    insert: vi.fn().mockImplementation((table: unknown) => makeInsertChain(table)),
    update: vi.fn().mockImplementation(() => updateChain),
    delete: vi.fn().mockImplementation(() => deleteChain),
  };

  const table = (name: string) => ({ __table: name });

  return {
    db: mockDb,
    mspsTable: table("msps"),
    tenantsTable: { __table: "tenants", id: "id", mspId: "msp_id", tenantId: "tenant_id" },
    mspStaffCustomerScopesTable: table("mspStaffCustomerScopes"),
    mspServiceAccountsTable: table("mspServiceAccounts"),
    mspConnectorConfigsTable: table("mspConnectorConfigs"),
    mspSubscriptionsTable: table("mspSubscriptions"),
    mspEmailTemplatesTable: table("mspEmailTemplates"),
    mspRefreshTokensTable: table("mspRefreshTokens"),
    mspAuditLogsTable: table("mspAuditLogs"),
    mspMailboxConnectorsTable: { mspId: "msp_id" },
    mspMailboxConsentStatesTable: { state: "state", usedAt: "used_at", expiresAt: "expires_at" },
    mspInvitesTable: table("mspInvites"),
    usersTable: { id: "id", email: "email", name: "name", mspId: "msp_id" },
    passwordResetTokensTable: table("passwordResetTokens"),
    mfaEnrollmentsTable: table("mfaEnrollments"),
    mfaChallengesTable: table("mfaChallenges"),
    webauthnCredentialsTable: table("webauthnCredentials"),
    webauthnChallengesTable: table("webauthnChallenges"),
    MSP_LOCKED_EMAIL_KEYS: [],
    MSP_EMAIL_TEMPLATE_KEYS: [],
  };
});

vi.mock("../lib/portal-url.ts", () => ({
  // Deliberately distinct from the deprecated getPortalBaseUrl()'s /crm
  // suffix, and already ends in /portal — a caller that re-appended a
  // literal "/portal" would produce a double path this test can catch.
  getMspPortalBaseUrl: vi.fn().mockReturnValue("https://msp-portal.test/portal"),
}));

vi.mock("../lib/mailer.ts", () => ({
  sendEmailForMsp: vi.fn().mockResolvedValue(undefined),
  emailButton: vi.fn().mockReturnValue(""),
  brandedEmail: vi.fn().mockReturnValue(""),
  sendEmailFromTemplate: vi.fn().mockResolvedValue(undefined),
  passwordResetEmail: vi.fn().mockReturnValue(""),
}));

vi.mock("../lib/azure-keyvault.ts", () => ({
  setSecretValue: vi.fn(),
  getSecretMetadata: vi.fn(),
}));

vi.mock("../lib/stripe.ts", () => ({
  getStripeKey: vi.fn().mockReturnValue(null),
}));

const buildAdminConsentUrlMock = vi.fn().mockReturnValue("https://login.microsoftonline.com/common/adminconsent?test=1");
vi.mock("../lib/graph.ts", () => ({
  buildAdminConsentUrl: (...args: unknown[]) => buildAdminConsentUrlMock(...args),
}));

// #4241: the connector consents and verifies against the dedicated mailbox-send app.
vi.mock("../lib/mailbox-send-app.ts", () => ({
  mailboxSendAppCredentialsPresent: vi.fn().mockReturnValue(true),
  mailboxSendAppClientId: vi.fn().mockReturnValue("mailbox-send-app-client-id"),
  MAILBOX_SEND_APP_NOT_CONFIGURED: "Mailbox send app not configured",
}));

// #4197: the mailbox callback confirms the tenant's consent with Microsoft
// before activating the connector — "confirmed" here, refused in its own case.
const verifyConsentMock = vi.fn().mockResolvedValue({ ok: true, roles: ["Mail.Send"] });
// #4227: the connect route resolves the mailbox domain's tenant from Microsoft.
const resolveDomainMock = vi.fn();
vi.mock("../lib/consent-verification.ts", () => ({
  verifyTenantConsentWithMicrosoft: (...args: unknown[]) => verifyConsentMock(...args),
  resolveEntraTenantForDomain: (...args: unknown[]) => resolveDomainMock(...args),
}));

const MSP_TENANT = "c4c814d4-3afe-441e-9145-62461d0a4fd3";
const OTHER_TENANT = "0a361ab2-9e85-4bbf-8b75-c1ebf042dfba";

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

import router, { bindMailboxCallbackTenant, checkMspOwnTenant } from "./msp-settings.ts";
import { getMspPortalBaseUrl } from "../lib/portal-url.ts";
import { sendEmailFromTemplate } from "../lib/mailer.ts";
import { LEGACY_ROLE } from "@workspace/db/rbac/legacy-ladder";

const sendEmailFromTemplateMock = vi.mocked(sendEmailFromTemplate);

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as any).log = { child: () => (req as any).log, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  next();
});
app.use("/api", router);

const JWT_SECRET = "test-secret";
process.env.JWT_SECRET = JWT_SECRET;

function makeMspAdminToken(mspId: number): string {
  return jwt.sign(
    { id: 1, email: "admin@msp.test", role: "client", mspRole: LEGACY_ROLE.mspAdmin, mspId },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

describe("msp-settings.ts portal links (#154)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectResultsQueue = [];
    mockDefaultSelectResult = [];
    insertCalls.length = 0;
    verifyConsentMock.mockResolvedValue({ ok: true, roles: ["Mail.Send"] });
    resolveDomainMock.mockResolvedValue({ ok: true, tenantId: MSP_TENANT });
  });

  it("POST /msp/settings/users/:userId/reset-password builds the reset link off getMspPortalBaseUrl(), not the /crm base", async () => {
    const mspId = 7;
    const userId = 42;
    mockSelectResultsQueue = [
      [{ id: userId, email: "user@example.com", name: "Test User" }], // ownership lookup
    ];

    const res = await request(app)
      .post(`/api/msp/settings/users/${userId}/reset-password`)
      .set("Authorization", `Bearer ${makeMspAdminToken(mspId)}`);

    expect(res.status).toBe(200);
    expect(getMspPortalBaseUrl).toHaveBeenCalled();
    expect(sendEmailFromTemplateMock).toHaveBeenCalledTimes(1);
    const [, , mergeFields] = sendEmailFromTemplateMock.mock.calls[0];
    expect(mergeFields.resetLink.startsWith("https://msp-portal.test/portal/reset-password?token=")).toBe(true);
    // No double /portal/portal segment.
    expect(mergeFields.resetLink).not.toContain("/portal/portal");
  });

  it("GET .../connector/mailbox/callback (declined) redirects to a single, non-doubled /portal path", async () => {
    const res = await request(app)
      .get("/api/msp/settings/connector/mailbox/callback")
      .query({ error: "access_denied" });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://msp-portal.test/portal/settings/connector?mailbox_consent=declined");
    expect(res.headers.location).not.toContain("/portal/portal");
  });

  it("POST /msp/settings/users/:userId/reset-mfa (#172) builds every link off getMspPortalBaseUrl(), never the retired /crm path", async () => {
    const mspId = 7;
    const userId = 42;
    mockSelectResultsQueue = [
      [{ id: userId, email: "user@example.com", name: "Test User" }], // ownership lookup
      [{ method: "totp" }], // mfa enrollments
      [], // passkey rows
    ];

    const res = await request(app)
      .post(`/api/msp/settings/users/${userId}/reset-mfa`)
      .set("Authorization", `Bearer ${makeMspAdminToken(mspId)}`);

    expect(res.status).toBe(200);
    expect(sendEmailFromTemplateMock).toHaveBeenCalledTimes(1);
    const [, , mergeFields, , bodyHtml] = sendEmailFromTemplateMock.mock.calls[0];
    expect(mergeFields.loginLink).not.toContain("/crm");
    expect(mergeFields.securityLink).not.toContain("/crm");
    expect(bodyHtml).not.toContain("/crm");
  });

  it("GET .../connector/mailbox/callback (success) redirects to a single, non-doubled /portal path", async () => {
    const state = "abc123";
    mockSelectResultsQueue = [
      [{
        state,
        mspId: 7,
        mailboxUpn: "mailbox@example.com",
        fromDisplayName: "Support",
        expectedTenantId: MSP_TENANT,
        requestedByUserId: 1,
        returnPath: "/settings/connector",
      }],
      [], // no other MSP's customer carries this tenant
    ];

    const res = await request(app)
      .get("/api/msp/settings/connector/mailbox/callback")
      .query({ tenant: MSP_TENANT.toUpperCase(), admin_consent: "true", state });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://msp-portal.test/portal/settings/connector?mailbox_consent=success");
    expect(res.headers.location).not.toContain("/portal/portal");
  });

  it("GET .../connector/mailbox/callback REFUSES a tenant Microsoft does not confirm, without burning state or activating (#4197)", async () => {
    verifyConsentMock.mockResolvedValueOnce({ ok: false, reason: "tenant_not_found", detail: "400 AADSTS90002" });
    const state = "abc123";
    mockSelectResultsQueue = [
      [{ state, mspId: 7, mailboxUpn: "mailbox@example.com", fromDisplayName: "Support", expectedTenantId: MSP_TENANT, requestedByUserId: 1, returnPath: "/settings/connector" }],
      [],
    ];

    const res = await request(app)
      .get("/api/msp/settings/connector/mailbox/callback")
      .query({ tenant: MSP_TENANT, admin_consent: "true", state });

    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });

  const stateRow = (overrides: Record<string, unknown> = {}) => ({
    state: "abc123", mspId: 7, mailboxUpn: "mailbox@example.com", fromDisplayName: "Support",
    expectedTenantId: MSP_TENANT, requestedByUserId: 1, returnPath: "/settings/connector", ...overrides,
  });

  it("GET .../connector/mailbox/callback REFUSES a real consented tenant other than the mailbox's own, before asking Microsoft (#4227)", async () => {
    mockSelectResultsQueue = [[stateRow()]];

    const res = await request(app)
      .get("/api/msp/settings/connector/mailbox/callback")
      .query({ tenant: OTHER_TENANT, admin_consent: "true", state: "abc123" });

    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
    expect(verifyConsentMock).not.toHaveBeenCalled();
    expect(insertCalls).toHaveLength(0);
  });

  it("GET .../connector/mailbox/callback REFUSES a state minted with no tenant binding (#4227)", async () => {
    mockSelectResultsQueue = [[stateRow({ expectedTenantId: null })]];

    const res = await request(app)
      .get("/api/msp/settings/connector/mailbox/callback")
      .query({ tenant: MSP_TENANT, admin_consent: "true", state: "abc123" });

    expect(res.status).toBe(400);
    expect(verifyConsentMock).not.toHaveBeenCalled();
    expect(insertCalls).toHaveLength(0);
  });

  it("GET .../connector/mailbox/callback REFUSES the mailbox's tenant when it is another MSP's customer (#4227)", async () => {
    mockSelectResultsQueue = [[stateRow()], [{ id: 99, mspId: 8 }]];

    const res = await request(app)
      .get("/api/msp/settings/connector/mailbox/callback")
      .query({ tenant: MSP_TENANT, admin_consent: "true", state: "abc123" });

    expect(res.status).toBe(409);
    expect(verifyConsentMock).not.toHaveBeenCalled();
    expect(insertCalls).toHaveLength(0);
  });

  it("GET .../connector/mailbox/callback requires Mail.Send and activates against the bound tenant, not the query string (#4227)", async () => {
    mockSelectResultsQueue = [[stateRow()], []];

    await request(app)
      .get("/api/msp/settings/connector/mailbox/callback")
      .query({ tenant: MSP_TENANT.toUpperCase(), admin_consent: "true", state: "abc123" });

    expect(verifyConsentMock).toHaveBeenCalledWith(
      MSP_TENANT,
      expect.objectContaining({ app: "mailbox", resource: "graph", requireAnyRole: ["Mail.Send"] }),
    );
    expect(insertCalls).toHaveLength(1);
    expect((insertCalls[0].values as any).tenantId).toBe(MSP_TENANT);
  });

  it("GET .../connector/mailbox/callback REFUSES a consent that lacks Mail.Send (#4227)", async () => {
    verifyConsentMock.mockResolvedValueOnce({ ok: false, reason: "no_permissions", detail: "none of the required permissions (Mail.Send) granted on graph" });
    mockSelectResultsQueue = [[stateRow()], []];

    const res = await request(app)
      .get("/api/msp/settings/connector/mailbox/callback")
      .query({ tenant: MSP_TENANT, admin_consent: "true", state: "abc123" });

    expect(res.status).toBe(400);
    expect(res.text).toContain("permission to send mail");
    expect(insertCalls).toHaveLength(0);
  });

  it("POST .../connector/mailbox/connect records the mailbox domain's tenant on the state and hints consent at it (#4227)", async () => {
    mockSelectResultsQueue = [[]]; // no other MSP's customer carries this tenant

    const res = await request(app)
      .post("/api/msp/settings/connector/mailbox/connect")
      .set("Authorization", `Bearer ${makeMspAdminToken(7)}`)
      .send({ mailboxUpn: "support@mccawsoft2.onmicrosoft.com", fromDisplayName: "Support" });

    expect(res.status).toBe(200);
    expect(resolveDomainMock).toHaveBeenCalledWith("mccawsoft2.onmicrosoft.com");
    const stateInsert = insertCalls.find((c) => (c.values as any)?.state);
    expect((stateInsert!.values as any).expectedTenantId).toBe(MSP_TENANT);
    // #4241: the consent URL names the dedicated mailbox-send app, never MT_APP_CLIENT_ID.
    expect(buildAdminConsentUrlMock).toHaveBeenLastCalledWith(MSP_TENANT, expect.any(String), expect.any(String), "mailbox-send-app-client-id");
  });

  it("POST .../connector/mailbox/connect refuses a non-Microsoft domain and another MSP's customer tenant (#4227)", async () => {
    resolveDomainMock.mockResolvedValueOnce({ ok: false, reason: "not_entra_domain", detail: "400 AADSTS90002" });
    const notEntra = await request(app)
      .post("/api/msp/settings/connector/mailbox/connect")
      .set("Authorization", `Bearer ${makeMspAdminToken(7)}`)
      .send({ mailboxUpn: "support@example.com", fromDisplayName: "Support" });
    expect(notEntra.status).toBe(400);

    mockSelectResultsQueue = [[{ id: 99, mspId: 8 }]];
    const foreign = await request(app)
      .post("/api/msp/settings/connector/mailbox/connect")
      .set("Authorization", `Bearer ${makeMspAdminToken(7)}`)
      .send({ mailboxUpn: "support@mccawsoft2.onmicrosoft.com", fromDisplayName: "Support" });
    expect(foreign.status).toBe(409);
    expect(insertCalls.filter((c) => (c.values as any)?.state)).toHaveLength(0);
  });

  it("POST .../connector/mailbox/connect REFUSES a mailbox outside the MSP's recorded own tenant, e.g. its own customer's (#4242)", async () => {
    // mailbox domain resolves to MSP_TENANT (a same-MSP customer here); the MSP's own tenant is OTHER_TENANT
    mockSelectResultsQueue = [[], [{ entraTenantId: OTHER_TENANT }]];

    const res = await request(app)
      .post("/api/msp/settings/connector/mailbox/connect")
      .set("Authorization", `Bearer ${makeMspAdminToken(7)}`)
      .send({ mailboxUpn: "support@mccawsoft2.onmicrosoft.com", fromDisplayName: "Support" });

    expect(res.status).toBe(403);
    expect(insertCalls.filter((c) => (c.values as any)?.state)).toHaveLength(0);
  });

  it("POST .../connector/mailbox/connect allows a mailbox in the MSP's recorded own tenant (#4242)", async () => {
    mockSelectResultsQueue = [[], [{ entraTenantId: MSP_TENANT.toUpperCase() }]];

    const res = await request(app)
      .post("/api/msp/settings/connector/mailbox/connect")
      .set("Authorization", `Bearer ${makeMspAdminToken(7)}`)
      .send({ mailboxUpn: "support@mccawsoft2.onmicrosoft.com", fromDisplayName: "Support" });

    expect(res.status).toBe(200);
    expect(insertCalls.filter((c) => (c.values as any)?.state)).toHaveLength(1);
  });

  it("GET .../connector/mailbox/callback REFUSES a bound tenant that is not the MSP's own, before asking Microsoft (#4242)", async () => {
    // state bound to MSP_TENANT at mint; a platform admin has since recorded OTHER_TENANT as the MSP's own
    mockSelectResultsQueue = [[stateRow()], [], [{ entraTenantId: OTHER_TENANT }]];

    const res = await request(app)
      .get("/api/msp/settings/connector/mailbox/callback")
      .query({ tenant: MSP_TENANT, admin_consent: "true", state: "abc123" });

    expect(res.status).toBe(403);
    expect(res.headers.location).toBeUndefined();
    expect(verifyConsentMock).not.toHaveBeenCalled();
    expect(insertCalls).toHaveLength(0);
  });

  it("GET .../connector/mailbox/callback activates when the bound tenant is the MSP's own (#4242)", async () => {
    mockSelectResultsQueue = [[stateRow()], [], [{ entraTenantId: MSP_TENANT }]];

    const res = await request(app)
      .get("/api/msp/settings/connector/mailbox/callback")
      .query({ tenant: MSP_TENANT, admin_consent: "true", state: "abc123" });

    expect(res.status).toBe(302);
    expect(insertCalls).toHaveLength(1);
    expect((insertCalls[0].values as any).tenantId).toBe(MSP_TENANT);
  });

  it("checkMspOwnTenant enforces only once the MSP's own tenant is recorded (#4242)", () => {
    expect(checkMspOwnTenant(null, MSP_TENANT)).toEqual({ ok: true, enforced: false });
    expect(checkMspOwnTenant("  ", MSP_TENANT)).toEqual({ ok: true, enforced: false });
    expect(checkMspOwnTenant(MSP_TENANT.toUpperCase(), MSP_TENANT)).toEqual({ ok: true, enforced: true });
    expect(checkMspOwnTenant(OTHER_TENANT, MSP_TENANT)).toEqual({ ok: false, reason: "not_msp_own_tenant" });
  });

  it("bindMailboxCallbackTenant compares case-insensitively and fails closed (#4227)", () => {
    expect(bindMailboxCallbackTenant(MSP_TENANT, MSP_TENANT.toUpperCase())).toEqual({ ok: true, tenantId: MSP_TENANT });
    expect(bindMailboxCallbackTenant(MSP_TENANT, OTHER_TENANT)).toEqual({ ok: false, reason: "tenant_mismatch" });
    expect(bindMailboxCallbackTenant(MSP_TENANT, undefined)).toEqual({ ok: false, reason: "tenant_mismatch" });
    expect(bindMailboxCallbackTenant(null, MSP_TENANT)).toEqual({ ok: false, reason: "unbound_state" });
  });
});
