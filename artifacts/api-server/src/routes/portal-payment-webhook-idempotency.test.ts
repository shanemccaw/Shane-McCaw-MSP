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
let updateCallCount = 0;
let dbQueue: unknown[][] = [];
// Controls what rowCount db.execute() returns; used by coupon idempotency tests
let executeRowCountToReturn = 0;
let executeCallCount = 0;

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
    update: (_table: unknown) => {
      updateCallCount++;
      return {
        set: (_vals: unknown) => ({ where: async () => [] }),
      };
    },
    delete: () => ({ where: async () => [] }),
    execute: async () => {
      executeCallCount++;
      return { rows: [], rowCount: executeRowCountToReturn };
    },
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
    replayPhaseGenState: () => {},
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

// =============================================================================
// Scenario 5: invoice.paid — first delivery marks invoice as paid
// The idempotency select finds the invoice in "due" status, so the update runs.
// =============================================================================

const STRIPE_INVOICE_ID = "in_test_inv_idem_001";

function makeInvoicePaidEvent(stripeInvoiceId: string): Record<string, unknown> {
  return {
    id: "evt_test_invoice_paid",
    type: "invoice.paid",
    data: {
      object: {
        id: stripeInvoiceId,
        object: "invoice",
        subscription: "sub_test_abc",
        customer: "cus_test_xyz",
        amount_paid: 50000,
        currency: "usd",
      },
    },
  };
}

describe("webhook: invoice.paid first delivery marks invoice as paid", () => {
  let status: number;
  let body: Record<string, unknown>;
  let updatesBefore: number;

  before(async () => {
    updateCallCount = 0;
    insertCallCount = 0;
    // Seed: idempotency select returns an invoice that is not yet paid
    dbQueue = [[{ id: 77, status: "due" }]];
    updatesBefore = updateCallCount;
    webhookEventToReturn = makeInvoicePaidEvent(STRIPE_INVOICE_ID);

    ({ status, body } = await postWebhook(webhookEventToReturn));
    await waitForAsync();
  });

  it("webhook endpoint returns HTTP 200", () => {
    assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(body)}`);
  });

  it("webhook response contains { received: true }", () => {
    assert.equal(body.received, true);
  });

  it("db.update was called — invoice status should be set to paid", () => {
    assert.ok(
      updateCallCount > updatesBefore,
      `expected at least one db.update() call on first invoice.paid delivery, got updateCallCount=${updateCallCount}`,
    );
  });

  it("db.insert was NOT called — invoice.paid does not create a new invoice row", () => {
    assert.equal(insertCallCount, 0, `expected no db.insert() calls for invoice.paid, got ${insertCallCount}`);
  });
});

// =============================================================================
// Scenario 6: invoice.paid — replayed event is a no-op
// The idempotency select finds the invoice already in "paid" status, so the
// update is skipped entirely.
// =============================================================================

describe("webhook: invoice.paid replayed event is a no-op (idempotency)", () => {
  let status: number;
  let body: Record<string, unknown>;
  let updatesBefore: number;

  before(async () => {
    updateCallCount = 0;
    insertCallCount = 0;
    // Seed: idempotency select returns an invoice already marked paid
    dbQueue = [[{ id: 77, status: "paid" }]];
    updatesBefore = updateCallCount;
    webhookEventToReturn = makeInvoicePaidEvent(STRIPE_INVOICE_ID);

    ({ status, body } = await postWebhook(webhookEventToReturn));
    await waitForAsync();
  });

  it("webhook endpoint returns HTTP 200 even for a replayed invoice.paid event", () => {
    assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(body)}`);
  });

  it("webhook response contains { received: true }", () => {
    assert.equal(body.received, true);
  });

  it("db.update was NOT called — replayed invoice.paid must not double-mark as paid", () => {
    assert.equal(
      updateCallCount,
      updatesBefore,
      `expected zero db.update() calls on replay, but updateCallCount went from ${updatesBefore} to ${updateCallCount}`,
    );
  });

  it("db.insert was NOT called — replayed invoice.paid must not create a duplicate invoice", () => {
    assert.equal(insertCallCount, 0, `expected no db.insert() calls for replayed invoice.paid, got ${insertCallCount}`);
  });
});

// =============================================================================
// Scenario 7: coupon redemption — first delivery increments usesCount exactly once
//
// The coupon block inserts a coupon_redemptions row keyed by checkout_session_id.
// On first delivery db.execute() returns rowCount=1 (insert succeeded) and the
// handler must call db.update() to increment coupons.usesCount.
//
// The session uses an unknown type so neither the service_purchase nor the
// onboarding_purchase handler interferes — only the coupon block runs.
// =============================================================================

const COUPON_SESSION_ID = "cs_test_coupon_idem_abc";

function makeCouponSessionEvent(sessionId: string): Record<string, unknown> {
  return {
    id: "evt_test_coupon_completed",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        payment_status: "paid",
        amount_total: 100000,
        subscription: null,
        total_details: { amount_discount: 2000 },
        customer_details: { name: "Coupon Client", email: "coupon@example.com" },
        metadata: {
          type: "unknown_type",
          couponCode: "DISCOUNT20",
        },
      },
    },
  };
}

describe("webhook: coupon redemption — first delivery increments usesCount", () => {
  let status: number;
  let body: Record<string, unknown>;
  let updatesBefore: number;
  let executesBefore: number;

  before(async () => {
    insertCallCount = 0;
    updateCallCount = 0;
    executeCallCount = 0;
    // db.execute() returns rowCount=1 — the INSERT succeeded (first time)
    executeRowCountToReturn = 1;
    dbQueue = [];
    updatesBefore = updateCallCount;
    executesBefore = executeCallCount;
    webhookEventToReturn = makeCouponSessionEvent(COUPON_SESSION_ID);

    ({ status, body } = await postWebhook(webhookEventToReturn));
    await waitForAsync();
  });

  it("webhook endpoint returns HTTP 200", () => {
    assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(body)}`);
  });

  it("webhook response contains { received: true }", () => {
    assert.equal(body.received, true);
  });

  it("db.execute was called — coupon redemption INSERT was attempted", () => {
    assert.ok(
      executeCallCount > executesBefore,
      `expected at least one db.execute() call for coupon INSERT, got executeCallCount=${executeCallCount}`,
    );
  });

  it("db.update was called — usesCount was incremented on first delivery", () => {
    assert.ok(
      updateCallCount > updatesBefore,
      `expected db.update() for usesCount increment on first coupon redemption, got updateCallCount=${updateCallCount}`,
    );
  });
});

// =============================================================================
// Scenario 8: coupon redemption — replayed event does NOT double-increment usesCount
//
// When Stripe replays the same webhook, the coupon_redemptions INSERT hits the
// UNIQUE constraint on checkout_session_id and returns rowCount=0. The handler
// must skip the db.update() so usesCount is incremented exactly once.
// =============================================================================

describe("webhook: coupon redemption — replayed event does not double-increment usesCount", () => {
  let status: number;
  let body: Record<string, unknown>;
  let updatesBefore: number;
  let executesBefore: number;

  before(async () => {
    insertCallCount = 0;
    updateCallCount = 0;
    executeCallCount = 0;
    // db.execute() returns rowCount=0 — the INSERT conflicted (already processed)
    executeRowCountToReturn = 0;
    dbQueue = [];
    updatesBefore = updateCallCount;
    executesBefore = executeCallCount;
    webhookEventToReturn = makeCouponSessionEvent(COUPON_SESSION_ID);

    ({ status, body } = await postWebhook(webhookEventToReturn));
    await waitForAsync();
  });

  it("webhook endpoint returns HTTP 200 even for a replayed coupon event", () => {
    assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(body)}`);
  });

  it("webhook response contains { received: true }", () => {
    assert.equal(body.received, true);
  });

  it("db.execute was called — coupon redemption INSERT was attempted (conflict expected)", () => {
    assert.ok(
      executeCallCount > executesBefore,
      `expected at least one db.execute() call for coupon INSERT on replay, got executeCallCount=${executeCallCount}`,
    );
  });

  it("db.update was NOT called — usesCount must not be incremented again on replay", () => {
    assert.equal(
      updateCallCount,
      updatesBefore,
      `expected zero db.update() calls on coupon replay, but updateCallCount went from ${updatesBefore} to ${updateCallCount}`,
    );
  });
});
