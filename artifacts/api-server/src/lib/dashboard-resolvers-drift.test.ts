import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * #4837 — `resolveDriftEvents` (reached through `resolveMetric` for a `drift:*`
 * sourceKey) must consult `drift_collection_status` for the domain's LATEST run
 * BEFORE the baseline. A `not_comparable` / `error` verdict is reported as
 * not_available with the collector's real reason even when an older baseline
 * snapshot is on file — never as a clean "no drift".
 *
 * DB mocked with the same FIFO queue convention as dashboard-resolvers.test.ts.
 * The resolver's read order is: tenants (resolveTenantId) → drift_collection_status
 * → drift_baseline_snapshots → drift_events (only when it gets that far).
 */

let mockResultQueue: any[][] = [];

vi.mock("@workspace/db", () => {
  function makeChain() {
    const chain: any = {
      from: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      groupBy: () => chain,
      limit: () => chain,
      then: (onFulfilled: any, onRejected: any) =>
        Promise.resolve(mockResultQueue.shift() ?? []).then(onFulfilled, onRejected),
    };
    return chain;
  }

  const mockDb = {
    select: vi.fn(() => makeChain()),
    selectDistinct: vi.fn(() => makeChain()),
    selectDistinctOn: vi.fn(() => makeChain()),
  };

  const tbl = (cols: string[]) => Object.fromEntries(cols.map((c) => [c, c]));

  return {
    db: mockDb,
    tenantsTable: tbl(["id", "mspId", "tenantId", "status"]),
    driftCollectionStatusTable: tbl(["tenantId", "domainKey", "status", "reason"]),
    driftBaselineSnapshotsTable: tbl(["id", "tenantId", "domainKey", "config"]),
    driftEventsTable: tbl(["tenantId", "domainKey", "detectedAt"]),
  };
});

vi.mock("./sla-engine.ts", () => ({ runSlaEngineForTenant: vi.fn() }));
vi.mock("./scope-creep-engine.ts", () => ({ runScopeCreepEngineForTenant: vi.fn() }));

import { resolveMetric } from "./dashboard-resolvers.ts";
import { getMetric } from "@workspace/dashboard-registry";

const def = getMetric("drift.caPolicyDriftCount");

const TENANT = [{ tenantId: "c4c814d4-3afe-441e-9145-62461d0a4fd3" }];
const BASELINE = [{ id: 1, config: { policies: [] } }];
const EVENT = {
  detectedAt: new Date("2026-09-17T10:00:00.000Z"),
  setting: "policies[abc].state",
  op: "changed",
  oldValue: "enabled",
  newValue: "disabled",
  changedBy: null,
  verdict: "unapproved",
  crRef: null,
  changeRequestId: null,
};

describe("drift:* resolver — collector status is read before the baseline (#4837)", () => {
  beforeEach(() => {
    mockResultQueue = [];
  });

  it("resolves the ca-policy drift metric from the registry", () => {
    expect(def).toBeDefined();
    expect(def!.sourceKey).toBe("drift:ca-policy");
  });

  it("baseline on file + latest status not_comparable → not_available/not_comparable with the real reason", async () => {
    mockResultQueue.push(TENANT, [{ status: "not_comparable", reason: "gate_not_satisfied" }], BASELINE);
    const res = await resolveMetric(def!, { customerId: 10, mspId: 1 });
    expect(res).toMatchObject({ status: "not_available", reason: "not_comparable", detail: "gate_not_satisfied" });
  });

  it("baseline on file + latest status error → not_available/collection_error", async () => {
    mockResultQueue.push(TENANT, [{ status: "error", reason: "Graph 503" }], BASELINE);
    const res = await resolveMetric(def!, { customerId: 10, mspId: 1 });
    expect(res).toMatchObject({ status: "not_available", reason: "collection_error", detail: "Graph 503" });
  });

  it("not_comparable with no recorded reason falls back to a stated (non-empty) detail", async () => {
    mockResultQueue.push(TENANT, [{ status: "not_comparable", reason: null }], BASELINE);
    const res = await resolveMetric(def!, { customerId: 10, mspId: 1 });
    expect(res).toMatchObject({ status: "not_available", reason: "not_comparable" });
    expect((res as any).detail).toContain("drift:ca-policy");
  });

  it("no baseline + status not_comparable → still not_comparable (unchanged)", async () => {
    mockResultQueue.push(TENANT, [{ status: "not_comparable", reason: "gate_not_satisfied" }], []);
    const res = await resolveMetric(def!, { customerId: 10, mspId: 1 });
    expect(res).toMatchObject({ status: "not_available", reason: "not_comparable" });
  });

  it("no baseline + no status row → no_data (never scanned, unchanged)", async () => {
    mockResultQueue.push(TENANT, [], []);
    const res = await resolveMetric(def!, { customerId: 10, mspId: 1 });
    expect(res).toMatchObject({ status: "not_available", reason: "no_data" });
  });

  it("baseline + status tracked + no events → ok, genuinely clean (unchanged)", async () => {
    mockResultQueue.push(TENANT, [{ status: "tracked", reason: null }], BASELINE, []);
    const res = await resolveMetric(def!, { customerId: 10, mspId: 1 });
    expect(res.status).toBe("ok");
    expect((res as any).meta).toMatchObject({ hasBaseline: true, zeroRows: true, count: 0 });
  });

  it("baseline + status baseline_captured + events → ok with the real event list (unchanged)", async () => {
    mockResultQueue.push(TENANT, [{ status: "baseline_captured", reason: null }], BASELINE, [EVENT]);
    const res = await resolveMetric(def!, { customerId: 10, mspId: 1 });
    expect(res.status).toBe("ok");
    expect((res as any).data.events).toHaveLength(1);
    expect((res as any).meta.count).toBe(1);
  });

  it("baseline but no status row (predates status recording) → still served as tracked", async () => {
    mockResultQueue.push(TENANT, [], BASELINE, []);
    const res = await resolveMetric(def!, { customerId: 10, mspId: 1 });
    expect(res.status).toBe("ok");
  });
});
