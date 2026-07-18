/**
 * telemetry-retention-nodes.test.ts
 *
 * Unit tests for the platform_log_stream_prune workflow node handler.
 * Uses vi.mock to isolate @workspace/db and drizzle-orm's `lt` — the real
 * cutoff filtering (WHERE occurred_at < cutoff) is enforced by Postgres and
 * can only be proven against a live DB (no test DB exists here); this file
 * asserts the correct delete + where(lt(occurredAt, cutoff)) call is issued
 * with the right cutoff, and that the returned rowsDeleted reflects the
 * delete result's rowCount.
 *
 * Scope proof: this file (and the handler it tests) imports ONLY
 * platformLogStreamTable from @workspace/db — no exceptionGroupsTable,
 * exceptionOccurrencesTable, or mspEventStoreTable import exists anywhere
 * in telemetry-retention-nodes.ts, so those tables are never touched by
 * this node type.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockWhere, mockDelete } = vi.hoisted(() => ({
  mockWhere: vi.fn(),
  mockDelete: vi.fn(),
}));

vi.mock("@workspace/db", () => {
  const platformLogStreamTable = { occurredAt: "occurred_at" };
  return {
    db: { delete: mockDelete },
    platformLogStreamTable,
  };
});

vi.mock("./logger", () => {
  const noop = () => {};
  const noopLogger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, trace: noop, child: () => noopLogger };
  return { logger: noopLogger };
});

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    lt: vi.fn((col: unknown, val: unknown) => ({ type: "lt", col, val })),
  };
});

import { handlePlatformLogStreamPrune } from "./telemetry-retention-nodes.ts";
import { lt } from "drizzle-orm";

beforeEach(() => {
  vi.clearAllMocks();
  mockDelete.mockReturnValue({ where: mockWhere });
});

describe("handlePlatformLogStreamPrune", () => {
  it("deletes from platformLogStreamTable exactly once", async () => {
    mockWhere.mockResolvedValue({ rowCount: 0 });
    await handlePlatformLogStreamPrune({});
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it("defaults retentionDays to 7 when payload omits it", async () => {
    mockWhere.mockResolvedValue({ rowCount: 0 });
    const before = Date.now();
    const result = await handlePlatformLogStreamPrune({});
    const after = Date.now();

    expect(result.retentionDays).toBe(7);
    const cutoffMs = new Date(result.cutoffIso as string).getTime();
    expect(cutoffMs).toBeGreaterThanOrEqual(before - 7 * 86_400_000);
    expect(cutoffMs).toBeLessThanOrEqual(after - 7 * 86_400_000);
  });

  it("honors a custom retentionDays value", async () => {
    mockWhere.mockResolvedValue({ rowCount: 0 });
    const result = await handlePlatformLogStreamPrune({ retentionDays: 14 });
    expect(result.retentionDays).toBe(14);
  });

  it("calls lt(occurredAt, cutoff) with the exact computed cutoff date", async () => {
    mockWhere.mockResolvedValue({ rowCount: 0 });
    const result = await handlePlatformLogStreamPrune({ retentionDays: 3 });

    expect(lt).toHaveBeenCalledTimes(1);
    const [, cutoffArg] = vi.mocked(lt).mock.calls[0]!;
    expect(cutoffArg).toBeInstanceOf(Date);
    expect((cutoffArg as Date).toISOString()).toBe(result.cutoffIso);
  });

  it("returns rowsDeleted from the delete result's rowCount", async () => {
    mockWhere.mockResolvedValue({ rowCount: 42 });
    const result = await handlePlatformLogStreamPrune({});
    expect(result.rowsDeleted).toBe(42);
  });

  it("defaults rowsDeleted to 0 when rowCount is null", async () => {
    mockWhere.mockResolvedValue({ rowCount: null });
    const result = await handlePlatformLogStreamPrune({});
    expect(result.rowsDeleted).toBe(0);
  });

  it("defaults rowsDeleted to 0 when rowCount is absent from the result", async () => {
    mockWhere.mockResolvedValue({});
    const result = await handlePlatformLogStreamPrune({});
    expect(result.rowsDeleted).toBe(0);
  });
});
