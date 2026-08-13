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

// The fake DB has to actually honour WHERE clauses now (#543): the collector
// resolves TWO packages — the detail package and the scan's scoring package —
// and the whole point of the fix is that they hold different check sets. A fake
// that returns every junction row regardless of `package_key` cannot tell them
// apart, and would pass whether or not the scoping works. These are the only
// three drizzle helpers monitor-executor uses.
vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, value: unknown) => ({ __op: "eq", col, value }),
  and: (...conds: unknown[]) => ({ __op: "and", conds }),
  inArray: (col: unknown, values: unknown[]) => ({ __op: "inArray", col, values }),
}));

vi.mock("@workspace/db", () => {
  // Column access yields a {table, column} marker so the fake WHERE evaluator
  // knows which field an eq()/inArray() is actually about.
  const table = (name: string) =>
    new Proxy({ __table: name } as Record<string, unknown>, {
      get: (_t, prop) => {
        if (prop === "__table") return name;
        if (typeof prop === "symbol") return undefined;
        return { __table: name, __col: String(prop) };
      },
    });
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matches = (row: any, cond: any): boolean => {
    if (!cond || typeof cond !== "object") return true;
    if (cond.__op === "and") return (cond.conds as unknown[]).every(c => matches(row, c));
    if (cond.__op === "eq") return row?.[cond.col?.__col] === cond.value;
    if (cond.__op === "inArray") return (cond.values as unknown[]).includes(row?.[cond.col?.__col]);
    return true;
  };

  // Drizzle's builder is chainable AND awaitable at several different depths
  // (…where() for the checks load, …orderBy() for the junction, …limit() for
  // the single-row lookups), so the fake has to be all three.
  const query = (rows: unknown[]): Record<string, unknown> => ({
    where: (cond: unknown) => query(rows.filter(r => matches(r, cond))),
    orderBy: () => query(rows),
    limit: (n: number) => Promise.resolve(rows.slice(0, n)),
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

/** The scoring package every test's scan runs — the collector scopes to it. */
const SCORING_PACKAGE_KEY = "core:security-baseline";

/**
 * Junction rows for BOTH packages. Passing different key lists is how a test
 * expresses "this check is in the detail catalogue but curated out of the scan"
 * — the exact shape of the #543 bug.
 */
function linkChecks(detailKeys: string[], scoringKeys: string[]): void {
  state.packageChecks = [
    ...detailKeys.map((checkKey, i) => ({ packageKey: ITEM_DETAIL_PACKAGE_KEY, checkKey, sortOrder: i })),
    ...scoringKeys.map((checkKey, i) => ({ packageKey: SCORING_PACKAGE_KEY, checkKey, sortOrder: i })),
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  state.packages = [
    { key: ITEM_DETAIL_PACKAGE_KEY, label: "Full Item Detail Collection", engines: [], status: "active" },
    { key: SCORING_PACKAGE_KEY, label: "Security Baseline", engines: ["health"], status: "active" },
  ];
  linkChecks([baseCheck.key], [baseCheck.key]);
  state.checks = [baseCheck];
  state.profiles = [];
  state.inserts = [];
  state.failInsertsInto = null;
});

// ── 1. Complete item lists ────────────────────────────────────────────────────

describe("runItemDetailCollection — completeness", () => {
  it("persists EVERY page's items, not the first page rawResponse would have kept", async () => {
    mockPaginatedGraph(3);

    const result = await runItemDetailCollection({ tenantId: "tenant-guid", customerId: 42, scopeToPackageKey: SCORING_PACKAGE_KEY });

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
    // NULL since #543 — the collection no longer writes a tenant_monitor_profiles
    // row, so there is none to point at. Traceability is via runId/triggerId.
    expect(row["profileId"]).toBeNull();
  });

  it("writes one row per covered check, all under a single run id", async () => {
    const second = { ...baseCheck, id: 2, checkId: "uuid-2", key: "identity:mfa-registration" };
    linkChecks([baseCheck.key, second.key], [baseCheck.key, second.key]);
    state.checks = [baseCheck, second];
    mockPaginatedGraph(2);

    const result = await runItemDetailCollection({ tenantId: "tenant-guid", scopeToPackageKey: SCORING_PACKAGE_KEY });

    const rows = detailRows();
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.values["checkKey"])).toEqual([baseCheck.key, second.key]);
    expect(new Set(rows.map(r => r.values["runId"]))).toEqual(new Set([result.runId]));
    expect(result.itemsPersisted).toBe(8);
  });

  it("stores an over-sized payload as explicitly omitted, never as a silent prefix", async () => {
    const oversized = "x".repeat(MAX_PERSISTED_ITEM_BYTES + 1024);
    mockFetch.mockResolvedValue(mockRes({ value: [{ id: "u1", blob: oversized }] }));

    const result = await runItemDetailCollection({ tenantId: "tenant-guid", scopeToPackageKey: SCORING_PACKAGE_KEY });

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

    const result = await runItemDetailCollection({ tenantId: "tenant-guid", scopeToPackageKey: SCORING_PACKAGE_KEY });

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
      runItemDetailCollection({ tenantId: "tenant-guid", customerId: 42, scopeToPackageKey: SCORING_PACKAGE_KEY, parallelToRunId: "abc" }),
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
      runItemDetailCollection({ tenantId: "tenant-guid", scopeToPackageKey: SCORING_PACKAGE_KEY }),
    ]);

    // Exactly ONE profile row — the scoring run's. Since #543 the detail pass
    // writes none at all, so it can neither collide on
    // "{tenant}:{check}:{trigger}" nor win the DISTINCT ON that decides which
    // row is the tenant's live signal for this check.
    const keys = profileRows().map(r => String(r.values["idempotencyKey"]));
    expect(keys).toEqual(["tenant-guid:identity:stale-guest-accounts:diag-run-abc"]);

    // The detail run's triggerId is recorded on its own row too, so a detail row
    // can always be traced back to the collection that produced it.
    expect(detailRows()[0]!.values["triggerId"]).toBe(`item-detail-${detail.runId}`);
  });

  it("writes only to its own table — it never touches the scoring run's findings", async () => {
    mockPaginatedGraph(1);

    await runItemDetailCollection({ tenantId: "tenant-guid", scopeToPackageKey: SCORING_PACKAGE_KEY });

    const tables = new Set(state.inserts.map(i => i.table));
    // Its own table and NOTHING else (#543). tenant_monitor_profiles used to be
    // written here too, justified as an additive second recording; it isn't
    // additive — it is the unscoped scoring surface, so writing it made this
    // pass the score.
    expect(tables).toEqual(new Set(["tenant_check_item_details"]));
  });

  it("resolves rather than rejecting when its own persistence fails, so a caller can void it", async () => {
    mockPaginatedGraph(2);
    state.failInsertsInto = "tenant_check_item_details";

    const [scoring, detail] = await Promise.all([
      executeMonitoringPackage({ packageKey: "core:security-baseline", tenantId: "tenant-guid", triggerId: "diag-run-abc" }),
      runItemDetailCollection({ tenantId: "tenant-guid", scopeToPackageKey: SCORING_PACKAGE_KEY }),
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

    const result = await runItemDetailCollection({ tenantId: "tenant-guid", scopeToPackageKey: SCORING_PACKAGE_KEY });

    expect(result.status).toBe("no_checks");
    expect(result.checksTotal).toBe(0);
    expect(detailRows()).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("stops on a revoked grant instead of re-proving it on every remaining check", async () => {
    const second = { ...baseCheck, id: 2, checkId: "uuid-2", key: "identity:mfa-registration" };
    linkChecks([baseCheck.key, second.key], [baseCheck.key, second.key]);
    state.checks = [baseCheck, second];

    const { ConsentRevokedError } = await import("../graph");
    mockFetch.mockRejectedValue(new ConsentRevokedError("tenant-guid"));

    const result = await runItemDetailCollection({ tenantId: "tenant-guid", scopeToPackageKey: SCORING_PACKAGE_KEY });

    expect(result.status).toBe("consent_revoked");
    expect(result.checksTotal).toBe(1);
    expect(detailRows()).toHaveLength(1);
    expect(detailRows()[0]!.values["status"]).toBe("consent_revoked");
  });
});

// ── 3. #543 — package curation must gate EXECUTION, not just scoring ──────────
//
// The reported bug: checks deliberately removed from `monitoring_package_checks`
// for a package still ended up with fresh `tenant_monitor_profiles` rows,
// timestamped to the minute of a scan against that package. The scoring scan was
// innocent — `executeMonitoringPackage` never ran them. This parallel collector
// did, because it runs its OWN package, which the #339 migration links to every
// active check in the catalogue, and every check it ran wrote a profile row.
//
// These tests pin both halves of the fix, from the outside: what executes, and
// what reaches the scoring surface.

describe("runItemDetailCollection — #543 package-curation gating", () => {
  /** A check in the detail catalogue that has been curated OUT of the scan. */
  const excluded = { ...baseCheck, id: 9, checkId: "uuid-9", key: "appgov:stale-app-registrations" };

  beforeEach(() => {
    state.checks = [baseCheck, excluded];
    // Exactly the live shape: the detail package covers the whole catalogue,
    // the scoring package covers a curated subset that excludes this check.
    linkChecks([baseCheck.key, excluded.key], [baseCheck.key]);
  });

  it("never executes a check the scan's package excludes", async () => {
    mockPaginatedGraph(1);

    const result = await runItemDetailCollection({
      tenantId: "tenant-guid",
      customerId: 42,
      scopeToPackageKey: SCORING_PACKAGE_KEY,
    });

    // Only the in-scope check ran. Before the fix this was 2 — the excluded
    // check made a real Graph fetch on every single scan.
    expect(result.checksTotal).toBe(1);
    expect(detailRows().map(r => r.values["checkKey"])).toEqual([baseCheck.key]);
    expect(detailRows().map(r => r.values["checkKey"])).not.toContain(excluded.key);
  });

  it("leaves NO tenant_monitor_profiles row for an excluded check — the reported symptom", async () => {
    mockPaginatedGraph(1);

    await Promise.all([
      executeMonitoringPackage({
        packageKey: SCORING_PACKAGE_KEY,
        tenantId: "tenant-guid",
        triggerId: "diag-run-abc",
      }),
      runItemDetailCollection({
        tenantId: "tenant-guid",
        customerId: 42,
        scopeToPackageKey: SCORING_PACKAGE_KEY,
        parallelToRunId: "abc",
      }),
    ]);

    // This is the exact question Shane put to the live testbed: after a scan of
    // this package, does the excluded check have a fresh profile row? It must not.
    const profiledKeys = profileRows().map(r => String(r.values["checkKey"]));
    expect(profiledKeys).not.toContain(excluded.key);
    // And the only rows that exist at all are the scoring run's own.
    expect(profiledKeys).toEqual([baseCheck.key]);
    expect(profileRows().every(r => r.values["triggerId"] === "diag-run-abc")).toBe(true);
  });

  it("writes no profile row even for an IN-scope check, so it can never outrank the scan's own", async () => {
    mockPaginatedGraph(1);

    // Collector alone, no scoring run beside it: still zero profile rows.
    await runItemDetailCollection({ tenantId: "tenant-guid", scopeToPackageKey: SCORING_PACKAGE_KEY });

    expect(profileRows()).toHaveLength(0);
    // fetchLatestMonitorProfileRows() takes the newest row per check_key with no
    // package/run scoping, so a later-finishing detail row would silently BECOME
    // the tenant's signal for a check the scan had already read differently.
    expect(detailRows()).toHaveLength(1);
  });

  it("collects nothing rather than falling back to the whole catalogue when the scan's package resolves to no checks", async () => {
    mockPaginatedGraph(1);
    // Scoring package present but unpopulated — the scan itself ran zero checks.
    linkChecks([baseCheck.key, excluded.key], []);

    const result = await runItemDetailCollection({ tenantId: "tenant-guid", scopeToPackageKey: SCORING_PACKAGE_KEY });

    // Falling back to "everything" here is exactly the bug, so an empty scope
    // must mean an empty collection — never a full-catalogue sweep.
    expect(result.status).toBe("no_checks");
    expect(result.checksTotal).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("collects nothing when the scan's package does not exist at all", async () => {
    mockPaginatedGraph(1);

    const result = await runItemDetailCollection({ tenantId: "tenant-guid", scopeToPackageKey: "no:such-package" });

    expect(result.status).toBe("no_checks");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("still honours detail-package pruning within the scan's scope", async () => {
    mockPaginatedGraph(1);
    // Both checks scored, but the detail package has been pruned to one — the
    // documented way (#339) to skip item collection for a heavy check. The
    // intersection must respect that too, not just the scoring side.
    linkChecks([baseCheck.key], [baseCheck.key, excluded.key]);

    const result = await runItemDetailCollection({ tenantId: "tenant-guid", scopeToPackageKey: SCORING_PACKAGE_KEY });

    expect(result.checksTotal).toBe(1);
    expect(detailRows().map(r => r.values["checkKey"])).toEqual([baseCheck.key]);
  });
});

describe("executeMonitoringPackage — #543 resolved-check-list logging", () => {
  it("names every check that will run, and only those, before the first one runs", async () => {
    const excluded = { ...baseCheck, id: 9, checkId: "uuid-9", key: "appgov:stale-app-registrations" };
    state.checks = [baseCheck, excluded];
    linkChecks([baseCheck.key, excluded.key], [baseCheck.key]);
    mockPaginatedGraph(1);

    await executeMonitoringPackage({
      packageKey: SCORING_PACKAGE_KEY,
      tenantId: "tenant-guid",
      triggerId: "diag-run-abc",
    });

    // The line that makes "did this run execute check X?" answerable from the
    // logs alone, rather than inferred from rows several paths can write.
    const { logger } = await import("../logger");
    const resolved = (logger.info as unknown as Mock).mock.calls.find(
      (call: unknown[]) => typeof call[1] === "string" && call[1].includes("resolved package check list"),
    );
    expect(resolved).toBeDefined();
    const meta = resolved![0] as { checkKeys: string[]; packageKey: string };
    expect(meta.packageKey).toBe(SCORING_PACKAGE_KEY);
    expect(meta.checkKeys).toEqual([baseCheck.key]);
    expect(meta.checkKeys).not.toContain(excluded.key);
  });
});
