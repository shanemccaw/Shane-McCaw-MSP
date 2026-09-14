/**
 * retainer-work-logger.test.ts — the BYPRODUCT hook (Git #1293), plus its
 * Git #3473 wiring: the inserted row's `periodMonth` must come from the real
 * anniversary anchor (`resolveRetainerAnchorDay`), not a calendar month; and
 * its Git #4098 wiring: a closed target period queues into
 * `retainer_pending_entries` instead of writing past the period-close lock.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResolveRetainerAnchorDay = vi.fn(async () => 1);
vi.mock("./retainer-period-anchor.ts", () => ({
  resolveRetainerAnchorDay: (...args: unknown[]) => (mockResolveRetainerAnchorDay as (...a: unknown[]) => unknown)(...args),
}));

vi.mock("./logger.ts", () => {
  const child = vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child }));
  return { logger: { child, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

let insertedValues: Record<string, unknown> | null = null;
let insertedTable: "workLog" | "pending" | null = null;
let returningResult: Array<{ id: number }> = [];
/** null = period open (findClose returns nothing); non-null = closed. */
let closeRow: { id: number } | null = null;

vi.mock("@workspace/db", () => {
  const workLogChain: any = {
    values: (v: Record<string, unknown>) => {
      insertedValues = v;
      insertedTable = "workLog";
      return workLogChain;
    },
    onConflictDoNothing: () => workLogChain,
    returning: () => Promise.resolve(returningResult),
  };
  const pendingChain: any = {
    values: (v: Record<string, unknown>) => {
      insertedValues = v;
      insertedTable = "pending";
      return pendingChain;
    },
    onConflictDoNothing: () => pendingChain,
    returning: () => Promise.resolve(returningResult),
  };
  const selectChain: any = {
    from: () => selectChain,
    where: () => selectChain,
    limit: () => Promise.resolve(closeRow ? [closeRow] : []),
  };
  const makeTx = () => ({
    execute: () => Promise.resolve(),
    select: () => selectChain,
    insert: (table: unknown) => (table === "PENDING_TABLE" ? pendingChain : workLogChain),
  });
  return {
    db: {
      insert: vi.fn((table: unknown) => (table === "PENDING_TABLE" ? pendingChain : workLogChain)),
      transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(makeTx())),
    },
    retainerWorkLogTable: {
      source: "source",
      sourceRefId: "source_ref_id",
      id: "id",
    },
    retainerPendingEntriesTable: "PENDING_TABLE",
    retainerPeriodClosesTable: {
      customerId: "customer_id",
      periodKey: "period_key",
    },
  };
});

import { logRetainerWorkFromTracker } from "./retainer-work-logger.ts";

beforeEach(() => {
  insertedValues = null;
  insertedTable = null;
  returningResult = [{ id: 1 }];
  closeRow = null;
  mockResolveRetainerAnchorDay.mockClear();
  mockResolveRetainerAnchorDay.mockImplementation(async () => 1);
});

describe("logRetainerWorkFromTracker — Git #3473 anniversary wiring", () => {
  it("resolves the customer's real anchor day and keys periodMonth off it, not a calendar month", async () => {
    mockResolveRetainerAnchorDay.mockImplementation(async () => 14);
    const occurredAt = new Date("2026-08-13T00:00:00Z"); // before the 14th anniversary
    const created = await logRetainerWorkFromTracker({
      customerId: 42,
      mspId: 7,
      source: "change_control",
      sourceRefId: 99,
      item: "Closed a change request",
      occurredAt,
    });
    expect(created).toBe(true);
    expect(mockResolveRetainerAnchorDay).toHaveBeenCalledWith(42);
    // 2026-08-13 is BEFORE this customer's real 14th anniversary, so it belongs
    // to the PRIOR period key — never "2026-08" (the old calendar-month bug).
    expect(insertedValues?.periodMonth).toBe("2026-07-14");
  });

  it("uses the resolved anchor even when it lands the entry in the current period", async () => {
    mockResolveRetainerAnchorDay.mockImplementation(async () => 14);
    const occurredAt = new Date("2026-08-20T00:00:00Z"); // after the 14th anniversary
    await logRetainerWorkFromTracker({
      customerId: 42,
      mspId: 7,
      source: "remediation_tracker",
      sourceRefId: 5,
      item: "Closed a remediation step",
      occurredAt,
    });
    expect(insertedValues?.periodMonth).toBe("2026-08-14");
  });

  it("swallows a resolveRetainerAnchorDay failure rather than breaking the close action", async () => {
    mockResolveRetainerAnchorDay.mockImplementation(async () => {
      throw new Error("db unreachable");
    });
    const created = await logRetainerWorkFromTracker({
      customerId: 42,
      mspId: 7,
      source: "change_control",
      sourceRefId: 100,
      item: "Closed while the anchor lookup failed",
    });
    expect(created).toBe(false);
  });
});

describe("logRetainerWorkFromTracker — Git #4098 closed-period queueing (follow-up to #4026)", () => {
  it("writes straight into the ledger when the target period is open", async () => {
    closeRow = null;
    const created = await logRetainerWorkFromTracker({
      customerId: 42,
      mspId: 7,
      source: "change_control",
      sourceRefId: 200,
      item: "Closed a change request in an open period",
    });
    expect(created).toBe(true);
    expect(insertedTable).toBe("workLog");
  });

  it("queues into retainer_pending_entries instead of writing past a closed period's lock", async () => {
    closeRow = { id: 9 };
    const created = await logRetainerWorkFromTracker({
      customerId: 42,
      mspId: 7,
      source: "remediation_tracker",
      sourceRefId: 201,
      item: "Closed a remediation step against a closed period",
    });
    expect(created).toBe(true);
    expect(insertedTable).toBe("pending");
    expect(insertedValues?.periodKey).toBeDefined();
    expect(insertedValues?.status).toBeUndefined(); // defaults server-side, not set explicitly here
  });

  it("no-ops (does not double-queue) when the same closed-period item re-fires", async () => {
    closeRow = { id: 9 };
    returningResult = []; // ON CONFLICT DO NOTHING → no row returned
    const created = await logRetainerWorkFromTracker({
      customerId: 42,
      mspId: 7,
      source: "remediation_tracker",
      sourceRefId: 202,
      item: "Re-closed the same remediation step",
    });
    expect(created).toBe(false);
    expect(insertedTable).toBe("pending");
  });
});
