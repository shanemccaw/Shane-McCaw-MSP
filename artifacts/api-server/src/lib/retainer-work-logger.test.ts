/**
 * retainer-work-logger.test.ts — the BYPRODUCT hook (Git #1293), plus its
 * Git #3473 wiring: the inserted row's `periodMonth` must come from the real
 * anniversary anchor (`resolveRetainerAnchorDay`), not a calendar month.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResolveRetainerAnchorDay = vi.fn(async () => 1);
vi.mock("./retainer-period-anchor", () => ({
  resolveRetainerAnchorDay: (...args: unknown[]) => (mockResolveRetainerAnchorDay as (...a: unknown[]) => unknown)(...args),
}));

vi.mock("./logger", () => {
  const child = vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child }));
  return { logger: { child, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

let insertedValues: Record<string, unknown> | null = null;
let returningResult: Array<{ id: number }> = [];

vi.mock("@workspace/db", () => {
  const chain: any = {
    values: (v: Record<string, unknown>) => {
      insertedValues = v;
      return chain;
    },
    onConflictDoNothing: () => chain,
    returning: () => Promise.resolve(returningResult),
  };
  return {
    db: { insert: vi.fn(() => chain) },
    retainerWorkLogTable: {
      source: "source",
      sourceRefId: "source_ref_id",
      id: "id",
    },
  };
});

import { logRetainerWorkFromTracker } from "./retainer-work-logger.ts";

beforeEach(() => {
  insertedValues = null;
  returningResult = [{ id: 1 }];
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
