/**
 * workflow-executor-integrations.test.ts
 *
 * Unit tests for external-integration workflow node types:
 *   check_exchange_calendar_availability, create_exchange_calendar_event,
 *   save_to_sharepoint, get_from_sharepoint, generate_pdf,
 *   generate_invoice_stripe_payment, generate_stripe_payment_link,
 *   charge_stripe_invoice, create_phased_invoices, generate_phased_invoice,
 *   approval_gate
 *
 * Strategy:
 *   - Graph/SharePoint nodes: missing-credentials failure (live) + dry-run happy path
 *   - Stripe nodes: missing-key failure (mock getStripeKey to throw) + dry-run happy path
 *   - generate_pdf: missing htmlTemplate failure (live) + dry-run happy path
 *   - approval_gate: dry-run happy path
 *   - Exchange nodes: required-field failures (live, credentials mock returns false)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const state = vi.hoisted(() => ({
  dbQueue: [] as unknown[][],
  nodeOutputInserts: [] as Record<string, unknown>[],
  logInserts: [] as Record<string, unknown>[],
  fetchCalls: [] as { url: string; method: string }[],
  stripeInstances: [] as unknown[],
  webPushCalls: [] as unknown[],
  graphCredentialsMissing: true,
  stripeKeyThrows: false,
}));

// ── Mock @workspace/db ────────────────────────────────────────────────────────
vi.mock("@workspace/db", () => {
  function makeSelectChain(result: unknown[]): Record<string, unknown> {
    const chain: Record<string, unknown> = {
      from:      () => chain,
      where:     () => chain,
      limit:     () => chain,
      innerJoin: () => chain,
      leftJoin:  () => chain,
      orderBy:   () => chain,
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
      catch: () => Promise.resolve(result),
    };
    return chain;
  }

  const db = {
    select: (_cols?: unknown) => makeSelectChain(state.dbQueue.shift() ?? []),
    insert: (_table?: unknown) => ({
      values: (vals?: unknown) => {
        if (vals && typeof vals === "object") {
          const v = vals as Record<string, unknown>;
          if ("output" in v) state.nodeOutputInserts.push(v);
          else state.logInserts.push(v);
        }
        return {
          returning: async () => [{ id: 88 }],
          catch:     async () => {},
        };
      },
    }),
    update: () => ({
      set: () => ({ where: async () => [] }),
      where: async () => [],
    }),
  };

  const stub: Record<string, unknown> = {};
  const tableNames = [
    "wfRunsTable", "wfVersionsTable", "wfDefinitionsTable", "wfTriggersTable",
    "wfRunNodeOutputsTable", "wfRunNodeLogsTable",
    "leadsTable", "usersTable", "projectsTable", "opportunitiesTable",
    "clientDocumentsTable", "leadQualificationsTable", "quizLeadsTable",
    "clientHealthHistoryTable", "emailTemplatesTable", "marketingTasksTable",
    "kanbanTasksTable", "articlesTable", "notificationsTable",
    "campaignsTable", "landingPagesTable", "pendingApprovalsTable",
    "workflowStepsTable", "clientPresentationsTable", "deviceTokensTable",
    "insightsGeneratedDocumentsTable", "quickWinPresentationsTable",
    "campaignAssetsTable", "couponsTable",
  ];
  for (const name of tableNames) {
    stub[name] = {
      id: {}, definitionId: {}, status: {}, versionId: {}, branchPath: {},
      startedAt: {}, finishedAt: {}, errorMessage: {}, type: {}, enabled: {},
      config: {}, nextRunAt: {}, title: {}, createdAt: {}, role: {}, slug: {},
      token: {}, approverRole: {}, expiresAt: {},
    };
  }

  return { db, pool: { query: async () => ({ rows: [], rowCount: 0 }) }, ...stub, eq: () => {}, and: () => {}, or: () => {}, count: () => {} };
});

vi.mock("./logger", () => {
  const n = () => {};
  const log = { info: n, warn: n, error: n, debug: n, fatal: n, trace: n, child: () => log };
  return { logger: log };
});

vi.mock("./azure-automation", () => ({
  createRunbookJob:  async () => "fake-job-id",
  isAzureConfigured: () => false,
  getJobStatus:      async () => "Completed",
  getJobOutput:      async () => "",
  isTerminalStatus:  () => true,
}));

vi.mock("./web-push", () => ({
  sendWebPushToAdmins: async (...args: unknown[]) => {
    state.webPushCalls.push(args[0]);
  },
}));

vi.mock("./sse-channels", () => ({
  broadcastAdminWorkflowEvent: () => {},
  broadcastAdminEvent:         () => {},
}));

vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: {
    messages: {
      create: async () => ({
        content: [{ type: "text", text: '{"topic":"test"}' }],
      }),
      stream: () => ({
        finalMessage: async () => ({
          content: [{ type: "text", text: "content" }],
        }),
      }),
    },
  },
}));

vi.mock("@workspace/integrations-openai-ai-server/image", () => ({
  generateImage: async () => ({
    imageUrl: "https://example.com/image.png",
    revisedPrompt: "image",
  }),
}));

vi.mock("./kanban-auto-fire", () => ({
  autoFireFirstBacklogScript: async () => {},
  autoFireDocumentCard:       async () => {},
  reconcileOrphanedRuns:      async () => {},
  reconcileStalledPhases:     async () => {},
}));

vi.mock("../routes/admin-insights", () => ({
  executeAutomation: async () => {},
  nextRunFromCron:   () => new Date(),
}));

vi.mock("./manual-script-escalation", () => ({
  checkManualScriptEscalations: async () => ({ alerted: 0, checked: 0, cardIds: [] }),
}));

vi.mock("./mailer", () => ({
  sendEmail:    async () => {},
  brandedEmail: (html: string) => `<html>${html}</html>`,
}));

vi.mock("./push", () => ({
  sendPushNotifications: async () => {},
}));

vi.mock("./ps-script-gen", () => ({
  generatePsScript:     async () => ({ scriptContent: "Write-Host 'hello'" }),
  generateScriptBundle: async () => ({ bundleId: "bundle-1" }),
}));

vi.mock("./news-fetcher", () => ({
  fetchNewsHeadlines: async () => [],
}));

// ── Stripe mock ───────────────────────────────────────────────────────────────
vi.mock("./stripe", () => ({
  getStripeKey: () => {
    if (state.stripeKeyThrows) throw new Error("STRIPE_SECRET_KEY is not set");
    return "sk_test_fake";
  },
}));

// ── graph mock (Exchange / SharePoint) ───────────────────────────────────────
vi.mock("./graph", () => ({
  getAccessToken: async () => "fake-graph-token",
  graphCredentialsPresent: () => !state.graphCredentialsMissing,
}));

// ── fs/promises mock ─────────────────────────────────────────────────────────
vi.mock("fs/promises", () => {
  const fsMock = {
    writeFile: async () => {},
    mkdir:     async () => {},
    readFile:  async () => Buffer.from(""),
  };
  return { default: fsMock, ...fsMock };
});

// ── Import after all mocks ────────────────────────────────────────────────────
import { executeWorkflowRun } from "./workflow-executor";

// ── Helpers ───────────────────────────────────────────────────────────────────

function resetState(opts: { graphMissing?: boolean; stripeThrows?: boolean } = {}) {
  state.dbQueue = [];
  state.nodeOutputInserts = [];
  state.logInserts = [];
  state.fetchCalls = [];
  state.stripeInstances = [];
  state.webPushCalls = [];
  state.graphCredentialsMissing = opts.graphMissing !== false;
  state.stripeKeyThrows = Boolean(opts.stripeThrows);
}

function seedDb(graph: object, payload: Record<string, unknown> = {}, extraRows: unknown[][] = []) {
  const version = { id: 1, definitionId: 10, status: "published", label: "v1", graph };
  state.dbQueue = [
    [{ id: 1, versionId: 1, payload, status: "pending", triggerType: "manual", triggerRef: "manual", branchPath: [] }],
    [version],
    [{ status: "running" }],
    ...extraRows,
  ];
}

function singleNodeGraph(type: string, data: Record<string, unknown>) {
  return {
    nodes: [{ id: "n1", type, position: { x: 0, y: 0 }, data: { nodeType: type, label: type, ...data } }],
    edges: [],
  };
}

function capturedOutput(): Record<string, unknown> {
  return (state.nodeOutputInserts[0]?.output ?? {}) as Record<string, unknown>;
}

function capturedStatus(): string {
  return state.nodeOutputInserts[0]?.status as string ?? "unknown";
}

// Stub globalThis.fetch
function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(handler));
}

// =============================================================================
// check_exchange_calendar_availability
// =============================================================================

describe("check_exchange_calendar_availability — missing Graph credentials (live)", () => {
  beforeEach(async () => {
    resetState({ graphMissing: true });
    seedDb(singleNodeGraph("check_exchange_calendar_availability", {
      userUpn: "shane@contoso.com",
      startDateTime: "2025-01-01T09:00:00Z",
      endDateTime:   "2025-01-01T17:00:00Z",
    }));
    await executeWorkflowRun(1);
  });

  it("output.error mentions Graph credentials missing", () => {
    expect((capturedOutput().error as string)).toContain("Graph credentials missing");
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});

describe("check_exchange_calendar_availability — missing required fields (live)", () => {
  beforeEach(async () => {
    resetState({ graphMissing: true });
    seedDb(singleNodeGraph("check_exchange_calendar_availability", {
      // userUpn omitted
      startDateTime: "2025-01-01T09:00:00Z",
      endDateTime:   "2025-01-01T17:00:00Z",
    }));
    await executeWorkflowRun(1);
  });

  it("output.error is set", () => {
    expect(typeof capturedOutput().error).toBe("string");
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});

describe("check_exchange_calendar_availability — dry-run returns preview", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("check_exchange_calendar_availability", {
      userUpn: "shane@contoso.com",
      startDateTime: "2025-01-01T09:00:00Z",
      endDateTime:   "2025-01-01T17:00:00Z",
    }));
    await executeWorkflowRun(1, { dryRun: true });
  });

  it("output.dryRun is true", () => {
    expect(capturedOutput().dryRun).toBe(true);
  });

  it("output.isBusy is false in dry-run", () => {
    expect(capturedOutput().isBusy).toBe(false);
  });

  it("output.availableSlots has at least one entry", () => {
    expect(Array.isArray(capturedOutput().availableSlots)).toBe(true);
    expect((capturedOutput().availableSlots as string[]).length).toBeGreaterThan(0);
  });
});

describe("check_exchange_calendar_availability — Graph API call succeeds (live)", () => {
  beforeEach(async () => {
    resetState({ graphMissing: false });
    stubFetch(async () =>
      new Response(
        JSON.stringify({
          value: [{
            scheduleItems: [{ start: { dateTime: "2025-01-01T10:00:00" }, end: { dateTime: "2025-01-01T11:00:00" } }],
            availabilityView: "2",
          }],
        }),
        { status: 200 },
      ),
    );
    seedDb(singleNodeGraph("check_exchange_calendar_availability", {
      userUpn: "shane@contoso.com",
      startDateTime: "2025-01-01T09:00:00Z",
      endDateTime:   "2025-01-01T17:00:00Z",
    }));
    await executeWorkflowRun(1);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it("output.isBusy is true (busy slots found)", () => {
    expect(capturedOutput().isBusy).toBe(true);
  });

  it("output.busySlots has one entry", () => {
    expect((capturedOutput().busySlots as string[]).length).toBe(1);
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

// =============================================================================
// create_exchange_calendar_event
// =============================================================================

describe("create_exchange_calendar_event — missing Graph credentials (live)", () => {
  beforeEach(async () => {
    resetState({ graphMissing: true });
    seedDb(singleNodeGraph("create_exchange_calendar_event", {
      userUpn:       "shane@contoso.com",
      subject:       "Kick-off Meeting",
      startDateTime: "2025-01-15T10:00:00Z",
      endDateTime:   "2025-01-15T11:00:00Z",
    }));
    await executeWorkflowRun(1);
  });

  it("output.error mentions Graph credentials missing", () => {
    expect((capturedOutput().error as string)).toContain("Graph credentials missing");
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});

describe("create_exchange_calendar_event — missing subject is an error (live)", () => {
  beforeEach(async () => {
    resetState({ graphMissing: true });
    seedDb(singleNodeGraph("create_exchange_calendar_event", {
      userUpn: "shane@contoso.com",
      // subject omitted
      startDateTime: "2025-01-15T10:00:00Z",
      endDateTime:   "2025-01-15T11:00:00Z",
    }));
    await executeWorkflowRun(1);
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});

describe("create_exchange_calendar_event — dry-run returns preview event", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("create_exchange_calendar_event", {
      userUpn: "shane@contoso.com",
      subject: "Team Sync",
      startDateTime: "2025-01-15T10:00:00Z",
      endDateTime:   "2025-01-15T11:00:00Z",
    }));
    await executeWorkflowRun(1, { dryRun: true });
  });

  it("output.dryRun is true", () => {
    expect(capturedOutput().dryRun).toBe(true);
  });

  it("output.eventId is set", () => {
    expect(capturedOutput().eventId).toBeDefined();
  });
});

describe("create_exchange_calendar_event — Graph API happy path (live)", () => {
  beforeEach(async () => {
    resetState({ graphMissing: false });
    stubFetch(async () =>
      new Response(
        JSON.stringify({ id: "AAMkABCD", webLink: "https://outlook.office.com/calendar/item/AAMkABCD" }),
        { status: 200 },
      ),
    );
    seedDb(singleNodeGraph("create_exchange_calendar_event", {
      userUpn:       "shane@contoso.com",
      subject:       "Kick-off Meeting",
      startDateTime: "2025-01-15T10:00:00Z",
      endDateTime:   "2025-01-15T11:00:00Z",
    }));
    await executeWorkflowRun(1);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it("output.eventId is returned from Graph", () => {
    expect(capturedOutput().eventId).toBe("AAMkABCD");
  });

  it("output.eventUrl is the webLink", () => {
    expect(capturedOutput().eventUrl).toBe("https://outlook.office.com/calendar/item/AAMkABCD");
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

// =============================================================================
// save_to_sharepoint
// =============================================================================

describe("save_to_sharepoint — missing Graph credentials (live)", () => {
  beforeEach(async () => {
    resetState({ graphMissing: true });
    seedDb(singleNodeGraph("save_to_sharepoint", {
      siteId:          "contoso.sharepoint.com,abc,def",
      driveId:         "b!abc",
      fileName:        "report.pdf",
      fileContentText: "Hello world",
    }));
    await executeWorkflowRun(1);
  });

  it("output.error mentions Graph credentials", () => {
    expect((capturedOutput().error as string)).toContain("Graph credentials missing");
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});

describe("save_to_sharepoint — missing required siteId is an error (live)", () => {
  beforeEach(async () => {
    resetState({ graphMissing: true });
    seedDb(singleNodeGraph("save_to_sharepoint", {
      // siteId omitted
      driveId:         "b!abc",
      fileName:        "report.pdf",
      fileContentText: "content",
    }));
    await executeWorkflowRun(1);
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});

describe("save_to_sharepoint — dry-run returns placeholder item", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("save_to_sharepoint", {
      siteId:          "site-id",
      driveId:         "drive-id",
      fileName:        "document.pdf",
      fileContentText: "content",
    }));
    await executeWorkflowRun(1, { dryRun: true });
  });

  it("output.dryRun is true", () => {
    expect(capturedOutput().dryRun).toBe(true);
  });

  it("output.sharePointItemId is set", () => {
    expect(capturedOutput().sharePointItemId).toBeDefined();
  });
});

describe("save_to_sharepoint — Graph PUT succeeds (live)", () => {
  beforeEach(async () => {
    resetState({ graphMissing: false });
    stubFetch(async () =>
      new Response(
        JSON.stringify({ id: "01ABC", webUrl: "https://contoso.sharepoint.com/report.pdf", "@microsoft.graph.downloadUrl": "https://contoso.sharepoint.com/dl/report.pdf" }),
        { status: 200 },
      ),
    );
    seedDb(singleNodeGraph("save_to_sharepoint", {
      siteId:          "contoso.sharepoint.com,abc,def",
      driveId:         "b!abc",
      fileName:        "report.pdf",
      fileContentText: "Report content",
    }));
    await executeWorkflowRun(1);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it("output.sharePointItemId is from Graph response", () => {
    expect(capturedOutput().sharePointItemId).toBe("01ABC");
  });

  it("output.sharePointWebUrl is set", () => {
    expect(capturedOutput().sharePointWebUrl).toBe("https://contoso.sharepoint.com/report.pdf");
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

// =============================================================================
// get_from_sharepoint
// =============================================================================

describe("get_from_sharepoint — missing Graph credentials (live)", () => {
  beforeEach(async () => {
    resetState({ graphMissing: true });
    seedDb(singleNodeGraph("get_from_sharepoint", {
      siteId:   "contoso.sharepoint.com,abc,def",
      driveId:  "b!abc",
      itemPath: "documents/report.pdf",
    }));
    await executeWorkflowRun(1);
  });

  it("output.error mentions Graph credentials", () => {
    expect((capturedOutput().error as string)).toContain("Graph credentials missing");
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});

describe("get_from_sharepoint — dry-run returns placeholder file", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("get_from_sharepoint", {
      siteId:   "site-id",
      driveId:  "drive-id",
      itemPath: "documents/report.pdf",
    }));
    await executeWorkflowRun(1, { dryRun: true });
  });

  it("output.dryRun is true", () => {
    expect(capturedOutput().dryRun).toBe(true);
  });

  it("output.fileContentBase64 is set", () => {
    expect(typeof capturedOutput().fileContentBase64).toBe("string");
  });
});

describe("get_from_sharepoint — Graph GET succeeds (live)", () => {
  let fetchCallCount = 0;

  beforeEach(async () => {
    resetState({ graphMissing: false });
    fetchCallCount = 0;
    stubFetch(async (url: string) => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        // Metadata request
        return new Response(
          JSON.stringify({
            id: "01ABC",
            name: "report.pdf",
            webUrl: "https://contoso.sharepoint.com/report.pdf",
            file: { mimeType: "application/pdf" },
            "@microsoft.graph.downloadUrl": "https://cdn.sharepoint.com/report.pdf",
          }),
          { status: 200 },
        );
      }
      // Content download
      return new Response(Buffer.from("PDF content"), { status: 200 });
    });
    seedDb(singleNodeGraph("get_from_sharepoint", {
      siteId:   "contoso.sharepoint.com,abc,def",
      driveId:  "b!abc",
      itemPath: "documents/report.pdf",
    }));
    await executeWorkflowRun(1);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it("output.fileName is report.pdf", () => {
    expect(capturedOutput().fileName).toBe("report.pdf");
  });

  it("output.mimeType is application/pdf", () => {
    expect(capturedOutput().mimeType).toBe("application/pdf");
  });

  it("output.fileContentBase64 is a non-empty string", () => {
    expect(typeof capturedOutput().fileContentBase64).toBe("string");
    expect((capturedOutput().fileContentBase64 as string).length).toBeGreaterThan(0);
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

// =============================================================================
// generate_pdf
// =============================================================================

describe("generate_pdf — missing htmlTemplate is an error (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("generate_pdf", { htmlTemplate: "   " }));
    await executeWorkflowRun(1);
  });

  it("output.error mentions htmlTemplate", () => {
    expect((capturedOutput().error as string)).toContain("htmlTemplate");
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});

describe("generate_pdf — dry-run returns placeholder base64", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("generate_pdf", {
      htmlTemplate: "<p>Hello World</p>",
      fileName: "invoice.pdf",
    }));
    await executeWorkflowRun(1, { dryRun: true });
  });

  it("output.dryRun is true", () => {
    expect(capturedOutput().dryRun).toBe(true);
  });

  it("output.pdfDataUri starts with data:application/pdf", () => {
    expect((capturedOutput().pdfDataUri as string)).toContain("data:application/pdf");
  });

  it("output.fileName is invoice.pdf", () => {
    expect(capturedOutput().fileName).toBe("invoice.pdf");
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

// =============================================================================
// generate_invoice_stripe_payment
// =============================================================================

describe("generate_invoice_stripe_payment — missing Stripe key is an error (live)", () => {
  beforeEach(async () => {
    resetState({ stripeThrows: true });
    seedDb(singleNodeGraph("generate_invoice_stripe_payment", {
      customerEmail: "client@example.com",
      lineItems: '[{"description":"Consulting","amount":100000,"currency":"usd"}]',
    }));
    await executeWorkflowRun(1);
  });

  it("output.error contains the Stripe key error", () => {
    expect((capturedOutput().error as string)).toContain("STRIPE_SECRET_KEY");
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});

describe("generate_invoice_stripe_payment — missing customerEmail is an error (live)", () => {
  beforeEach(async () => {
    resetState({ stripeThrows: false });
    seedDb(singleNodeGraph("generate_invoice_stripe_payment", {
      // customerEmail omitted
      lineItems: '[{"description":"Consulting","amount":100000}]',
    }));
    await executeWorkflowRun(1);
  });

  it("output.error mentions customerEmail", () => {
    expect((capturedOutput().error as string)).toContain("customerEmail");
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});

describe("generate_invoice_stripe_payment — empty lineItems is an error (live)", () => {
  beforeEach(async () => {
    resetState({ stripeThrows: false });
    seedDb(singleNodeGraph("generate_invoice_stripe_payment", {
      customerEmail: "client@example.com",
      lineItems: "[]",
    }));
    await executeWorkflowRun(1);
  });

  it("output.error mentions line item requirement", () => {
    expect((capturedOutput().error as string)).toContain("line item");
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});

describe("generate_invoice_stripe_payment — dry-run returns placeholder invoice", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("generate_invoice_stripe_payment", {
      customerEmail: "client@example.com",
      lineItems: '[{"description":"Consulting","amount":100000}]',
    }));
    await executeWorkflowRun(1, { dryRun: true });
  });

  it("output.dryRun is true", () => {
    expect(capturedOutput().dryRun).toBe(true);
  });

  it("output.invoiceId is set", () => {
    expect(typeof capturedOutput().invoiceId).toBe("string");
  });

  it("output.amountDue is a number", () => {
    expect(typeof capturedOutput().amountDue).toBe("number");
  });
});

// =============================================================================
// generate_stripe_payment_link
// =============================================================================

describe("generate_stripe_payment_link — missing Stripe key is an error (live)", () => {
  beforeEach(async () => {
    resetState({ stripeThrows: true });
    seedDb(singleNodeGraph("generate_stripe_payment_link", {
      productName: "M365 Consulting",
      amount: "150000",
      currency: "usd",
    }));
    await executeWorkflowRun(1);
  });

  it("output.error contains the Stripe key error", () => {
    expect((capturedOutput().error as string)).toContain("STRIPE_SECRET_KEY");
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});

describe("generate_stripe_payment_link — missing productName is an error (live)", () => {
  beforeEach(async () => {
    resetState({ stripeThrows: false });
    seedDb(singleNodeGraph("generate_stripe_payment_link", {
      // productName omitted
      amount: "150000",
    }));
    await executeWorkflowRun(1);
  });

  it("output.error mentions productName", () => {
    expect((capturedOutput().error as string)).toContain("productName");
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});

describe("generate_stripe_payment_link — dry-run returns placeholder link", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("generate_stripe_payment_link", {
      productName: "M365 Consulting",
      amount: "150000",
      currency: "usd",
    }));
    await executeWorkflowRun(1, { dryRun: true });
  });

  it("output.dryRun is true", () => {
    expect(capturedOutput().dryRun).toBe(true);
  });

  it("output.paymentLinkUrl contains buy.stripe.com", () => {
    expect((capturedOutput().paymentLinkUrl as string)).toContain("stripe");
  });
});

// =============================================================================
// charge_stripe_invoice
// =============================================================================

describe("charge_stripe_invoice — missing Stripe key is an error (live)", () => {
  beforeEach(async () => {
    resetState({ stripeThrows: true });
    seedDb(singleNodeGraph("charge_stripe_invoice", { invoiceId: "in_test_123" }));
    await executeWorkflowRun(1);
  });

  it("output.error contains the Stripe key error", () => {
    expect((capturedOutput().error as string)).toContain("STRIPE_SECRET_KEY");
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});

describe("charge_stripe_invoice — missing invoiceId is an error (live)", () => {
  beforeEach(async () => {
    resetState({ stripeThrows: false });
    seedDb(singleNodeGraph("charge_stripe_invoice", {}));
    await executeWorkflowRun(1);
  });

  it("output.error mentions invoiceId", () => {
    expect((capturedOutput().error as string)).toContain("invoiceId");
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});

describe("charge_stripe_invoice — dry-run returns success preview", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("charge_stripe_invoice", { invoiceId: "in_test_123" }));
    await executeWorkflowRun(1, { dryRun: true });
  });

  it("output.dryRun is true", () => {
    expect(capturedOutput().dryRun).toBe(true);
  });

  it("output.chargeStatus is succeeded in dry-run", () => {
    expect(capturedOutput().chargeStatus).toBe("succeeded");
  });
});

// =============================================================================
// create_phased_invoices
// =============================================================================

describe("create_phased_invoices — missing Stripe key is an error (live)", () => {
  beforeEach(async () => {
    resetState({ stripeThrows: true });
    seedDb(singleNodeGraph("create_phased_invoices", {
      projectId: "42",
      clientEmail: "client@example.com",
      depositSessionId: "cs_test_123",
      phases: '[{"phaseId":"p1","phaseTitle":"Discovery","amount":5000}]',
    }));
    await executeWorkflowRun(1);
  });

  it("output.error contains Stripe key error", () => {
    expect((capturedOutput().error as string)).toContain("STRIPE_SECRET_KEY");
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});

describe("create_phased_invoices — missing projectId is an error (live)", () => {
  beforeEach(async () => {
    resetState({ stripeThrows: false });
    seedDb(singleNodeGraph("create_phased_invoices", {
      // projectId omitted
      clientEmail: "client@example.com",
      depositSessionId: "cs_test_123",
    }));
    await executeWorkflowRun(1);
  });

  it("output.error mentions projectId", () => {
    expect((capturedOutput().error as string)).toContain("projectId");
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});

describe("create_phased_invoices — dry-run returns placeholder invoices", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("create_phased_invoices", {
      projectId: "42",
      clientEmail: "client@example.com",
      depositSessionId: "cs_test_abc",
    }));
    await executeWorkflowRun(1, { dryRun: true });
  });

  it("output.dryRun is true", () => {
    expect(capturedOutput().dryRun).toBe(true);
  });

  it("output.invoiceIds is an array", () => {
    expect(Array.isArray(capturedOutput().invoiceIds)).toBe(true);
  });

  it("output.phaseCount is a number", () => {
    expect(typeof capturedOutput().phaseCount).toBe("number");
  });
});

// =============================================================================
// generate_phased_invoice
// =============================================================================

describe("generate_phased_invoice — missing clientEmail is an error (live)", () => {
  beforeEach(async () => {
    resetState({ stripeThrows: false });
    seedDb(singleNodeGraph("generate_phased_invoice", {
      // clientEmail omitted
      amountCents: "500000",
      depositSessionId: "cs_test_abc",
    }));
    await executeWorkflowRun(1);
  });

  it("output.error mentions clientEmail", () => {
    expect((capturedOutput().error as string)).toContain("clientEmail");
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});

describe("generate_phased_invoice — zero amountCents is an error (live)", () => {
  beforeEach(async () => {
    resetState({ stripeThrows: false });
    seedDb(singleNodeGraph("generate_phased_invoice", {
      clientEmail: "client@example.com",
      amountCents: "0",
      depositSessionId: "cs_test_abc",
    }));
    await executeWorkflowRun(1);
  });

  it("output.error mentions amountCents", () => {
    expect((capturedOutput().error as string)).toContain("amountCents");
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});

describe("generate_phased_invoice — dry-run returns placeholder", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("generate_phased_invoice", {
      clientEmail: "client@example.com",
      amountCents: "500000",
      depositSessionId: "cs_test_abc",
      phaseTitle: "Phase 1",
    }));
    await executeWorkflowRun(1, { dryRun: true });
  });

  it("output.dryRun is true", () => {
    expect(capturedOutput().dryRun).toBe(true);
  });
});

// =============================================================================
// approval_gate — dry-run
// =============================================================================

describe("approval_gate — dry-run returns approval preview", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("approval_gate", {
      label: "Approve before sending invoice",
      approverRole: "admin",
      expiresInHours: "48",
    }));
    await executeWorkflowRun(1, { dryRun: true });
  });

  it("output.dryRun is true", () => {
    expect(capturedOutput().dryRun).toBe(true);
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});
