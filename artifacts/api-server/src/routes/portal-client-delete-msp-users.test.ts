import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

// Top level variables prefixed with 'mock' to bypass hoisting checks.
// mockSelectResults is consumed in FIFO order by successive db.select() chains,
// falling back to [] once exhausted (mirrors how the real handler issues many
// sequential/parallel selects before doing any deletes).
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

  return {
    db: mockDb,
    projectsTable: table("projects"),
    clientServicesTable: table("clientServices"),
    servicesTable: table("services"),
    workflowStepsTable: table("workflowSteps"),
    kanbanTasksTable: table("kanbanTasks"),
    documentsTable: table("documents"),
    reportsTable: table("reports"),
    invoicesTable: table("invoices"),
    messagesTable: table("messages"),
    notificationsTable: table("notifications"),
    projectUpdatesTable: table("projectUpdates"),
    usersTable: { id: "id", email: "email", role: "role", name: "name" },
    contractsTable: table("contracts"),
    passwordResetTokensTable: table("passwordResetTokens"),
    workflowTemplateStepsTable: table("workflowTemplateSteps"),
    workflowTemplateStepTasksTable: table("workflowTemplateStepTasks"),
    workflowTemplatesTable: table("workflowTemplates"),
    contractTemplatesTable: table("contractTemplates"),
    impersonationTokensTable: table("impersonationTokens"),
    statusReportsTable: table("statusReports"),
    deviceTokensTable: table("deviceTokens"),
    projectClosuresTable: table("projectClosures"),
    auditLogsTable: table("auditLogs"),
    instructionSetsTable: table("instructionSets"),
    checklistsTable: table("checklists"),
    artifactSetsTable: table("artifactSets"),
    deliverableSetsTable: table("deliverableSets"),
    emailsTable: table("emails"),
    emailDomainRulesTable: table("emailDomainRules"),
    clientM365ProfilesTable: table("clientM365Profiles"),
    couponsTable: table("coupons"),
    clientAppRegistrationsTable: table("clientAppRegistrations"),
    accountSetupTokensTable: table("accountSetupTokens"),
    mfaEnrollmentsTable: table("mfaEnrollments"),
    mfaChallengesTable: table("mfaChallenges"),
    webauthnCredentialsTable: table("webauthnCredentials"),
    webauthnChallengesTable: table("webauthnChallenges"),
    clientHealthHistoryTable: table("clientHealthHistory"),
    quizLeadsTable: { id: "id", email: "email" },
    scriptRunResultsTable: table("scriptRunResults"),
    powershellScriptsTable: table("powershellScripts"),
    clientScoresTable: table("clientScores"),
    clientAutomationRunsTable: table("clientAutomationRuns"),
    scriptPackagesTable: table("scriptPackages"),
    scriptModulesTable: table("scriptModules"),
    azureTenantCredentialsTable: table("azureTenantCredentials"),
    clientCallbackTokensTable: table("clientCallbackTokens"),
    insightsGeneratedDocumentsTable: table("insightsGeneratedDocuments"),
    quickWinPresentationsTable: table("quickWinPresentations"),
    presentationDocViewsTable: table("presentationDocViews"),
    quickWinResultSharesTable: table("quickWinResultShares"),
    clientDocumentsTable: table("clientDocuments"),
    fulfillmentQueueTable: table("fulfillmentQueue"),
    fulfillmentSlaConfigTable: table("fulfillmentSlaConfig"),
    FULFILLMENT_DELIVERY_STATUSES: ["queued", "delivered"],
    FULFILLMENT_SOURCE_TYPES: ["manual", "automated"],
    mspCustomersTable: { id: "id", mspId: "msp_id", tenantId: "tenant_id", status: "status", name: "name", domain: "domain" },
    mspUsersTable: { id: "id", userId: "user_id", mspId: "msp_id", customerId: "customer_id", mspRole: "msp_role" },
    mspAuditLogsTable: table("mspAuditLogs"),
    monitorChecksTable: table("monitorChecks"),
    checkoutSessionsTable: table("checkoutSessions"),
    tenantConsentTable: table("tenantConsent"),
    mspDiagnosticRunsTable: table("mspDiagnosticRuns"),
    mspsTable: table("msps"),
  };
});

vi.mock("../lib/catalog-pricing.ts", () => ({
  resolveCatalogPricing: vi.fn().mockResolvedValue({}),
}));

vi.mock("../lib/mailer.ts", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  sendEmailFromTemplate: vi.fn().mockResolvedValue(undefined),
  getEmailTemplateOrFallback: vi.fn().mockResolvedValue(""),
  getTenantHealthBlockHtml: vi.fn().mockResolvedValue(""),
  purchaseConfirmationEmail: vi.fn(),
  onboardingConfirmationEmail: vi.fn(),
  adminPurchaseAlertEmail: vi.fn(),
  closureRequestEmail: vi.fn(),
  statusReportReplyEmail: vi.fn(),
  clientThreadReplyEmail: vi.fn(),
  adminThreadReplyEmail: vi.fn(),
  retainerResumedEmail: vi.fn(),
  appRegExpiryAlertEmail: vi.fn(),
  brandedEmail: vi.fn(),
  PORTAL_URL: "https://portal.test",
}));

vi.mock("../lib/sms.ts", () => ({
  sendAdminSms: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/push.ts", () => ({
  sendPushNotifications: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/web-push.ts", () => ({
  sendWebPushToAdmins: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/audit.ts", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/stripe.ts", () => ({
  getStripeKey: vi.fn().mockReturnValue(null),
}));

vi.mock("./portal-retainer-billing.ts", () => ({
  handleRetainerScheduleUpdated: vi.fn(),
  handleRetainerScheduleCompleted: vi.fn(),
  handleRetainerScheduleReleased: vi.fn(),
  handleRetainerScheduleCanceled: vi.fn(),
}));

vi.mock("../lib/graph.ts", () => ({
  listDriveItems: vi.fn(),
  graphCredentialsPresent: vi.fn().mockReturnValue(false),
  createProjectFolder: vi.fn(),
  uploadFileToClientContracts: vi.fn(),
  getDriveItemDownloadUrl: vi.fn(),
}));

vi.mock("../lib/azure-keyvault.ts", () => ({
  setSecretValue: vi.fn(),
  getSecretValue: vi.fn(),
  getSecretMetadata: vi.fn(),
}));

vi.mock("../lib/azure-credentials.ts", () => ({
  testClientCredentials: vi.fn(),
}));

vi.mock("../lib/probe-graph-permissions.ts", () => ({
  probeGraphPermissions: vi.fn(),
}));

vi.mock("../lib/sow-pricing.ts", () => ({
  stripStagedForReviewBanner: vi.fn((s: string) => s),
  stripTierDetectionText: vi.fn((s: string) => s),
  extractAiHtml: vi.fn((s: string) => s),
  nextBusinessMonday: vi.fn(),
  WORKSTREAM_ADJ_MAP: {},
  ADJ_SIGNAL_PATTERNS: {},
}));

vi.mock("../lib/tenant-signals.ts", () => ({
  computeTenantSignals: vi.fn(),
  ADJUSTMENT_SIGNALS: {},
  getDisabledSignalKeys: vi.fn().mockReturnValue([]),
}));

vi.mock("../lib/client-script-sequence.ts", () => ({
  runClientScriptSequence: vi.fn(),
}));

vi.mock("../lib/kanban-phase-advance.ts", () => ({
  advancePhaseIfComplete: vi.fn(),
  syncProjectProgress: vi.fn(),
  seedKanbanCardsForPhase: vi.fn(),
}));

vi.mock("../lib/kanban-auto-fire.ts", () => ({
  autoFireFirstBacklogScript: vi.fn(),
  autoFireDocumentCard: vi.fn(),
  autoFireRunWorkflowCards: vi.fn(),
}));

vi.mock("../lib/azure-automation.ts", () => ({
  isAzureConfigured: vi.fn().mockReturnValue(false),
}));

vi.mock("../lib/crm-pipeline.ts", () => ({
  ensureLeadForClient: vi.fn(),
}));

vi.mock("../lib/invoice-sharepoint.ts", () => ({
  uploadInvoiceToSharePoint: vi.fn(),
}));

vi.mock("../lib/portal-url.ts", () => ({
  getPortalBaseUrl: vi.fn().mockReturnValue("https://portal.test"),
  buildAccountSetupUrl: vi.fn().mockReturnValue("https://portal.test/setup"),
}));

vi.mock("../lib/workflow-executor.ts", () => ({
  fireWorkflowsForEvent: vi.fn().mockResolvedValue(undefined),
  emitWorkflowEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/m365-profile-pdf.ts", () => ({
  generateM365ProfilePdf: vi.fn(),
}));

vi.mock("../lib/manual-script-package.ts", () => ({
  generateManualScriptPackage: vi.fn(),
  injectCallbackVars: vi.fn(),
}));

vi.mock("../lib/insight-pdf.ts", () => ({
  buildHtmlDoc: vi.fn(),
  htmlToPdf: vi.fn(),
}));

vi.mock("../lib/sse-channels.ts", () => ({
  broadcastKanbanChange: vi.fn(),
  registerSSEClient: vi.fn(),
  registerPresentationSSEClient: vi.fn(),
  broadcastPresentationScopeChange: vi.fn(),
  replayPhaseGenState: vi.fn(),
}));

// portal.ts does `const log = logger.child(...)` at module scope.
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

vi.mock("multer", () => {
  const multerFn: any = vi.fn(() => ({
    single: () => (_req: any, _res: any, next: any) => next(),
    array: () => (_req: any, _res: any, next: any) => next(),
    fields: () => (_req: any, _res: any, next: any) => next(),
  }));
  multerFn.memoryStorage = vi.fn();
  multerFn.diskStorage = vi.fn();
  return { default: multerFn };
});

vi.mock("pdf-lib", () => ({
  PDFDocument: { create: vi.fn(), load: vi.fn() },
  rgb: vi.fn(),
  StandardFonts: {},
}));

import router, { ensureClientMspUser } from "./portal.ts";
import { db, mspUsersTable, usersTable, mspCustomersTable } from "@workspace/db";

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  // Minimal req.log stub — real requests get this from pino-http; requireAuth
  // calls req.log.child(...) when present.
  (req as any).log = { child: () => (req as any).log, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  next();
});
app.use("/api/portal", router);

const JWT_SECRET = "test-secret";
process.env.JWT_SECRET = JWT_SECRET;

function makeAdminToken(): string {
  return jwt.sign({ id: 99, email: "admin@shanemccaw.com", role: "admin" }, JWT_SECRET, { expiresIn: "1h" });
}

describe("DELETE /api/portal/admin/clients/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectResultsQueue = [];
    mockDefaultSelectResult = [];
    deleteCalls.length = 0;
  });

  it("deletes both usersTable and mspUsersTable rows for a client with an active msp_users row", async () => {
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
      .delete(`/api/portal/admin/clients/${clientId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(204);

    // The core regression assertion: db.delete was called with mspUsersTable,
    // scoped by the deleted client's id, in addition to usersTable.
    expect(db.delete).toHaveBeenCalledWith(mspUsersTable);
    expect(db.delete).toHaveBeenCalledWith(usersTable);

    const mspUsersDeleteIndex = (db.delete as any).mock.calls.findIndex(
      (call: unknown[]) => call[0] === mspUsersTable
    );
    const usersDeleteIndex = (db.delete as any).mock.calls.findIndex(
      (call: unknown[]) => call[0] === usersTable
    );
    expect(mspUsersDeleteIndex).toBeGreaterThanOrEqual(0);
    expect(usersDeleteIndex).toBeGreaterThanOrEqual(0);
    // mspUsersTable delete happens before the usersTable delete (FK-safe ordering).
    expect(mspUsersDeleteIndex).toBeLessThan(usersDeleteIndex);
  });
});

// Cross-MSP tenant boundary backstop in ensureClientMspUser. This is the
// post-payment defense-in-depth half of "Reject cross-MSP tenant consent
// conflicts" (the consent-time check in routes/consent.ts is the primary gate).
// When a tenantId resolves to a customer under a DIFFERENT MSP than the user's
// existing msp_users row, the customerId patch must be REFUSED so the user is
// never cross-linked to another MSP's customer (which would leak that MSP's
// engine history / findings / SOWs — confirmed live for user 92).
describe("ensureClientMspUser — cross-MSP customerId patch backstop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectResultsQueue = [];
    mockDefaultSelectResult = [];
  });

  it("REFUSES to patch customerId when the tenantId customer is under a different MSP", async () => {
    mockSelectResultsQueue = [
      // 1. tenantId → customer lookup: customer 1 lives under mspId 1
      [{ id: 1, mspId: 1 }],
      // 2. existing msp_users row for this user: under mspId 89, customerId still null
      [{ id: 500, existingCustomerId: null, existingMspId: 89 }],
    ];

    await ensureClientMspUser(92, "tenant-conflict");

    // The buggy patch must NOT run — leave the existing row's customerId untouched.
    expect(db.update).not.toHaveBeenCalled();
  });

  it("patches customerId when the tenantId customer is under the SAME MSP", async () => {
    mockSelectResultsQueue = [
      // 1. tenantId → customer lookup: customer 5 under mspId 89 (matches the user's MSP)
      [{ id: 5, mspId: 89 }],
      // 2. existing msp_users row: under mspId 89, customerId null → safe to patch
      [{ id: 500, existingCustomerId: null, existingMspId: 89 }],
    ];

    await ensureClientMspUser(92, "tenant-ok");

    // No conflict → the customerId patch proceeds on mspUsersTable.
    expect(db.update).toHaveBeenCalledWith(mspUsersTable);
  });

  it("does not patch (nothing to do) when the existing row already has a customerId", async () => {
    mockSelectResultsQueue = [
      [{ id: 5, mspId: 89 }],
      // existing row already linked → no patch regardless of MSP
      [{ id: 500, existingCustomerId: 5, existingMspId: 89 }],
    ];

    await ensureClientMspUser(92, "tenant-ok");

    expect(db.update).not.toHaveBeenCalled();
  });
});
