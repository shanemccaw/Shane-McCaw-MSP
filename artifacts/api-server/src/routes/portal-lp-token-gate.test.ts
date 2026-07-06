/**
 * Tests for the LP-only service purchase gate in POST /api/portal/checkout/create-session.
 *
 * The gate sits in portal.ts: for any service whose visibility is "landing_page_only",
 * the request MUST supply a valid, unexpired, service-scoped HMAC-SHA256 token in the
 * `lpToken` field.  A missing, tampered, or expired token returns HTTP 403.
 *
 * These tests verify that the gate cannot be bypassed:
 *   1. No lpToken            → 403 (gate blocks request)
 *   2. Valid lpToken          → NOT 403 (gate passes; request proceeds to Stripe — mocked
 *                               to throw → 503 — proving the gate was cleared)
 *   3. Expired lpToken        → 403 (gate rejects expired tokens)
 *   4. Tampered lpToken       → 403 (gate rejects bad HMAC signatures)
 *   5. Wrong-service lpToken  → 403 (token for a different serviceId is rejected)
 *
 * Approach:
 *  - mock.module() stubs @workspace/db and every lib dependency so no real network
 *    or DB connections are opened.
 *  - The mock DB returns canned contract + service rows via a response queue.
 *  - JWT_SECRET is injected via process.env so token generation/validation uses
 *    the same secret the production code reads.
 *  - The real router from portal.ts is mounted in a lightweight Express server.
 *  - getStripeKey() is stubbed to throw after the LP gate — any 503 means the
 *    gate was cleared, any 403 means the gate fired.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */
import { describe, it, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";

// ── Test JWT secret ───────────────────────────────────────────────────────────
// Must be set before portal.ts is imported (it reads process.env.JWT_SECRET at
// runtime, so any value works — we just need it consistent across generate + verify).
const TEST_JWT_SECRET = "lp-gate-test-secret-abc123";
process.env.JWT_SECRET = TEST_JWT_SECRET;

// ── Token helpers (mirror the production logic in admin-marketing.ts) ─────────

function makeToken(serviceId: number, expOffsetMs: number): string {
  const exp = Date.now() + expOffsetMs;
  const payload = Buffer.from(JSON.stringify({ serviceId, exp })).toString("base64url");
  const sig = crypto.createHmac("sha256", TEST_JWT_SECRET).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

/** A token valid for 60 seconds for the given serviceId. */
function validToken(serviceId: number): string {
  return makeToken(serviceId, 60_000);
}

/** A token that expired 1 second ago. */
function expiredToken(serviceId: number): string {
  return makeToken(serviceId, -1_000);
}

/** A token with a correct-looking structure but whose HMAC is wrong. */
function tamperedToken(serviceId: number): string {
  const exp = Date.now() + 60_000;
  const payload = Buffer.from(JSON.stringify({ serviceId, exp })).toString("base64url");
  const fakeSig = "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";
  return `${payload}.${fakeSig}`;
}

// ── Canned DB rows ────────────────────────────────────────────────────────────
const LP_SERVICE_ID = 42;

const fakeContract = {
  id: 7,
  serviceId: LP_SERVICE_ID,
  userId: null,
  guestEmail: "buyer@example.com",
  finalPrice: null,
  status: "pending",
};

const fakeService = {
  id: LP_SERVICE_ID,
  name: "LP-Only Service",
  price: "750",
  visibility: "landing_page_only",
};

// ── DB response queue ─────────────────────────────────────────────────────────
// The checkout handler makes exactly 2 db.select() calls (per service):
//   [0] contractsTable WHERE (id = ? AND guestEmail = ?) → [fakeContract]
//   [1] servicesTable  WHERE id = ANY(...)               → [fakeService]
let dbSelectQueue: unknown[][] = [];

function makeMockDb() {
  return {
    select: (_cols?: unknown) => ({
      from: (_table: unknown) => ({
        where: async (_condition: unknown) => {
          return dbSelectQueue.shift() ?? [];
        },
      }),
    }),
    insert: () => ({ values: async () => [] }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
    delete: () => ({ where: async () => [] }),
  };
}

// ── Prime the queue before each request ──────────────────────────────────────
function primeQueue() {
  dbSelectQueue = [[fakeContract], [fakeService]];
}

// ── Register all mocks BEFORE portal.ts is dynamically imported ───────────────

// All table exports from @workspace/db are used as opaque references by Drizzle;
// mocked as empty objects since our stub db ignores the table argument entirely.
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
    workflowTemplatesTable: {},
    serviceScriptSetsTable: {},
    clientCallbackTokensTable: {},
    insightsGeneratedDocumentsTable: {},
    quickWinPresentationsTable: {},
    presentationDocViewsTable: {},
    quickWinResultSharesTable: {},
    clientDocumentsTable: {},
  },
});

// NOTE: mock specifiers must match the exact import strings in portal.ts.
// portal.ts uses .ts extensions on all relative imports so mocks must too.

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

// Stripe helper: throw so any request that clears the LP gate returns 503.
// If the LP gate fires instead, the response is 403. This makes the status
// code a reliable indicator of whether the gate was bypassed.
mock.module("../lib/stripe.ts", {
  namedExports: {
    getStripeKey: () => { throw new Error("Stripe not configured in tests"); },
    processStripeEvent: async () => {},
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

mock.module("../lib/client-script-sequence.ts", {
  namedExports: { runClientScriptSequence: async () => {} },
});

mock.module("../lib/invoice-sharepoint.ts", {
  namedExports: { uploadInvoiceToSharePoint: async () => {} },
});

mock.module("../lib/portal-url.ts", {
  namedExports: { getPortalBaseUrl: () => "https://example.com" },
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

mock.module("../lib/probe-graph-permissions.ts", {
  namedExports: { probeGraphPermissions: async () => ({ ok: false }) },
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
    autoFireRunWorkflowCards: async () => {},
  },
});

mock.module("../lib/crm-pipeline.ts", {
  namedExports: { ensureLeadForClient: async () => {} },
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

mock.module("../lib/azure-automation.ts", {
  namedExports: { isAzureConfigured: () => false },
});

mock.module("../lib/sow-pricing.ts", {
  namedExports: {
    stripStagedForReviewBanner: (h: string) => h,
    stripTierDetectionText: (h: string) => h,
    extractAiHtml: (h: string) => h,
    nextBusinessMonday: () => new Date(),
    WORKSTREAM_ADJ_MAP: {},
  },
});

// multer stub: must expose diskStorage() (called at module load) and return
// a no-op middleware factory so route registration doesn't crash.
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
mock.module("multer", {
  defaultExport: noopMulter,
});

// pdf-lib stub (used by invoice/contract PDF generation, not by checkout)
mock.module("pdf-lib", {
  namedExports: {
    PDFDocument: { create: async () => ({ save: async () => Buffer.from("") }) },
    rgb: () => ({}),
    StandardFonts: {},
  },
});

// ── Dynamically import the REAL portal router AFTER mocks are registered ──────
const { default: portalRouter } = await import("./portal.ts");

// ── Build a minimal Express app around the real router ────────────────────────
const { default: express } = await import("express");
const app = express();
app.use(express.json());

// Attach a minimal logger stub to every request (portal.ts calls req.log)
app.use((_req: unknown, _res: unknown, next: () => void) => {
  ((_req as Record<string, unknown>).log = noopLogger);
  next();
});

app.use("/api", portalRouter);

// ── Start / stop test HTTP server ────────────────────────────────────────────
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

// ── Request helper ────────────────────────────────────────────────────────────

async function postCheckout(body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  primeQueue();
  const res = await fetch(`${baseUrl}/api/portal/checkout/create-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json() as Record<string, unknown>;
  return { status: res.status, json };
}

// Base request body shared by all test cases — one LP-only service + matching contract
const baseBody = {
  serviceIds: [LP_SERVICE_ID],
  contractIds: [fakeContract.id],
  guestEmail: fakeContract.guestEmail,
};

// ─────────────────────────────────────────────────────────────────────────────

describe("LP token gate — POST /api/portal/checkout/create-session", () => {
  describe("no lpToken → 403", () => {
    let status: number;
    let json: Record<string, unknown>;

    before(async () => {
      ({ status, json } = await postCheckout(baseBody));
    });

    it("returns HTTP 403", () => {
      assert.equal(status, 403, `expected 403, got ${status}; body: ${JSON.stringify(json)}`);
    });

    it("error message references landing page", () => {
      assert.ok(
        typeof json.error === "string" && json.error.toLowerCase().includes("landing page"),
        `expected error mentioning "landing page", got: ${JSON.stringify(json.error)}`,
      );
    });
  });

  describe("valid lpToken → gate clears (Stripe stub returns 503)", () => {
    let status: number;
    let json: Record<string, unknown>;

    before(async () => {
      ({ status, json } = await postCheckout({ ...baseBody, lpToken: validToken(LP_SERVICE_ID) }));
    });

    it("does NOT return 403 (gate was not triggered)", () => {
      assert.notEqual(status, 403, `got 403 — gate fired unexpectedly; body: ${JSON.stringify(json)}`);
    });

    it("returns 503 (Stripe stub threw, proving LP gate was cleared)", () => {
      assert.equal(status, 503, `expected 503 (Stripe stub), got ${status}; body: ${JSON.stringify(json)}`);
    });
  });

  describe("expired lpToken → 403", () => {
    let status: number;
    let json: Record<string, unknown>;

    before(async () => {
      ({ status, json } = await postCheckout({ ...baseBody, lpToken: expiredToken(LP_SERVICE_ID) }));
    });

    it("returns HTTP 403", () => {
      assert.equal(status, 403, `expected 403, got ${status}; body: ${JSON.stringify(json)}`);
    });

    it("error message indicates token is invalid or expired", () => {
      assert.ok(
        typeof json.error === "string" &&
          (json.error.toLowerCase().includes("invalid") || json.error.toLowerCase().includes("expired")),
        `expected error mentioning "invalid" or "expired", got: ${JSON.stringify(json.error)}`,
      );
    });
  });

  describe("tampered lpToken (bad HMAC) → 403", () => {
    let status: number;
    let json: Record<string, unknown>;

    before(async () => {
      ({ status, json } = await postCheckout({ ...baseBody, lpToken: tamperedToken(LP_SERVICE_ID) }));
    });

    it("returns HTTP 403", () => {
      assert.equal(status, 403, `expected 403, got ${status}; body: ${JSON.stringify(json)}`);
    });

    it("error message indicates token is invalid", () => {
      assert.ok(
        typeof json.error === "string" && json.error.toLowerCase().includes("invalid"),
        `expected error mentioning "invalid", got: ${JSON.stringify(json.error)}`,
      );
    });
  });

  describe("lpToken for a different serviceId → 403", () => {
    let status: number;
    let json: Record<string, unknown>;

    before(async () => {
      // Token signed correctly but for service 999, not LP_SERVICE_ID (42)
      ({ status, json } = await postCheckout({ ...baseBody, lpToken: validToken(999) }));
    });

    it("returns HTTP 403", () => {
      assert.equal(status, 403, `expected 403, got ${status}; body: ${JSON.stringify(json)}`);
    });

    it("error message indicates token is invalid", () => {
      assert.ok(
        typeof json.error === "string" && json.error.toLowerCase().includes("invalid"),
        `expected error mentioning "invalid", got: ${JSON.stringify(json.error)}`,
      );
    });
  });
});
