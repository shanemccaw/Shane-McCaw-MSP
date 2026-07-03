/**
 * Unit tests for handleSystemAction('auto_fire_kanban', payload) routing.
 *
 * Verifies that the Kanban Auto-fire system-action handler correctly:
 *   1. Calls autoFireFirstBacklogScript (and NOT autoFireDocumentCard)
 *      when action='script'.
 *   2. Calls autoFireDocumentCard (and NOT autoFireFirstBacklogScript)
 *      when action='document'.
 *   3. Calls BOTH functions when action='both' (the default).
 *   4. Returns { skipped: true } without calling either function when
 *      clientUserId is absent from the payload.
 *   5. clientUserId=0 (falsy) is treated as absent — same guard.
 *
 * Approach:
 *   - mock.module() stubs kanban-auto-fire and all heavy dependencies so
 *     no real DB connections or Azure calls are made.
 *   - Call counters let each test assert exactly which functions fired.
 *   - Because the handler fires functions with .catch() (fire-and-forget),
 *     a microtask flush (await Promise.resolve() x2) is needed before
 *     asserting.
 *   - IMPORTANT: mock specifiers must match the exact import strings used in
 *     system-action-handlers.ts (no .ts extension — the source uses bare
 *     relative paths like "./logger", "./kanban-auto-fire", etc.).
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */
import { describe, it, mock, before } from "node:test";
import assert from "node:assert/strict";

// ── Call counters — reset before each test scenario ──────────────────────────
let scriptCallCount = 0;
let documentCallCount = 0;
let lastScriptClientId: number | undefined;
let lastDocumentClientId: number | undefined;

function resetCounters() {
  scriptCallCount = 0;
  documentCallCount = 0;
  lastScriptClientId = undefined;
  lastDocumentClientId = undefined;
}

// ── Stub kanban-auto-fire BEFORE importing system-action-handlers ─────────────
// NOTE: specifier must match the exact string in system-action-handlers.ts:
//   import { ... } from "./kanban-auto-fire.ts";
mock.module("./kanban-auto-fire.ts", {
  namedExports: {
    autoFireFirstBacklogScript: async (clientUserId: number) => {
      scriptCallCount++;
      lastScriptClientId = clientUserId;
    },
    autoFireDocumentCard: async (clientUserId: number) => {
      documentCallCount++;
      lastDocumentClientId = clientUserId;
    },
    reconcileOrphanedRuns: async () => {},
    reconcileStalledPhases: async () => {},
  },
});

// ── Stub logger (imported as "./logger.ts") ───────────────────────────────────
const noop = () => {};
const noopLogger = {
  info: noop, warn: noop, error: noop, debug: noop,
  fatal: noop, trace: noop, child: () => noopLogger,
};
mock.module("./logger.ts", {
  namedExports: { logger: noopLogger },
});

// ── Stub manual-script-escalation (imported as "./manual-script-escalation.ts") ──
mock.module("./manual-script-escalation.ts", {
  namedExports: {
    checkManualScriptEscalations: async () => ({ alerted: 0, checked: 0, cardIds: [] }),
  },
});

// ── Stub admin-insights (imported as "../routes/admin-insights.ts") ────────────
mock.module("../routes/admin-insights.ts", {
  namedExports: {
    executeAutomation: async () => {},
    nextRunFromCron: () => new Date(),
  },
});

// ── Stub @workspace/db (no real DB) ───────────────────────────────────────────
mock.module("@workspace/db", {
  namedExports: {
    pool: { query: async () => ({ rows: [], rowCount: 0 }) },
    db: {
      select: () => ({
        from: () => ({ where: () => ({ then: (r: (v: unknown[]) => void) => r([]) }) }),
      }),
      update: () => ({ set: () => ({ where: async () => [] }) }),
    },
    insightsAutomationsTable: {},
  },
});

// ── Import the handler under test AFTER all mocks are registered ──────────────
const { handleSystemAction } = await import("./system-action-handlers.ts");

/** Flush all microtasks so fire-and-forget promises resolve before asserting. */
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

// =============================================================================
// action = 'script'  → only autoFireFirstBacklogScript should be called
// =============================================================================

describe("handleSystemAction auto_fire_kanban — action='script'", () => {
  let result: Record<string, unknown>;

  before(async () => {
    resetCounters();
    result = await handleSystemAction("auto_fire_kanban", {
      clientUserId: 42,
      action: "script",
    });
    await flushMicrotasks();
  });

  it("returns fired=true with the correct clientUserId and action", () => {
    assert.deepEqual(result, { fired: true, clientUserId: 42, action: "script" });
  });

  it("calls autoFireFirstBacklogScript exactly once", () => {
    assert.equal(scriptCallCount, 1, `expected 1 script call, got ${scriptCallCount}`);
  });

  it("passes the correct clientUserId to autoFireFirstBacklogScript", () => {
    assert.equal(lastScriptClientId, 42);
  });

  it("does NOT call autoFireDocumentCard", () => {
    assert.equal(documentCallCount, 0, `expected 0 document calls, got ${documentCallCount}`);
  });
});

// =============================================================================
// action = 'document'  → only autoFireDocumentCard should be called
// =============================================================================

describe("handleSystemAction auto_fire_kanban — action='document'", () => {
  let result: Record<string, unknown>;

  before(async () => {
    resetCounters();
    result = await handleSystemAction("auto_fire_kanban", {
      clientUserId: 99,
      action: "document",
    });
    await flushMicrotasks();
  });

  it("returns fired=true with the correct clientUserId and action", () => {
    assert.deepEqual(result, { fired: true, clientUserId: 99, action: "document" });
  });

  it("calls autoFireDocumentCard exactly once", () => {
    assert.equal(documentCallCount, 1, `expected 1 document call, got ${documentCallCount}`);
  });

  it("passes the correct clientUserId to autoFireDocumentCard", () => {
    assert.equal(lastDocumentClientId, 99);
  });

  it("does NOT call autoFireFirstBacklogScript", () => {
    assert.equal(scriptCallCount, 0, `expected 0 script calls, got ${scriptCallCount}`);
  });
});

// =============================================================================
// action = 'both' (the default when action is omitted)
// =============================================================================

describe("handleSystemAction auto_fire_kanban — action='both' (default)", () => {
  let result: Record<string, unknown>;

  before(async () => {
    resetCounters();
    // Omit 'action' to exercise the default-to-"both" path in the handler
    result = await handleSystemAction("auto_fire_kanban", { clientUserId: 7 });
    await flushMicrotasks();
  });

  it("returns fired=true with action='both'", () => {
    assert.deepEqual(result, { fired: true, clientUserId: 7, action: "both" });
  });

  it("calls autoFireFirstBacklogScript exactly once", () => {
    assert.equal(scriptCallCount, 1, `expected 1 script call, got ${scriptCallCount}`);
  });

  it("calls autoFireDocumentCard exactly once", () => {
    assert.equal(documentCallCount, 1, `expected 1 document call, got ${documentCallCount}`);
  });

  it("passes the correct clientUserId to both functions", () => {
    assert.equal(lastScriptClientId, 7);
    assert.equal(lastDocumentClientId, 7);
  });
});

// =============================================================================
// Edge case: missing clientUserId → graceful skip, no crash, no functions fired
// =============================================================================

describe("handleSystemAction auto_fire_kanban — missing clientUserId", () => {
  let result: Record<string, unknown>;

  before(async () => {
    resetCounters();
    result = await handleSystemAction("auto_fire_kanban", { action: "script" });
    await flushMicrotasks();
  });

  it("returns skipped=true", () => {
    assert.equal(result.skipped, true);
  });

  it("includes a non-empty reason string", () => {
    assert.ok(
      typeof result.reason === "string" && result.reason.length > 0,
      `expected a non-empty reason string, got ${JSON.stringify(result.reason)}`,
    );
  });

  it("does NOT call autoFireFirstBacklogScript", () => {
    assert.equal(scriptCallCount, 0, `expected 0 script calls, got ${scriptCallCount}`);
  });

  it("does NOT call autoFireDocumentCard", () => {
    assert.equal(documentCallCount, 0, `expected 0 document calls, got ${documentCallCount}`);
  });
});

// =============================================================================
// Edge case: clientUserId = 0 (falsy — treated the same as absent)
// =============================================================================

describe("handleSystemAction auto_fire_kanban — clientUserId=0 (falsy, treated as absent)", () => {
  let result: Record<string, unknown>;

  before(async () => {
    resetCounters();
    result = await handleSystemAction("auto_fire_kanban", {
      clientUserId: 0,
      action: "both",
    });
    await flushMicrotasks();
  });

  it("returns skipped=true (0 is falsy and treated as absent by the guard)", () => {
    assert.equal(result.skipped, true);
  });

  it("does NOT call autoFireFirstBacklogScript", () => {
    assert.equal(scriptCallCount, 0);
  });

  it("does NOT call autoFireDocumentCard", () => {
    assert.equal(documentCallCount, 0);
  });
});
