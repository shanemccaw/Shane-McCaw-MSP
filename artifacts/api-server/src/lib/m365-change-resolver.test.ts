import { describe, it, expect, vi } from "vitest";

/**
 * Unit tests for m365-change-resolver.ts (#1533) — the pure SKU-matching half
 * of the resolution layer. What these lock down:
 *
 *   1. An interpretation's free-text `touches.skus` entry maps to a real
 *      subscribed SKU by normalized equality or long-enough containment —
 *      "Project Online" finds PROJECTONLINE_PLAN_1 without an alias table.
 *   2. Short names NEVER match by containment ("E5" must not match SPE_E5) —
 *      a wrong match would count the wrong licence population as affected.
 *   3. A name that matches nothing is returned as UNMATCHED, not dropped —
 *      the caller turns that into `not_measured` / `sku_not_mapped`, never a
 *      guessed zero (#1533's zero-is-only-ever-measured rule).
 */

// The module under test imports db-backed neighbours at module scope; the pure
// functions never touch them, so they are stubbed inert.
vi.mock("@workspace/db", () => ({
  db: {},
  licenseAssignmentSnapshotsTable: {},
  m365ChangeInterpretationsTable: {},
  m365ChangeResolutionsTable: {},
  monitorChecksTable: {},
  tenantMonitorProfilesTable: {},
  tenantsTable: {},
}));
vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
}));
vi.mock("./monitor-executor", () => ({ executeMonitorCheck: vi.fn() }));
vi.mock("./license-waste-source", () => ({ resolveSubscribedSkuCatalog: vi.fn() }));
vi.mock("./logger", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

import { matchSkusToCatalog, normalizeSkuName } from "./m365-change-resolver";
import type { SubscribedSkuCatalogEntry } from "./license-waste-source";

const CATALOG: SubscribedSkuCatalogEntry[] = [
  { skuId: "53818b1b-4a27-454b-8896-0dba576410e6", skuPartNumber: "PROJECTONLINE_PLAN_1", consumedUnits: 14 },
  { skuId: "c7df2760-2c81-4ef7-b578-5b5392b571df", skuPartNumber: "ENTERPRISEPREMIUM", consumedUnits: 250 },
  { skuId: "06ebc4ee-1bb5-47dd-8120-11324bc54e06", skuPartNumber: "SPE_E5", consumedUnits: 40 },
];

describe("normalizeSkuName", () => {
  it("lowercases and strips everything but alphanumerics", () => {
    expect(normalizeSkuName("PROJECTONLINE_PLAN_1")).toBe("projectonlineplan1");
    expect(normalizeSkuName("Project Online (Plan 1)")).toBe("projectonlineplan1");
  });
});

describe("matchSkusToCatalog", () => {
  it("matches a friendly name to its part number by containment", () => {
    const { matched, unmatched } = matchSkusToCatalog(["Project Online"], CATALOG);
    expect(matched).toEqual({ PROJECTONLINE_PLAN_1: "53818b1b-4a27-454b-8896-0dba576410e6" });
    expect(unmatched).toEqual([]);
  });

  it("matches an exact part number regardless of case and separators", () => {
    const { matched } = matchSkusToCatalog(["spe_e5"], CATALOG);
    expect(matched).toEqual({ SPE_E5: "06ebc4ee-1bb5-47dd-8120-11324bc54e06" });
  });

  it("matches a SKU GUID directly", () => {
    const { matched } = matchSkusToCatalog(["c7df2760-2c81-4ef7-b578-5b5392b571df"], CATALOG);
    expect(matched).toEqual({ ENTERPRISEPREMIUM: "c7df2760-2c81-4ef7-b578-5b5392b571df" });
  });

  it("refuses short-name containment — 'E5' must not match SPE_E5", () => {
    const { matched, unmatched } = matchSkusToCatalog(["E5"], CATALOG);
    expect(matched).toEqual({});
    expect(unmatched).toEqual(["E5"]);
  });

  it("returns unmapped names as unmatched instead of dropping them", () => {
    const { matched, unmatched } = matchSkusToCatalog(["Project Online", "Visio Plan 2"], CATALOG);
    expect(Object.keys(matched)).toEqual(["PROJECTONLINE_PLAN_1"]);
    expect(unmatched).toEqual(["Visio Plan 2"]);
  });

  it("matches nothing against an estate that does not hold the SKU", () => {
    // The caller must turn this into not_measured/sku_not_mapped — never zero:
    // free-text naming failure and genuine absence are indistinguishable here.
    const { matched, unmatched } = matchSkusToCatalog(["Power BI Premium"], CATALOG);
    expect(matched).toEqual({});
    expect(unmatched).toEqual(["Power BI Premium"]);
  });

  it("ignores blank entries", () => {
    const { matched, unmatched } = matchSkusToCatalog(["  ", ""], CATALOG);
    expect(matched).toEqual({});
    expect(unmatched).toEqual([]);
  });
});
