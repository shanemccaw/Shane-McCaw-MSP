import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────
// runDiagnostics is statically imported ("./diagnostics-runner") by the sweep, so
// the mock factory reads it at module-eval time — hoist it above the vi.mock.
const { runDiagnostics } = vi.hoisted(() => ({
  runDiagnostics: vi.fn((_opts: { customerId?: number; tenantId?: string }) => Promise.resolve({})),
}));
vi.mock("./diagnostics-runner", () => ({ runDiagnostics }));

// Controllable DB state, reset per test.
let selectResult: Array<{ sowId: string; customerId: number | null }> = [];
let flipResults: Array<Array<{ sowId: string }>> = []; // per-UPDATE .returning() result, in call order
const insertValues = vi.fn((_v: unknown) => Promise.resolve());

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve(selectResult) }) }),
    update: () => ({
      set: () => ({
        where: () => ({ returning: () => Promise.resolve(flipResults.shift() ?? []) }),
      }),
    }),
    insert: () => ({ values: (v: unknown) => insertValues(v) }),
  },
  mspSowsTable: { sowId: "s.sow_id", customerId: "s.customer_id", status: "s.status", expiresAt: "s.expires_at", updatedAt: "s.updated_at" },
  mspSowEventsTable: { sowId: "e.sow_id", eventName: "e.event_name", actorRole: "e.actor_role", payload: "e.payload" },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ type: "and", args }),
  eq: () => ({ type: "eq" }),
  inArray: () => ({ type: "inArray" }),
  isNotNull: () => ({ type: "isNotNull" }),
  lt: () => ({ type: "lt" }),
}));

vi.mock("./logger", () => {
  const noop = () => {};
  const child = { info: noop, warn: noop, error: noop, debug: noop };
  return { logger: { child: () => child, ...child } };
});

import { sweepExpiredSows } from "./sow-expiry-sweep";

beforeEach(() => {
  selectResult = [];
  flipResults = [];
  insertValues.mockClear();
  runDiagnostics.mockClear();
});

describe("sweepExpiredSows", () => {
  it("does nothing when no SOWs are past expiry", async () => {
    selectResult = [];
    await sweepExpiredSows();
    expect(insertValues).not.toHaveBeenCalled();
    expect(runDiagnostics).not.toHaveBeenCalled();
  });

  it("expires each stale SOW, emits sow.expired, and fires one rescan per distinct customer", async () => {
    // Two SOWs for customer 10 (dedup → one rescan), one for customer 20.
    selectResult = [
      { sowId: "sow-a", customerId: 10 },
      { sowId: "sow-b", customerId: 10 },
      { sowId: "sow-c", customerId: 20 },
    ];
    flipResults = [[{ sowId: "sow-a" }], [{ sowId: "sow-b" }], [{ sowId: "sow-c" }]];

    await sweepExpiredSows();
    await vi.waitFor(() => expect(runDiagnostics).toHaveBeenCalledTimes(2));

    // One sow.expired event per flipped SOW.
    expect(insertValues).toHaveBeenCalledTimes(3);
    const evt = insertValues.mock.calls[0]![0] as Record<string, unknown>;
    expect(evt.eventName).toBe("sow.expired");
    expect(evt.actorRole).toBe("system");

    // Deduped rescans: customers 10 and 20, each with just customerId.
    const rescannedCustomers = runDiagnostics.mock.calls.map((c) => c[0].customerId).sort();
    expect(rescannedCustomers).toEqual([10, 20]);
  });

  it("does not rescan a SOW that lost the status race (UPDATE flipped nothing)", async () => {
    selectResult = [
      { sowId: "sow-win", customerId: 10 },
      { sowId: "sow-lost", customerId: 99 },
    ];
    flipResults = [[{ sowId: "sow-win" }], []]; // second UPDATE matched no row

    await sweepExpiredSows();
    await vi.waitFor(() => expect(runDiagnostics).toHaveBeenCalledTimes(1));

    expect(insertValues).toHaveBeenCalledTimes(1); // only the winner gets an event
    expect(runDiagnostics.mock.calls[0]![0].customerId).toBe(10);
  });

  it("skips rescan for an expired SOW with no customer, but still records the event", async () => {
    selectResult = [{ sowId: "sow-orphan", customerId: null }];
    flipResults = [[{ sowId: "sow-orphan" }]];

    await sweepExpiredSows();
    await new Promise((r) => setTimeout(r, 5));

    expect(insertValues).toHaveBeenCalledTimes(1);
    expect(runDiagnostics).not.toHaveBeenCalled();
  });
});
