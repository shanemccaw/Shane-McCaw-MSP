/**
 * Unit tests for handleAutoFireKanban(payload) routing.
 *
 * Verifies that the auto-fire kanban handler correctly:
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
let scriptCallCount = 0;
let documentCallCount = 0;
let lastScriptClientId: number | undefined;
let lastDocumentClientId: number | undefined;
let scriptShouldThrow = false;
let documentShouldThrow = false;

function resetCounters() {
  scriptCallCount = 0;
  documentCallCount = 0;
  lastScriptClientId = undefined;
  lastDocumentClientId = undefined;
}

// ── Stub kanban-auto-fire BEFORE importing auto-fire-kanban-handler ───────────
vi.mock("./kanban-auto-fire", () => ({
  autoFireFirstBacklogScript: vi.fn(async (clientUserId: number) => {
    if (scriptShouldThrow) throw new Error("Azure Automation unreachable (simulated outage)");
    scriptCallCount++;
    lastScriptClientId = clientUserId;
  }),
  autoFireDocumentCard: vi.fn(async (clientUserId: number) => {
    if (documentShouldThrow) throw new Error("AI generation failed (simulated error)");
    documentCallCount++;
    lastDocumentClientId = clientUserId;
  }),
  autoFireRunWorkflowCards: vi.fn(async () => {}),
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
// action = 'script'  → only autoFireFirstBacklogScript should be called
// =============================================================================

describe("handleAutoFireKanban — action='script'", () => {
  let result: Record<string, unknown>;

  beforeAll(async () => {
    resetCounters();
    result = await handleAutoFireKanban({ clientUserId: 42, action: "script" });
    await flushMicrotasks();
  });

  it("returns fired=true with the correct clientUserId and action", () => {
    expect(result).toEqual({ fired: true, clientUserId: 42, action: "script" });
  });

  it("calls autoFireFirstBacklogScript exactly once", () => {
    expect(scriptCallCount).toBe(1);
  });

  it("passes the correct clientUserId to autoFireFirstBacklogScript", () => {
    expect(lastScriptClientId).toBe(42);
  });

  it("does NOT call autoFireDocumentCard", () => {
    expect(documentCallCount).toBe(0);
  });
});

// =============================================================================
// action = 'document'  → only autoFireDocumentCard should be called
// =============================================================================

describe("handleAutoFireKanban — action='document'", () => {
  let result: Record<string, unknown>;

  beforeAll(async () => {
    resetCounters();
    result = await handleAutoFireKanban({ clientUserId: 99, action: "document" });
    await flushMicrotasks();
  });

  it("returns fired=true with the correct clientUserId and action", () => {
    expect(result).toEqual({ fired: true, clientUserId: 99, action: "document" });
  });

  it("calls autoFireDocumentCard exactly once", () => {
    expect(documentCallCount).toBe(1);
  });

  it("passes the correct clientUserId to autoFireDocumentCard", () => {
    expect(lastDocumentClientId).toBe(99);
  });

  it("does NOT call autoFireFirstBacklogScript", () => {
    expect(scriptCallCount).toBe(0);
  });
});

// =============================================================================
// action = 'both' (the default when action is omitted)
// =============================================================================

describe("handleAutoFireKanban — action='both' (default)", () => {
  let result: Record<string, unknown>;

  beforeAll(async () => {
    resetCounters();
    result = await handleAutoFireKanban({ clientUserId: 7 });
    await flushMicrotasks();
  });

  it("returns fired=true with action='both'", () => {
    expect(result).toEqual({ fired: true, clientUserId: 7, action: "both" });
  });

  it("calls autoFireFirstBacklogScript exactly once", () => {
    expect(scriptCallCount).toBe(1);
  });

  it("calls autoFireDocumentCard exactly once", () => {
    expect(documentCallCount).toBe(1);
  });

  it("passes the correct clientUserId to both functions", () => {
    expect(lastScriptClientId).toBe(7);
    expect(lastDocumentClientId).toBe(7);
  });
});

// =============================================================================
// Edge case: missing clientUserId → graceful skip, no crash, no functions fired
// =============================================================================

describe("handleAutoFireKanban — missing clientUserId", () => {
  let result: Record<string, unknown>;

  beforeAll(async () => {
    resetCounters();
    result = await handleAutoFireKanban({ action: "script" });
    await flushMicrotasks();
  });

  it("returns skipped=true", () => {
    expect(result.skipped).toBe(true);
  });

  it("includes a non-empty reason string", () => {
    expect(typeof result.reason).toBe("string");
    expect((result.reason as string).length).toBeGreaterThan(0);
  });

  it("does NOT call autoFireFirstBacklogScript", () => {
    expect(scriptCallCount).toBe(0);
  });

  it("does NOT call autoFireDocumentCard", () => {
    expect(documentCallCount).toBe(0);
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

  it("does NOT call autoFireFirstBacklogScript", () => {
    expect(scriptCallCount).toBe(0);
  });

  it("does NOT call autoFireDocumentCard", () => {
    expect(documentCallCount).toBe(0);
  });
});

// =============================================================================
// Azure-outage resilience — when autoFireFirstBacklogScript throws, handler must NOT crash
// =============================================================================

describe("handleAutoFireKanban — Azure outage (script function throws)", () => {
  let result: Record<string, unknown>;
  let caughtError: unknown = null;

  beforeAll(async () => {
    resetCounters();
    scriptShouldThrow = true;
    try {
      result = await handleAutoFireKanban({ clientUserId: 55, action: "script" });
    } catch (err) {
      caughtError = err;
    } finally {
      scriptShouldThrow = false;
    }
    await flushMicrotasks();
  });

  it("does NOT throw — Azure outage is caught by fire-and-forget .catch()", () => {
    expect(caughtError).toBeNull();
  });

  it("still returns fired=true (handler is fire-and-forget — result is immediate)", () => {
    expect(result).toBeDefined();
    expect(result.fired).toBe(true);
    expect(result.clientUserId).toBe(55);
  });

  it("does NOT surface the Azure error to the caller", () => {
    expect("error" in result).toBe(false);
    expect("skipped" in result).toBe(false);
  });
});

// =============================================================================
// Azure-outage resilience — action='both': even when script throws, document should still be attempted
// =============================================================================

describe("handleAutoFireKanban — Azure outage with action='both'", () => {
  let result: Record<string, unknown>;
  let caughtError: unknown = null;

  beforeAll(async () => {
    resetCounters();
    scriptShouldThrow = true;
    try {
      result = await handleAutoFireKanban({ clientUserId: 77, action: "both" });
    } catch (err) {
      caughtError = err;
    } finally {
      scriptShouldThrow = false;
    }
    await flushMicrotasks();
  });

  it("does NOT throw even when the script function fails", () => {
    expect(caughtError).toBeNull();
  });

  it("returns fired=true — handler is non-blocking", () => {
    expect(result).toBeDefined();
    expect(result.fired).toBe(true);
  });

  it("document function is still attempted independently (called once)", () => {
    expect(documentCallCount).toBe(1);
  });

  it("passes the correct clientUserId to the document function", () => {
    expect(lastDocumentClientId).toBe(77);
  });
});

// =============================================================================
// Document AI failure — when autoFireDocumentCard throws, handler must NOT crash
// =============================================================================

describe("handleAutoFireKanban — document AI failure (document function throws)", () => {
  let result: Record<string, unknown>;
  let caughtError: unknown = null;

  beforeAll(async () => {
    resetCounters();
    documentShouldThrow = true;
    try {
      result = await handleAutoFireKanban({ clientUserId: 88, action: "document" });
    } catch (err) {
      caughtError = err;
    } finally {
      documentShouldThrow = false;
    }
    await flushMicrotasks();
  });

  it("does NOT throw — AI failure is caught by fire-and-forget .catch()", () => {
    expect(caughtError).toBeNull();
  });

  it("still returns fired=true (handler is fire-and-forget — result is immediate)", () => {
    expect(result).toBeDefined();
    expect(result.fired).toBe(true);
    expect(result.clientUserId).toBe(88);
  });

  it("does NOT surface the AI error to the caller", () => {
    expect("error" in result).toBe(false);
    expect("skipped" in result).toBe(false);
  });

  it("does NOT call autoFireFirstBacklogScript when action='document'", () => {
    expect(scriptCallCount).toBe(0);
  });
});

// =============================================================================
// Document AI failure with action='both' — even when document throws, script should still be attempted
// =============================================================================

describe("handleAutoFireKanban — document AI failure with action='both'", () => {
  let result: Record<string, unknown>;
  let caughtError: unknown = null;

  beforeAll(async () => {
    resetCounters();
    documentShouldThrow = true;
    try {
      result = await handleAutoFireKanban({ clientUserId: 101, action: "both" });
    } catch (err) {
      caughtError = err;
    } finally {
      documentShouldThrow = false;
    }
    await flushMicrotasks();
  });

  it("does NOT throw even when the document function fails", () => {
    expect(caughtError).toBeNull();
  });

  it("returns fired=true — handler is non-blocking", () => {
    expect(result).toBeDefined();
    expect(result.fired).toBe(true);
  });

  it("script function is still attempted independently (called once)", () => {
    expect(scriptCallCount).toBe(1);
  });

  it("passes the correct clientUserId to the script function", () => {
    expect(lastScriptClientId).toBe(101);
  });
});
