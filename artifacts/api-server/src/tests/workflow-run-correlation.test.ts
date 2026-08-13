/**
 * Phase 0b — background-job / workflow-run correlation spine.
 *
 * Proves the behaviour fixed by wrapping executeRun() in one
 * runWithRequestContext() context per RUN:
 *
 *   1. Two separate dispatchEvent() calls emitted DURING the same executeRun()
 *      invocation share ONE correlationId (the run's traceId).
 *   2. Two SEPARATE executeRun() invocations get DIFFERENT correlationIds.
 *   3. A run whose triggerEventId is a bare event UUID inherits it as the
 *      correlationId (ties the workflow's events back to the originating event).
 *   4. A run with no triggerEventId gets a fresh generated correlationId.
 *
 * The REAL executeRun + event-bus run; only @workspace/db and the outbound
 * webhook fan-out are mocked. A custom "test_emit" node dispatches an extra
 * event so each run produces >1 dispatch (the node's event + run.completed),
 * which is what lets us assert the "same run shares one id" property directly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared mock state — hoisted so the vi.mock factory (also hoisted) can see it.
const h = vi.hoisted(() => {
  // The real @workspace/db index throws unless DATABASE_URL is set; importOriginal
  // (below) loads it to reuse the real drizzle table objects. A dummy URL is
  // enough — pg.Pool connects lazily, so no live DB is ever contacted.
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";

  interface CapturedEvent { correlationId?: string; eventType?: string }
  const capturedEvents: CapturedEvent[] = [];
  // Mutable holders: the run/workflow the select() stub serves, and identity
  // refs to the real table objects (captured inside the mock factory).
  const state: { run: Record<string, unknown> | null; wf: Record<string, unknown> | null } = {
    run: null,
    wf: null,
  };
  const tables: { runs?: unknown; workflows?: unknown; eventStore?: unknown } = {};

  function makeThenable(value: unknown) {
    const p = Promise.resolve(value) as Promise<unknown> & {
      onConflictDoUpdate: () => Promise<unknown>;
      onConflictDoNothing: () => Promise<unknown>;
      returning: () => Promise<unknown>;
    };
    p.onConflictDoUpdate = () => Promise.resolve(value);
    p.onConflictDoNothing = () => Promise.resolve(value);
    p.returning = () => Promise.resolve(value);
    return p;
  }

  const mockDb = {
    select(_projection?: unknown) {
      let table: unknown;
      const builder: Record<string, unknown> = {
        from(t: unknown) { table = t; return builder; },
        where() { return builder; },
        orderBy() { return builder; },
        limit() {
          if (table === tables.runs) return Promise.resolve(state.run ? [state.run] : []);
          if (table === tables.workflows) return Promise.resolve(state.wf ? [state.wf] : []);
          return Promise.resolve([]);
        },
      };
      return builder;
    },
    insert(table: unknown) {
      return {
        values(vals: Record<string, unknown>) {
          if (table === tables.eventStore) {
            capturedEvents.push({
              correlationId: vals["correlationId"] as string | undefined,
              eventType: vals["eventType"] as string | undefined,
            });
          }
          return makeThenable([]);
        },
      };
    },
    update() {
      return { set() { return { where() { return makeThenable([]); } }; } };
    },
    execute() { return Promise.resolve({ rows: [] }); },
  };

  return { capturedEvents, state, tables, mockDb };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  // Reuse the real drizzle table objects for identity checks in mockDb.
  h.tables.runs = actual["portalWfRunsTable"];
  h.tables.workflows = actual["portalWfWorkflowsTable"];
  h.tables.eventStore = actual["mspEventStoreTable"];
  return { ...actual, db: h.mockDb };
});

vi.mock("../lib/webhook-delivery.ts", () => ({ fanOutWebhooks: vi.fn(async () => {}) }));
vi.mock("../lib/webhook-delivery", () => ({ fanOutWebhooks: vi.fn(async () => {}) }));

import { executeRun, registerNodeHandler } from "../lib/portal-workflow-engine";
import { dispatchEvent, systemActor } from "../lib/event-bus";

// A custom node that emits one extra canonical event mid-run.
registerNodeHandler("test_emit", async () => {
  await dispatchEvent({
    eventType: "test.wf.node_emit",
    source: "workflow-run-correlation-test",
    actor: systemActor(),
    mspId: 7,
    causationId: "11111111-1111-1111-1111-111111111111",
    payload: {},
  });
  return { emitted: true };
});

const GRAPH = {
  nodes: [
    { id: "start", type: "start", config: {} },
    { id: "emit", type: "test_emit", config: {} },
  ],
  edges: [{ from: "start", to: "emit" }],
};

function primeRun(runId: string, triggerEventId: string | null) {
  h.state.run = {
    runId,
    status: "pending",
    workflowKey: "wf_test",
    triggerEventId,
    tenantContext: { mspId: 7, customerId: null },
    inputPayload: {},
    aiAdmitted: null,
  };
  h.state.wf = { isActive: true, graph: GRAPH, retryPolicy: null };
}

async function eventsFor(runId: string, triggerEventId: string | null) {
  h.capturedEvents.length = 0;
  primeRun(runId, triggerEventId);
  await executeRun(runId);
  // run.completed is dispatched fire-and-forget (void); flush microtasks.
  await new Promise((r) => setTimeout(r, 20));
  return [...h.capturedEvents];
}

describe("workflow run correlation spine (executeRun)", () => {
  beforeEach(() => {
    h.capturedEvents.length = 0;
  });

  it("all dispatches within ONE run share a single correlationId, inherited from triggerEventId", async () => {
    const triggerId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const events = await eventsFor("run-a", triggerId);

    const types = events.map((e) => e.eventType);
    expect(types).toContain("test.wf.node_emit");
    expect(types).toContain("portal_wf.run.completed");
    expect(events.length).toBeGreaterThanOrEqual(2);

    const ids = new Set(events.map((e) => e.correlationId));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toBe(triggerId);
  });

  it("two SEPARATE runs get DIFFERENT correlationIds from each other", async () => {
    const a = await eventsFor("run-b", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    const b = await eventsFor("run-c", "cccccccc-cccc-cccc-cccc-cccccccccccc");

    const aId = a[0]?.correlationId;
    const bId = b[0]?.correlationId;
    expect(aId).toBe("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    expect(bId).toBe("cccccccc-cccc-cccc-cccc-cccccccccccc");
    expect(aId).not.toBe(bId);
  });

  it("a run with no triggerEventId gets a fresh generated correlationId (still shared within the run)", async () => {
    const events = await eventsFor("run-d", null);
    const ids = new Set(events.map((e) => e.correlationId));
    expect(ids.size).toBe(1);
    const only = [...ids][0]!;
    expect(only).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});
