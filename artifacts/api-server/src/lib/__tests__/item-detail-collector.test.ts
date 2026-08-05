/**
 * item-detail-collector.test.ts (#339)
 *
 * The two things this has to prove, and why each is the real risk:
 *
 *  1. GENUINELY COMPLETE ITEM LISTS. The whole reason this mechanism exists is
 *     that the sources a remediation document could otherwise draw on are
 *     truncated: tenant_monitor_profiles.rawResponse holds page 1 only (five
 *     rows for a CSV report), and the scoring scan discards the full list it
 *     computes. So the test drives a genuinely multi-page Graph response through
 *     the real executor and asserts the persisted array holds EVERY page's
 *     items — a passing count of "page 1 only" is the exact bug being closed.
 *
 *  2. NON-INTERFERENCE WITH THE SCORING SCAN. Run both concurrently and assert
 *     the scoring run is bit-for-bit what it was: same statuses, no `items`
 *     dragged onto its hot path, and — the subtle one — a DIFFERENT triggerId,
 *     because the executor's idempotency key is "{tenant}:{check}:{trigger}"
 *     and a shared triggerId would make one run silently return the other's
 *     cached, item-less result.
 *
 * Only the boundaries are mocked (the DB and Graph). The executor, its
 * pagination, its mapping and the collector's persistence decisions are all
 * real code under test.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => {
  const table = (name: string) => ({ __table: name });
  const monitorChecksTable = table("monitor_checks");
  const monitoringPackagesTable = table("monitoring_packages");
  const monitoringPackageChecksTable = table("monitoring_package_checks");
  const tenantMonitorProfilesTable = table("tenant_monitor_profiles");
  const tenantCheckItemDetailsTable = table("tenant_check_item_details");
  const tenantsTable = table("tenants");

  const state: {
    packages: unknown[];
    packageChecks: unknown[];
    checks: unknown[];
    profiles: unknown[];
    inserts: Array<{ table: string; values: Record<string, unknown> }>;
    failInsertsInto: string | null;
  } = {
    packages: [],
    packageChecks: [],
    checks: [],
    profiles: [],
    inserts: [],
    failInsertsInto: null,
  };

  const rowsFor = (t: { __table?: string }): unknown[] => {
    switch (t?.__table) {
      case "monitoring_packages": return state.packages;
      case "monitoring_package_checks": return state.packageChecks;
      case "monitor_checks": return state.checks;
      case "tenant_monitor_profiles": return state.profiles;
      default: return [];
    }
  };

  // Drizzle's builder is chainable AND awaitable at several different depths
  // (…where() for the checks load, …orderBy() for the junction, …limit() for
  // the single-row lookups), so the fake has to be all three.
  const query = (rows: unknown[]): Record<string, unknown> => ({
    where: () => query(rows),
    orderBy: () => query(rows),
    limit: () => Promise.resolve(rows),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej),
  });

  const db = {
    select: () => ({ from: (t: { __table?: string }) => query(rowsFor(t)) }),
    insert: (t: { __table?: string }) => ({
      values: (values: Record<string, unknown>) => {
        if (state.failInsertsInto && t.__table === state.failInsertsInto) {
          throw new Error(`simulated write failure into ${t.__table}`);
        }
        state.inserts.push({ table: t.__table ?? "?", values });
        const profileRow = [{ profileId: `profile-${state.inserts.length}` }];
        const settled = {
          returning: () => Promise.resolve(profileRow),
          then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
            Promise.resolve(undefined).then(res, rej),
        };
        return { ...settled, onConflictDoNothing: () => settled };
      },
    }),
  };

  return {
    db,
    __state: state,
    monitorChecksTable,
    monitoringPackagesTable,
    monitoringPackageChecksTable,
    tenantMonitorProfilesTable,
    tenantCheckItemDetailsTable,
    tenantsTable,
  };
});

vi.mock("../graph", () => ({
  graphFetchForTenant: vi.fn(),
  ConsentRevokedError: class ConsentRevokedError extends Error {
    tenantId: string;
    constructor(tenantId: string) {
      super(`Consent revoked for ${tenantId}`);
      this.name = "ConsentRevokedError";
      this.tenantId = tenantId;
    }
  },
  LicenseGapError: class LicenseGapError extends Error {
    tenantId: string;
    feature: string;
    graphErrorCode: string | null;
    rawBody: string;
    constructor(tenantId: string, feature: string, graphErrorCode: string | null, rawBody: string) {
      super(`License gap for ${tenantId}: ${feature}`);
      this.name = "LicenseGapError";
      this.tenantId = tenantId;
      this.feature = feature;
      this.graphErrorCode = graphErrorCode;
      this.rawBody = rawBody;
    }
  },
  markTenantConsentRevoked: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../ps-execution-client", () => ({
  callPsExecution: vi.fn(),
  PsExecutionError: class PsExecutionError extends Error {
    kind: string;
    cmdletKey: string;
    constructor(kind: string, cmdletKey: string, message: string) {
      super(message);
      this.name = "PsExecutionError";
      this.kind = kind;
      this.cmdletKey = cmdletKey;
    }
  },
}));

vi.mock("../logger", () => {
  const child = vi.fn();
  const base = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child };
  child.mockReturnValue(base);
  return { logger: base };
});

import { graphFetchForTenant } from "../graph";
import { runItemDetailCollection, ITEM_DETAIL_PACKAGE_KEY, MAX_PERSISTED_ITEM_BYTES } from "../item-detail-collector";
import { executeMonitoringPackage } from "../monitor-executor";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import * as dbModule from "@workspace/db";

const state = (dbModule as unknown as { __state: {
  packages: unknown[];
  packageChecks: unknown[];
  checks: unknown[];
  profiles: unknown[];
  inserts: Array<{ table: string; values: Record<string, unknown> }>;
  failInsertsInto: string | null;
} }).__state;

const mockFetch = graphFetchForTenant as Mock;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseCheck = {
  id: 1,
  checkId: "uuid-1",
  key: "identity:stale-guest-accounts",
  label: "Stale guest accounts",
  description: null,
  endpoint: "/users",
  method: "GET",
  requestBody: null,
  selectParams: null,
  filterParams: null,
  properties: ["id"] as string[],
  mapping: [] as Array<{ sourceField: string; targetField: string; transform?: string }>,
  severityRules: [] as Array<{ expression: string; severity: string; label?: string }>,
  outputSchema: null,
  engines: [] as string[],
  frequency: "daily" as const,
  requiresCustomerScript: false,
  scriptPackageId: null,
  fanOutSource: null,
  fanOutItemIdField: null,
  fanOutMaxItems: null,
  fanOutItemFilter: null,
  fanOutItemNormalizer: null,
  executorType: "graph" as const,
  psCmdletKey: null,
  psParams: null,
  spOperation: null,
  schemaVersion: 1,
  status: "active" as const,
  createdByAdminId: null,
  updatedByAdminId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockRes = (payload: unknown) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(payload),
  json: async () => payload,
  headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? "application/json" : null) },
});

/**
 * A genuinely paginated Graph collection: `pages` pages of 2 items each, linked
 * by @odata.nextLink. Driven entirely off the requested URL (never a call
 * counter) so it stays correct when the scoring scan and the detail collection
 * are paginating the same endpoint concurrently.
 */
function mockPaginatedGraph(pages: number) {
  mockFetch.mockImplementation(async (_tenantId: string, path: string) => {
    const page = Number(/[?&]page=(\d+)/.exec(path)?.[1] ?? 1);
    const items = [{ id: `u${page * 2 - 1}`, page }, { id: `u${page * 2}`, page }];
    return mockRes({
      value: items,
      ...(page < pages ? { "@odata.nextLink": `https://graph.microsoft.com/v1.0/users?page=${page + 1}` } : {}),
    });
  });
}

const detailRows = () => state.inserts.filter(i => i.table === "tenant_check_item_details");
const profileRows = () => state.inserts.filter(i => i.table === "tenant_monitor_profiles");

beforeEach(() => {
  vi.clearAllMocks();
  state.packages = [{ key: ITEM_DETAIL_PACKAGE_KEY, label: "Full Item Detail Collection", engines: [], status: "active" }];
  state.packageChecks = [{ checkKey: baseCheck.key, sortOrder: 0 }];
  state.checks = [baseCheck];
  state.profiles = [];
  state.inserts = [];
  state.failInsertsInto = null;
});

// ── 1. Complete item lists ────────────────────────────────────────────────────

describe("runItemDetailCollection — completeness", () => {
  it("persists EVERY page's items, not the first page rawResponse would have kept", async () => {
    mockPaginatedGraph(3);

    const result = await runItemDetailCollection({ tenantId: "tenant-guid", customerId: 42 });

    expect(result.status).toBe("completed");
    expect(result.checksTotal).toBe(1);
    expect(result.checksWithItems).toBe(1);

    const rows = detailRows();
    expect(rows).toHaveLength(1);
    const row = rows[0]!.values;

    // 3 pages x 2 items. A result of 2 here would be the exact truncation bug
    // (page 1 only) this table exists to eliminate.
    expect((row["items"] as unknown[]).length).toBe(6);
    expect(row["itemCount"]).toBe(6);
    expect(row["pageCount"]).toBe(3);
    expect(result.itemsPersisted).toBe(6);

    // Every item, in order, from every page — not just the right count.
    expect((row["items"] as Array<{ id: string }>).map(i => i.id))
      .toEqual(["u1", "u2", "u3", "u4", "u5", "u6"]);
    expect(new Set((row["items"] as Array<{ page: number }>).map(i => i.page))).toEqual(new Set([1, 2, 3]));

    expect(row["itemsOmitted"]).toBe(false);
    expect(row["status"]).toBe("ok");
    expect(row["packageKey"]).toBe(ITEM_DETAIL_PACKAGE_KEY);
    expect(row["tenantId"]).toBe("tenant-guid");
    expect(row["customerId"]).toBe(42);
    // Traceable back to the profile row this same collection wrote.
    expect(row["profileId"]).toBeTruthy();
  });

  it("writes one row per covered check, all under a single run id", async () => {
    const second = { ...baseCheck, id: 2, checkId: "uuid-2", key: "identity:mfa-registration" };
    state.packageChecks = [{ checkKey: baseCheck.key, sortOrder: 0 }, { checkKey: second.key, sortOrder: 1 }];
    state.checks = [baseCheck, second];
    mockPaginatedGraph(2);

    const result = await runItemDetailCollection({ tenantId: "tenant-guid" });

    const rows = detailRows();
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.values["checkKey"])).toEqual([baseCheck.key, second.key]);
    expect(new Set(rows.map(r => r.values["runId"]))).toEqual(new Set([result.runId]));
    expect(result.itemsPersisted).toBe(8);
  });

  it("stores an over-sized payload as explicitly omitted, never as a silent prefix", async () => {
    const oversized = "x".repeat(MAX_PERSISTED_ITEM_BYTES + 1024);
    mockFetch.mockResolvedValue(mockRes({ value: [{ id: "u1", blob: oversized }] }));

    const result = await runItemDetailCollection({ tenantId: "tenant-guid" });

    const row = detailRows()[0]!.values;
    expect(row["itemsOmitted"]).toBe(true);
    // The absence must be explicit and explained — a stored prefix would make a
    // remediation document under-report while looking complete.
    expect(row["items"]).toBeNull();
    expect(String(row["itemsOmittedReason"])).toContain("NOT stored in part");
    // The real count is still recorded, so "we know there are N, we can't list
    // them" is answerable rather than reading as zero affected items.
    expect(row["itemCount"]).toBe(1);
    expect(result.checksOmitted).toBe(1);
    expect(result.status).toBe("partial");
  });

  it("still writes a row — with the reason — for a check that produced no items", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "Forbidden",
      headers: { get: () => null },
    });

    const result = await runItemDetailCollection({ tenantId: "tenant-guid" });

    const row = detailRows()[0]!.values;
    expect(row["status"]).toBe("error");
    expect(row["items"]).toBeNull();
    expect(row["itemsOmitted"]).toBe(false);
    expect(String(row["errorMessage"])).toContain("403");
    expect(result.status).toBe("partial");
    expect(result.checksWithoutItems).toBe(1);
  });
});

// ── 2. Parallel execution / non-interference ──────────────────────────────────

describe("runItemDetailCollection — parallel with the scoring scan", () => {
  it("runs concurrently with a scoring package run without changing its result", async () => {
    mockPaginatedGraph(3);

    const [scoring, detail] = await Promise.all([
      executeMonitoringPackage({
        packageKey: "core:security-baseline",
        tenantId: "tenant-guid",
        triggerId: "diag-run-abc",
      }),
      runItemDetailCollection({ tenantId: "tenant-guid", customerId: 42, parallelToRunId: "abc" }),
    ]);

    // The scoring run is untouched: same shape, same statuses, still completes.
    expect(scoring.runStatus).toBe("completed");
    expect(scoring.checks).toHaveLength(1);
    expect(scoring.checks[0]!.status).toBe("ok");
    expect(scoring.checks[0]!.itemCount).toBe(6);
    // And the hot path still retains NO item list — the memory profile the
    // scoring scan deliberately has is not quietly widened by this feature.
    expect(scoring.checks[0]!.items).toBeUndefined();

    // The detail run got its complete list at the same time.
    expect(detail.status).toBe("completed");
    expect((detailRows()[0]!.values["items"] as unknown[]).length).toBe(6);
  });

  it("uses its own triggerId, so neither run serves the other a cached result", async () => {
    mockPaginatedGraph(2);

    const [, detail] = await Promise.all([
      executeMonitoringPackage({ packageKey: "core:security-baseline", tenantId: "tenant-guid", triggerId: "diag-run-abc" }),
      runItemDetailCollection({ tenantId: "tenant-guid" }),
    ]);

    // Two profile rows — one per run — with DIFFERENT idempotency keys. Sharing
    // a triggerId would collide on "{tenant}:{check}:{trigger}" and hand one run
    // the other's cached, item-less result.
    const keys = profileRows().map(r => String(r.values["idempotencyKey"]));
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
    expect(keys).toContain("tenant-guid:identity:stale-guest-accounts:diag-run-abc");
    expect(keys.some(k => k.endsWith(`item-detail-${detail.runId}`))).toBe(true);

    // The detail run's triggerId is recorded on its own row too, so a detail row
    // can always be traced back to the collection that produced it.
    expect(detailRows()[0]!.values["triggerId"]).toBe(`item-detail-${detail.runId}`);
  });

  it("writes only to its own table — it never touches the scoring run's findings", async () => {
    mockPaginatedGraph(1);

    await runItemDetailCollection({ tenantId: "tenant-guid" });

    const tables = new Set(state.inserts.map(i => i.table));
    // tenant_monitor_profiles is written by executeMonitorCheck itself — the
    // same additive arrangement simulator runs already rely on — and nothing else.
    expect(tables).toEqual(new Set(["tenant_monitor_profiles", "tenant_check_item_details"]));
  });

  it("resolves rather than rejecting when its own persistence fails, so a caller can void it", async () => {
    mockPaginatedGraph(2);
    state.failInsertsInto = "tenant_check_item_details";

    const [scoring, detail] = await Promise.all([
      executeMonitoringPackage({ packageKey: "core:security-baseline", tenantId: "tenant-guid", triggerId: "diag-run-abc" }),
      runItemDetailCollection({ tenantId: "tenant-guid" }),
    ]);

    // No rejection, and the scoring run beside it is entirely unaffected.
    expect(detail.status).toBe("partial");
    expect(detail.checksWithItems).toBe(0);
    expect(detail.checksWithoutItems).toBe(1);
    expect(scoring.runStatus).toBe("completed");
    expect(scoring.checks[0]!.status).toBe("ok");
  });

  it("reports no_checks — loudly, not silently — when the package is unpopulated", async () => {
    state.packageChecks = [];

    const result = await runItemDetailCollection({ tenantId: "tenant-guid" });

    expect(result.status).toBe("no_checks");
    expect(result.checksTotal).toBe(0);
    expect(detailRows()).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("stops on a revoked grant instead of re-proving it on every remaining check", async () => {
    const second = { ...baseCheck, id: 2, checkId: "uuid-2", key: "identity:mfa-registration" };
    state.packageChecks = [{ checkKey: baseCheck.key, sortOrder: 0 }, { checkKey: second.key, sortOrder: 1 }];
    state.checks = [baseCheck, second];

    const { ConsentRevokedError } = await import("../graph");
    mockFetch.mockRejectedValue(new ConsentRevokedError("tenant-guid"));

    const result = await runItemDetailCollection({ tenantId: "tenant-guid" });

    expect(result.status).toBe("consent_revoked");
    expect(result.checksTotal).toBe(1);
    expect(detailRows()).toHaveLength(1);
    expect(detailRows()[0]!.values["status"]).toBe("consent_revoked");
  });
});
