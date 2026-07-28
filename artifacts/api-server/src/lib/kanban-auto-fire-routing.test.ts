/**
 * Unit tests for handleAutoFireKanban(payload) routing.
 *
 * The script and document auto-fire actions were removed (superseded by the
 * real, event-driven flow: consent -> event emitted -> login -> workflow
 * verifies telemetry -> generates documents). Only the "workflow" action
 * (launching a real child workflow) remains.
 *
 * Verifies that the auto-fire kanban handler correctly:
 *   1. Calls autoFireRunWorkflowCards when action='workflow' (and the default
 *      when action is omitted).
 *   2. Calls autoFireRunWorkflowCards when action='both'.
 *   3. Does NOT call autoFireRunWorkflowCards for the retired 'script'/'document'
 *      actions — they are now silent no-ops.
 *   4. Returns { skipped: true } without calling anything when clientUserId is
 *      absent from the payload.
 *   5. clientUserId=0 (falsy) is treated as absent — same guard.
 *   6. A thrown error from autoFireRunWorkflowCards is caught (fire-and-forget)
 *      and never surfaces to the caller.
 *
 * Approach:
 *   - vi.mock() stubs kanban-auto-fire and logger so no real DB
 *     connections or Azure calls are made.
 *   - Call counters let each test assert exactly which functions fired.
 *   - Because the handler fires functions with .catch() (fire-and-forget),
 *     a microtask flush (await Promise.resolve() x2) is needed before
 *     asserting.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */
import { describe, it, vi, expect, beforeAll } from "vitest";

// ── Call counters ─────────────────────────────────────────────────────────────
let workflowCallCount = 0;
let lastWorkflowClientId: number | undefined;
let workflowShouldThrow = false;

function resetCounters() {
  workflowCallCount = 0;
  lastWorkflowClientId = undefined;
}

// ── Stub kanban-auto-fire BEFORE importing auto-fire-kanban-handler ───────────
vi.mock("./kanban-auto-fire", () => ({
  autoFireRunWorkflowCards: vi.fn(async (clientUserId: number) => {
    if (workflowShouldThrow) throw new Error("Workflow execution failed (simulated outage)");
    workflowCallCount++;
    lastWorkflowClientId = clientUserId;
  }),
  reconcileOrphanedRuns: vi.fn(async () => {}),
  reconcileStalledPhases: vi.fn(async () => {}),
  reconcileLateStuckQueuedCompletions: vi.fn(async () => {}),
}));

vi.mock("./logger", () => {
  const noop = () => {};
  const noopLogger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, trace: noop, child: () => noopLogger };
  return { logger: noopLogger };
});

// Import after mocks are registered
import { handleAutoFireKanban } from "./auto-fire-kanban-handler";

/** Flush all microtasks so fire-and-forget promises resolve before asserting. */
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

// =============================================================================
// action = 'workflow' → autoFireRunWorkflowCards should be called
// =============================================================================

describe("handleAutoFireKanban — action='workflow'", () => {
  let result: Record<string, unknown>;

  beforeAll(async () => {
    resetCounters();
    result = await handleAutoFireKanban({ clientUserId: 42, action: "workflow" });
    await flushMicrotasks();
  });

  it("returns fired=true with the correct clientUserId and action", () => {
    expect(result).toEqual({ fired: true, clientUserId: 42, action: "workflow" });
  });

  it("calls autoFireRunWorkflowCards exactly once", () => {
    expect(workflowCallCount).toBe(1);
  });

  it("passes the correct clientUserId to autoFireRunWorkflowCards", () => {
    expect(lastWorkflowClientId).toBe(42);
  });
});

// =============================================================================
// action omitted → defaults to 'workflow'
// =============================================================================

describe("handleAutoFireKanban — action omitted (defaults to 'workflow')", () => {
  let result: Record<string, unknown>;

  beforeAll(async () => {
    resetCounters();
    result = await handleAutoFireKanban({ clientUserId: 7 });
    await flushMicrotasks();
  });

  it("returns fired=true with action='workflow'", () => {
    expect(result).toEqual({ fired: true, clientUserId: 7, action: "workflow" });
  });

  it("calls autoFireRunWorkflowCards exactly once", () => {
    expect(workflowCallCount).toBe(1);
  });

  it("passes the correct clientUserId", () => {
    expect(lastWorkflowClientId).toBe(7);
  });
});

// =============================================================================
// action = 'both' → autoFireRunWorkflowCards should still be called
// =============================================================================

describe("handleAutoFireKanban — action='both'", () => {
  let result: Record<string, unknown>;

  beforeAll(async () => {
    resetCounters();
    result = await handleAutoFireKanban({ clientUserId: 101, action: "both" });
    await flushMicrotasks();
  });

  it("returns fired=true with action='both'", () => {
    expect(result).toEqual({ fired: true, clientUserId: 101, action: "both" });
  });

  it("calls autoFireRunWorkflowCards exactly once", () => {
    expect(workflowCallCount).toBe(1);
  });

  it("passes the correct clientUserId", () => {
    expect(lastWorkflowClientId).toBe(101);
  });
});

// =============================================================================
// Retired actions ('script' / 'document') are now silent no-ops
// =============================================================================

describe("handleAutoFireKanban — retired action='script' (no-op)", () => {
  let result: Record<string, unknown>;

  beforeAll(async () => {
    resetCounters();
    result = await handleAutoFireKanban({ clientUserId: 55, action: "script" });
    await flushMicrotasks();
  });

  it("still returns fired=true", () => {
    expect(result).toEqual({ fired: true, clientUserId: 55, action: "script" });
  });

  it("does NOT call autoFireRunWorkflowCards", () => {
    expect(workflowCallCount).toBe(0);
  });
});

describe("handleAutoFireKanban — retired action='document' (no-op)", () => {
  let result: Record<string, unknown>;

  beforeAll(async () => {
    resetCounters();
    result = await handleAutoFireKanban({ clientUserId: 88, action: "document" });
    await flushMicrotasks();
  });

  it("still returns fired=true", () => {
    expect(result).toEqual({ fired: true, clientUserId: 88, action: "document" });
  });

  it("does NOT call autoFireRunWorkflowCards", () => {
    expect(workflowCallCount).toBe(0);
  });
});

// =============================================================================
// Edge case: missing clientUserId → graceful skip, no crash, no function fired
// =============================================================================

describe("handleAutoFireKanban — missing clientUserId", () => {
  let result: Record<string, unknown>;

  beforeAll(async () => {
    resetCounters();
    result = await handleAutoFireKanban({ action: "workflow" });
    await flushMicrotasks();
  });

  it("returns skipped=true", () => {
    expect(result.skipped).toBe(true);
  });

  it("includes a non-empty reason string", () => {
    expect(typeof result.reason).toBe("string");
    expect((result.reason as string).length).toBeGreaterThan(0);
  });

  it("does NOT call autoFireRunWorkflowCards", () => {
    expect(workflowCallCount).toBe(0);
  });
});

// =============================================================================
// Edge case: clientUserId = 0 (falsy — treated the same as absent)
// =============================================================================

describe("handleAutoFireKanban — clientUserId=0 (falsy, treated as absent)", () => {
  let result: Record<string, unknown>;

  beforeAll(async () => {
    resetCounters();
    result = await handleAutoFireKanban({ clientUserId: 0, action: "both" });
    await flushMicrotasks();
  });

  it("returns skipped=true (0 is falsy and treated as absent by the guard)", () => {
    expect(result.skipped).toBe(true);
  });

  it("does NOT call autoFireRunWorkflowCards", () => {
    expect(workflowCallCount).toBe(0);
  });
});

// =============================================================================
// Outage resilience — when autoFireRunWorkflowCards throws, handler must NOT crash
// =============================================================================

describe("handleAutoFireKanban — workflow execution outage (function throws)", () => {
  let result: Record<string, unknown>;
  let caughtError: unknown = null;

  beforeAll(async () => {
    resetCounters();
    workflowShouldThrow = true;
    try {
      result = await handleAutoFireKanban({ clientUserId: 55, action: "workflow" });
    } catch (err) {
      caughtError = err;
    } finally {
      workflowShouldThrow = false;
    }
    await flushMicrotasks();
  });

  it("does NOT throw — the outage is caught by fire-and-forget .catch()", () => {
    expect(caughtError).toBeNull();
  });

  it("still returns fired=true (handler is fire-and-forget — result is immediate)", () => {
    expect(result).toBeDefined();
    expect(result.fired).toBe(true);
    expect(result.clientUserId).toBe(55);
  });

  it("does NOT surface the error to the caller", () => {
    expect("error" in result).toBe(false);
    expect("skipped" in result).toBe(false);
  });
});
