/**
 * Tests for PATCH /portal/presentations/:id/selections.
 *
 * The handler re-derives phase totals from the live SOW pricing each time a
 * client toggles phases, so a stale snapshot can never produce a wrong total
 * at checkout. These tests verify the two critical paths:
 *
 *   (A) Live SOW doc present — toggling a subset of phases returns a totalPrice
 *       that equals the sum of ONLY the selected phases' live prices.
 *
 *   (B) No SOW doc (fallback) — phase toggle still returns a totalPrice derived
 *       from the snapshot prices, not the stale stored totalPrice.
 *
 * Also verifies:
 *   (A2) IDs not in the live phase set are silently dropped (validation).
 *   (B2) Selecting all snapshot phases returns the correct snapshot total.
 *
 * Approach:
 *  - mock.module() stubs @workspace/db — no real DB connections.
 *  - A chainable queue mock lets each test scenario control DB responses.
 *  - requireAuth is stubbed to call next(); a custom express middleware
 *    injects req.user so the handler's `req.user!.id` check is satisfied.
 *  - db.update() is stubbed with a no-op so writes don't fail.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */
import { describe, it, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ── JWT secret (must be set before portal.ts is imported) ─────────────────────
process.env.JWT_SECRET = "scope-toggle-test-secret-xyz";

// ── Queue-based mock DB ───────────────────────────────────────────────────────
// Each db.select() call pops one entry. The returned object is a thenable that
// also exposes .from(), .where(), .limit(), and other chainable methods.
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

// ── Register all mocks BEFORE portal.ts is imported ───────────────────────────
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

// Inject req.user and req.log before every route — requireAuth is stubbed to
// call next() but does NOT set req.user; the handler needs req.user!.id.
const CLIENT_USER_ID = 7;
app.use((_req: unknown, _res: unknown, next: () => void) => {
  (_req as Record<string, unknown>).user = { id: CLIENT_USER_ID };
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

// ── Canned data ────────────────────────────────────────────────────────────────

const PRES_ID = 202;

function makePresRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PRES_ID,
    shareToken: "toggle-test-token",
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
    ...overrides,
  };
}

function makeSowDoc(
  pricingLines: Array<{ title: string; scope: string; priceUsd: number; notes: string }>,
): Record<string, unknown> {
  return {
    id: 1,
    title: "Statement of Work",
    category: "sow",
    docType: "sow",
    htmlContent: "<p>SOW content</p>",
    sowPricingLines: pricingLines,
    sowTotalPrice: String(pricingLines.reduce((s, l) => s + l.priceUsd, 0)),
    createdAt: new Date(),
  };
}

// ── Request helper ─────────────────────────────────────────────────────────────

type SelectionsResponse = { totalPrice: number; selectedPhaseIds: string[] };

async function patchSelections(
  presId: number,
  selectedPhaseIds: string[],
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/api/portal/presentations/${presId}/selections`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selectedPhaseIds }),
  });
  const body = await res.json() as Record<string, unknown>;
  return { status: res.status, body };
}

// =============================================================================
// Path (A): Live SOW doc — toggling a subset of phases computes correct total
// =============================================================================

describe("PATCH selections (A): live SOW — toggled subset gives correct total", () => {
  const livePricingLines = [
    { title: "Phase 1 — Discovery", scope: "Requirements", priceUsd: 10_000, notes: "" },
    { title: "Phase 2 — Implementation", scope: "Core build", priceUsd: 25_000, notes: "" },
    { title: "Phase 3 — Rollout", scope: "Go-live", priceUsd: 8_000, notes: "" },
  ];

  // Client selects only phases 0 and 2, skipping phase 1
  const requestedIds = ["sow-0", "sow-2"];
  const expectedTotal = 10_000 + 8_000;

  let status: number;
  let body: Record<string, unknown>;

  before(async () => {
    const presRow = makePresRow({
      documentsIncluded: [1],
      sowPhases: [],
      selectedPhaseIds: [],
      totalPrice: "43000",
    });
    const sowDoc = makeSowDoc(livePricingLines);

    // Queue:
    //  [0] quickWinPresentationsTable → presRow  (ownership check)
    //  [1] insightsGeneratedDocumentsTable        (deriveEffectiveSowData pricing lookup)
    dbQueue = [[presRow], [sowDoc]];
    ({ status, body } = await patchSelections(PRES_ID, requestedIds));
  });

  it("returns HTTP 200", () => {
    assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(body)}`);
  });

  it("selectedPhaseIds contains exactly the requested phase IDs", () => {
    const ids = body.selectedPhaseIds as string[];
    assert.deepEqual(
      [...ids].sort(),
      [...requestedIds].sort(),
      `expected ${JSON.stringify(requestedIds.sort())}, got ${JSON.stringify(ids)}`,
    );
  });

  it("totalPrice equals the sum of the live prices of the selected phases only", () => {
    assert.equal(
      body.totalPrice,
      expectedTotal,
      `expected totalPrice ${expectedTotal} (sow-0 $10k + sow-2 $8k), got ${body.totalPrice}`,
    );
  });

  it("omitted phase (sow-1, $25k) is NOT included in the total", () => {
    assert.notEqual(
      body.totalPrice,
      10_000 + 25_000 + 8_000,
      "full total should not appear — sow-1 was not selected",
    );
  });
});

// =============================================================================
// Path (A2): Invalid / unknown phase IDs are silently dropped
// =============================================================================

describe("PATCH selections (A2): live SOW — invalid phase IDs are silently dropped", () => {
  const livePricingLines = [
    { title: "Foundation", scope: "Identity setup", priceUsd: 6_000, notes: "" },
    { title: "Governance", scope: "Policy", priceUsd: 9_000, notes: "" },
  ];

  // Mix of a valid id and an unknown id that is not in the live phase set
  const requestedIds = ["sow-0", "unknown-phase-999"];
  const expectedTotal = 6_000; // only sow-0 survives validation

  let status: number;
  let body: Record<string, unknown>;

  before(async () => {
    const presRow = makePresRow({
      documentsIncluded: [1],
      sowPhases: [],
      selectedPhaseIds: [],
      totalPrice: "0",
    });
    const sowDoc = makeSowDoc(livePricingLines);

    dbQueue = [[presRow], [sowDoc]];
    ({ status, body } = await patchSelections(PRES_ID, requestedIds));
  });

  it("returns HTTP 200", () => {
    assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(body)}`);
  });

  it("unknown phase ID is not present in the returned selectedPhaseIds", () => {
    const ids = body.selectedPhaseIds as string[];
    assert.ok(
      !ids.includes("unknown-phase-999"),
      `unknown phase should have been dropped; got selectedPhaseIds: ${JSON.stringify(ids)}`,
    );
  });

  it("valid phase ID sow-0 is retained", () => {
    const ids = body.selectedPhaseIds as string[];
    assert.ok(ids.includes("sow-0"), `sow-0 should be retained; got ${JSON.stringify(ids)}`);
  });

  it("totalPrice only reflects the valid selected phase (sow-0 = $6k)", () => {
    assert.equal(
      body.totalPrice,
      expectedTotal,
      `expected totalPrice ${expectedTotal}, got ${body.totalPrice}`,
    );
  });
});

// =============================================================================
// Path (B): No SOW doc — fallback to snapshot, total derived from snapshot prices
// =============================================================================

describe("PATCH selections (B): no SOW doc — total derived from snapshot phase prices", () => {
  const snapshotPhases = [
    { id: "snap-0", title: "Phase A", description: "Kick-off", price: 4_000, selected: true },
    { id: "snap-1", title: "Phase B", description: "Delivery", price: 11_000, selected: true },
    { id: "snap-2", title: "Phase C", description: "Closure", price: 5_000, selected: true },
  ];

  // Client selects phases 0 and 2 — skipping snap-1
  const requestedIds = ["snap-0", "snap-2"];
  const expectedTotal = 4_000 + 5_000;

  let status: number;
  let body: Record<string, unknown>;

  before(async () => {
    // No documents included → deriveEffectiveSowData skips the DB query and
    // falls back to the sowPhases snapshot stored on the presentation row.
    const presRow = makePresRow({
      documentsIncluded: [],
      sowPhases: snapshotPhases,
      selectedPhaseIds: ["snap-0", "snap-1", "snap-2"],
      totalPrice: "20000",
    });

    // Only one DB read needed (quickWinPresentationsTable); no doc query.
    dbQueue = [[presRow]];
    ({ status, body } = await patchSelections(PRES_ID, requestedIds));
  });

  it("returns HTTP 200", () => {
    assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(body)}`);
  });

  it("selectedPhaseIds reflects only the requested snapshot phases", () => {
    const ids = body.selectedPhaseIds as string[];
    assert.deepEqual(
      [...ids].sort(),
      [...requestedIds].sort(),
      `expected ${JSON.stringify(requestedIds.sort())}, got ${JSON.stringify(ids)}`,
    );
  });

  it("totalPrice equals the snapshot prices of the selected phases only ($4k + $5k)", () => {
    assert.equal(
      body.totalPrice,
      expectedTotal,
      `expected totalPrice ${expectedTotal}, got ${body.totalPrice}`,
    );
  });

  it("totalPrice does NOT equal the stale stored totalPrice ($20k)", () => {
    assert.notEqual(
      body.totalPrice,
      20_000,
      "stale stored totalPrice should have been replaced by a freshly computed value",
    );
  });

  it("omitted snapshot phase (snap-1, $11k) is not included in the total", () => {
    const ids = body.selectedPhaseIds as string[];
    assert.ok(!ids.includes("snap-1"), `snap-1 should not be in selectedPhaseIds; got ${JSON.stringify(ids)}`);
  });
});

// =============================================================================
// Path (B2): No SOW doc — selecting ALL snapshot phases gives the full total
// =============================================================================

describe("PATCH selections (B2): no SOW doc — all snapshot phases selected gives full total", () => {
  const snapshotPhases = [
    { id: "snap-0", title: "Phase A", description: "Kick-off", price: 3_500, selected: true },
    { id: "snap-1", title: "Phase B", description: "Delivery", price: 8_500, selected: true },
  ];

  const requestedIds = ["snap-0", "snap-1"];
  const expectedTotal = 3_500 + 8_500;

  let status: number;
  let body: Record<string, unknown>;

  before(async () => {
    const presRow = makePresRow({
      documentsIncluded: [],
      sowPhases: snapshotPhases,
      selectedPhaseIds: [],
      totalPrice: "99999", // Intentionally wrong stored total — should be ignored
    });

    dbQueue = [[presRow]];
    ({ status, body } = await patchSelections(PRES_ID, requestedIds));
  });

  it("returns HTTP 200", () => {
    assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(body)}`);
  });

  it("both snapshot phases are in selectedPhaseIds", () => {
    const ids = body.selectedPhaseIds as string[];
    assert.deepEqual(
      [...ids].sort(),
      ["snap-0", "snap-1"],
      `expected both snapshot IDs, got ${JSON.stringify(ids)}`,
    );
  });

  it("totalPrice equals the sum of ALL snapshot phase prices ($3.5k + $8.5k)", () => {
    assert.equal(
      body.totalPrice,
      expectedTotal,
      `expected totalPrice ${expectedTotal}, got ${body.totalPrice}`,
    );
  });

  it("stale stored totalPrice ($99999) is NOT returned", () => {
    assert.notEqual(
      body.totalPrice,
      99_999,
      "the handler must compute a fresh total, not echo the stored one",
    );
  });
});

// =============================================================================
// Path (A3): Live SOW — empty selectedPhaseIds falls back to all phases (never zeros total)
// =============================================================================

describe("PATCH selections (A3): live SOW — empty selectedPhaseIds [] falls back to all phases", () => {
  const livePricingLines = [
    { title: "Phase 1 — Discovery", scope: "Requirements", priceUsd: 10_000, notes: "" },
    { title: "Phase 2 — Implementation", scope: "Core build", priceUsd: 25_000, notes: "" },
    { title: "Phase 3 — Rollout", scope: "Go-live", priceUsd: 8_000, notes: "" },
  ];
  const fullTotal = 10_000 + 25_000 + 8_000; // 43 000

  let status: number;
  let body: Record<string, unknown>;

  before(async () => {
    const presRow = makePresRow({
      documentsIncluded: [1],
      sowPhases: [],
      selectedPhaseIds: ["sow-0", "sow-1", "sow-2"],
      totalPrice: String(fullTotal),
    });
    const sowDoc = makeSowDoc(livePricingLines);

    // Queue:
    //  [0] quickWinPresentationsTable → presRow  (ownership check)
    //  [1] insightsGeneratedDocumentsTable        (deriveEffectiveSowData pricing lookup)
    dbQueue = [[presRow], [sowDoc]];
    ({ status, body } = await patchSelections(PRES_ID, []));
  });

  it("returns HTTP 200", () => {
    assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(body)}`);
  });

  it("selectedPhaseIds falls back to all live SOW phases (not empty)", () => {
    const ids = body.selectedPhaseIds as string[];
    assert.ok(
      ids.length > 0,
      `sending [] with a live SOW must not produce an empty selection; got ${JSON.stringify(ids)}`,
    );
  });

  it("selectedPhaseIds contains all three live phases", () => {
    const ids = body.selectedPhaseIds as string[];
    assert.deepEqual(
      [...ids].sort(),
      ["sow-0", "sow-1", "sow-2"],
      `expected all live phases, got ${JSON.stringify(ids)}`,
    );
  });

  it("totalPrice equals the full live SOW total ($43k), not zero", () => {
    assert.equal(
      body.totalPrice,
      fullTotal,
      `expected ${fullTotal} (full SOW total), got ${body.totalPrice}`,
    );
  });

  it("totalPrice is greater than zero", () => {
    assert.ok(
      (body.totalPrice as number) > 0,
      `totalPrice must not be zero when a live SOW doc has phases; got ${body.totalPrice}`,
    );
  });
});

// =============================================================================
// Path (B3): No SOW doc — empty selectedPhaseIds falls back to stored selections
// =============================================================================

describe("PATCH selections (B3): no SOW doc — empty selectedPhaseIds [] falls back to stored snapshot selections", () => {
  const snapshotPhases = [
    { id: "snap-0", title: "Phase A", description: "Kick-off", price: 4_000, selected: true },
    { id: "snap-1", title: "Phase B", description: "Delivery", price: 11_000, selected: true },
    { id: "snap-2", title: "Phase C", description: "Closure", price: 5_000, selected: true },
  ];
  const fullSnapshotTotal = 4_000 + 11_000 + 5_000; // 20 000

  let status: number;
  let body: Record<string, unknown>;

  before(async () => {
    // No documents included → deriveEffectiveSowData uses the sowPhases snapshot.
    const presRow = makePresRow({
      documentsIncluded: [],
      sowPhases: snapshotPhases,
      selectedPhaseIds: ["snap-0", "snap-1", "snap-2"],
      totalPrice: String(fullSnapshotTotal),
    });

    // Only one DB read needed (quickWinPresentationsTable); no doc query.
    dbQueue = [[presRow]];
    ({ status, body } = await patchSelections(PRES_ID, []));
  });

  it("returns HTTP 200", () => {
    assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(body)}`);
  });

  it("selectedPhaseIds falls back to stored snapshot selections (not empty)", () => {
    const ids = body.selectedPhaseIds as string[];
    assert.ok(
      ids.length > 0,
      `sending [] with snapshot phases must not produce an empty selection; got ${JSON.stringify(ids)}`,
    );
  });

  it("totalPrice is greater than zero", () => {
    assert.ok(
      (body.totalPrice as number) > 0,
      `totalPrice must not be zero when snapshot phases exist; got ${body.totalPrice}`,
    );
  });
});
