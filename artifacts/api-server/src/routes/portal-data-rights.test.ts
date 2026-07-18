/**
 * Tests for portal data-rights endpoints:
 *   GET  /api/portal/data-export
 *   POST /api/portal/deletion-request
 *
 * Approach:
 *  - mock.module() stubs @workspace/db — no real DB connections.
 *  - requireAuth is stubbed to inject req.user so handler auth checks pass.
 *  - sendEmail is mocked to capture calls without network I/O.
 *  - createAuditLog is mocked to a no-op.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */

import { describe, it, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

process.env.JWT_SECRET = "data-rights-test-secret-xyz";
process.env.ADMIN_EMAIL = "admin@test.example";

// ── Queue-based mock DB ───────────────────────────────────────────────────────
let dbQueue: unknown[][] = [];

function makeChain(result: unknown[]): Record<string, unknown> {
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: () => chain,
    limit: () => chain,
    leftJoin: () => chain,
    innerJoin: () => chain,
    orderBy: () => chain,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
    catch: (reject: (e: unknown) => unknown) => Promise.resolve(result).catch(reject),
  };
  return chain;
}

function makeMockDb() {
  return {
    select: (_cols?: unknown) => makeChain(dbQueue.shift() ?? []),
    insert: () => ({
      values: () => ({
        returning: async () => [],
        onConflictDoNothing: () => ({ returning: async () => [] }),
      }),
      onConflictDoNothing: () => ({ returning: async () => [] }),
    }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
    delete: () => ({ where: async () => [] }),
    execute: async () => ({ rows: [] }),
  };
}

// ── Mocks (must run before portal.ts import) ──────────────────────────────────
mock.module("@workspace/db", {
  namedExports: {
    db: makeMockDb(),
    projectsTable: {},
    clientServicesTable: {},
    servicesTable: {},
    workflowStepsTable: {},
    kanbanTasksTable: {},
    documentsTable: {},
    reportsTable: {},
    invoicesTable: {},
    messagesTable: {},
    notificationsTable: {},
    projectUpdatesTable: {},
    usersTable: {},
    contractsTable: {},
    passwordResetTokensTable: {},
    workflowTemplateStepsTable: {},
    workflowTemplateStepTasksTable: {},
    workflowTemplatesTable: {},
    contractTemplatesTable: {},
    impersonationTokensTable: {},
    statusReportsTable: {},
    deviceTokensTable: {},
    projectClosuresTable: {},
    auditLogsTable: {},
    instructionSetsTable: {},
    checklistsTable: {},
    artifactSetsTable: {},
    deliverableSetsTable: {},
    emailsTable: {},
    emailDomainRulesTable: {},
    clientM365ProfilesTable: {},
    couponsTable: {},
    clientAppRegistrationsTable: {},
    accountSetupTokensTable: {},
    mfaEnrollmentsTable: {},
    mfaChallengesTable: {},
    webauthnCredentialsTable: {},
    webauthnChallengesTable: {},
    clientHealthHistoryTable: {},
    quizLeadsTable: {},
    scriptRunResultsTable: {},
    powershellScriptsTable: {},
    clientScoresTable: {},
    clientAutomationRunsTable: {},
    scriptPackagesTable: {},
    scriptModulesTable: {},
    azureTenantCredentialsTable: {},
    clientDocumentsTable: {},
    serviceScriptSetsTable: {},
    clientCallbackTokensTable: {},
    insightsGeneratedDocumentsTable: {},
    quickWinPresentationsTable: {},
    presentationDocViewsTable: {},
    quickWinResultSharesTable: {},
  },
});

mock.module("../middlewares/requireAuth.ts", {
  namedExports: {
    requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
    requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
  },
});

const noop = () => {};
const noopLogger = {
  info: noop, warn: noop, error: noop, debug: noop,
  fatal: noop, trace: noop,
  child: () => noopLogger,
};
mock.module("../lib/logger.ts", {
  namedExports: { logger: noopLogger },
});

const sentEmails: { to: string; subject: string }[] = [];
mock.module("../lib/mailer.ts", {
  namedExports: {
    sendEmail: async (to: string, subject: string) => { sentEmails.push({ to, subject }); },
    sendEmailFromTemplate: async () => {},
    getEmailTemplateOrFallback: async () => ({ subject: "", html: "" }),
    purchaseConfirmationEmail: () => ({ subject: "", html: "" }),
    onboardingConfirmationEmail: () => ({ subject: "", html: "" }),
    adminPurchaseAlertEmail: () => ({ subject: "", html: "" }),
    closureRequestEmail: () => ({ subject: "", html: "" }),
    statusReportReplyEmail: () => ({ subject: "", html: "" }),
    clientThreadReplyEmail: () => ({ subject: "", html: "" }),
    adminThreadReplyEmail: () => ({ subject: "", html: "" }),
    retainerResumedEmail: () => ({ subject: "", html: "" }),
    appRegExpiryAlertEmail: () => ({ subject: "", html: "" }),
    brandedEmail: () => ({ subject: "", html: "" }),
    getTenantHealthBlockHtml: async () => "",
    PORTAL_URL: "https://test.example/crm/portal",
  },
});

mock.module("../lib/audit.ts", {
  namedExports: {
    createAuditLog: async () => {},
  },
});

// All other heavy deps — no-ops
const noopMod = { default: {}, namedExports: {} };
for (const mod of [
  "../lib/sms.ts",
  "../lib/push.ts",
  "../lib/web-push.ts",
  "../lib/stripe.ts",
  "../lib/graph.ts",
  "../lib/azure-keyvault.ts",
  "../lib/azure-credentials.ts",
  "../lib/probe-graph-permissions.ts",
  "../lib/sow-pricing.ts",
  "../lib/tenant-signals.ts",
  "../lib/client-script-sequence.ts",
  "../lib/kanban-phase-advance.ts",
  "../lib/kanban-auto-fire.ts",
  "../lib/azure-automation.ts",
  "../lib/crm-pipeline.ts",
  "../lib/invoice-sharepoint.ts",
  "../lib/portal-url.ts",
  "../lib/workflow-executor.ts",
  "../lib/m365-profile-pdf.ts",
  "../lib/manual-script-package.ts",
  "../lib/insight-pdf.ts",
  "../lib/sse-channels.ts",
]) {
  mock.module(mod, {
    namedExports: {
      sendAdminSms: noop,
      sendPushNotifications: noop,
      sendWebPushToAdmins: noop,
      getStripeKey: () => "sk_test_fake",
      listDriveItems: async () => [],
      graphCredentialsPresent: () => false,
      createProjectFolder: async () => null,
      uploadFileToClientContracts: async () => null,
      getDriveItemDownloadUrl: async () => null,
      setSecretValue: async () => {},
      getSecretValue: async () => null,
      getSecretMetadata: async () => null,
      testClientCredentials: async () => ({ ok: false }),
      probeGraphPermissions: async () => ({}),
      stripStagedForReviewBanner: (s: string) => s,
      stripTierDetectionText: (s: string) => s,
      extractAiHtml: () => "",
      nextBusinessMonday: () => new Date(),
      WORKSTREAM_ADJ_MAP: {},
      ADJ_SIGNAL_PATTERNS: [],
      computeTenantSignals: async () => [],
      ADJUSTMENT_SIGNALS: [],
      getDisabledSignalKeys: async () => new Set(),
      runClientScriptSequence: async () => {},
      advancePhaseIfComplete: async () => {},
      syncProjectProgress: async () => {},
      seedKanbanCardsForPhase: async () => {},
      autoFireFirstBacklogScript: async () => {},
      autoFireDocumentCard: async () => {},
      autoFireRunWorkflowCards: async () => {},
      isAzureConfigured: () => false,
      ensureLeadForClient: async () => {},
      uploadInvoiceToSharePoint: async () => {},
      getPortalBaseUrl: () => "https://test.example",
      fireWorkflowsForEvent: async () => {},
      emitWorkflowEvent: async () => {},
      generateM365ProfilePdf: async () => Buffer.from(""),
      generateManualScriptPackage: async () => Buffer.from(""),
      injectCallbackVars: (s: string) => s,
      buildHtmlDoc: () => "",
      htmlToPdf: async () => Buffer.from(""),
      broadcastKanbanChange: noop,
      registerSSEClient: noop,
      registerPresentationSSEClient: noop,
      broadcastPresentationScopeChange: noop,
      replayPhaseGenState: noop,
    },
  });
}

// ── Import app under test ─────────────────────────────────────────────────────
const { default: router } = await import("./portal.ts");
import express from "express";

function makeApp(userId = 42) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // Inject auth user for requireAuth (which is stubbed to call next())
    (req as unknown as Record<string, unknown>).user = { id: userId, role: "client", email: "client@test.example" };
    (req as unknown as Record<string, unknown>).log = noopLogger;
    next();
  });
  app.use("/api", router);
  return app;
}

function listen(app: ReturnType<typeof express>) {
  return new Promise<http.Server>(resolve => {
    const srv = http.createServer(app).listen(0, "127.0.0.1", () => resolve(srv));
  });
}

async function request(srv: http.Server, opts: { method?: string; path: string; body?: unknown }) {
  const port = (srv.address() as AddressInfo).port;
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const payload = opts.body ? JSON.stringify(opts.body) : undefined;
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: opts.path,
      method: opts.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    }, res => {
      let data = "";
      res.on("data", c => { data += c; });
      res.on("end", () => {
        let body: unknown;
        try { body = JSON.parse(data); } catch { body = data; }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Data Export Tests ─────────────────────────────────────────────────────────
describe("GET /api/portal/data-export", () => {
  let srv: http.Server;

  before(async () => {
    srv = await listen(makeApp(42));
  });

  after(() => srv.close());

  it("returns 404 when user is not found in DB", async () => {
    dbQueue.length = 0;
    // user select returns empty
    dbQueue.push([]);
    const { status, body } = await request(srv, { path: "/api/portal/data-export" });
    assert.equal(status, 404);
    assert.equal((body as { error: string }).error, "User not found");
  });

  it("returns complete export structure for a known user", async () => {
    dbQueue.length = 0;
    const fakeUser = { id: 42, name: "Test Client", email: "client@test.example", company: "ACME", phone: null, createdAt: new Date().toISOString() };
    dbQueue.push([fakeUser]);          // usersTable
    dbQueue.push([]);                  // projectsTable (empty)
    dbQueue.push([]);                  // invoicesTable (empty)
    dbQueue.push([]);                  // clientM365ProfilesTable (empty)
    dbQueue.push([]);                  // clientDocumentsTable (empty)
    dbQueue.push([]);                  // auditLogsTable (empty)
    dbQueue.push([]);                  // quizLeadsTable (empty)

    const port = (srv.address() as AddressInfo).port;
    const raw = await new Promise<string>((resolve, reject) => {
      http.get({
        hostname: "127.0.0.1",
        port,
        path: "/api/portal/data-export",
        headers: { "Content-Type": "application/json" },
      }, res => {
        let d = ""; res.on("data", c => { d += c; }); res.on("end", () => resolve(d));
      }).on("error", reject);
    });

    const body = JSON.parse(raw) as Record<string, unknown>;
    assert.ok(body.exportedAt, "exportedAt missing");
    assert.ok(body.exportVersion, "exportVersion missing");
    assert.ok(body.notice, "notice missing");
    assert.deepEqual(body.profile, fakeUser);
    assert.ok(Array.isArray(body.projects), "projects should be array");
    assert.ok(Array.isArray(body.invoices), "invoices should be array");
    assert.ok(Array.isArray(body.messages), "messages should be array");
    assert.ok(Array.isArray(body.documents), "documents should be array");
    assert.ok(Array.isArray(body.clientDocuments), "clientDocuments should be array");
    assert.ok(Array.isArray(body.auditActivity), "auditActivity should be array");
    assert.ok(Array.isArray(body.quizResults), "quizResults should be array");
  });
});

// ── Deletion Request Tests ────────────────────────────────────────────────────
describe("POST /api/portal/deletion-request", () => {
  let srv: http.Server;

  before(async () => {
    sentEmails.length = 0;
    srv = await listen(makeApp(42));
  });

  after(() => srv.close());

  it("returns 404 when user is not found in DB", async () => {
    dbQueue.length = 0;
    dbQueue.push([]);
    const { status, body } = await request(srv, { method: "POST", path: "/api/portal/deletion-request" });
    assert.equal(status, 404);
    assert.equal((body as { error: string }).error, "User not found");
  });

  it("returns ok:true and sends admin notification email", async () => {
    dbQueue.length = 0;
    sentEmails.length = 0;
    const fakeUser = { id: 42, name: "Test Client", email: "client@test.example", company: "ACME" };
    dbQueue.push([fakeUser]);

    const { status, body } = await request(srv, { method: "POST", path: "/api/portal/deletion-request" });
    assert.equal(status, 200);
    assert.equal((body as { ok: boolean }).ok, true);
    assert.ok((body as { message: string }).message.includes("30 days"), "response should mention 30-day SLA");
    assert.ok((body as { message: string }).message.includes("contracts"), "response should mention contract retention");

    // Email notification should have been sent
    assert.equal(sentEmails.length, 1);
    assert.equal(sentEmails[0].to, "admin@test.example");
    assert.ok(sentEmails[0].subject.includes("Deletion Request"), `unexpected subject: ${sentEmails[0].subject}`);
  });
});
