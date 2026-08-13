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
    tenantsTable: table("tenants"),
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

vi.mock("../lib/graph.ts", () => ({
  buildAdminConsentUrl: vi.fn().mockReturnValue("https://login.microsoftonline.com/common/adminconsent?test=1"),
  mtAppCredentialsPresent: vi.fn().mockReturnValue(true),
}));

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

import router from "./msp-settings.ts";
import { getMspPortalBaseUrl } from "../lib/portal-url.ts";
import { sendEmailFromTemplate } from "../lib/mailer.ts";

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
    { id: 1, email: "admin@msp.test", role: "client", mspRole: "MSPAdmin", mspId },
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
        requestedByUserId: 1,
        returnPath: "/settings/connector",
      }],
    ];

    const res = await request(app)
      .get("/api/msp/settings/connector/mailbox/callback")
      .query({ tenant: "tenant-guid", admin_consent: "true", state });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://msp-portal.test/portal/settings/connector?mailbox_consent=success");
    expect(res.headers.location).not.toContain("/portal/portal");
  });
});
