import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────
// runDiagnostics is statically imported ("./diagnostics-runner") by the sweep, so
// the mock factory reads it at module-eval time — hoist it above the vi.mock.
const { runDiagnostics } = vi.hoisted(() => ({
  runDiagnostics: vi.fn((_opts: { customerId?: number; tenantId?: string }) => Promise.resolve({})),
}));
vi.mock("./diagnostics-runner", () => ({ runDiagnostics }));

// runItemDetailCollection (#339, Git #1037) — the parallel full-item detail
// pass the sweep now fires alongside each rescan.
const { runItemDetailCollection } = vi.hoisted(() => ({
  runItemDetailCollection: vi.fn((_opts: { tenantId?: string; customerId?: number | null; scopeToPackageKey?: string }) =>
    Promise.resolve({ runId: "detail-run", status: "completed", itemsPersisted: 0 })),
}));
vi.mock("./item-detail-collector", () => ({ runItemDetailCollection }));

// Controllable DB state, reset per test.
let selectResult: Array<{ sowId: string; customerId: number | null }> = [];
// Keyed by customerId — the sweep re-resolves tenants.tenantId per rescanned
// customer to fire the parallel detail collection alongside runDiagnostics.
let tenantByCustomerId: Record<number, string> = {};
let flipResults: Array<Array<{ sowId: string }>> = []; // per-UPDATE .returning() result, in call order
const insertValues = vi.fn((_v: unknown) => Promise.resolve());

vi.mock("@workspace/db", () => {
  const tenantsTable = { id: "t.id", tenantId: "t.tenant_id" };
  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: (cond: { type?: string; args?: unknown[] }) => {
            if (table === tenantsTable) {
              const customerId = cond?.type === "eq" ? (cond.args?.[1] as number) : undefined;
              const tenantId = customerId != null ? tenantByCustomerId[customerId] : undefined;
              return { limit: () => Promise.resolve(tenantId ? [{ tenantId }] : []) };
            }
            return Promise.resolve(selectResult);
          },
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => ({ returning: () => Promise.resolve(flipResults.shift() ?? []) }),
        }),
      }),
      insert: () => ({ values: (v: unknown) => insertValues(v) }),
    },
    mspSowsTable: { sowId: "s.sow_id", customerId: "s.customer_id", status: "s.status", expiresAt: "s.expires_at", updatedAt: "s.updated_at" },
    mspSowEventsTable: { sowId: "e.sow_id", eventName: "e.event_name", actorRole: "e.actor_role", payload: "e.payload" },
    tenantsTable,
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ type: "and", args }),
  eq: (...args: unknown[]) => ({ type: "eq", args }),
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
  tenantByCustomerId = {};
  flipResults = [];
  insertValues.mockClear();
  runDiagnostics.mockClear();
  runItemDetailCollection.mockClear();
});

describe("sweepExpiredSows", () => {
  it("does nothing when no SOWs are past expiry", async () => {
    selectResult = [];
    await sweepExpiredSows();
    expect(insertValues).not.toHaveBeenCalled();
    expect(runDiagnostics).not.toHaveBeenCalled();
    expect(runItemDetailCollection).not.toHaveBeenCalled();
  });

  it("expires each stale SOW, emits sow.expired, and fires one rescan (+ parallel item-detail collection) per distinct customer", async () => {
    // Two SOWs for customer 10 (dedup → one rescan), one for customer 20.
    selectResult = [
      { sowId: "sow-a", customerId: 10 },
      { sowId: "sow-b", customerId: 10 },
      { sowId: "sow-c", customerId: 20 },
    ];
    flipResults = [[{ sowId: "sow-a" }], [{ sowId: "sow-b" }], [{ sowId: "sow-c" }]];
    tenantByCustomerId = { 10: "tenant-guid-10", 20: "tenant-guid-20" };

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

    // Git #1037: every rescanned customer also gets a parallel full-item
    // detail collection pass, resolving tenantId itself and scoping to the
    // same "core:security-baseline" default runDiagnostics used above —
    // this is the fix for the tenant_check_item_details write-path lag.
    await vi.waitFor(() => expect(runItemDetailCollection).toHaveBeenCalledTimes(2));
    const detailCalls = runItemDetailCollection.mock.calls
      .map((c) => c[0] as { tenantId: string; customerId: number; scopeToPackageKey: string })
      .sort((a, b) => a.customerId - b.customerId);
    expect(detailCalls).toEqual([
      { tenantId: "tenant-guid-10", customerId: 10, scopeToPackageKey: "core:security-baseline" },
      { tenantId: "tenant-guid-20", customerId: 20, scopeToPackageKey: "core:security-baseline" },
    ]);
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
    expect(runItemDetailCollection).not.toHaveBeenCalled();
  });

  it("does not fire item-detail collection for a customer whose tenant can't be resolved", async () => {
    selectResult = [{ sowId: "sow-notenant", customerId: 30 }];
    flipResults = [[{ sowId: "sow-notenant" }]];
    // tenantByCustomerId deliberately left empty for customer 30.

    await sweepExpiredSows();
    await vi.waitFor(() => expect(runDiagnostics).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 5));

    expect(runItemDetailCollection).not.toHaveBeenCalled();
  });
});
