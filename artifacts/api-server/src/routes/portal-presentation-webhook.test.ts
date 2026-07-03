/**
 * Tests for the Stripe webhook failure path — checkout.session.expired
 * for presentation_checkout sessions.
 *
 * Verifies that when Stripe reports a session expiry the presentation row
 * has its stripeSessionId cleared and its status reset to 'pending', so it
 * is never stuck in a "pending payment" limbo.
 *
 * Approach:
 *  - mock.module() stubs @workspace/db, Stripe (including webhooks.constructEvent),
 *    and all side-effect modules so no real DB connections or network calls open.
 *  - A module-level `webhookEventToReturn` variable lets each test control what
 *    constructEvent() returns (bypassing signature validation entirely).
 *  - A module-level `capturedUpdateSet` variable captures the values passed to
 *    db.update().set() so assertions can verify the rollback values.
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

// ── JWT secret (must be set before portal.ts is imported) ─────────────────────
process.env.JWT_SECRET = "presentation-webhook-test-secret-xyz";

// ── Stripe webhook secret — must be non-empty so handler does not return 503 ──
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_fake_webhook_secret";

// ── Shared mutable state — set in each test's before() hook ──────────────────
// The Stripe mock reads webhookEventToReturn from here; the DB mock writes to capturedUpdateSet.
let webhookEventToReturn: unknown = null;
let capturedUpdateSet: Record<string, unknown> | null = null;

// ── Queue-based mock DB (same pattern as portal-checkout-price.test.ts) ───────
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
    update: (_table: unknown) => ({
      set: (vals: Record<string, unknown>) => {
        capturedUpdateSet = vals;
        return { where: async () => [] };
      },
    }),
    delete: () => ({ where: async () => [] }),
    execute: async () => ({ rows: [] }),
  };
}

// ── Stripe mock — bypasses signature verification, returns webhookEventToReturn ─
mock.module("stripe", {
  defaultExport: class MockStripe {
    constructor(_key: string) {}
    webhooks = {
      constructEvent: (_body: unknown, _sig: unknown, _secret: unknown) => webhookEventToReturn,
    };
    checkout = {
      sessions: {
        create: async () => ({ id: "cs_test_webhook_abc", url: "https://checkout.stripe.com/pay/test" }),
        retrieve: async () => ({ payment_status: "unpaid" }),
      },
    };
    customers = {
      list: async () => ({ data: [] }),
      create: async () => ({ id: "cus_test_webhook" }),
    };
  },
});

// ── Register all remaining mocks BEFORE portal.ts is imported ─────────────────
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
    getStripeKey: () => "sk_test_fake_key_for_webhook_tests",
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

// ── Dynamically import the real portal router AFTER mocks are registered ───────
const { default: portalRouter } = await import("./portal.ts");

// ── Minimal Express app ────────────────────────────────────────────────────────
const { default: express } = await import("express");
const app = express();

// Raw body parser for the webhook path (mirrors app.ts setup)
app.use("/api/portal/stripe/webhook", express.raw({ type: "*/*" }));
app.use(express.json());

app.use((_req: unknown, _res: unknown, next: () => void) => {
  (_req as Record<string, unknown>).log = noopLogger;
  next();
});
app.use("/api", portalRouter);

// ── HTTP server lifecycle ──────────────────────────────────────────────────────
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

// ── Helpers ───────────────────────────────────────────────────────────────────

const PRESENTATION_ID = 99;
const SESSION_ID = "cs_test_expired_session_abc123";

function makeExpiredSessionEvent(
  presentationId: number,
  sessionId: string,
): Record<string, unknown> {
  return {
    id: "evt_test_expired",
    type: "checkout.session.expired",
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        payment_status: "unpaid",
        metadata: {
          type: "presentation_checkout",
          presentationId: String(presentationId),
          userId: "77",
          paymentPlan: "full",
          totalPrice: "40000",
        },
      },
    },
  };
}

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

function waitForAsync(ms = 150): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Scenario 1: checkout.session.expired for presentation_checkout
// presentation stripeSessionId must be cleared and status reset to 'pending'
// =============================================================================

describe("webhook: checkout.session.expired clears presentation stripeSessionId", () => {
  let status: number;
  let body: Record<string, unknown>;

  before(async () => {
    capturedUpdateSet = null;
    dbQueue = [];
    webhookEventToReturn = makeExpiredSessionEvent(PRESENTATION_ID, SESSION_ID);

    ({ status, body } = await postWebhook(webhookEventToReturn));
    // Wait for setImmediate-deferred processStripeEvent to complete
    await waitForAsync();
  });

  it("webhook endpoint returns HTTP 200", () => {
    assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(body)}`);
  });

  it("webhook response contains { received: true }", () => {
    assert.equal(
      body.received,
      true,
      `expected body.received to be true, got ${JSON.stringify(body)}`,
    );
  });

  it("db.update was called (presentation row was written)", () => {
    assert.notEqual(
      capturedUpdateSet,
      null,
      "expected db.update().set() to be called but it was not",
    );
  });

  it("stripeSessionId is set to null in the update", () => {
    assert.equal(
      (capturedUpdateSet as Record<string, unknown> | null)?.stripeSessionId,
      null,
      `expected stripeSessionId to be cleared (null), got ${JSON.stringify(capturedUpdateSet?.stripeSessionId)}`,
    );
  });

  it("status is reset to 'draft' in the update", () => {
    assert.equal(
      (capturedUpdateSet as Record<string, unknown> | null)?.status,
      "draft",
      `expected status to be 'draft', got ${JSON.stringify(capturedUpdateSet?.status)}`,
    );
  });
});

// =============================================================================
// Scenario 2: checkout.session.expired for a different session type (e.g. service_purchase)
// The presentation table must NOT be updated — it's not a presentation checkout
// =============================================================================

describe("webhook: checkout.session.expired for non-presentation session is ignored", () => {
  before(async () => {
    capturedUpdateSet = null;
    dbQueue = [];
    webhookEventToReturn = {
      id: "evt_test_expired_service",
      type: "checkout.session.expired",
      data: {
        object: {
          id: "cs_test_service_expired",
          object: "checkout.session",
          payment_status: "unpaid",
          metadata: {
            type: "service_purchase",
            userId: "77",
            serviceName: "Microsoft 365 Setup",
            serviceCategory: "m365",
            servicePriceInCents: "250000",
          },
        },
      },
    };

    await postWebhook(webhookEventToReturn);
    await waitForAsync();
  });

  it("db.update was NOT called for a non-presentation expired session", () => {
    assert.equal(
      capturedUpdateSet,
      null,
      `expected no DB update for non-presentation session, but got: ${JSON.stringify(capturedUpdateSet)}`,
    );
  });
});

// =============================================================================
// Scenario 3: checkout.session.expired with missing presentationId in metadata
// Should be handled gracefully — no DB update, no crash
// =============================================================================

describe("webhook: checkout.session.expired with missing presentationId is handled safely", () => {
  before(async () => {
    capturedUpdateSet = null;
    dbQueue = [];
    webhookEventToReturn = {
      id: "evt_test_expired_no_id",
      type: "checkout.session.expired",
      data: {
        object: {
          id: "cs_test_no_pres_id",
          object: "checkout.session",
          payment_status: "unpaid",
          metadata: {
            type: "presentation_checkout",
            // presentationId intentionally omitted
            userId: "77",
          },
        },
      },
    };

    await postWebhook(webhookEventToReturn);
    await waitForAsync();
  });

  it("webhook returns 200 even when presentationId is missing", async () => {
    const { status } = await postWebhook(webhookEventToReturn);
    assert.equal(status, 200);
  });

  it("db.update was NOT called when presentationId is missing", () => {
    assert.equal(
      capturedUpdateSet,
      null,
      `expected no DB update when presentationId is absent, got: ${JSON.stringify(capturedUpdateSet)}`,
    );
  });
});
