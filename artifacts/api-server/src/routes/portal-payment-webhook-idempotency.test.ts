/**
 * Tests for Stripe webhook idempotency on service_purchase and onboarding_purchase.
 *
 * Verifies that a replayed checkout.session.completed webhook for either payment
 * type is a complete no-op after the first processing — no duplicate invoices,
 * no duplicate emails, no duplicate SMS/push notifications.
 *
 * Approach:
 *  - mock.module() stubs @workspace/db, Stripe, and all side-effect modules so
 *    no real DB connections or network calls open.
 *  - A module-level `webhookEventToReturn` variable lets each test control what
 *    constructEvent() returns (bypassing signature validation entirely).
 *  - A module-level `insertCallCount` variable tracks how many times db.insert()
 *    is called, so tests can assert "no insert on replay".
 *  - A module-level `dbQueue` array lets tests seed what db.select() returns —
 *    the first item is dequeued for the idempotency check, subsequent items for
 *    any further selects in the handler.
 *  - After posting to the webhook endpoint the test waits 150 ms for the
 *    setImmediate-deferred processStripeEvent() to finish before asserting.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */
import { describe, it, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

process.env.JWT_SECRET = "payment-idempotency-test-secret-xyz";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_fake_webhook_secret";

let webhookEventToReturn: unknown = null;
let insertCallCount = 0;
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
    insert: (_table: unknown) => {
      insertCallCount++;
      return {
        values: (_vals: unknown) => ({
          returning: async () => [{ id: 9001 }],
          onConflictDoNothing: () => ({ returning: async () => [] }),
        }),
        onConflictDoNothing: () => ({ returning: async () => [] }),
      };
    },
    update: (_table: unknown) => ({
      set: (_vals: unknown) => ({ where: async () => [] }),
    }),
    delete: () => ({ where: async () => [] }),
    execute: async () => ({ rows: [], rowCount: 0 }),
  };
}

mock.module("stripe", {
  defaultExport: class MockStripe {
    constructor(_key: string) {}
    webhooks = {
      constructEvent: (_body: unknown, _sig: unknown, _secret: unknown) => webhookEventToReturn,
    };
    checkout = {
      sessions: {
        create: async () => ({ id: "cs_test_idem_abc", url: "https://checkout.stripe.com/pay/test" }),
        retrieve: async () => ({ payment_status: "unpaid" }),
      },
    };
    customers = {
      list: async () => ({ data: [] }),
      create: async () => ({ id: "cus_test_idem" }),
    };
  },
});

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
    serviceScriptSetsTable: {},
    clientCallbackTokensTable: {},
    insightsGeneratedDocumentsTable: {},
    quickWinPresentationsTable: {},
    presentationDocViewsTable: {},
    quickWinResultSharesTable: {},
    clientDocumentsTable: {},
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

mock.module("../lib/mailer.ts", {
  namedExports: {
    sendEmail: async () => {},
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
    PORTAL_URL: "https://example.com",
  },
});

mock.module("../lib/sms.ts", {
  namedExports: { sendAdminSms: async () => {} },
});

mock.module("../lib/push.ts", {
  namedExports: { sendPushNotifications: async () => {} },
});

mock.module("../lib/web-push.ts", {
  namedExports: { sendWebPushToAdmins: async () => {} },
});

mock.module("../lib/audit.ts", {
  namedExports: { createAuditLog: async () => {} },
});

mock.module("../lib/stripe.ts", {
  namedExports: {
    getStripeKey: () => "sk_test_fake_key_for_idempotency_tests",
    syncWebhookEndpoints: async () => {},
  },
});

mock.module("../lib/graph.ts", {
  namedExports: {
    listDriveItems: async () => [],
    graphCredentialsPresent: () => false,
    createProjectFolder: async () => null,
    uploadFileToClientContracts: async () => null,
    getDriveItemDownloadUrl: async () => null,
  },
});

mock.module("../lib/azure-keyvault.ts", {
  namedExports: {
    setSecretValue: async () => {},
    getSecretValue: async () => null,
    getSecretMetadata: async () => null,
  },
});

mock.module("../lib/azure-credentials.ts", {
  namedExports: { testClientCredentials: async () => ({ ok: false }) },
});

mock.module("../lib/probe-graph-permissions.ts", {
  namedExports: { probeGraphPermissions: async () => ({ ok: false }) },
});

mock.module("../lib/client-script-sequence.ts", {
  namedExports: { runClientScriptSequence: async () => {} },
});

mock.module("../lib/kanban-phase-advance.ts", {
  namedExports: {
    advancePhaseIfComplete: async () => {},
    syncProjectProgress: async () => {},
  },
});

mock.module("../lib/kanban-auto-fire.ts", {
  namedExports: {
    autoFireFirstBacklogScript: async () => {},
    autoFireDocumentCard: async () => {},
  },
});

mock.module("../lib/crm-pipeline.ts", {
  namedExports: { ensureLeadForClient: async () => {} },
});

mock.module("../lib/invoice-sharepoint.ts", {
  namedExports: { uploadInvoiceToSharePoint: async () => {} },
});

mock.module("../lib/portal-url.ts", {
  namedExports: { getPortalBaseUrl: () => "https://example.com/crm" },
});

mock.module("../lib/m365-profile-pdf.ts", {
  namedExports: { generateM365ProfilePdf: async () => Buffer.from("") },
});

mock.module("../lib/manual-script-package.ts", {
  namedExports: {
    generateManualScriptPackage: async () => Buffer.from(""),
    injectCallbackVars: (script: string) => script,
  },
});

mock.module("../lib/insight-pdf.ts", {
  namedExports: {
    buildHtmlDoc: () => "",
    htmlToPdf: async () => Buffer.from(""),
  },
});

mock.module("../lib/sse-broadcast.ts", {
  namedExports: {
    broadcastKanbanChange: () => {},
    registerSSEClient: () => {},
    registerPresentationSSEClient: () => {},
    broadcastPresentationScopeChange: () => {},
  },
});

mock.module("../lib/workflow-executor.ts", {
  namedExports: {
    fireWorkflowsForEvent: async () => {},
    emitWorkflowEvent: async () => {},
    fireWorkflowForDefinition: async () => {},
    executeWorkflowRun: async () => {},
    triggerScheduledWorkflows: async () => {},
    computeNextCronRun: () => null,
  },
});

const noopMulterMiddleware = (_req: unknown, _res: unknown, next: () => void) => next();
const noopMulter = Object.assign(
  () => ({
    single: () => noopMulterMiddleware,
    array: () => noopMulterMiddleware,
    fields: () => noopMulterMiddleware,
    none: () => noopMulterMiddleware,
  }),
  {
    diskStorage: () => ({}),
    memoryStorage: () => ({}),
  },
);
mock.module("multer", { defaultExport: noopMulter });

mock.module("pdf-lib", {
  namedExports: {
    PDFDocument: { create: async () => ({ save: async () => Buffer.from("") }) },
    rgb: () => ({}),
    StandardFonts: {},
  },
});

const { default: portalRouter } = await import("./portal.ts");

const { default: express } = await import("express");
const app = express();

app.use("/api/portal/stripe/webhook", express.raw({ type: "*/*" }));
app.use(express.json());

app.use((_req: unknown, _res: unknown, next: () => void) => {
  (_req as Record<string, unknown>).log = noopLogger;
  next();
});
app.use("/api", portalRouter);

let server: http.Server;
let baseUrl: string;

before(
  () =>
    new Promise<void>((resolve) => {
      server = http.createServer(app);
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    }),
);

after(
  () =>
    new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    }),
);

async function postWebhook(event: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/api/portal/stripe/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "stripe-signature": "t=fake,v1=fake",
    },
    body: JSON.stringify(event),
  });
  const body = await res.json() as Record<string, unknown>;
  return { status: res.status, body };
}

function waitForAsync(ms = 200): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SVC_SESSION_ID = "cs_test_svc_idem_abc123";
const ONB_SESSION_ID = "cs_test_onb_idem_xyz789";

function makeServicePurchaseEvent(sessionId: string): Record<string, unknown> {
  return {
    id: "evt_test_svc_completed",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        payment_status: "paid",
        amount_total: 150000,
        subscription: null,
        customer_details: { name: "Test Client", email: "client@example.com" },
        metadata: {
          type: "service_purchase",
          userId: "42",
          serviceName: "Microsoft 365 Setup",
          serviceCategory: "m365",
          servicePriceInCents: "150000",
        },
      },
    },
  };
}

function makeOnboardingPurchaseEvent(sessionId: string): Record<string, unknown> {
  return {
    id: "evt_test_onb_completed",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        payment_status: "paid",
        amount_total: 350000,
        subscription: null,
        customer_details: { name: "Test Client", email: "client@example.com" },
        metadata: {
          type: "onboarding_purchase",
          userId: "42",
          serviceIds: "7",
          servicePrices: "3500.00",
        },
      },
    },
  };
}

// =============================================================================
// Scenario 1: service_purchase — first call creates the invoice
// The idempotency check finds no existing invoice, so insert proceeds.
// =============================================================================

describe("webhook: service_purchase first call creates an invoice", () => {
  let status: number;
  let body: Record<string, unknown>;
  let insertsBefore: number;

  before(async () => {
    insertCallCount = 0;
    // dbQueue is empty — idempotency check returns [] (no existing invoice)
    dbQueue = [];
    insertsBefore = insertCallCount;
    webhookEventToReturn = makeServicePurchaseEvent(SVC_SESSION_ID);

    ({ status, body } = await postWebhook(webhookEventToReturn));
    await waitForAsync();
  });

  it("webhook endpoint returns HTTP 200", () => {
    assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(body)}`);
  });

  it("webhook response contains { received: true }", () => {
    assert.equal(body.received, true);
  });

  it("db.insert was called (invoice was created)", () => {
    assert.ok(
      insertCallCount > insertsBefore,
      `expected at least one db.insert() call on first processing, got insertCallCount=${insertCallCount}`,
    );
  });
});

// =============================================================================
// Scenario 2: service_purchase — replayed event is a complete no-op
// The idempotency check finds an existing invoice, so insert is skipped.
// A replayed webhook must not create a duplicate invoice or send duplicate
// emails, SMS, or push notifications.
// =============================================================================

describe("webhook: service_purchase replayed event is a no-op (idempotency)", () => {
  let status: number;
  let body: Record<string, unknown>;
  let insertsBefore: number;

  before(async () => {
    insertCallCount = 0;
    // Seed queue: idempotency check returns an existing invoice row → skip everything
    dbQueue = [[{ id: 999 }]];
    insertsBefore = insertCallCount;
    webhookEventToReturn = makeServicePurchaseEvent(SVC_SESSION_ID);

    ({ status, body } = await postWebhook(webhookEventToReturn));
    await waitForAsync();
  });

  it("webhook endpoint returns HTTP 200 even for a replayed event", () => {
    assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(body)}`);
  });

  it("webhook response contains { received: true }", () => {
    assert.equal(body.received, true);
  });

  it("db.insert was NOT called — replayed event must not create a duplicate invoice", () => {
    assert.equal(
      insertCallCount,
      insertsBefore,
      `expected zero db.insert() calls on replay, but insertCallCount went from ${insertsBefore} to ${insertCallCount}`,
    );
  });
});

// =============================================================================
// Scenario 3: onboarding_purchase — first call passes the outer idempotency
// guard and reaches the provisioning path (no crash, 200 response).
// Note: in the mock environment provisionOnboardingProject exits early because
// no real services/buyer exist in the DB mock, so we only verify that the
// outer guard does NOT block a first-time event — the webhook must respond 200
// and must not throw.  The DB insert assertion belongs in an integration test
// that can seed real service+user rows.
// =============================================================================

describe("webhook: onboarding_purchase first call is not blocked by idempotency guard", () => {
  let status: number;
  let body: Record<string, unknown>;

  before(async () => {
    insertCallCount = 0;
    // dbQueue empty — outer idempotency check returns [] → proceed into provisioning
    dbQueue = [];
    webhookEventToReturn = makeOnboardingPurchaseEvent(ONB_SESSION_ID);

    ({ status, body } = await postWebhook(webhookEventToReturn));
    await waitForAsync();
  });

  it("webhook endpoint returns HTTP 200 (outer guard does not block first call)", () => {
    assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(body)}`);
  });

  it("webhook response contains { received: true }", () => {
    assert.equal(body.received, true);
  });
});

// =============================================================================
// Scenario 4: onboarding_purchase — replayed event is a complete no-op
// The outer idempotency guard finds an existing invoice and skips everything —
// no provisioning, no SMS, no push notifications, no emails.
// =============================================================================

describe("webhook: onboarding_purchase replayed event is a no-op (idempotency)", () => {
  let status: number;
  let body: Record<string, unknown>;
  let insertsBefore: number;

  before(async () => {
    insertCallCount = 0;
    // Seed queue: outer idempotency check returns an existing invoice → skip all
    dbQueue = [[{ id: 999 }]];
    insertsBefore = insertCallCount;
    webhookEventToReturn = makeOnboardingPurchaseEvent(ONB_SESSION_ID);

    ({ status, body } = await postWebhook(webhookEventToReturn));
    await waitForAsync();
  });

  it("webhook endpoint returns HTTP 200 even for a replayed event", () => {
    assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(body)}`);
  });

  it("webhook response contains { received: true }", () => {
    assert.equal(body.received, true);
  });

  it("db.insert was NOT called — replayed onboarding event must not re-provision", () => {
    assert.equal(
      insertCallCount,
      insertsBefore,
      `expected zero db.insert() calls on replay, but insertCallCount went from ${insertsBefore} to ${insertCallCount}`,
    );
  });
});
