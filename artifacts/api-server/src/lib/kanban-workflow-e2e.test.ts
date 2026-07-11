/**
 * End-to-end integration test: kanban.card_moved event → workflow executor → handler
 *
 * Verifies the full dispatch path:
 *   emitWorkflowEvent('kanban.card_moved', { action, clientUserId })
 *     → trigger matched in wf_triggers
 *     → fireWorkflowForDefinition creates a run
 *     → executeWorkflowRun BFS traverses the kanban auto-fire graph:
 *         start → condition (clientUserId > 0) → monitor_execute_package → end
 *     → monitor_execute_package node calls the correct kanban-auto-fire function
 *       based on the `action` field in the payload
 *
 * Uses Vitest because Vitest resolves TypeScript imports transparently
 * (no explicit .ts extensions needed), which lets it stub the module graph
 * through the real workflow-executor → kanban-auto-fire chain.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Shared mutable state (vi.hoisted so factories can close over it) ──────────
const state = vi.hoisted(() => ({
  dbQueue: [] as unknown[][],
  scriptCalls: 0,
  documentCalls: 0,
  lastScriptClientId: undefined as number | undefined,
  lastDocumentClientId: undefined as number | undefined,
}));

// ── The kanban auto-fire workflow graph (matches seed-system-workflows.ts) ─────
// start → condition (clientUserId > 0) → monitor_execute_package → end
//                                      ↘ end_skip (no client)
const KANBAN_GRAPH = {
  nodes: [
    { id: "start",    type: "start",                   position: { x: 100, y: 100 }, data: { nodeType: "start",                   label: "kanban.card_moved" } },
    { id: "guard",    type: "condition",                position: { x: 100, y: 230 }, data: { nodeType: "condition",                label: "Has Client?",       expression: "clientUserId > 0" } },
    { id: "execute",  type: "monitor_execute_package",  position: { x: 100, y: 360 }, data: { nodeType: "monitor_execute_package",  label: "Auto-fire Card",    clientId: "{{clientUserId}}", action: "{{action}}" } },
    { id: "end",      type: "end",                      position: { x: 100, y: 490 }, data: { nodeType: "end",                      label: "Done" } },
    { id: "end_skip", type: "end",                      position: { x: 250, y: 230 }, data: { nodeType: "end",                      label: "No client — skip" } },
  ],
  edges: [
    { id: "e1", source: "start",   target: "guard"    },
    { id: "e2", source: "guard",   target: "execute",  sourceHandle: "true"  },
    { id: "e3", source: "guard",   target: "end_skip", sourceHandle: "false" },
    { id: "e4", source: "execute", target: "end"       },
  ],
};

// ── Fake DB trigger and version rows ──────────────────────────────────────────
const FAKE_TRIGGER = { id: 1, definitionId: 10, type: "event", enabled: true, config: { eventName: "kanban.card_moved" }, nextRunAt: null };
const FAKE_VERSION = { id: 5, definitionId: 10, status: "published", label: "v1", graph: KANBAN_GRAPH };
const FAKE_DEF     = { id: 10, concurrencyLimit: 1 };

// ── Mock @workspace/db ────────────────────────────────────────────────────────
// Queue-based: each db.select() call pops the next result from state.dbQueue.
// Inserts and updates are no-ops (except wfRunsTable insert which returns runId).
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

  // Insert mock: wfRunsTable inserts return a runId; all others are caught silently
  function makeInsertValues(returningResult: unknown[]) {
    return {
      returning: async () => returningResult,
      catch:     async () => {},
    };
  }

  function makeUpdateChain(): Record<string, unknown> {
    const chain: Record<string, unknown> = {
      set:   () => ({ where: async () => [] }),
      where: async () => [],
    };
    return chain;
  }

  const db = {
    select: (_cols?: unknown) => makeSelectChain(state.dbQueue.shift() ?? []),
    insert: (_table?: unknown) => ({
      values: (_vals?: unknown) => makeInsertValues([{ id: 99 }]),
    }),
    update: () => makeUpdateChain(),
  };

  return {
    db,
    pool: { query: async () => ({ rows: [], rowCount: 0 }) },
    // Tables — used as drizzle column refs; actual values don't matter since our
    // mock chain ignores the .where() argument entirely.
    wfRunsTable:           { id: {}, definitionId: {}, status: {}, versionId: {}, branchPath: {}, startedAt: {}, finishedAt: {}, errorMessage: {} },
    wfVersionsTable:       { id: {}, definitionId: {}, status: {} },
    wfDefinitionsTable:    { id: {}, concurrencyLimit: {} },
    wfTriggersTable:       { id: {}, type: {}, enabled: {}, definitionId: {}, config: {}, nextRunAt: {} },
    wfRunNodeOutputsTable: {},
    wfRunNodeLogsTable:    {},
    leadsTable:            {},
    usersTable:            {},
    projectsTable:         {},
    opportunitiesTable:    {},
    clientDocumentsTable:  {},
    leadQualificationsTable: {},
    quizLeadsTable:        {},
    clientHealthHistoryTable: {},
    type: undefined,
  };
});

// ── Mock kanban-auto-fire (call tracking) ─────────────────────────────────────
vi.mock("./kanban-auto-fire", () => ({
  autoFireFirstBacklogScript: async (clientUserId: number) => {
    state.scriptCalls++;
    state.lastScriptClientId = clientUserId;
  },
  autoFireDocumentCard: async (clientUserId: number) => {
    state.documentCalls++;
    state.lastDocumentClientId = clientUserId;
  },
  autoFireRunWorkflowCards:            async () => {},
  reconcileOrphanedRuns:               async () => {},
  reconcileStalledPhases:              async () => {},
  reconcileLateStuckQueuedCompletions: async () => {},
}));

// ── Mock azure-automation (no real Azure calls) ───────────────────────────────
vi.mock("./azure-automation", () => ({
  createRunbookJob:  async () => "fake-job-id",
  isAzureConfigured: () => false,
  getJobStatus:      async () => "Completed",
  getJobOutput:      async () => "",
  isTerminalStatus:  () => true,
}));

// ── Mock logger ───────────────────────────────────────────────────────────────
vi.mock("./logger", () => {
  const n = () => {};
  const log = { info: n, warn: n, error: n, debug: n, fatal: n, trace: n, child: () => log };
  return { logger: log };
});

// ── Mock admin-insights (imported by system-action-handlers) ──────────────────
vi.mock("../routes/admin-insights", () => ({
  executeAutomation: async () => {},
  nextRunFromCron:   () => new Date(),
}));

// ── Mock manual-script-escalation (imported by system-action-handlers) ─────────
vi.mock("./manual-script-escalation", () => ({
  checkManualScriptEscalations: async () => ({ alerted: 0, checked: 0, cardIds: [] }),
}));

// ── Import after all mocks are registered ─────────────────────────────────────
import { emitWorkflowEvent } from "./workflow-executor";

// ── Helpers ───────────────────────────────────────────────────────────────────

function resetState() {
  state.dbQueue = [];
  state.scriptCalls = 0;
  state.documentCalls = 0;
  state.lastScriptClientId = undefined;
  state.lastDocumentClientId = undefined;
}

/**
 * Seed the DB queue for one kanban.card_moved event with the given payload.
 * Order matches the exact sequence of db.select() calls through
 * emitWorkflowEvent → fireWorkflowForDefinition → executeWorkflowRun.
 */
function seedDbQueue(runPayload: Record<string, unknown>) {
  state.dbQueue = [
    // 1. emitWorkflowEvent: SELECT from wf_triggers WHERE type='event' AND enabled=true
    [FAKE_TRIGGER],
    // 2. fireWorkflowForDefinition: SELECT version WHERE definitionId=10 AND status='published'
    [FAKE_VERSION],
    // 3. fireWorkflowForDefinition: SELECT definition WHERE id=10
    [FAKE_DEF],
    // 4. countRunningRuns: SELECT count(*) FROM wf_runs WHERE definitionId=10 AND status='running'
    [{ cnt: 0 }],
    // (INSERT wf_runs → mock returns [{ id: 99 }])
    // 5. executeWorkflowRun: SELECT run WHERE id=99
    [{ id: 99, versionId: 5, payload: runPayload, status: "pending", triggerType: "event", triggerRef: "event:kanban.card_moved", branchPath: [] }],
    // 6. executeWorkflowRun: SELECT version WHERE id=5
    [FAKE_VERSION],
    // (UPDATE wf_runs SET status='running' — no-op via update mock)
    // 7-10. BFS cancellation checks (one per traversed node: start, guard, execute, end)
    // For the no-clientUserId path only 3 are consumed (start, guard, end_skip); extra is harmless.
    [{ status: "running" }],
    [{ status: "running" }],
    [{ status: "running" }],
    [{ status: "running" }],
  ];
}

/** Wait for executeWorkflowRun to finish (it runs in a setImmediate after fireWorkflowForDefinition). */
async function waitForWorkflowRun() {
  // Let fireWorkflowForDefinition's setImmediate fire
  await new Promise<void>(resolve => setImmediate(resolve));
  // Flush all remaining microtasks from executeWorkflowRun's async chain
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

beforeEach(() => {
  resetState();
});

// =============================================================================
// action = 'script'
// Emitting the event with action='script' must call autoFireFirstBacklogScript
// ONLY — the document handler must stay idle.
// =============================================================================

describe("kanban.card_moved e2e — action='script'", () => {
  beforeEach(async () => {
    seedDbQueue({ clientUserId: 42, action: "script", _eventType: "kanban.card_moved" });
    await emitWorkflowEvent("kanban.card_moved", { clientUserId: 42, action: "script" });
    await waitForWorkflowRun();
  });

  it("autoFireFirstBacklogScript is called exactly once", () => {
    expect(state.scriptCalls).toBe(1);
  });

  it("autoFireFirstBacklogScript receives the correct clientUserId", () => {
    expect(state.lastScriptClientId).toBe(42);
  });

  it("autoFireDocumentCard is NOT called", () => {
    expect(state.documentCalls).toBe(0);
  });
});

// =============================================================================
// action = 'document'
// Emitting with action='document' must call autoFireDocumentCard ONLY.
// =============================================================================

describe("kanban.card_moved e2e — action='document'", () => {
  beforeEach(async () => {
    seedDbQueue({ clientUserId: 77, action: "document", _eventType: "kanban.card_moved" });
    await emitWorkflowEvent("kanban.card_moved", { clientUserId: 77, action: "document" });
    await waitForWorkflowRun();
  });

  it("autoFireDocumentCard is called exactly once", () => {
    expect(state.documentCalls).toBe(1);
  });

  it("autoFireDocumentCard receives the correct clientUserId", () => {
    expect(state.lastDocumentClientId).toBe(77);
  });

  it("autoFireFirstBacklogScript is NOT called", () => {
    expect(state.scriptCalls).toBe(0);
  });
});

// =============================================================================
// No matching trigger
// If the trigger's eventName doesn't match, no workflow fires.
// =============================================================================

describe("kanban.card_moved e2e — event name mismatch (no matching trigger)", () => {
  beforeEach(async () => {
    // Return a trigger that watches a DIFFERENT event
    state.dbQueue = [
      [{ ...FAKE_TRIGGER, config: { eventName: "some.other.event" } }],
    ];
    await emitWorkflowEvent("kanban.card_moved", { clientUserId: 99, action: "script" });
    await waitForWorkflowRun();
  });

  it("neither auto-fire function is called when the trigger doesn't match", () => {
    expect(state.scriptCalls).toBe(0);
    expect(state.documentCalls).toBe(0);
  });
});

// =============================================================================
// Edge case: missing clientUserId in the event payload
// The workflow still runs (trigger matches) but the condition node evaluates
// `clientUserId > 0` as false, routing to end_skip without calling any function.
// =============================================================================

describe("kanban.card_moved e2e — missing clientUserId in payload", () => {
  beforeEach(async () => {
    seedDbQueue({ action: "script", _eventType: "kanban.card_moved" }); // no clientUserId
    await emitWorkflowEvent("kanban.card_moved", { action: "script" });
    await waitForWorkflowRun();
  });

  it("neither auto-fire function is called", () => {
    expect(state.scriptCalls).toBe(0);
    expect(state.documentCalls).toBe(0);
  });
});
