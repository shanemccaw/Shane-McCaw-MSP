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
    usersTable: { id: "id", email: "email", role: "role", name: "name", tenantId: "tenant_id", mspId: "msp_id", mspRole: "msp_role" },
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
    tenantsTable: { id: "id", mspId: "msp_id", tenantId: "tenant_id", status: "status", customerName: "customer_name", domain: "domain", industry: "industry", consent: "consent", createdAt: "created_at" },
    mspAuditLogsTable: table("mspAuditLogs"),
    monitorChecksTable: table("monitorChecks"),
    checkoutSessionsTable: table("checkoutSessions"),
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
  // consent-invite.ts (imported by portal.ts since #103) pulls these three:
  buildAdminConsentUrl: vi.fn().mockReturnValue("https://login.microsoftonline.com/common/adminconsent?test=1"),
  mtAppCredentialsPresent: vi.fn().mockReturnValue(false),
  REQUIRED_MT_SCOPES: [],
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
  getAdjustmentSignalDefinitions: vi.fn().mockResolvedValue([]),
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
import { db, usersTable } from "@workspace/db";

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
      .delete(`/api/portal/admin/clients/${clientId}`)
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

// Cross-MSP tenant boundary backstop in ensureClientMspUser. This is the
// post-payment defense-in-depth half of "Reject cross-MSP tenant consent
// conflicts" (the consent-time check in routes/consent.ts is the primary gate).
// When a tenantId resolves to a tenants row under a DIFFERENT MSP than the
// user's own msp_id, the tenant-link patch must be REFUSED so the user is
// never cross-linked to another MSP's tenant (which would leak that MSP's
// engine history / findings / SOWs — confirmed live pre-refactor for user 92).
// Post-#92 the "existing msp_users row" is the user's own row: the second
// mocked select is the users-row read (tenantId/mspId/mspRole projection).
describe("ensureClientMspUser — cross-MSP customerId patch backstop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectResultsQueue = [];
    mockDefaultSelectResult = [];
  });

  it("REFUSES to patch the tenant link when the tenantId tenant is under a different MSP", async () => {
    mockSelectResultsQueue = [
      // 1. tenantId → tenants lookup: tenant 1 lives under mspId 1
      [{ id: 1, mspId: 1 }],
      // 2. the user's own row: under mspId 89, not tenant-linked yet
      [{ existingCustomerId: null, existingMspId: 89, existingRole: "CustomerUser" }],
    ];

    await ensureClientMspUser(92, "tenant-conflict");

    // The buggy patch must NOT run — leave the user's tenant link untouched.
    expect(db.update).not.toHaveBeenCalled();
  });

  it("patches the tenant link when the tenantId tenant is under the SAME MSP", async () => {
    mockSelectResultsQueue = [
      // 1. tenantId → tenants lookup: tenant 5 under mspId 89 (matches the user's MSP)
      [{ id: 5, mspId: 89 }],
      // 2. the user's own row: under mspId 89, not tenant-linked → safe to patch
      [{ existingCustomerId: null, existingMspId: 89, existingRole: "CustomerUser" }],
    ];

    await ensureClientMspUser(92, "tenant-ok");

    // No conflict → the tenant-link patch proceeds on the user's own row.
    expect(db.update).toHaveBeenCalledWith(usersTable);
  });

  it("does not patch (nothing to do) when the user is already tenant-linked", async () => {
    mockSelectResultsQueue = [
      [{ id: 5, mspId: 89 }],
      // already linked → no patch regardless of MSP
      [{ existingCustomerId: 5, existingMspId: 89, existingRole: "CustomerUser" }],
    ];

    await ensureClientMspUser(92, "tenant-ok");

    expect(db.update).not.toHaveBeenCalled();
  });
});
