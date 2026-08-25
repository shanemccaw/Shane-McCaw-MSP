import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Git #1230 — the Licensing pillar dashboard's per-SKU ledger
 * (`resolveLicenseSkuLedger` / `licenseSkuLedgerRowsFromLines`, license-waste-
 * source.ts). Same DB mock + fixture shape as license-waste-paid-seats.test.ts,
 * since both resolvers share the same underlying `/subscribedSkus` +
 * `sku_price_reference` data.
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
    skuPriceReferenceTable: tbl(["skuPartNumber", "displayName", "monthlyPriceCents"]),
  };
});

import { licenseSkuLedgerRowsFromLines, resolveLicenseSkuLedger } from "./license-waste-source.ts";

const skuPage = (items: unknown[]) => ({ value: items });
const sku = (skuPartNumber: string, enabled: number, consumed: number) => ({
  skuId: `id-${skuPartNumber}`,
  skuPartNumber,
  consumedUnits: consumed,
  prepaidUnits: { enabled, suspended: 0, warning: 0 },
});

const SUBSCRIBED_SKU_CHECKS = [{ key: "licensing:sku-utilization", endpoint: "/subscribedSkus" }];
const collectedAt = new Date("2026-08-01T03:00:45.924Z");

function queueGraphPage(page: unknown) {
  mockResultQueue.push(SUBSCRIBED_SKU_CHECKS);
  mockResultQueue.push([{ rawResponse: page, collectedAt }]);
}
function queuePrice(row: { displayName: string; monthlyPriceCents: number | null } | null) {
  mockResultQueue.push(row ? [row] : []);
}

describe("licenseSkuLedgerRowsFromLines", () => {
  const lines = [
    { skuPartNumber: "SPE_E5", enabled: 240, consumed: 202, unused: 38 },
    { skuPartNumber: "POWER_BI_PRO", enabled: 12, consumed: 12, unused: 0 },
    { skuPartNumber: "POWER_BI_STANDARD", enabled: 1_000_000, consumed: 2, unused: 999_998 },
  ];
  const prices = new Map<string, number | null>([
    ["SPE_E5", 5700],
    ["POWER_BI_PRO", 1000],
    ["POWER_BI_STANDARD", null], // free — no price row
  ]);
  const names = new Map<string, string>([
    ["SPE_E5", "Microsoft 365 E5"],
    ["POWER_BI_PRO", "Power BI Pro"],
  ]);

  it("builds real per-SKU rows, ordered by monthly waste, excluding unpriced SKUs", () => {
    const { rows, excluded } = licenseSkuLedgerRowsFromLines(lines, prices, names);

    expect(rows.map((r) => r.skuPartNumber)).toEqual(["SPE_E5", "POWER_BI_PRO"]);
    expect(rows[0]).toEqual({
      skuPartNumber: "SPE_E5",
      displayName: "Microsoft 365 E5",
      purchased: 240,
      assigned: 202,
      unassigned: 38,
      unitMonthlyPriceCents: 5700,
      monthlyWasteCents: 38 * 5700,
      annualWasteCents: 38 * 5700 * 12,
    });
    expect(rows[1].monthlyWasteCents).toBe(0);
    expect(excluded).toEqual([
      { skuPartNumber: "POWER_BI_STANDARD", purchased: 1_000_000, reason: "no_price_on_file" },
    ]);
  });

  it("a zero-priced SKU is excluded the same as an unpriced one", () => {
    const { rows, excluded } = licenseSkuLedgerRowsFromLines(
      [{ skuPartNumber: "FLOW_FREE", enabled: 10_000, consumed: 3, unused: 9_997 }],
      new Map([["FLOW_FREE", 0]]),
      new Map(),
    );
    expect(rows).toEqual([]);
    expect(excluded).toEqual([{ skuPartNumber: "FLOW_FREE", purchased: 10_000, reason: "zero_price" }]);
  });

  it("falls back to the SKU part number when no display name is known", () => {
    const { rows } = licenseSkuLedgerRowsFromLines(
      [{ skuPartNumber: "AAD_PREMIUM", enabled: 41, consumed: 41, unused: 0 }],
      new Map([["AAD_PREMIUM", 600]]),
      new Map(),
    );
    expect(rows[0].displayName).toBe("AAD_PREMIUM");
  });
});

describe("resolveLicenseSkuLedger", () => {
  beforeEach(() => {
    mockResultQueue = [];
  });

  it("turns a real /subscribedSkus page into a priced ledger with real totals", async () => {
    queueGraphPage(skuPage([sku("SPE_E5", 240, 202), sku("POWER_BI_PRO", 12, 12)]));
    queuePrice({ displayName: "Microsoft 365 E5", monthlyPriceCents: 5700 });
    queuePrice({ displayName: "Power BI Pro", monthlyPriceCents: 1000 });

    const ledger = (await resolveLicenseSkuLedger("tenant-guid-1"))!;

    expect(ledger.rows).toHaveLength(2);
    expect(ledger.totalPurchased).toBe(252);
    expect(ledger.totalAssigned).toBe(214);
    expect(ledger.totalUnassigned).toBe(38);
    expect(ledger.totalMonthlyWasteCents).toBe(38 * 5700);
    expect(ledger.checkKey).toBe("licensing:sku-utilization");
  });

  it("returns an empty-rows ledger (not null) when every SKU is unpriced", async () => {
    queueGraphPage(skuPage([sku("FLOW_FREE", 10_000, 3)]));
    queuePrice(null);

    const ledger = (await resolveLicenseSkuLedger("tenant-guid-1"))!;
    expect(ledger.rows).toEqual([]);
    expect(ledger.excluded).toEqual([{ skuPartNumber: "FLOW_FREE", purchased: 10_000, reason: "no_price_on_file" }]);
  });

  it("stays null when no /subscribedSkus page can be sourced at all", async () => {
    mockResultQueue.push([]); // no active /subscribedSkus checks
    expect(await resolveLicenseSkuLedger("tenant-guid-1")).toBeNull();
  });
});
