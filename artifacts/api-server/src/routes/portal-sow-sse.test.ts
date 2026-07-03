/**
 * Integration test: GET /portal/presentations/:id/scope-events (real portal.ts route).
 *
 * Verifies that the REAL scope-events SSE endpoint in portal.ts:
 *   (A) Accepts a valid share-token in ?token= and establishes an SSE stream.
 *   (B) Rejects invalid / missing tokens with HTTP 403.
 *   (C) Delivers a "scope_changed" SSE event within 2 seconds of a
 *       broadcastPresentationScopeChange() call, using the real sse-broadcast.ts
 *       in-memory registry (not a surrogate endpoint).
 *   (D) Isolates broadcasts — a broadcast for presentation 99 is NOT received
 *       by a subscriber of presentation 1.
 *
 * Approach:
 *   - mock.module() stubs @workspace/db and all heavy portal.ts dependencies
 *     (mailer, sms, push, stripe, etc.) using the same pattern as the other
 *     portal route tests.
 *   - sse-broadcast.ts is NOT mocked — the real in-memory registry is shared
 *     between portal.ts (which calls registerPresentationSSEClient) and the
 *     test (which calls broadcastPresentationScopeChange).  This means the test
 *     exercises the full wiring: real portal auth → real registry → real event.
 *   - The DB queue returns [{ shareToken: "share-abc" }] so the share-token
 *     path in the endpoint can authenticate the test client.
 *   - A raw http.get stream acts as the SSE client (Node ships no EventSource;
 *     the raw stream gives the same observable behaviour).
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */
import { describe, it, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

// ── JWT secret (must be set before portal.ts is imported) ─────────────────────
process.env.JWT_SECRET = "portal-sse-test-secret-xyz";

// ── Queue-based mock DB ────────────────────────────────────────────────────────
let dbQueue: unknown[][] = [];

function makeChain(result: unknown[]): Record<string, unknown> {
  const chain: Record<string, unknown> = {
    from:      () => chain,
    where:     () => chain,
    limit:     () => chain,
    leftJoin:  () => chain,
    innerJoin: () => chain,
    orderBy:   () => chain,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
    catch: (reject: (e: unknown) => unknown) => Promise.resolve(result).catch(reject),
  };
  return chain;
}

function makeMockDb() {
  return {
    select:  (_cols?: unknown) => makeChain(dbQueue.shift() ?? []),
    insert:  () => ({ values: () => ({ returning: async () => [], onConflictDoNothing: () => ({ returning: async () => [] }) }), onConflictDoNothing: () => ({ returning: async () => [] }) }),
    update:  () => ({ set: () => ({ where: async () => [] }) }),
    delete:  () => ({ where: async () => [] }),
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
    requireAuth:  (_req: unknown, _res: unknown, next: () => void) => next(),
    requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
  },
});

const noop = () => {};
const noopLogger = {
  info: noop, warn: noop, error: noop, debug: noop,
  fatal: noop, trace: noop,
  child: () => noopLogger,
};
mock.module("../lib/logger.ts", { namedExports: { logger: noopLogger } });

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

mock.module("../lib/sms.ts", { namedExports: { sendAdminSms: async () => {} } });
mock.module("../lib/push.ts", { namedExports: { sendPushNotifications: async () => {} } });
mock.module("../lib/web-push.ts", { namedExports: { sendWebPushToAdmins: async () => {} } });
mock.module("../lib/audit.ts", { namedExports: { createAuditLog: async () => {} } });

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

// sse-broadcast.ts is intentionally NOT mocked.
// The real in-memory registry is shared between portal.ts and the test:
//   portal.ts  → calls registerPresentationSSEClient when the client connects
//   test file  → calls broadcastPresentationScopeChange to fire the event
// This proves the real endpoint wiring end-to-end.

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

// ── Dynamically import real portal router + real sse-broadcast AFTER mocks ─────
const { default: portalRouter } = await import("./portal.ts");
const { broadcastPresentationScopeChange, getPresentationSSEClientCount } =
  await import("../lib/sse-broadcast.ts");

// ── Express app ────────────────────────────────────────────────────────────────
const { default: express } = await import("express");
const app = express();
app.use(express.json());

// The scope-events endpoint is unauthenticated (uses share-token query param) so
// we don't need to inject req.user.  Inject req.log so the handler doesn't crash.
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
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    }),
);

after(
  () =>
    new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    ),
);

// ── Helpers ────────────────────────────────────────────────────────────────────

const SHARE_TOKEN = "share-abc-test-token";
const PRES_ID = 1;

/** Connect to the SSE endpoint and collect events until the predicate returns
 *  true or the timeout fires.  Returns the first matching event data line, or
 *  rejects after timeoutMs. */
function connectAndWaitForEvent(
  presentationId: number,
  token: string,
  predicate: (line: string) => boolean,
  timeoutMs = 2500,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = `${baseUrl}/api/portal/presentations/${presentationId}/scope-events?token=${encodeURIComponent(token)}`;
    const req = http.get(url, (res: IncomingMessage) => {
      const timer = setTimeout(() => {
        req.destroy();
        reject(new Error(`SSE event not received within ${timeoutMs}ms`));
      }, timeoutMs);

      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        for (const line of chunk.split("\n")) {
          if (predicate(line)) {
            clearTimeout(timer);
            req.destroy();
            resolve(line);
          }
        }
      });

      res.on("error", (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    req.on("error", (err: Error) => {
      // ECONNRESET is expected when req.destroy() closes an open SSE stream
      if ((err as NodeJS.ErrnoException).code !== "ECONNRESET") reject(err);
    });
  });
}

/** Wait for the SSE client registry to register `count` clients for `presId`. */
async function waitForClients(
  presId: number,
  count: number,
  timeoutMs = 1000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((getPresentationSSEClientCount(presId) ?? 0) >= count) return;
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error(`Expected ${count} SSE client(s) for presentation ${presId} within ${timeoutMs}ms`);
}

// =============================================================================
// Tests — GET /api/portal/presentations/:id/scope-events
// =============================================================================

describe("GET /api/portal/presentations/:id/scope-events — real portal.ts route", () => {

  it("(A) delivers scope_changed within 2 s after broadcastPresentationScopeChange via share-token auth", async () => {
    // DB: share-token validation query returns matching token
    dbQueue.push([{ shareToken: SHARE_TOKEN }]);

    const eventPromise = connectAndWaitForEvent(
      PRES_ID,
      SHARE_TOKEN,
      (line) => line.includes("scope_changed"),
    );

    // Wait until the portal endpoint has registered our client in the registry
    await waitForClients(PRES_ID, 1);

    // Simulate Shane regenerating the SOW — fires the broadcast
    broadcastPresentationScopeChange(PRES_ID, "sow-0:15000|sow-1:8000");

    const receivedLine = await eventPromise;
    assert.match(receivedLine, /scope_changed/);
  });

  it("(B) returns 403 when the share-token does not match the stored token", async () => {
    // DB: share-token validation query returns a DIFFERENT token
    dbQueue.push([{ shareToken: "correct-token" }]);

    const status = await new Promise<number>((resolve, reject) => {
      const url = `${baseUrl}/api/portal/presentations/${PRES_ID}/scope-events?token=wrong-token`;
      const req = http.get(url, (res) => {
        req.destroy();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", (err: Error) => {
        if ((err as NodeJS.ErrnoException).code !== "ECONNRESET") reject(err);
      });
    });

    assert.equal(status, 403);
  });

  it("(B2) returns 403 when no token is supplied and no JWT is present", async () => {
    // DB: query returns a presentation — but token doesn't match empty string
    dbQueue.push([{ shareToken: SHARE_TOKEN }]);

    const status = await new Promise<number>((resolve, reject) => {
      const url = `${baseUrl}/api/portal/presentations/${PRES_ID}/scope-events`;
      const req = http.get(url, (res) => {
        req.destroy();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", (err: Error) => {
        if ((err as NodeJS.ErrnoException).code !== "ECONNRESET") reject(err);
      });
    });

    assert.equal(status, 403);
  });

  it("(C) delivers the sowVersion payload embedded in the event data", async () => {
    dbQueue.push([{ shareToken: SHARE_TOKEN }]);

    const eventPromise = connectAndWaitForEvent(
      PRES_ID,
      SHARE_TOKEN,
      (line) => line.startsWith("data:") && line.includes("scope_changed"),
    );

    await waitForClients(PRES_ID, 1);

    const NEW_VERSION = "sow-0:20000|sow-1:8000";
    broadcastPresentationScopeChange(PRES_ID, NEW_VERSION);

    const dataLine = await eventPromise;
    // The event data is a JSON string — verify it parses and contains the new version
    const jsonStr = dataLine.replace(/^data:\s*/, "");
    const payload = JSON.parse(jsonStr) as { type: string; sowVersion: string };
    assert.equal(payload.type, "scope_changed");
    assert.equal(payload.sowVersion, NEW_VERSION);
  });

  it("(D) broadcast for presentation 99 is NOT received by a subscriber of presentation 1", async () => {
    dbQueue.push([{ shareToken: SHARE_TOKEN }]);

    let receivedEvent = false;
    const neverResolvePromise = connectAndWaitForEvent(
      PRES_ID,
      SHARE_TOKEN,
      (line) => {
        if (line.includes("scope_changed")) { receivedEvent = true; return true; }
        return false;
      },
      800, // short timeout — we expect NO event
    );

    await waitForClients(PRES_ID, 1);

    // Broadcast to a DIFFERENT presentation
    broadcastPresentationScopeChange(99, "sow-0:5000");

    // neverResolvePromise should reject (timeout) because pres 1 got no event
    await assert.rejects(neverResolvePromise, /not received/);
    assert.equal(receivedEvent, false, "subscriber for pres 1 must not receive a pres-99 broadcast");
  });

  it("(E) response sets Content-Type: text/event-stream", async () => {
    dbQueue.push([{ shareToken: SHARE_TOKEN }]);

    const contentType = await new Promise<string>((resolve, reject) => {
      const url = `${baseUrl}/api/portal/presentations/${PRES_ID}/scope-events?token=${encodeURIComponent(SHARE_TOKEN)}`;
      const req = http.get(url, (res) => {
        const ct = res.headers["content-type"] ?? "";
        req.destroy();
        resolve(ct);
      });
      req.on("error", (err: Error) => {
        if ((err as NodeJS.ErrnoException).code !== "ECONNRESET") reject(err);
      });
    });

    assert.match(contentType, /text\/event-stream/);
  });
});
