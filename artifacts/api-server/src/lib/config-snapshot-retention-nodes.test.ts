/**
 * config-snapshot-retention-nodes.test.ts
 *
 * Unit tests for the `config_snapshot_prune` workflow node handler (Git #2114).
 * Mocks `@workspace/db`'s `db.execute` the same way
 * `telemetry-retention-nodes.test.ts` mocks `db.delete` — the real per-tenant
 * ranking/exclusion/delete SQL is enforced by Postgres and is verified live
 * against the local database separately; this file asserts the handler issues
 * the sweep with the right `keepPerTenant`, records a `config_snapshot_prune_runs`
 * row, and shapes its return value from the sweep's real result row.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockExecute } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { execute: mockExecute },
}));

vi.mock("./logger", () => {
  const noop = () => {};
  const noopLogger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, trace: noop, child: () => noopLogger };
  return { logger: noopLogger };
});

import { handleConfigSnapshotPrune } from "./config-snapshot-retention-nodes.ts";

const SWEEP_ROW = {
  tenants_considered: 3,
  candidates_over_cap: 5,
  protected_by_diff: 2,
  protected_by_baseline: 1,
  snapshots_deleted: 2,
  objects_deleted_estimate: 74300,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute
    .mockResolvedValueOnce({ rows: [SWEEP_ROW] }) // the sweep SELECT/DELETE
    .mockResolvedValueOnce({ rows: [] }); // the audit-row INSERT
});

describe("handleConfigSnapshotPrune", () => {
  it("issues exactly one sweep statement and one audit-log insert", async () => {
    await handleConfigSnapshotPrune({});
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it("defaults keepPerTenant to 20 when payload omits it", async () => {
    const result = await handleConfigSnapshotPrune({});
    expect(result.keepPerTenant).toBe(20);
  });

  it("honors a custom keepPerTenant value", async () => {
    const result = await handleConfigSnapshotPrune({ keepPerTenant: 5 });
    expect(result.keepPerTenant).toBe(5);
  });

  it("floors a negative keepPerTenant at 0 rather than issuing a negative cap", async () => {
    const result = await handleConfigSnapshotPrune({ keepPerTenant: -3 });
    expect(result.keepPerTenant).toBe(0);
  });

  it("shapes its return value from the sweep's real result row, not an estimate", async () => {
    const result = await handleConfigSnapshotPrune({ keepPerTenant: 10 });
    expect(result.tenantsConsidered).toBe(3);
    expect(result.candidatesOverCap).toBe(5);
    expect(result.protectedByDiff).toBe(2);
    expect(result.protectedByBaseline).toBe(1);
    expect(result.snapshotsDeleted).toBe(2);
    expect(result.objectsDeletedEstimate).toBe(74300);
  });

  it("defaults every count to 0 when the sweep returns no row", async () => {
    mockExecute.mockReset();
    mockExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await handleConfigSnapshotPrune({});
    expect(result.snapshotsDeleted).toBe(0);
    expect(result.tenantsConsidered).toBe(0);
  });
});
