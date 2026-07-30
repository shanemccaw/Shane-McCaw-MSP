import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

// Top level variables prefixed with 'mock' to bypass hoisting checks.
// mockSelectResults is consumed in FIFO order by successive db.select() chains,
// falling back to [] once exhausted.
let mockSelectResultsQueue: any[][] = [];
let mockDefaultSelectResult: any[] = [];

vi.mock("@workspace/db", () => {
  const makeSelectChain = () => {
    const chain: any = {
      from: () => chain,
      where: () => chain,
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

  const makeDeleteChain = () => {
    const chain: any = {
      where: () => chain,
      then: (onfulfilled: any) => Promise.resolve({}).then(onfulfilled),
    };
    return chain;
  };

  const updateChain: any = {
    set: () => updateChain,
    where: () => updateChain,
    then: (onfulfilled: any) => Promise.resolve({}).then(onfulfilled),
  };

  const insertChain: any = {
    values: () => insertChain,
    returning: () => Promise.resolve([]),
    then: (onfulfilled: any) => Promise.resolve({}).then(onfulfilled),
  };

  const mockDb = {
    select: vi.fn().mockImplementation(() => makeSelectChain()),
    delete: vi.fn().mockImplementation(() => makeDeleteChain()),
    update: vi.fn().mockImplementation(() => updateChain),
    insert: vi.fn().mockImplementation(() => insertChain),
  };

  const table = (name: string) => ({ __table: name });

  // Trimmed to exactly what portal-team.ts imports directly from @workspace/db,
  // plus a couple of tables that are ONLY needed so modules portal-team.ts pulls
  // in transitively (../middlewares/requireAuth.ts's tenantsTable/
  // mspStaffCustomerScopesTable, ../lib/session-tracking.ts's
  // mspRefreshTokensTable) resolve to a defined (if unused-by-this-test) value
  // rather than the full portal.ts table list this mock originally carried.
  return {
    db: mockDb,
    usersTable: { id: "id", email: "email", role: "role", name: "name", tenantId: "tenant_id", mspId: "msp_id", mspRole: "msp_role" },
    mfaEnrollmentsTable: table("mfaEnrollments"),
    webauthnCredentialsTable: table("webauthnCredentials"),
    userSessionsTable: table("userSessions"),
    passwordResetTokensTable: table("passwordResetTokens"),
    mfaChallengesTable: table("mfaChallenges"),
    webauthnChallengesTable: table("webauthnChallenges"),
    mfaBypassCodesTable: table("mfaBypassCodes"),
    tenantsTable: { id: "id", mspId: "msp_id" },
    mspStaffCustomerScopesTable: table("mspStaffCustomerScopes"),
    mspRefreshTokensTable: table("mspRefreshTokens"),
  };
});

vi.mock("../lib/audit.ts", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/session-tracking.ts", () => ({
  revokeAllOtherSessions: vi.fn().mockResolvedValue(0),
}));

vi.mock("../lib/portal-url.ts", () => ({
  getPortalBaseUrl: vi.fn().mockReturnValue("https://portal.test"),
  getMspPortalBaseUrl: vi.fn().mockReturnValue("https://portal.test/portal"),
  buildAccountSetupUrl: vi.fn().mockReturnValue("https://portal.test/setup"),
}));

vi.mock("../lib/mailer.ts", () => ({
  sendEmailFromTemplate: vi.fn().mockResolvedValue(undefined),
  passwordResetEmail: vi.fn(),
}));

vi.mock("../lib/client-setup-token.ts", () => ({
  ensureClientSetupToken: vi.fn().mockResolvedValue({ token: "setup-token", isNew: true }),
}));

// portal-team.ts does `const log = logger.child(...)` at module scope.
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

import router from "./portal-team.ts";
import { sendEmailFromTemplate } from "../lib/mailer.ts";

const sendEmailFromTemplateMock = vi.mocked(sendEmailFromTemplate);

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  // Minimal req.log stub — real requests get this from pino-http; requireAuth
  // calls req.log.child(...) when present.
  (req as any).log = { child: () => (req as any).log, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  next();
});
// portal-team.ts's own routes already carry the literal "/portal/team/..."
// prefix, so mounting at "/api" (the standard house-style mount, NOT the
// doubled "/api/portal" the old portal.ts test file used) hits the real
// "/api/portal/team/:userId/reset-mfa" path.
app.use("/api", router);

const JWT_SECRET = "test-secret";
process.env.JWT_SECRET = JWT_SECRET;

function makeAdminToken(): string {
  return jwt.sign({ id: 99, email: "admin@shanemccaw.com", role: "admin" }, JWT_SECRET, { expiresIn: "1h" });
}

// #172: mailer.ts's PORTAL_URL hardcoded /crm/portal hybrid was removed;
// portal-team.ts's own MFA-reset link builder must resolve exclusively off
// getMspPortalBaseUrl(), never a leftover /crm path.
describe("POST /api/portal/team/:userId/reset-mfa (#172)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectResultsQueue = [];
    mockDefaultSelectResult = [];
  });

  it("builds every generated link off getMspPortalBaseUrl(), never the retired /crm path", async () => {
    const targetUserId = 55;
    const token = makeAdminToken();

    mockSelectResultsQueue = [
      [{ customerId: 1, email: "teammate@example.com", name: "Teammate" }], // target lookup
      [{ method: "totp" }], // mfa enrollments
      [], // passkey rows
    ];

    const res = await request(app)
      .post(`/api/portal/team/${targetUserId}/reset-mfa`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(sendEmailFromTemplateMock).toHaveBeenCalledTimes(1);
    const [, , mergeFields, , bodyHtml] = sendEmailFromTemplateMock.mock.calls[0];
    expect(mergeFields.loginLink).not.toContain("/crm");
    expect(mergeFields.securityLink).not.toContain("/crm");
    expect(bodyHtml).not.toContain("/crm");
  });
});
