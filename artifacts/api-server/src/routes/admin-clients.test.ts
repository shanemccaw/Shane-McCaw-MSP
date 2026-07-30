import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

// Top level variables prefixed with 'mock' to bypass hoisting checks.
// mockSelectResults is consumed in FIFO order by successive db.select() chains,
// falling back to [] once exhausted (mirrors how the real handler issues many
// sequential selects before doing any deletes).
let mockSelectResultsQueue: any[][] = [];
let mockDefaultSelectResult: any[] = [];

const deleteCalls: { table: unknown; whereArgs: unknown[] }[] = [];

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

  const makeDeleteChain = (table: unknown) => {
    const whereArgs: unknown[] = [];
    const chain: any = {
      where: (...args: unknown[]) => {
        whereArgs.push(...args);
        deleteCalls.push({ table, whereArgs });
        return chain;
      },
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
    delete: vi.fn().mockImplementation((table: unknown) => makeDeleteChain(table)),
    update: vi.fn().mockImplementation(() => updateChain),
    insert: vi.fn().mockImplementation(() => insertChain),
  };

  // Minimal distinguishable table markers — real column objects aren't needed
  // since the mock chain ignores its arguments; we only need each table export
  // to be a unique referenceable value so assertions can check `toHaveBeenCalledWith`.
  const table = (name: string) => ({ __table: name });

  // Trimmed to exactly the tables admin-clients.ts imports from @workspace/db —
  // NOT the full portal.ts table list this file's mock originally carried.
  return {
    db: mockDb,
    usersTable: { id: "id", email: "email", role: "role", name: "name", tenantId: "tenant_id", mspId: "msp_id", mspRole: "msp_role" },
    projectsTable: table("projects"),
    kanbanTasksTable: table("kanbanTasks"),
    emailsTable: table("emails"),
    clientM365ProfilesTable: table("clientM365Profiles"),
    clientAppRegistrationsTable: table("clientAppRegistrations"),
    leadStagingTable: table("leadStaging"),
    clientHealthHistoryTable: table("clientHealthHistory"),
    azureTenantCredentialsTable: table("azureTenantCredentials"),
    accountSetupTokensTable: table("accountSetupTokens"),
    invoicesTable: table("invoices"),
    contractsTable: table("contracts"),
    messagesTable: table("messages"),
    clientServicesTable: table("clientServices"),
    reportsTable: table("reports"),
    statusReportsTable: table("statusReports"),
    scriptRunResultsTable: table("scriptRunResults"),
    quizLeadsTable: { id: "id", email: "email" },
    insightsGeneratedDocumentsTable: table("insightsGeneratedDocuments"),
    projectUpdatesTable: table("projectUpdates"),
    documentsTable: table("documents"),
    workflowStepsTable: table("workflowSteps"),
    notificationsTable: table("notifications"),
    impersonationTokensTable: table("impersonationTokens"),
    passwordResetTokensTable: table("passwordResetTokens"),
    emailDomainRulesTable: table("emailDomainRules"),
    clientDocumentsTable: table("clientDocuments"),
    mfaEnrollmentsTable: table("mfaEnrollments"),
    mfaChallengesTable: table("mfaChallenges"),
    webauthnCredentialsTable: table("webauthnCredentials"),
    webauthnChallengesTable: table("webauthnChallenges"),
  };
});

vi.mock("../lib/mailer.ts", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  sendEmailFromTemplate: vi.fn().mockResolvedValue(undefined),
  brandedEmail: vi.fn(),
  appRegExpiryAlertEmail: vi.fn(),
}));

vi.mock("../lib/audit.ts", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/azure-keyvault.ts", () => ({
  setSecretValue: vi.fn(),
  getSecretValue: vi.fn(),
  getSecretMetadata: vi.fn(),
}));

vi.mock("../lib/azure-credentials.ts", () => ({
  testClientCredentials: vi.fn(),
}));

vi.mock("../lib/consent-invite.ts", () => ({
  mtAppCredentialsPresent: vi.fn().mockReturnValue(false),
  createConsentInviteForEmail: vi.fn(),
}));

vi.mock("../lib/portal-url.ts", () => ({
  getMspPortalBaseUrl: vi.fn().mockReturnValue("https://portal.test/portal"),
  buildAccountSetupUrl: vi.fn().mockReturnValue("https://portal.test/setup"),
}));

vi.mock("../lib/stripe.ts", () => ({
  getStripeKey: vi.fn().mockReturnValue(null),
}));

vi.mock("../lib/m365-profile-pdf.ts", () => ({
  generateM365ProfilePdf: vi.fn(),
}));

// admin-clients.ts does `const log = logger.child(...)` at module scope.
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

import router from "./admin-clients.ts";
import { db, usersTable } from "@workspace/db";

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  // Minimal req.log stub — real requests get this from pino-http; requireAdmin
  // calls req.log.child(...) when present.
  (req as any).log = { child: () => (req as any).log, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  next();
});
app.use("/api", router);

const JWT_SECRET = "test-secret";
process.env.JWT_SECRET = JWT_SECRET;

function makeAdminToken(): string {
  return jwt.sign({ id: 99, email: "admin@shanemccaw.com", role: "admin" }, JWT_SECRET, { expiresIn: "1h" });
}

describe("DELETE /api/admin/clients/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectResultsQueue = [];
    mockDefaultSelectResult = [];
    deleteCalls.length = 0;
  });

  it("deletes the users row (msp_users was absorbed into users — #92, so one delete IS the whole account)", async () => {
    const clientId = 42;
    const token = makeAdminToken();

    // First select: the client lookup (usersTable) — must resolve truthy.
    mockSelectResultsQueue = [
      [{ id: clientId, email: "client@example.com" }], // client lookup
      [], // clientProjectRows
      [], // clientSvcRows
    ];
    // Any further selects (none expected on this path once svc rows are empty)
    // fall back to mockDefaultSelectResult = [].

    const res = await request(app)
      .delete(`/api/admin/clients/${clientId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(204);

    // Post-#92 there is no separate msp_users row: deleting the users row is
    // the complete account deletion. The regression this file originally
    // guarded (an orphaned msp_users row surviving the user delete) is now
    // structurally impossible, so the assertion inverts: exactly one delete
    // against usersTable, and no delete against any dropped bridge table.
    expect(db.delete).toHaveBeenCalledWith(usersTable);
    const usersDeleteCalls = (db.delete as any).mock.calls.filter(
      (call: unknown[]) => call[0] === usersTable
    );
    expect(usersDeleteCalls).toHaveLength(1);
  });
});
