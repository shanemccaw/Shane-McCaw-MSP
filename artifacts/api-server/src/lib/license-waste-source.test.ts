import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for license-waste-source.ts — computing a tenant's REAL per-SKU
 * unused seats so cost-engine.ts has something honest to price.
 *
 * These tests are written against the LIVE catalog audited 2026-07-26:
 *   * `cost:license-waste-estimate` (the registry's declared sourceKey) does not
 *     exist at all.
 *   * `cost:unused-unassigned-licenses` maps `count` over `consumedUnits`, so
 *     its `unusedLicenseCount` is a count of SKU ROWS, not of wasted seats.
 *   * Every `groupByCount(skuPartNumber)` over /subscribedSkus yields one row
 *     per SKU (`{ENTERPRISEPACK: 1}`) — SKU-keyed and numeric, and therefore a
 *     perfect trap: pricing it reports waste that does not exist.
 * The regression these lock down is that NONE of those is treated as a seat
 * count; the figure comes from prepaidUnits.enabled − consumedUnits.
 *
 * DB is mocked with a FIFO queue. Query order per resolveLicenseWasteCounts:
 *   1. monitor_checks (active) — filtered in JS to /subscribedSkus endpoints
 *   2. tenant_monitor_profiles, once per candidate key, in ALPHABETICAL key
 *      order — every candidate is read before one is chosen, because the choice
 *      is by `collected_at` recency across the whole set (#441). It used to be
 *      "first candidate with a usable page wins, with cost:unused-unassigned-
 *      licenses sorted to the front by name"; that made the reported provenance
 *      a naming preference rather than a fact, and once that check left the
 *      assess:copilot-readiness package it kept winning on a stale stored page.
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
    monitorChecksTable: tbl(["key", "status", "endpoint"]),
    tenantMonitorProfilesTable: tbl(["tenantId", "checkKey", "rawResponse", "collectedAt", "status"]),
  };
});

import { resolveLicenseWasteCounts, unusedSeatsFromSubscribedSkus } from "./license-waste-source.ts";

/** The real /subscribedSkus shape, as Graph returns it. */
function skuPage(items: unknown[], nextLink?: string) {
  return { value: items, ...(nextLink ? { "@odata.nextLink": nextLink } : {}) };
}
const sku = (skuPartNumber: string, enabled: number, consumed: number) => ({
  skuId: `id-${skuPartNumber}`,
  skuPartNumber,
  consumedUnits: consumed,
  prepaidUnits: { enabled, suspended: 0, warning: 0 },
});

/** The live catalog's four /subscribedSkus checks. */
const SUBSCRIBED_SKU_CHECKS = [
  { key: "cost:entra-license-tier-distribution", endpoint: "/subscribedSkus" },
  { key: "cost:license-count-by-sku", endpoint: "/subscribedSkus" },
  { key: "cost:unused-unassigned-licenses", endpoint: "/subscribedSkus" },
  { key: "cost:utilization-by-sku", endpoint: "/subscribedSkus" },
];
/** Real non-/subscribedSkus cost checks that must never be candidates. */
const OTHER_COST_CHECKS = [
  { key: "cost:duplicate-assignments", endpoint: "/users" },
  { key: "cost:group-based-licensing-adoption", endpoint: "/groups" },
  { key: "cost:underutilized-premium", endpoint: "/users" },
];

const collectedAt = new Date("2026-07-27T03:00:45.924Z");

describe("unusedSeatsFromSubscribedSkus", () => {
  it("computes unused seats as prepaidUnits.enabled - consumedUnits, per SKU", () => {
    const out = unusedSeatsFromSubscribedSkus(
      skuPage([sku("ENTERPRISEPACK", 25, 21), sku("SPB", 10, 10), sku("POWER_BI_PRO", 5, 2)]),
    )!;
    expect(out.counts).toEqual({ ENTERPRISEPACK: 4, POWER_BI_PRO: 3 }); // SPB fully assigned → omitted
    expect(out.totalEnabledSeats).toBe(40);
    expect(out.lines).toContainEqual({ skuPartNumber: "SPB", enabled: 10, consumed: 10, unused: 0 });
  });

  it("never returns a negative count when consumed exceeds enabled", () => {
    const out = unusedSeatsFromSubscribedSkus(skuPage([sku("ENTERPRISEPACK", 5, 8)]))!;
    expect(out.counts).toEqual({});
    expect(out.lines[0].unused).toBe(0);
  });

  it("skips a SKU missing consumedUnits rather than treating every seat as wasted", () => {
    const partial = { skuPartNumber: "SPE_E3", prepaidUnits: { enabled: 50 } }; // no consumedUnits
    const out = unusedSeatsFromSubscribedSkus(skuPage([partial, sku("ENTERPRISEPACK", 4, 1)]))!;
    expect(out.counts).toEqual({ ENTERPRISEPACK: 3 });
    expect(out.lines.map((l) => l.skuPartNumber)).toEqual(["ENTERPRISEPACK"]);
    expect(out.totalEnabledSeats).toBe(4); // the 50 unusable seats are not counted either
  });

  it("refuses a truncated page — only the first Graph page is persisted", () => {
    expect(
      unusedSeatsFromSubscribedSkus(skuPage([sku("ENTERPRISEPACK", 25, 21)], "https://graph/next")),
    ).toBeNull();
  });

  it("returns null for a response with no usable SKU rows", () => {
    expect(unusedSeatsFromSubscribedSkus(skuPage([]))).toBeNull();
    expect(unusedSeatsFromSubscribedSkus(null)).toBeNull();
    expect(unusedSeatsFromSubscribedSkus({ notAPage: true })).toBeNull();
  });
});

describe("resolveLicenseWasteCounts", () => {
  beforeEach(() => {
    mockResultQueue = [];
  });

  it("prices real unused seats from the live tenant's /subscribedSkus response", async () => {
    mockResultQueue.push([...OTHER_COST_CHECKS, ...SUBSCRIBED_SKU_CHECKS]);
    // Only one candidate has a stored page, so it wins on recency by default.
    mockResultQueue.push([
      { rawResponse: skuPage([sku("ENTERPRISEPACK", 25, 21), sku("SPB", 3, 3)]), collectedAt },
    ]);

    const res = await resolveLicenseWasteCounts("tenant-guid-1");
    expect(res).not.toBeNull();
    expect(res!.checkKey).toBe("cost:entra-license-tier-distribution");
    expect(res!.counts).toEqual({ ENTERPRISEPACK: 4 });
    expect(res!.totalEnabledSeats).toBe(28);
  });

  it("NEVER prices a groupByCount SKU-row tally as waste (the fabrication trap)", async () => {
    // extractedProperties on these checks carries {ENTERPRISEPACK: 1, ...} — one
    // row per SKU. It is SKU-keyed and numeric, so a name/shape-based resolver
    // would price it as 1 wasted seat per SKU. The real page says every seat is
    // assigned, so the only honest answer is null.
    mockResultQueue.push(SUBSCRIBED_SKU_CHECKS);
    mockResultQueue.push([
      {
        rawResponse: skuPage([sku("ENTERPRISEPACK", 21, 21), sku("SPB", 3, 3)]),
        collectedAt,
        extractedProperties: {
          entraLicenseTierDistribution: { ENTERPRISEPACK: 1, SPB: 1 },
          unusedLicenseCount: 4,
        },
      },
    ]);

    expect(await resolveLicenseWasteCounts("tenant-guid-1")).toBeNull();
  });

  it("only considers checks whose ENDPOINT hits /subscribedSkus, not cost:* by name", async () => {
    // Only the /users + /groups cost checks exist → no candidate at all, and no
    // profile query is ever issued.
    mockResultQueue.push(OTHER_COST_CHECKS);
    expect(await resolveLicenseWasteCounts("tenant-guid-1")).toBeNull();
    expect(mockResultQueue).toHaveLength(0);
  });

  it("moves to the next /subscribedSkus check when the first has no stored page", async () => {
    mockResultQueue.push(SUBSCRIBED_SKU_CHECKS);
    mockResultQueue.push([]); // cost:entra-license-tier-distribution — never collected
    mockResultQueue.push([{ rawResponse: skuPage([sku("SPE_E3", 12, 7)]), collectedAt }]);

    const res = await resolveLicenseWasteCounts("tenant-guid-1");
    expect(res!.checkKey).toBe("cost:license-count-by-sku");
    expect(res!.counts).toEqual({ SPE_E3: 5 });
    expect(res!.fallback).toBe(true);
  });

  it("#441 — provenance follows the NEWEST stored page, not the tidiest key name", async () => {
    // The exact live shape behind #441: cost:unused-unassigned-licenses was
    // removed from assess:copilot-readiness, so its row is now months old, while
    // a check the scan still runs has a fresh one. tenant_monitor_profiles keeps
    // the last row per check forever, so the retired check still HAS a page —
    // the old name-preference sort therefore kept citing it as the source of the
    // customer's current licence figures. Recency is what makes the reported
    // checkKey a fact rather than a preference.
    const stale = new Date("2026-05-01T00:00:00.000Z");
    const fresh = new Date("2026-08-05T00:00:00.000Z");
    mockResultQueue.push(SUBSCRIBED_SKU_CHECKS);
    // Alphabetical candidate order: entra, license-count, unused-unassigned, utilization.
    mockResultQueue.push([]);                                                             // entra
    mockResultQueue.push([{ rawResponse: skuPage([sku("SPE_E3", 12, 7)]), collectedAt: fresh }]);  // license-count
    mockResultQueue.push([{ rawResponse: skuPage([sku("SPE_E3", 90, 1)]), collectedAt: stale }]);  // unused-unassigned
    mockResultQueue.push([]);                                                             // utilization

    const res = await resolveLicenseWasteCounts("tenant-guid-1");
    expect(res!.checkKey).toBe("cost:license-count-by-sku");
    // 5, from the fresh page — NOT 89 from the retired check's stale one.
    expect(res!.counts).toEqual({ SPE_E3: 5 });
  });

  it("#441 — still honours an EXPLICIT preferredCheckKey over a newer page elsewhere", async () => {
    // A caller naming a check is stating intent, not guessing from a string, so
    // it stays ahead of recency. Only the name-based default was removed.
    const fresh = new Date("2026-08-05T00:00:00.000Z");
    const older = new Date("2026-08-01T00:00:00.000Z");
    mockResultQueue.push(SUBSCRIBED_SKU_CHECKS);
    mockResultQueue.push([{ rawResponse: skuPage([sku("SPE_E3", 30, 22)]), collectedAt: older }]); // entra
    mockResultQueue.push([{ rawResponse: skuPage([sku("SPE_E3", 12, 7)]), collectedAt: fresh }]);  // license-count
    mockResultQueue.push([]);
    mockResultQueue.push([]);

    const res = await resolveLicenseWasteCounts("tenant-guid-1", "cost:entra-license-tier-distribution");
    expect(res!.checkKey).toBe("cost:entra-license-tier-distribution");
    // 8, from the named check's older page — not 5 from the newer one.
    expect(res!.counts).toEqual({ SPE_E3: 8 });
    expect(res!.fallback).toBe(false);
  });

  it("reports fallback=true because the registry's declared key is not a real check", async () => {
    mockResultQueue.push(SUBSCRIBED_SKU_CHECKS);
    mockResultQueue.push([{ rawResponse: skuPage([sku("ENTERPRISEPACK", 25, 21)]), collectedAt }]);
    const res = await resolveLicenseWasteCounts("tenant-guid-1");
    // `cost:license-waste-estimate` does not exist in the catalog, so whatever
    // is used is by definition not the declared source.
    expect(res!.fallback).toBe(true);
  });
});
