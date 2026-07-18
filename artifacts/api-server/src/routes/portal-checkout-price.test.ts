/**
 * Tests for POST /portal/presentations/:id/checkout — Stripe charge price derivation.
 *
 * Verifies that the Stripe line-item unit_amount always reflects the LIVE SOW
 * phase prices rather than stale creation-time snapshots, and that stale stored
 * selections default to full price (all live phases), not zero.
 *
 * Approach:
 *  - mock.module() stubs @workspace/db, Stripe, and all side-effect modules so
 *    no real DB connections or network calls are opened.
 *  - The mock DB uses the same chainable thenable queue as portal-scope-sync.test.ts.
 *  - Stripe is stubbed: stripe.checkout.sessions.create() captures its arguments
 *    and returns a fake session URL — no real charges occur.
 *  - requireAuth is stubbed to call next() and req.user is injected via middleware.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */
import { describe, it, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ── JWT secret (must be set before portal.ts is imported) ─────────────────────
process.env.JWT_SECRET = "checkout-price-test-secret-xyz";

// ── Captured Stripe session-creation arguments ─────────────────────────────────
// Reset before each scenario's `before()` hook.
let capturedCreateArgs: Record<string, unknown> | null = null;

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

// ── Stripe mock — captures session.create args; returns a fake session ────────
// Must be registered BEFORE portal.ts is imported so the dynamic
// `await import("stripe")` inside the handler picks up this stub.
mock.module("stripe", {
  defaultExport: class MockStripe {
    constructor(_key: string) {}
    checkout = {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          capturedCreateArgs = params;
          return {
            id: "cs_test_checkout_price_abc",
            url: "https://checkout.stripe.com/pay/price-test",
          };
        },
      },
    };
    customers = {
      list: async () => ({ data: [] }),
      create: async () => ({ id: "cus_test_price_test" }),
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

// getStripeKey returns a fake key (does NOT throw) so the handler can proceed
// past the Stripe key check and reach stripe.checkout.sessions.create().
mock.module("../lib/stripe.ts", {
  namedExports: {
    getStripeKey: () => "sk_test_fake_key_for_checkout_price_tests",
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
    autoFireRunWorkflowCards: async () => {},
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

mock.module("../lib/sse-channels.ts", {
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

// ── Dynamically import the real portal router AFTER mocks are registered ───────
const { default: portalRouter } = await import("./portal.ts");

// ── Minimal Express app ────────────────────────────────────────────────────────
const { default: express } = await import("express");
const app = express();
app.use(express.json());

const CLIENT_USER_ID = 77;
app.use((_req: unknown, _res: unknown, next: () => void) => {
  (_req as Record<string, unknown>).log = noopLogger;
  (_req as Record<string, unknown>).user = { id: CLIENT_USER_ID };
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

// ── Canned data helpers ────────────────────────────────────────────────────────

const PRES_ID = 202;

function makePresRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PRES_ID,
    shareToken: "checkout-test-token",
    clientUserId: CLIENT_USER_ID,
    projectId: null,
    status: "pending",
    stripeSessionId: null,
    signatureData: null,
    signedAt: null,
    signerName: null,
    paymentPlan: null,
    documentsIncluded: [],
    sowPhases: [],
    selectedPhaseIds: [],
    totalPrice: "0",
    paymentSchedule: null,
    updatedAt: null,
    ...overrides,
  };
}

function makeSowDoc(
  pricingLines: Array<{ title: string; scope: string; priceUsd: number; notes: string }>,
): Record<string, unknown> {
  return {
    id: 10,
    title: "Statement of Work",
    category: "sow",
    docType: "sow",
    htmlContent: "<p>SOW</p>",
    sowPricingLines: pricingLines,
    sowTotalPrice: String(pricingLines.reduce((s, l) => s + l.priceUsd, 0)),
    createdAt: new Date(),
  };
}

// ── Request helper ─────────────────────────────────────────────────────────────

async function postCheckout(
  id: number,
  paymentPlan: "full" | "phased",
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/api/portal/presentations/${id}/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer fake-jwt" },
    body: JSON.stringify({ paymentPlan }),
  });
  const body = await res.json() as Record<string, unknown>;
  return { status: res.status, body };
}

// Helper to extract the unit_amount from captured Stripe args
function capturedUnitAmount(): number {
  const lineItems = capturedCreateArgs?.line_items as Array<{
    price_data: { unit_amount: number };
  }> | undefined;
  assert.ok(lineItems && lineItems.length > 0, "expected at least one Stripe line item");
  return lineItems[0].price_data.unit_amount;
}

// =============================================================================
// Scenario 1: All live SOW phases selected (default) — full payment
// unit_amount must equal the sum of ALL live phase prices × 100
// =============================================================================

describe("checkout price: all live phases selected — full payment unit_amount", () => {
  const livePricingLines = [
    { title: "Discovery", scope: "Requirements gathering", priceUsd: 10_000, notes: "" },
    { title: "Implementation", scope: "Core build", priceUsd: 25_000, notes: "" },
    { title: "Rollout", scope: "Go-live support", priceUsd: 5_000, notes: "" },
  ];
  const expectedTotal = 10_000 + 25_000 + 5_000; // 40_000

  let status: number;
  let body: Record<string, unknown>;

  before(async () => {
    capturedCreateArgs = null;
    const presRow = makePresRow({
      documentsIncluded: [10],
      sowPhases: [],
      selectedPhaseIds: [],      // no stored selection → defaults to all phases
      totalPrice: "0",
    });
    const sowDoc = makeSowDoc(livePricingLines);

    // DB queue:
    //  [0] quickWinPresentationsTable → presRow
    //  [1] insightsGeneratedDocumentsTable (deriveEffectiveSowData)
    //  [2] usersTable → [] (no user profile → no Stripe customer lookup)
    dbQueue = [[presRow], [sowDoc], []];
    ({ status, body } = await postCheckout(PRES_ID, "full"));
  });

  it("returns HTTP 200", () => {
    assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(body)}`);
  });

  it("responds with a Stripe checkout URL", () => {
    assert.ok(
      typeof body.url === "string" && body.url.startsWith("https://"),
      `expected a checkout URL, got ${JSON.stringify(body.url)}`,
    );
  });

  it("Stripe line-item unit_amount equals sum of all live phase prices × 100", () => {
    const unitAmount = capturedUnitAmount();
    assert.equal(
      unitAmount,
      expectedTotal * 100,
      `expected unit_amount ${expectedTotal * 100}, got ${unitAmount}`,
    );
  });

  it("Stripe metadata.totalPrice matches the live SOW total", () => {
    const meta = capturedCreateArgs?.metadata as Record<string, string> | undefined;
    assert.equal(
      meta?.totalPrice,
      String(expectedTotal),
      `expected metadata.totalPrice "${expectedTotal}", got "${meta?.totalPrice}"`,
    );
  });

  it("Stripe metadata.paymentPlan is 'full'", () => {
    const meta = capturedCreateArgs?.metadata as Record<string, string> | undefined;
    assert.equal(meta?.paymentPlan, "full");
  });
});

// =============================================================================
// Scenario 2: Valid stored selection (subset of live phases) — full payment
// unit_amount must equal the sum of only the SELECTED phase prices × 100
// =============================================================================

describe("checkout price: valid stored selection (subset) — only selected phases charged", () => {
  const livePricingLines = [
    { title: "Foundation", scope: "Identity setup", priceUsd: 6_000, notes: "" },
    { title: "Governance", scope: "Policy", priceUsd: 9_000, notes: "" },
    { title: "Migration", scope: "Mailbox migration", priceUsd: 12_000, notes: "" },
  ];

  // Client previously selected only sow-0 and sow-2 (skipping sow-1 at $9k)
  const storedSelectedIds = ["sow-0", "sow-2"];
  const expectedSelectedTotal = 6_000 + 12_000; // 18_000

  let status: number;
  let body: Record<string, unknown>;

  before(async () => {
    capturedCreateArgs = null;
    const presRow = makePresRow({
      documentsIncluded: [10],
      sowPhases: [],
      selectedPhaseIds: storedSelectedIds,
      totalPrice: "18000",
    });
    const sowDoc = makeSowDoc(livePricingLines);

    dbQueue = [[presRow], [sowDoc], []];
    ({ status, body } = await postCheckout(PRES_ID, "full"));
  });

  it("returns HTTP 200", () => {
    assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(body)}`);
  });

  it("Stripe unit_amount equals sum of sow-0 ($6k) + sow-2 ($12k) only × 100", () => {
    const unitAmount = capturedUnitAmount();
    assert.equal(
      unitAmount,
      expectedSelectedTotal * 100,
      `expected unit_amount ${expectedSelectedTotal * 100} (selected phases only), got ${unitAmount}`,
    );
  });

  it("Stripe unit_amount does NOT include the unselected sow-1 price ($9k)", () => {
    const unitAmount = capturedUnitAmount();
    assert.ok(
      unitAmount < (6_000 + 9_000 + 12_000) * 100,
      `unit_amount should not include sow-1's $9k; got ${unitAmount}`,
    );
  });

  it("Stripe metadata.totalPrice equals the selected subset total", () => {
    const meta = capturedCreateArgs?.metadata as Record<string, string> | undefined;
    assert.equal(meta?.totalPrice, String(expectedSelectedTotal));
  });
});

// =============================================================================
// Scenario 3: Stale stored selections (none exist in live SOW)
// Must default to ALL live phases selected → unit_amount = full live total × 100
// Must NOT be zero.
// =============================================================================

describe("checkout price: stale stored selections — defaults to full price, not zero", () => {
  const livePricingLines = [
    { title: "Quick Win Pack", scope: "Immediate wins", priceUsd: 4_500, notes: "" },
    { title: "Roadmap Build", scope: "12-month plan", priceUsd: 7_500, notes: "" },
  ];
  const fullLiveTotal = 4_500 + 7_500; // 12_000

  // These IDs don't exist in the live SOW — completely stale snapshot IDs
  const staleSelectedIds = ["old-phase-1", "old-phase-2", "old-phase-3"];

  let status: number;
  let body: Record<string, unknown>;

  before(async () => {
    capturedCreateArgs = null;
    const presRow = makePresRow({
      documentsIncluded: [10],
      sowPhases: [],
      selectedPhaseIds: staleSelectedIds,
      totalPrice: "3000",         // stale stored total — must NOT be used
    });
    const sowDoc = makeSowDoc(livePricingLines);

    dbQueue = [[presRow], [sowDoc], []];
    ({ status, body } = await postCheckout(PRES_ID, "full"));
  });

  it("returns HTTP 200 (stale selection does not cause a 400)", () => {
    assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(body)}`);
  });

  it("Stripe unit_amount is NOT zero", () => {
    const unitAmount = capturedUnitAmount();
    assert.ok(unitAmount > 0, `unit_amount must not be zero; got ${unitAmount}`);
  });

  it("Stripe unit_amount equals full live SOW total × 100 (all phases, not stale stored total)", () => {
    const unitAmount = capturedUnitAmount();
    assert.equal(
      unitAmount,
      fullLiveTotal * 100,
      `expected ${fullLiveTotal * 100} (all live phases), got ${unitAmount}; stale $3k stored total must not be used`,
    );
  });

  it("Stripe unit_amount is NOT the stale stored totalPrice ($3k)", () => {
    const unitAmount = capturedUnitAmount();
    assert.notEqual(
      unitAmount,
      3_000 * 100,
      "unit_amount must not equal the stale stored totalPrice ($3k × 100)",
    );
  });

  it("Stripe metadata.totalPrice reflects the live full total, not the stale stored total", () => {
    const meta = capturedCreateArgs?.metadata as Record<string, string> | undefined;
    assert.equal(
      meta?.totalPrice,
      String(fullLiveTotal),
      `expected metadata.totalPrice "${fullLiveTotal}", got "${meta?.totalPrice}"`,
    );
  });
});

// =============================================================================
// Scenario 4: Phased payment plan — unit_amount is 20% deposit of live total
// =============================================================================

describe("checkout price: phased payment — unit_amount equals 20% deposit of live total", () => {
  const livePricingLines = [
    { title: "Phase A", scope: "Scope A", priceUsd: 8_000, notes: "" },
    { title: "Phase B", scope: "Scope B", priceUsd: 12_000, notes: "" },
  ];
  const fullLiveTotal = 8_000 + 12_000; // 20_000
  const expectedDeposit = Math.round(fullLiveTotal * 0.2 * 100); // 400_000 cents = $4_000

  let status: number;
  let body: Record<string, unknown>;

  before(async () => {
    capturedCreateArgs = null;
    const presRow = makePresRow({
      documentsIncluded: [10],
      sowPhases: [],
      selectedPhaseIds: [],       // all phases selected by default
      totalPrice: "0",
    });
    const sowDoc = makeSowDoc(livePricingLines);

    dbQueue = [[presRow], [sowDoc], []];
    ({ status, body } = await postCheckout(PRES_ID, "phased"));
  });

  it("returns HTTP 200", () => {
    assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(body)}`);
  });

  it("Stripe unit_amount equals 20% of live total × 100 (deposit only)", () => {
    const unitAmount = capturedUnitAmount();
    assert.equal(
      unitAmount,
      expectedDeposit,
      `expected deposit unit_amount ${expectedDeposit} (20% of $${fullLiveTotal}), got ${unitAmount}`,
    );
  });

  it("Stripe unit_amount is less than the full live total × 100", () => {
    const unitAmount = capturedUnitAmount();
    assert.ok(
      unitAmount < fullLiveTotal * 100,
      `phased deposit should be less than full amount; got ${unitAmount} vs ${fullLiveTotal * 100}`,
    );
  });

  it("Stripe metadata.paymentPlan is 'phased'", () => {
    const meta = capturedCreateArgs?.metadata as Record<string, string> | undefined;
    assert.equal(meta?.paymentPlan, "phased");
  });

  it("Stripe metadata.totalPrice is the full live total (not just the deposit)", () => {
    const meta = capturedCreateArgs?.metadata as Record<string, string> | undefined;
    assert.equal(
      meta?.totalPrice,
      String(fullLiveTotal),
      `totalPrice in metadata should be the full engagement price, not the deposit`,
    );
  });
});

// =============================================================================
// Scenario 5: No SOW doc, no snapshot phases, totalPrice "0" → 400
// Ensures the guard against zero-price checkout works.
// =============================================================================

describe("checkout price: zero effective price returns 400 (no SOW, no snapshot)", () => {
  let status: number;
  let body: Record<string, unknown>;

  before(async () => {
    capturedCreateArgs = null;
    const presRow = makePresRow({
      documentsIncluded: [],    // no docs → no SOW pricing lookup
      sowPhases: [],            // no snapshot phases
      selectedPhaseIds: [],
      totalPrice: "0",          // stored total is also zero
    });

    // Only the presentation lookup; deriveEffectiveSowData skips the doc query
    // since documentsIncluded is empty → falls back to snapshot (empty) → total 0
    dbQueue = [[presRow]];
    ({ status, body } = await postCheckout(PRES_ID, "full"));
  });

  it("returns HTTP 400 when effective price is zero", () => {
    assert.equal(status, 400, `expected 400, got ${status}; body: ${JSON.stringify(body)}`);
  });

  it("error message indicates invalid price", () => {
    assert.ok(
      typeof body.error === "string" && body.error.toLowerCase().includes("price"),
      `expected price-related error, got "${body.error}"`,
    );
  });

  it("Stripe session.create was NOT called for zero-price checkout", () => {
    assert.equal(
      capturedCreateArgs,
      null,
      "Stripe should not be called when the price is zero",
    );
  });
});
