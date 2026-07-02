/**
 * Tests for the scope-sync logic in GET /portal/presentations/:id.
 *
 * The handler calls deriveEffectiveSowData() which reads live sowPricingLines
 * from the SOW document included in the presentation. These tests verify all
 * three branches:
 *
 *   (a) SOW doc with pricing lines overrides the creation-time snapshot
 *   (b) Stored client selections are preserved when still valid (intersection)
 *   (c) Fallback to creation-time snapshot when no SOW pricing exists
 *
 * Also verifies:
 *   (b2) Stale stored selections (not in live phase IDs) default to all selected
 *   - effectiveTotalPrice always matches the sum of the selected phases
 *
 * Approach:
 *  - mock.module() stubs @workspace/db so no real DB connections are opened.
 *  - The mock DB uses a chainable thenable queue: each db.select() call pops
 *    the next result from the queue, allowing per-scenario DB response control.
 *  - Auth uses ?token=<shareToken> — no JWT needed.
 *  - projectId and clientUserId are null to avoid extra DB round-trips.
 *  - getStripeKey() is stubbed to throw (caught silently in the handler).
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */
import { describe, it, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ── JWT secret (must be set before portal.ts is imported) ─────────────────────
process.env.JWT_SECRET = "scope-sync-test-secret-xyz";

// ── Queue-based mock DB ───────────────────────────────────────────────────────
// Each db.select() call pops one entry. The returned object is a thenable that
// also exposes .from(), .where(), .limit(), and .leftJoin() for full chaining
// without any real DB interaction.
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

// Stripe stubs — getStripeKey() throws so the stripe session check is
// caught and skipped silently, letting the handler complete normally.
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
  namedExports: { generateManualScriptPackage: async () => Buffer.from("") },
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
app.use(express.json());
// Inject req.log and req.user before every route — requireAuth is stubbed to
// call next() but does NOT set req.user; the PATCH handler needs req.user!.id.
const CLIENT_USER_ID = 42;
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

// ── Canned data ────────────────────────────────────────────────────────────────

const SHARE_TOKEN = "test-share-token-abc";
const PRES_ID = 101;

/** Minimal presentation row shared by all scenarios. */
function makePresRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PRES_ID,
    shareToken: SHARE_TOKEN,
    clientUserId: null,
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

/** Build a document row that looks like a SOW with pricing. */
function makeSowDoc(pricingLines: Array<{ title: string; scope: string; priceUsd: number; notes: string }>): Record<string, unknown> {
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

type PresentationResponse = {
  sowPhases: Array<{ id: string; title: string; description: string; price: number; selected: boolean }>;
  selectedPhaseIds: string[];
  totalPrice: number;
};

async function getPresentation(id: number): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/api/portal/presentations/${id}?token=${SHARE_TOKEN}`);
  const body = await res.json() as Record<string, unknown>;
  return { status: res.status, body };
}

async function patchSelections(
  id: number,
  selectedPhaseIds: string[],
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/api/portal/presentations/${id}/selections`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selectedPhaseIds }),
  });
  const body = await res.json() as Record<string, unknown>;
  return { status: res.status, body };
}

// =============================================================================
// Branch (a): Live SOW pricing overrides the creation-time snapshot
// =============================================================================

describe("scope-sync branch (a): live SOW doc overrides creation-time snapshot", () => {
  const livePricingLines = [
    { title: "Phase 1 — Discovery", scope: "Requirements gathering", priceUsd: 10_000, notes: "" },
    { title: "Phase 2 — Implementation", scope: "Core build", priceUsd: 20_000, notes: "" },
    { title: "Phase 3 — Rollout", scope: "Go-live support", priceUsd: 8_000, notes: "" },
  ];

  const snapshotPhases = [
    { id: "snap-0", title: "Old Snapshot Phase", description: "Stale", price: 5_000, selected: true },
  ];

  let status: number;
  let body: Record<string, unknown>;

  before(async () => {
    const presRow = makePresRow({
      documentsIncluded: [1],
      sowPhases: snapshotPhases,
      selectedPhaseIds: ["snap-0"],
      totalPrice: "5000",
    });
    const sowDoc = makeSowDoc(livePricingLines);

    // Queue:
    //  [0] quickWinPresentationsTable → presRow
    //  [1] insightsGeneratedDocumentsTable (full doc for display)
    //  [2] insightsGeneratedDocumentsTable (pricing in deriveEffectiveSowData)
    dbQueue = [[presRow], [sowDoc], [sowDoc]];
    ({ status, body } = await getPresentation(PRES_ID));
  });

  it("returns HTTP 200", () => {
    assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(body)}`);
  });

  it("sowPhases are derived from the live SOW doc, not the snapshot", () => {
    const phases = body.sowPhases as PresentationResponse["sowPhases"];
    assert.equal(phases.length, 3, `expected 3 live phases, got ${phases.length}`);
    assert.equal(phases[0].id, "sow-0");
    assert.equal(phases[1].id, "sow-1");
    assert.equal(phases[2].id, "sow-2");
  });

  it("phase titles match the live SOW pricing lines", () => {
    const phases = body.sowPhases as PresentationResponse["sowPhases"];
    assert.equal(phases[0].title, "Phase 1 — Discovery");
    assert.equal(phases[1].title, "Phase 2 — Implementation");
    assert.equal(phases[2].title, "Phase 3 — Rollout");
  });

  it("phase prices match the live SOW pricing lines", () => {
    const phases = body.sowPhases as PresentationResponse["sowPhases"];
    assert.equal(phases[0].price, 10_000);
    assert.equal(phases[1].price, 20_000);
    assert.equal(phases[2].price, 8_000);
  });

  it("snapshot phase ID is NOT present (live phases took over)", () => {
    const phases = body.sowPhases as PresentationResponse["sowPhases"];
    const ids = phases.map((p) => p.id);
    assert.ok(!ids.includes("snap-0"), `snapshot id 'snap-0' should not appear; ids: ${JSON.stringify(ids)}`);
  });

  it("all phases are selected by default when no prior selections exist", () => {
    const phases = body.sowPhases as PresentationResponse["sowPhases"];
    assert.ok(phases.every((p) => p.selected), `all phases should be selected by default`);
  });

  it("effectiveTotalPrice equals the sum of all selected phase prices", () => {
    const expectedTotal = 10_000 + 20_000 + 8_000;
    assert.equal(body.totalPrice, expectedTotal, `expected totalPrice ${expectedTotal}, got ${body.totalPrice}`);
  });
});

// =============================================================================
// Branch (b): Stored client selections are preserved when still valid
// =============================================================================

describe("scope-sync branch (b): stored selections preserved when still valid", () => {
  const livePricingLines = [
    { title: "Foundation", scope: "Identity setup", priceUsd: 6_000, notes: "" },
    { title: "Governance", scope: "Policy and compliance", priceUsd: 9_000, notes: "" },
    { title: "Migration", scope: "Mailbox migration", priceUsd: 12_000, notes: "" },
  ];

  // Client previously selected sow-0 and sow-2 (skipping sow-1)
  const storedSelectedIds = ["sow-0", "sow-2"];

  let status: number;
  let body: Record<string, unknown>;

  before(async () => {
    const presRow = makePresRow({
      documentsIncluded: [1],
      sowPhases: [],
      selectedPhaseIds: storedSelectedIds,
      totalPrice: "18000",
    });
    const sowDoc = makeSowDoc(livePricingLines);

    dbQueue = [[presRow], [sowDoc], [sowDoc]];
    ({ status, body } = await getPresentation(PRES_ID));
  });

  it("returns HTTP 200", () => {
    assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(body)}`);
  });

  it("selectedPhaseIds honours the stored selection (sow-0 and sow-2)", () => {
    const selectedIds = body.selectedPhaseIds as string[];
    assert.deepEqual(
      [...selectedIds].sort(),
      ["sow-0", "sow-2"],
      `expected ["sow-0","sow-2"], got ${JSON.stringify(selectedIds)}`,
    );
  });

  it("sow-0 phase is marked selected", () => {
    const phases = body.sowPhases as PresentationResponse["sowPhases"];
    const phase0 = phases.find((p) => p.id === "sow-0");
    assert.ok(phase0?.selected, "sow-0 should be selected");
  });

  it("sow-1 phase is NOT selected (client deselected it)", () => {
    const phases = body.sowPhases as PresentationResponse["sowPhases"];
    const phase1 = phases.find((p) => p.id === "sow-1");
    assert.ok(phase1 && !phase1.selected, "sow-1 should not be selected");
  });

  it("sow-2 phase is marked selected", () => {
    const phases = body.sowPhases as PresentationResponse["sowPhases"];
    const phase2 = phases.find((p) => p.id === "sow-2");
    assert.ok(phase2?.selected, "sow-2 should be selected");
  });

  it("effectiveTotalPrice equals sum of sow-0 ($6k) + sow-2 ($12k) only", () => {
    const expectedTotal = 6_000 + 12_000;
    assert.equal(body.totalPrice, expectedTotal, `expected totalPrice ${expectedTotal}, got ${body.totalPrice}`);
  });
});

// =============================================================================
// Branch (b2): Stale stored selections (none valid) default to all selected
// =============================================================================

describe("scope-sync branch (b2): stale stored selections default to all phases selected", () => {
  const livePricingLines = [
    { title: "Quick Win Pack", scope: "Immediate wins", priceUsd: 4_500, notes: "" },
    { title: "Roadmap Build", scope: "12-month plan", priceUsd: 7_500, notes: "" },
  ];

  // These IDs don't exist in the live SOW (stale snapshot IDs)
  const staleSelectedIds = ["phase-old-1", "phase-old-2"];

  let status: number;
  let body: Record<string, unknown>;

  before(async () => {
    const presRow = makePresRow({
      documentsIncluded: [1],
      sowPhases: [],
      selectedPhaseIds: staleSelectedIds,
      totalPrice: "3000",
    });
    const sowDoc = makeSowDoc(livePricingLines);

    dbQueue = [[presRow], [sowDoc], [sowDoc]];
    ({ status, body } = await getPresentation(PRES_ID));
  });

  it("returns HTTP 200", () => {
    assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(body)}`);
  });

  it("stale selection IDs are not present in selectedPhaseIds", () => {
    const selectedIds = body.selectedPhaseIds as string[];
    assert.ok(
      !selectedIds.includes("phase-old-1") && !selectedIds.includes("phase-old-2"),
      `stale IDs should not appear; selectedPhaseIds: ${JSON.stringify(selectedIds)}`,
    );
  });

  it("falls back to all live phases selected (intersection was empty)", () => {
    const selectedIds = body.selectedPhaseIds as string[];
    assert.deepEqual(
      [...selectedIds].sort(),
      ["sow-0", "sow-1"],
      `expected both live phases selected, got ${JSON.stringify(selectedIds)}`,
    );
  });

  it("all live phases are marked selected", () => {
    const phases = body.sowPhases as PresentationResponse["sowPhases"];
    assert.ok(phases.every((p) => p.selected), "all phases should be selected when stored selections are stale");
  });

  it("effectiveTotalPrice equals sum of all live phases ($4.5k + $7.5k)", () => {
    const expectedTotal = 4_500 + 7_500;
    assert.equal(body.totalPrice, expectedTotal, `expected totalPrice ${expectedTotal}, got ${body.totalPrice}`);
  });
});

// =============================================================================
// Branch (c): Fallback to creation-time snapshot when no SOW pricing exists
// =============================================================================

describe("scope-sync branch (c): fallback to creation-time snapshot when no SOW doc", () => {
  const snapshotPhases = [
    { id: "snap-0", title: "Snapshot Phase A", description: "From creation", price: 3_000, selected: true },
    { id: "snap-1", title: "Snapshot Phase B", description: "From creation", price: 7_000, selected: true },
  ];

  let status: number;
  let body: Record<string, unknown>;

  before(async () => {
    const presRow = makePresRow({
      documentsIncluded: [],
      sowPhases: snapshotPhases,
      selectedPhaseIds: ["snap-0", "snap-1"],
      totalPrice: "10000",
    });

    // No doc queries will be made since documentsIncluded is empty
    dbQueue = [[presRow]];
    ({ status, body } = await getPresentation(PRES_ID));
  });

  it("returns HTTP 200", () => {
    assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(body)}`);
  });

  it("sowPhases are the creation-time snapshot phases", () => {
    const phases = body.sowPhases as PresentationResponse["sowPhases"];
    assert.equal(phases.length, 2, `expected 2 snapshot phases, got ${phases.length}`);
    assert.equal(phases[0].id, "snap-0");
    assert.equal(phases[1].id, "snap-1");
  });

  it("snapshot phase titles are preserved", () => {
    const phases = body.sowPhases as PresentationResponse["sowPhases"];
    assert.equal(phases[0].title, "Snapshot Phase A");
    assert.equal(phases[1].title, "Snapshot Phase B");
  });

  it("selectedPhaseIds matches the creation-time snapshot", () => {
    const selectedIds = body.selectedPhaseIds as string[];
    assert.deepEqual(
      [...selectedIds].sort(),
      ["snap-0", "snap-1"],
      `expected snapshot IDs, got ${JSON.stringify(selectedIds)}`,
    );
  });

  it("effectiveTotalPrice matches the stored totalPrice from the snapshot", () => {
    assert.equal(body.totalPrice, 10_000, `expected totalPrice 10000, got ${body.totalPrice}`);
  });
});

// =============================================================================
// Branch (c2): Fallback when included doc exists but has null/empty sowPricingLines
// =============================================================================

describe("scope-sync branch (c2): fallback when included SOW doc has no pricing lines", () => {
  const snapshotPhases = [
    { id: "snap-0", title: "Legacy Phase", description: "Pre-SOW estimate", price: 15_000, selected: true },
  ];

  let status: number;
  let body: Record<string, unknown>;

  before(async () => {
    const presRow = makePresRow({
      documentsIncluded: [1],
      sowPhases: snapshotPhases,
      selectedPhaseIds: ["snap-0"],
      totalPrice: "15000",
    });
    const emptyPricingDoc = {
      id: 1,
      title: "Statement of Work",
      category: "sow",
      docType: "sow",
      htmlContent: "<p>No pricing parsed yet</p>",
      sowPricingLines: [],
      sowTotalPrice: null,
      createdAt: new Date(),
    };

    // doc is present but has empty sowPricingLines — should fall back to snapshot
    dbQueue = [[presRow], [emptyPricingDoc], [emptyPricingDoc]];
    ({ status, body } = await getPresentation(PRES_ID));
  });

  it("returns HTTP 200", () => {
    assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(body)}`);
  });

  it("falls back to the creation-time snapshot phases", () => {
    const phases = body.sowPhases as PresentationResponse["sowPhases"];
    assert.equal(phases.length, 1, `expected 1 snapshot phase, got ${phases.length}`);
    assert.equal(phases[0].id, "snap-0");
    assert.equal(phases[0].title, "Legacy Phase");
  });

  it("effectiveTotalPrice uses the stored snapshot total, not zero", () => {
    assert.equal(body.totalPrice, 15_000, `expected totalPrice 15000, got ${body.totalPrice}`);
  });
});

// =============================================================================
// PATCH branch (1): valid subset of live phases — totalPrice matches selected
// =============================================================================

describe("PATCH /selections (1): valid subset of live phases — totalPrice is correct", () => {
  const livePricingLines = [
    { title: "Discovery", scope: "Requirements", priceUsd: 5_000, notes: "" },
    { title: "Build", scope: "Core implementation", priceUsd: 15_000, notes: "" },
    { title: "Support", scope: "Post-launch support", priceUsd: 3_000, notes: "" },
  ];

  // Client selects only sow-0 and sow-2 (skips sow-1)
  const incoming = ["sow-0", "sow-2"];

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

    // Queue:
    //  [0] presentation lookup
    //  [1] deriveEffectiveSowData → SOW doc pricing
    dbQueue = [[presRow], [sowDoc]];
    ({ status, body } = await patchSelections(PRES_ID, incoming));
  });

  it("returns HTTP 200", () => {
    assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(body)}`);
  });

  it("selectedPhaseIds contains exactly the valid requested IDs", () => {
    const ids = body.selectedPhaseIds as string[];
    assert.deepEqual(
      [...ids].sort(),
      ["sow-0", "sow-2"],
      `expected ["sow-0","sow-2"], got ${JSON.stringify(ids)}`,
    );
  });

  it("totalPrice equals sum of sow-0 ($5k) + sow-2 ($3k) only", () => {
    const expected = 5_000 + 3_000;
    assert.equal(body.totalPrice, expected, `expected ${expected}, got ${body.totalPrice}`);
  });

  it("totalPrice does NOT include the unselected sow-1 price ($15k)", () => {
    assert.ok(
      (body.totalPrice as number) < 15_000,
      `totalPrice should not include sow-1's $15k; got ${body.totalPrice}`,
    );
  });
});

// =============================================================================
// PATCH branch (2): stale/invalid IDs are dropped and total is recomputed
// =============================================================================

describe("PATCH /selections (2): stale/invalid IDs are dropped — total recomputed from valid only", () => {
  const livePricingLines = [
    { title: "Phase A", scope: "Scope A", priceUsd: 8_000, notes: "" },
    { title: "Phase B", scope: "Scope B", priceUsd: 12_000, notes: "" },
  ];

  // Mix of one valid live ID and two stale IDs that don't exist in the live SOW
  const incoming = ["sow-0", "stale-id-x", "stale-id-y"];

  let status: number;
  let body: Record<string, unknown>;

  before(async () => {
    const presRow = makePresRow({
      documentsIncluded: [1],
      sowPhases: [],
      selectedPhaseIds: ["stale-id-x"],
      totalPrice: "999",
    });
    const sowDoc = makeSowDoc(livePricingLines);

    dbQueue = [[presRow], [sowDoc]];
    ({ status, body } = await patchSelections(PRES_ID, incoming));
  });

  it("returns HTTP 200", () => {
    assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(body)}`);
  });

  it("stale IDs are not present in the returned selectedPhaseIds", () => {
    const ids = body.selectedPhaseIds as string[];
    assert.ok(
      !ids.includes("stale-id-x") && !ids.includes("stale-id-y"),
      `stale IDs should be dropped; got ${JSON.stringify(ids)}`,
    );
  });

  it("only the valid live ID (sow-0) is retained", () => {
    const ids = body.selectedPhaseIds as string[];
    assert.deepEqual(ids, ["sow-0"], `expected ["sow-0"], got ${JSON.stringify(ids)}`);
  });

  it("totalPrice is recomputed from sow-0 price only ($8k), not the stale stored total", () => {
    assert.equal(body.totalPrice, 8_000, `expected 8000, got ${body.totalPrice}`);
  });
});

// =============================================================================
// PATCH branch (3): no live SOW doc — fallback to creation-time snapshot
// =============================================================================

describe("PATCH /selections (3): no live SOW doc — snapshot phases used for validation", () => {
  const snapshotPhases = [
    { id: "snap-0", title: "Snapshot Alpha", description: "Pre-SOW", price: 4_000, selected: true },
    { id: "snap-1", title: "Snapshot Beta", description: "Pre-SOW", price: 6_000, selected: true },
  ];

  // Client requests only snap-0 from the snapshot
  const incoming = ["snap-0"];

  let status: number;
  let body: Record<string, unknown>;

  before(async () => {
    const presRow = makePresRow({
      documentsIncluded: [],      // no docs → no SOW lookup → fallback to snapshot
      sowPhases: snapshotPhases,
      selectedPhaseIds: ["snap-0", "snap-1"],
      totalPrice: "10000",
    });

    // Only the presentation lookup; no doc query since documentsIncluded is empty
    dbQueue = [[presRow]];
    ({ status, body } = await patchSelections(PRES_ID, incoming));
  });

  it("returns HTTP 200", () => {
    assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(body)}`);
  });

  it("selectedPhaseIds contains only snap-0 (the valid requested ID)", () => {
    const ids = body.selectedPhaseIds as string[];
    assert.deepEqual(ids, ["snap-0"], `expected ["snap-0"], got ${JSON.stringify(ids)}`);
  });

  it("totalPrice equals the snapshot price of snap-0 ($4k) only", () => {
    assert.equal(body.totalPrice, 4_000, `expected 4000, got ${body.totalPrice}`);
  });

  it("totalPrice does NOT include the unselected snap-1 price ($6k)", () => {
    assert.ok(
      (body.totalPrice as number) < 6_000,
      `totalPrice should not include snap-1's $6k; got ${body.totalPrice}`,
    );
  });
});

// =============================================================================
// PATCH branch (4): empty selectedPhaseIds with live SOW doc present
// — must NOT zero out the total; handler must fall back to all phases
// =============================================================================

describe("PATCH /selections (4): empty selectedPhaseIds [] with live SOW doc — falls back to all phases, not zero", () => {
  const livePricingLines = [
    { title: "Phase A", scope: "Scope A", priceUsd: 6_000, notes: "" },
    { title: "Phase B", scope: "Scope B", priceUsd: 9_000, notes: "" },
  ];
  const expectedTotal = 6_000 + 9_000;

  let status: number;
  let body: Record<string, unknown>;

  before(async () => {
    const presRow = makePresRow({
      documentsIncluded: [1],
      sowPhases: [],
      selectedPhaseIds: ["sow-0", "sow-1"],
      totalPrice: String(expectedTotal),
    });
    const sowDoc = makeSowDoc(livePricingLines);

    // Queue:
    //  [0] presentation lookup
    //  [1] deriveEffectiveSowData → SOW doc pricing
    dbQueue = [[presRow], [sowDoc]];
    ({ status, body } = await patchSelections(PRES_ID, []));
  });

  it("returns HTTP 200", () => {
    assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(body)}`);
  });

  it("selectedPhaseIds falls back to all live phases (not empty)", () => {
    const ids = body.selectedPhaseIds as string[];
    assert.ok(
      ids.length > 0,
      `selectedPhaseIds should not be empty when [] is sent with a live SOW doc; got ${JSON.stringify(ids)}`,
    );
  });

  it("selectedPhaseIds contains all live SOW phase IDs", () => {
    const ids = body.selectedPhaseIds as string[];
    assert.deepEqual(
      [...ids].sort(),
      ["sow-0", "sow-1"],
      `expected all live phases ["sow-0","sow-1"], got ${JSON.stringify(ids)}`,
    );
  });

  it("totalPrice equals the full SOW total ($15k), not zero", () => {
    assert.equal(
      body.totalPrice,
      expectedTotal,
      `sending [] must not zero out the total; expected ${expectedTotal}, got ${body.totalPrice}`,
    );
  });

  it("totalPrice is greater than zero", () => {
    assert.ok(
      (body.totalPrice as number) > 0,
      `totalPrice must not be zero when a live SOW doc is present; got ${body.totalPrice}`,
    );
  });
});

// =============================================================================
// PATCH branch (5): empty selectedPhaseIds with snapshot-only fallback
// — no SOW doc; stored selections are preserved (not zeroed out)
// =============================================================================

describe("PATCH /selections (5): empty selectedPhaseIds [] with snapshot-only — stored selections preserved", () => {
  const snapshotPhases = [
    { id: "snap-0", title: "Snapshot X", description: "Desc X", price: 5_000, selected: true },
    { id: "snap-1", title: "Snapshot Y", description: "Desc Y", price: 7_000, selected: true },
  ];
  // Stored total from creation time
  const storedTotal = 12_000;

  let status: number;
  let body: Record<string, unknown>;

  before(async () => {
    const presRow = makePresRow({
      documentsIncluded: [],        // no docs → no SOW lookup → snapshot path
      sowPhases: snapshotPhases,
      selectedPhaseIds: ["snap-0", "snap-1"],   // both phases previously selected
      totalPrice: String(storedTotal),
    });

    // Only the presentation lookup; documentsIncluded is empty so no doc query
    dbQueue = [[presRow]];
    ({ status, body } = await patchSelections(PRES_ID, []));
  });

  it("returns HTTP 200", () => {
    assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(body)}`);
  });

  it("selectedPhaseIds falls back to the stored snapshot selections (not empty)", () => {
    const ids = body.selectedPhaseIds as string[];
    assert.ok(
      ids.length > 0,
      `selectedPhaseIds should not be empty when [] is sent and snapshot phases exist; got ${JSON.stringify(ids)}`,
    );
  });

  it("totalPrice is greater than zero", () => {
    assert.ok(
      (body.totalPrice as number) > 0,
      `totalPrice must not be zero when snapshot phases exist; got ${body.totalPrice}`,
    );
  });
});
