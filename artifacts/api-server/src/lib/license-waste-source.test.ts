import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for license-waste-source.ts — the resolution step that finds WHICH
 * real monitor check holds a tenant's per-SKU wasted-seat counts.
 *
 * This is the exact chain that was broken: the Cost Engine's inputs both existed
 * (real sku_price_reference pricing, real per-SKU seat counts on a cost check)
 * but the code only ever looked at the single hardcoded key
 * `cost:license-waste-estimate`, so the dollar figure came back null.
 *
 * DB is mocked with a FIFO queue (same convention as dashboard-resolvers.test.ts).
 * Query order per resolveLicenseWasteCounts call:
 *   1. sku_price_reference   (every priceable SKU)
 *   2. monitor_checks        (active cost:* keys)
 *   3. tenant_monitor_profiles, once per candidate key, in candidate order
 */

let mockResultQueue: any[][] = [];

vi.mock("@workspace/db", () => {
  function makeChain() {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (onFulfilled: any, onRejected: any) =>
        Promise.resolve(mockResultQueue.shift() ?? []).then(onFulfilled, onRejected),
    };
    return chain;
  }
  const tbl = (cols: string[]) => Object.fromEntries(cols.map((c) => [c, c]));
  return {
    db: { select: vi.fn(() => makeChain()) },
    monitorChecksTable: tbl(["key", "status", "mapping"]),
    skuPriceReferenceTable: tbl(["skuPartNumber", "displayName", "monthlyPriceCents"]),
    tenantMonitorProfilesTable: tbl(["tenantId", "checkKey", "extractedProperties", "collectedAt", "status"]),
  };
});

import {
  resolveLicenseWasteCounts,
  extractCountMaps,
  DEFAULT_LICENSE_WASTE_CHECK_KEY,
} from "./license-waste-source.ts";

/** The real seeded SKUs relevant to these tests (2026-07-19-sku-price-reference.sql). */
const PRICED_SKUS = [
  { sku: "ENTERPRISEPACK" },
  { sku: "SPE_E3" },
  { sku: "SPB" },
];

const collectedAt = new Date("2026-07-26T02:00:00.000Z");

function queueSkusAndChecks(costCheckKeys: string[]) {
  mockResultQueue.push(PRICED_SKUS);
  mockResultQueue.push(costCheckKeys.map((key) => ({ key })));
}

describe("extractCountMaps", () => {
  it("returns EVERY count map, not just the first — the old first-object-wins trap", () => {
    const maps = extractCountMaps({
      byDepartment: { Sales: 3, Support: 1 },
      skuPartNumber: { ENTERPRISEPACK: 1, SPB: 3 },
      unusedLicenseCount: 4,
      _itemCount: 9,
      __rawResponse: { value: [] },
    });
    expect(maps.map((m) => m.field).sort()).toEqual(["byDepartment", "skuPartNumber"]);
    expect(maps.find((m) => m.field === "skuPartNumber")!.counts).toEqual({
      ENTERPRISEPACK: 1,
      SPB: 3,
    });
  });

  it("skips reserved auto-keys, scalars and arrays", () => {
    expect(extractCountMaps({ _itemCount: 4, total: 9, list: [1, 2], __status: "ok" })).toEqual([]);
  });
});

describe("resolveLicenseWasteCounts", () => {
  beforeEach(() => {
    mockResultQueue = [];
  });

  it("uses the preferred (registry) check key when it genuinely has SKU data", async () => {
    queueSkusAndChecks(["cost:unused-unassigned-licenses"]);
    mockResultQueue.push([
      { extractedProperties: { skuPartNumber: { ENTERPRISEPACK: 2 } }, collectedAt },
    ]);

    const res = await resolveLicenseWasteCounts("tenant-guid-1");
    expect(res).not.toBeNull();
    expect(res!.checkKey).toBe(DEFAULT_LICENSE_WASTE_CHECK_KEY);
    expect(res!.fallback).toBe(false);
    expect(res!.counts).toEqual({ ENTERPRISEPACK: 2 });
  });

  it("falls back to the cost check that ACTUALLY collected the seat data (the real bug)", async () => {
    // Exactly the live shape Shane confirmed: nothing on the registry's declared
    // key, real per-SKU waste on cost:unused-unassigned-licenses.
    queueSkusAndChecks(["cost:unused-unassigned-licenses"]);
    mockResultQueue.push([]); // cost:license-waste-estimate — no row for this tenant
    mockResultQueue.push([
      {
        extractedProperties: {
          unusedLicenseCount: 4,
          skuPartNumber: { ENTERPRISEPACK: 1, SPB: 3 },
          _itemCount: 4,
        },
        collectedAt,
      },
    ]);

    const res = await resolveLicenseWasteCounts("tenant-guid-1");
    expect(res).not.toBeNull();
    expect(res!.checkKey).toBe("cost:unused-unassigned-licenses");
    expect(res!.fallback).toBe(true);
    expect(res!.field).toBe("skuPartNumber");
    expect(res!.counts).toEqual({ ENTERPRISEPACK: 1, SPB: 3 });
    expect(res!.pricedSkuCount).toBe(2);
  });

  it("prefers the SKU-keyed map over a same-check map grouped by something else", async () => {
    queueSkusAndChecks([]);
    mockResultQueue.push([
      {
        extractedProperties: {
          // Alphabetically/insertion-order first, but NOT SKU-keyed — pricing it
          // as license waste would invent a dollar figure out of nothing.
          byDepartment: { Sales: 12, Support: 8 },
          skuPartNumber: { ENTERPRISEPACK: 1 },
        },
        collectedAt,
      },
    ]);

    const res = await resolveLicenseWasteCounts("tenant-guid-1");
    expect(res!.field).toBe("skuPartNumber");
    expect(res!.counts).toEqual({ ENTERPRISEPACK: 1 });
  });

  it("never widens into whole-estate licensing checks — only cost:* waste-named keys are candidates", async () => {
    // The discovery query is restricted to cost:%; of those, only keys naming an
    // unused/wasted concept survive. A cost inventory check must be ignored, or
    // the entire license estate would be reported as waste.
    queueSkusAndChecks(["cost:license-inventory", "cost:unused-unassigned-licenses"]);
    mockResultQueue.push([]); // preferred key — no data
    // Only ONE further profile query should be issued (the unused-* key). If
    // cost:license-inventory were a candidate it would be queried first and
    // consume this row.
    mockResultQueue.push([
      { extractedProperties: { skuPartNumber: { SPE_E3: 5 } }, collectedAt },
    ]);

    const res = await resolveLicenseWasteCounts("tenant-guid-1");
    expect(res!.checkKey).toBe("cost:unused-unassigned-licenses");
    expect(res!.counts).toEqual({ SPE_E3: 5 });
  });

  it("returns null (honest no-data) when no cost check has SKU-keyed seat data", async () => {
    queueSkusAndChecks(["cost:unused-unassigned-licenses"]);
    mockResultQueue.push([]);
    mockResultQueue.push([{ extractedProperties: { _itemCount: 0 }, collectedAt }]);

    expect(await resolveLicenseWasteCounts("tenant-guid-1")).toBeNull();
  });

  it("returns null rather than a bogus map when nothing is priceable at all", async () => {
    mockResultQueue.push([]); // sku_price_reference empty
    expect(await resolveLicenseWasteCounts("tenant-guid-1")).toBeNull();
  });
});
