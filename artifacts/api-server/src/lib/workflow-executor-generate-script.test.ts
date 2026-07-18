/**
 * Executor-level tests for the `generate_script` workflow node.
 *
 * These tests call executeWorkflowRun() with a minimal single-node graph so that
 * the full executor try/catch path is exercised — not just generateScriptFromService()
 * in isolation.  Assertions target observable side-effects (wfRunsTable updates)
 * rather than internal state so the tests remain valid as the executor evolves.
 *
 * Two scenarios:
 *   1. AI returns prose (no JSON envelope) → executor must mark run "failed" with
 *      an errorMessage that surfaces the problem; never "completed" silently.
 *   2. AI returns valid PowerShell → executor must mark run "completed".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WfGraph } from "@workspace/db";

// ── Shared state (hoisted so mock factories can reference it) ─────────────────

const psState = vi.hoisted(() => ({
  shouldThrow: true as boolean,
  throwMessage: "generate_script: AI did not return a valid JSON envelope — try again",
  result: { scriptId: "exec-test-script-id", packageId: null as null, title: "Exec Test Script" },
}));

const dbState = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  capturedUpdates: [] as Record<string, unknown>[],
}));

// ── Mock: ps-script-gen.js ────────────────────────────────────────────────────
vi.mock("./ps-script-gen.js", () => ({
  generateScriptFromService: vi.fn(async () => {
    if (psState.shouldThrow) throw new Error(psState.throwMessage);
    return psState.result;
  }),
  generateScriptFromDocument: vi.fn(async () => {
    if (psState.shouldThrow) throw new Error(psState.throwMessage);
    return psState.result;
  }),
}));

// ── Mock: drizzle-orm (prevent eq/and/inArray throwing on empty table objects) ─
vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  or: () => ({}),
  desc: () => ({}),
  asc: () => ({}),
  count: () => ({}),
  inArray: () => ({}),
  isNull: () => ({}),
  isNotNull: () => ({}),
  ne: () => ({}),
  gt: () => ({}),
  gte: () => ({}),
  lt: () => ({}),
  lte: () => ({}),
  like: () => ({}),
  ilike: () => ({}),
  notInArray: () => ({}),
  sql: Object.assign(() => ({}), { raw: () => ({}) }),
}));

// ── Mock: @workspace/db ───────────────────────────────────────────────────────
vi.mock("@workspace/db", () => {
  function makeSelectChain(result: unknown[]): Record<string, unknown> {
    const c: Record<string, unknown> = {
      from: () => c,
      where: () => c,
      limit: () => c,
      orderBy: () => c,
      innerJoin: () => c,
      leftJoin: () => c,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(res, rej),
      catch: (fn: (e: unknown) => unknown) => Promise.resolve(result).catch(fn),
    };
    return c;
  }

  const db = {
    select: (_cols?: unknown) => makeSelectChain(dbState.selectQueue.shift() ?? []),
    update: (_table: unknown) => ({
      set: (vals: unknown) => {
        dbState.capturedUpdates.push(vals as Record<string, unknown>);
        return { where: async () => [] };
      },
    }),
    insert: (_table: unknown) => ({
      values: (_vals: unknown) => ({
        returning: async () => [],
        catch: (_fn: unknown) => Promise.resolve(),
        onConflictDoNothing: () => ({ returning: async () => [] }),
      }),
      onConflictDoNothing: () => ({ returning: async () => [] }),
      catch: (_fn: unknown) => Promise.resolve(),
    }),
    execute: async () => ({ rows: [] }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };

  const noop = {};
  return {
    db,
    pool: { query: async () => ({ rows: [], rowCount: 0 }) },
    // All table references used by workflow-executor.ts
    wfRunsTable: noop,
    wfVersionsTable: noop,
    wfDefinitionsTable: noop,
    wfRunNodeLogsTable: noop,
    wfRunNodeOutputsTable: noop,
    wfTriggersTable: noop,
    pendingApprovalsTable: noop,
    leadsTable: noop,
    usersTable: noop,
    projectsTable: noop,
    opportunitiesTable: noop,
    clientDocumentsTable: noop,
    leadQualificationsTable: noop,
    quizLeadsTable: noop,
    clientHealthHistoryTable: noop,
    emailTemplatesTable: noop,
    marketingTasksTable: noop,
    kanbanTasksTable: noop,
    articlesTable: noop,
    notificationsTable: noop,
    campaignsTable: noop,
    campaignAssetsTable: noop,
    offersTable: noop,
    landingPagesTable: noop,
    clientPresentationsTable: noop,
    scriptRunResultsTable: noop,
    insightsGeneratedDocumentsTable: noop,
    clientM365ProfilesTable: noop,
    deviceTokensTable: noop,
    workflowStepsTable: noop,
    quickWinPresentationsTable: noop,
    powershellScriptsTable: noop,
    servicesTable: noop,
    scriptPackagesTable: noop,
    scriptModulesTable: noop,
    workflowTemplatesTable: noop,
    workflowTemplateStepsTable: noop,
    workflowTemplateStepTasksTable: noop,
  };
});

// ── Mock: all other workflow-executor.ts dependencies ─────────────────────────

vi.mock("./azure-automation", () => ({
  createRunbookJob: async () => {},
  isAzureConfigured: () => false,
}));

vi.mock("./news-fetcher.js", () => ({
  fetchNewsHeadlines: async () => [],
  DEFAULT_NEWS_PROMPT: "",
  CAMPAIGN_BRIEF_PROMPT: "",
}));

vi.mock("./web-push", () => ({ sendWebPushToAdmins: async () => {} }));
vi.mock("./push", () => ({ sendPushNotifications: async () => {} }));

vi.mock("./sse-channels", () => ({
  broadcastAdminWorkflowEvent: () => {},
  broadcastPresentationPhaseGenProgress: () => {},
  broadcastPresentationPhaseGenComplete: () => {},
  broadcastPresentationPhaseGenError: () => {},
  broadcastPresentationDocsChange: () => {},
  broadcastPresentationProjectReady: () => {},
  replayPhaseGenState: () => {},
}));

vi.mock("./consolidated-sow-generator", () => ({
  generateConsolidatedSowDocument: async () => {},
  broadcastSowChangeForProject: async () => {},
  broadcastDocsChangeForProject: async () => {},
}));

vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: { messages: { create: async () => {} } },
}));

vi.mock("@workspace/integrations-openai-ai-server/image", () => ({
  openai: { images: { generate: async () => {} } },
}));

vi.mock("./logger", () => {
  const n = () => {};
  const l = { info: n, warn: n, error: n, debug: n, fatal: n, trace: n, child: () => l };
  return { logger: l };
});

vi.mock("./prompt-loader", () => ({
  getPrompt: async (_key: string, fallback: string) => fallback,
  getDocumentStylePrefix: async () => "",
}));

vi.mock("./sow-pricing-persist.js", () => ({ persistSowPricing: async () => {} }));

vi.mock("ajv", () => {
  const MockAjv = function () {
    return { compile: () => () => true, addFormat: () => {} };
  };
  MockAjv.default = MockAjv;
  return { default: MockAjv };
});

// ── Import executeWorkflowRun AFTER all mocks are registered ──────────────────
import { executeWorkflowRun } from "./workflow-executor";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FAKE_RUN = {
  id: 1,
  versionId: 1,
  payload: {},
  definitionId: null,
  status: "pending",
};

const FAKE_VERSION = { id: 1, graph: null };

// Minimal single-node graph: one generate_script node, no edges.
// inlineGraph overrides the stored version graph.
const GENERATE_SCRIPT_GRAPH: WfGraph = {
  nodes: [
    {
      id: "gs-node-1",
      type: "generate_script",
      data: { sourceMode: "service", targetId: "42", outputMode: "auto" },
      position: { x: 0, y: 0 },
    },
  ],
  edges: [],
};

// Document-source graph with a piped {{documentId}} expression instead of a
// literal targetId — mirrors what the builder UI now allows the user to type
// into the "Or Enter Document ID (piped)" field.
const GENERATE_SCRIPT_PIPED_DOC_GRAPH: WfGraph = {
  nodes: [
    {
      id: "gs-node-1",
      type: "generate_script",
      data: { sourceMode: "document", targetId: "{{documentId}}", outputMode: "auto" },
      position: { x: 0, y: 0 },
    },
  ],
  edges: [],
};

// ── Suite 1: Prose-only AI response → executor must fail the run ──────────────
//
// When generateScriptFromService() throws (no valid JSON/PS in AI response),
// the executor's catch block must set nodeError = true, which bubbles up to
// db.update(wfRunsTable, { status: "failed", errorMessage: "..." }).
// The run must NEVER be silently completed.

describe("executor: generate_script node — prose-only AI response causes run failure", () => {
  beforeEach(async () => {
    psState.shouldThrow = true;
    dbState.capturedUpdates = [];
    // Queue: run row, version row, cancellation check
    dbState.selectQueue = [[FAKE_RUN], [FAKE_VERSION], [{ status: "running" }]];
    await executeWorkflowRun(1, { inlineGraph: GENERATE_SCRIPT_GRAPH });
  });

  it("marks the run as failed in wfRunsTable", () => {
    const failedUpdate = dbState.capturedUpdates.find(
      (u) => (u as Record<string, unknown>).status === "failed",
    );
    expect(failedUpdate).toBeDefined();
  });

  it("errorMessage surfaces the generate_script error prefix", () => {
    const failedUpdate = dbState.capturedUpdates.find(
      (u) => (u as Record<string, unknown>).status === "failed",
    );
    expect(typeof (failedUpdate as Record<string, unknown>)?.errorMessage).toBe("string");
    expect((failedUpdate as Record<string, unknown>).errorMessage).toContain("generate_script");
  });

  it("does NOT mark the run as completed — no silent success", () => {
    const completedUpdate = dbState.capturedUpdates.find(
      (u) => (u as Record<string, unknown>).status === "completed",
    );
    expect(completedUpdate).toBeUndefined();
  });
});

// ── Suite 2: Valid PowerShell AI response → executor must complete the run ────
//
// When generateScriptFromService() returns a valid { scriptId, packageId, title },
// the executor must reach the completion update — no failed status.

describe("executor: generate_script node — valid PowerShell AI response completes the run", () => {
  beforeEach(async () => {
    psState.shouldThrow = false;
    dbState.capturedUpdates = [];
    dbState.selectQueue = [[FAKE_RUN], [FAKE_VERSION], [{ status: "running" }]];
    await executeWorkflowRun(1, { inlineGraph: GENERATE_SCRIPT_GRAPH });
  });

  it("marks the run as completed in wfRunsTable", () => {
    const completedUpdate = dbState.capturedUpdates.find(
      (u) => (u as Record<string, unknown>).status === "completed",
    );
    expect(completedUpdate).toBeDefined();
  });

  it("does NOT mark the run as failed when PS generation succeeds", () => {
    const failedUpdate = dbState.capturedUpdates.find(
      (u) => (u as Record<string, unknown>).status === "failed",
    );
    expect(failedUpdate).toBeUndefined();
  });
});

// ── Suite 3: Piped {{documentId}} targetId ("From Document" mode) ─────────────
//
// The builder now lets the user type a piped expression (e.g. {{documentId}})
// into targetId when sourceMode === "document" instead of picking a document
// from the static list. The executor already runs interp() on targetId before
// parsing it as a number — this confirms that path resolves correctly against
// the run's payload and reaches generateScriptFromDocument() with the resolved
// numeric ID, completing the run successfully.

describe("executor: generate_script node — piped {{documentId}} targetId (From Document mode)", () => {
  beforeEach(async () => {
    psState.shouldThrow = false;
    dbState.capturedUpdates = [];
    // Payload simulates an upstream generate_document/find_object node having
    // already populated {{documentId}} before this node runs.
    const runWithDocumentId = { ...FAKE_RUN, payload: { documentId: 77 } };
    dbState.selectQueue = [[runWithDocumentId], [FAKE_VERSION], [{ status: "running" }]];
    await executeWorkflowRun(1, { inlineGraph: GENERATE_SCRIPT_PIPED_DOC_GRAPH });
  });

  it("resolves the piped documentId and completes the run", () => {
    const completedUpdate = dbState.capturedUpdates.find(
      (u) => (u as Record<string, unknown>).status === "completed",
    );
    expect(completedUpdate).toBeDefined();
  });

  it("does NOT fail the run due to an unresolved targetId", () => {
    const failedUpdate = dbState.capturedUpdates.find(
      (u) => (u as Record<string, unknown>).status === "failed",
    );
    expect(failedUpdate).toBeUndefined();
  });
});
