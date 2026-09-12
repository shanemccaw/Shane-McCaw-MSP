/**
 * Executor-level tests for the `generate_script` workflow node.
 *
 * #3565 — this node no longer calls Anthropic directly. It now pauses the run
 * for a human hand-off (same pauseForApproval / wf_runs.status =
 * "awaiting_approval" mechanism approval_gate / break_glass_verification_gate
 * already use) instead of generating the script itself. These tests call
 * executeWorkflowRun() with a minimal single-node graph so that the full
 * executor try/catch path is exercised — not just the case body in isolation.
 * Assertions target observable side-effects (wfRunsTable updates,
 * pending_script_handoffs inserts) rather than internal state so the tests
 * remain valid as the executor evolves.
 *
 * Scenarios:
 *   1. Valid target (service) → run pauses ("awaiting_approval"), a
 *      pending_script_handoffs row is created, run is never silently
 *      "completed".
 *   2. Piped {{documentId}} target ("From Document" mode) → the piped
 *      expression still resolves before the pause.
 *   3. Missing/invalid target → the run still fails immediately (no AI call
 *      needed to know the config is broken).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WfGraph } from "@workspace/db";

// ── Shared state (hoisted so mock factories can reference it) ─────────────────

const dbState = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  capturedUpdates: [] as Record<string, unknown>[],
  capturedInserts: [] as Record<string, unknown>[],
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
      values: (vals: unknown) => {
        dbState.capturedInserts.push(vals as Record<string, unknown>);
        return {
          // Echo the inserted row back with a fake id — mirrors what a real
          // `.returning()` gives the executor (it reads `handoff.id` etc.
          // immediately after inserting).
          returning: async () => [{ id: 555, ...(vals as Record<string, unknown>) }],
          catch: (_fn: unknown) => Promise.resolve(),
          onConflictDoNothing: () => ({ returning: async () => [] }),
        };
      },
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
    pendingScriptHandoffsTable: noop,
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

vi.mock("./azure-automation.ts", () => ({
  createRunbookJob: async () => {},
  isAzureConfigured: () => false,
}));

vi.mock("./news-fetcher.ts", () => ({
  fetchNewsHeadlines: async () => [],
  DEFAULT_NEWS_PROMPT: "",
  CAMPAIGN_BRIEF_PROMPT: "",
}));

vi.mock("./web-push.ts", () => ({ sendWebPushToAdmins: async () => {} }));
vi.mock("./push.ts", () => ({ sendPushNotifications: async () => {} }));

// generate_script's pause path notifies admins via notification-center, not a
// direct DB/SSE call — stub the leaf module rather than its (unmocked) own
// transitive imports (graphEmail, event-bus, sse-channels), same reasoning as
// ./web-push and ./push above.
vi.mock("./notification-center.ts", () => ({
  createNotification: async () => {},
  createNotificationForAllAdmins: async () => {},
}));

vi.mock("./sse-channels.ts", () => ({
  broadcastAdminWorkflowEvent: () => {},
  broadcastPresentationPhaseGenProgress: () => {},
  broadcastPresentationPhaseGenComplete: () => {},
  broadcastPresentationPhaseGenError: () => {},
  broadcastPresentationDocsChange: () => {},
  broadcastPresentationProjectReady: () => {},
  replayPhaseGenState: () => {},
  broadcastWorkflowRunError: () => {},
}));

vi.mock("./document-engine-sow.ts", () => ({
  broadcastSowChangeForProject: async () => {},
  broadcastDocsChangeForProject: async () => {},
}));

vi.mock("@workspace/integrations-anthropic-ai", () => ({
  // The executor wraps every AI call in withAiAttribution() so the metered
  // client can bill it. Pass-through here — attribution itself is covered by
  // ai-usage-metering.test.ts; this mock only needs the call to still happen.
  withAiAttribution: <T,>(_attribution: unknown, fn: () => T): T => fn(),
  // Phase 5: the document engines call withAiUsageCapture instead, to read back
  // what the call cost. Pass-through with no costs — these tests assert the call
  // still happens, not what it cost.
  withAiUsageCapture: async <T,>(_attribution: unknown, fn: () => Promise<T>) => ({ result: await fn(), costs: [] }),
  totalCapturedCostCents: () => null,
  anthropic: { messages: { create: async () => {} } },
}));

vi.mock("@workspace/integrations-openai-ai-server/image", () => ({
  openai: { images: { generate: async () => {} } },
}));

vi.mock("./logger.ts", () => {
  const n = () => {};
  const l = { info: n, warn: n, error: n, debug: n, fatal: n, trace: n, child: () => l };
  return { logger: l };
});

vi.mock("./prompt-loader.ts", () => ({
  getPrompt: async (_key: string, fallback: string) => fallback,
  getDocumentStylePrefix: async () => "",
}));

vi.mock("./sow-pricing-persist.ts", () => ({ persistSowPricing: async () => {} }));

vi.mock("ajv", () => {
  const MockAjv = function () {
    return { compile: () => () => true, addFormat: () => {} };
  };
  MockAjv.default = MockAjv;
  return { default: MockAjv };
});

// ── Import executeWorkflowRun AFTER all mocks are registered ──────────────────
import { executeWorkflowRun } from "./workflow-executor.ts";

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

const MISSING_TARGET_GRAPH: WfGraph = {
  nodes: [
    {
      id: "gs-node-1",
      type: "generate_script",
      data: { sourceMode: "service", outputMode: "auto" },
      position: { x: 0, y: 0 },
    },
  ],
  edges: [],
};

// ── Suite 1: valid service target → run pauses for the human hand-off ─────────

describe("executor: generate_script node — service source pauses the run for a script hand-off", () => {
  beforeEach(async () => {
    dbState.capturedUpdates = [];
    dbState.capturedInserts = [];
    // Queue: run row, version row, per-node cancellation check, target-label select.
    dbState.selectQueue = [[FAKE_RUN], [FAKE_VERSION], [{ status: "running" }], [{ name: "Test Service" }]];
    await executeWorkflowRun(1, { inlineGraph: GENERATE_SCRIPT_GRAPH });
  });

  it("marks the run as awaiting_approval, not completed or failed", () => {
    const awaitingUpdate = dbState.capturedUpdates.find((u) => u.status === "awaiting_approval");
    expect(awaitingUpdate).toBeDefined();
    expect(dbState.capturedUpdates.find((u) => u.status === "completed")).toBeUndefined();
    expect(dbState.capturedUpdates.find((u) => u.status === "failed")).toBeUndefined();
  });

  it("creates a pending_script_handoffs row with the resolved target", () => {
    const handoffInsert = dbState.capturedInserts.find((i) => i.sourceMode === "service");
    expect(handoffInsert).toBeDefined();
    expect(handoffInsert?.targetId).toBe(42);
    expect(handoffInsert?.targetLabel).toBe("Test Service");
    expect(handoffInsert?.status).toBe("pending");
  });

  it("never calls generateScriptFromService/Document — no AI-generated scriptId in the run's own output", () => {
    // The node's own paused output carries handoffId, not a scriptId/packageId —
    // those only appear once Shane completes the hand-off and the run resumes.
    const handoffInsert = dbState.capturedInserts.find((i) => i.sourceMode === "service");
    expect(handoffInsert).not.toHaveProperty("scriptId");
  });
});

// ── Suite 2: piped {{documentId}} targetId ("From Document" mode) ─────────────

describe("executor: generate_script node — piped {{documentId}} targetId (From Document mode)", () => {
  beforeEach(async () => {
    dbState.capturedUpdates = [];
    dbState.capturedInserts = [];
    // Payload simulates an upstream generate_document/find_object node having
    // already populated {{documentId}} before this node runs.
    const runWithDocumentId = { ...FAKE_RUN, payload: { documentId: 77 } };
    dbState.selectQueue = [[runWithDocumentId], [FAKE_VERSION], [{ status: "running" }], [{ title: "Test Document" }]];
    await executeWorkflowRun(1, { inlineGraph: GENERATE_SCRIPT_PIPED_DOC_GRAPH });
  });

  it("resolves the piped documentId and pauses for the hand-off", () => {
    const handoffInsert = dbState.capturedInserts.find((i) => i.sourceMode === "document");
    expect(handoffInsert).toBeDefined();
    expect(handoffInsert?.targetId).toBe(77);
    expect(handoffInsert?.targetLabel).toBe("Test Document");
  });

  it("does NOT fail the run due to an unresolved targetId", () => {
    const failedUpdate = dbState.capturedUpdates.find((u) => u.status === "failed");
    expect(failedUpdate).toBeUndefined();
  });
});

// ── Suite 3: missing target → still fails immediately, no hand-off created ────

describe("executor: generate_script node — missing targetId fails the run without pausing", () => {
  beforeEach(async () => {
    dbState.capturedUpdates = [];
    dbState.capturedInserts = [];
    dbState.selectQueue = [[FAKE_RUN], [FAKE_VERSION], [{ status: "running" }]];
    await executeWorkflowRun(1, { inlineGraph: MISSING_TARGET_GRAPH });
  });

  it("marks the run as failed", () => {
    const failedUpdate = dbState.capturedUpdates.find((u) => u.status === "failed");
    expect(failedUpdate).toBeDefined();
    expect(typeof failedUpdate?.errorMessage).toBe("string");
    expect(failedUpdate?.errorMessage).toContain("generate_script");
  });

  it("does not create a pending_script_handoffs row", () => {
    expect(dbState.capturedInserts.find((i) => i.sourceMode != null)).toBeUndefined();
  });

  it("does not pause the run (no awaiting_approval update)", () => {
    expect(dbState.capturedUpdates.find((u) => u.status === "awaiting_approval")).toBeUndefined();
  });
});
