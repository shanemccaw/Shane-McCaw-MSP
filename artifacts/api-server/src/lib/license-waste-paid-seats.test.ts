import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * #333 — the War Room Licensing card reported "1,020,000 seats provisioned" and
 * "1,019,995 paid, unassigned" for a tenant with five active users.
 *
 * The number was real code doing real arithmetic on a real Graph page: Microsoft
 * returns free / viral / self-service SKUs through the same `/subscribedSkus`
 * shape as purchased ones, with `prepaidUnits.enabled` carrying a sentinel
 * CAPACITY instead of a bought quantity — 1,000,000 for POWER_BI_STANDARD and
 * 10,000 for FLOW_FREE / the viral trial SKUs. `totalEnabledSeats` summed them.
 *
 * The first test below is the reproduction: it runs the UNCHANGED
 * `unusedSeatsFromSubscribedSkus` over exactly that estate and asserts it still
 * produces the two reported numbers, so the diagnosis stays pinned to real
 * behaviour rather than to a story about it. Everything after it is the fix.
 *
 * DB is mocked with a FIFO queue, same as license-waste-source.test.ts. Query
 * order per resolvePaidSeatFigures:
 *   1. monitor_checks (active) — filtered in JS to /subscribedSkus endpoints
 *   2. tenant_monitor_profiles, once per candidate key in order
 *   3. sku_price_reference, once per DISTINCT skuPartNumber on the page
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

import {
  paidSeatFiguresFromLines,
  resolvePaidSeatFigures,
  unusedSeatsFromSubscribedSkus,
} from "./license-waste-source.ts";

const skuPage = (items: unknown[]) => ({ value: items });
const sku = (skuPartNumber: string, enabled: number, consumed: number) => ({
  skuId: `id-${skuPartNumber}`,
  skuPartNumber,
  consumedUnits: consumed,
  prepaidUnits: { enabled, suspended: 0, warning: 0 },
});

/**
 * The reported estate: three SKUs Microsoft reports at sentinel capacity, five
 * seats genuinely in use across them, and one real purchased SKU.
 */
const REPORTED_ESTATE = [
  sku("POWER_BI_STANDARD", 1_000_000, 2), // Fabric (Free)
  sku("FLOW_FREE", 10_000, 3), // Power Automate Free
  sku("CCIBOTS_PRIVPREV_VIRAL", 10_000, 0), // viral trial
];

const SUBSCRIBED_SKU_CHECKS = [
  { key: "cost:license-count-by-sku", endpoint: "/subscribedSkus" },
  { key: "cost:unused-unassigned-licenses", endpoint: "/subscribedSkus" },
];
const collectedAt = new Date("2026-08-01T03:00:45.924Z");

/**
 * Queue the catalog + profile reads resolveLicenseWasteCounts performs.
 *
 * One profile read PER CANDIDATE, in alphabetical key order: since #441 every
 * candidate is read before one is chosen, because the winner is the most
 * recently collected page rather than the first usable one. Only the first
 * candidate here has a stored page, so it wins by default.
 */
function queueGraphPage(page: unknown) {
  mockResultQueue.push(SUBSCRIBED_SKU_CHECKS);
  mockResultQueue.push([{ rawResponse: page, collectedAt }]);
  for (let i = 1; i < SUBSCRIBED_SKU_CHECKS.length; i++) mockResultQueue.push([]);
}
/** Queue one sku_price_reference lookup result (in page order, distinct SKUs). */
function queuePrice(row: { displayName: string; monthlyPriceCents: number | null } | null) {
  mockResultQueue.push(row ? [row] : []);
}

describe("#333 reproduction — the bug, in the real unchanged arithmetic", () => {
  it("every-SKU totals produce exactly the 1,020,000 / 1,019,995 Shane saw", () => {
    const out = unusedSeatsFromSubscribedSkus(skuPage(REPORTED_ESTATE))!;
    const unassigned = out.lines.reduce((sum, l) => sum + l.unused, 0);

    expect(out.totalEnabledSeats).toBe(1_020_000);
    expect(unassigned).toBe(1_019_995);
    // ...and only 5 seats are actually in use anywhere on the tenant.
    expect(out.lines.reduce((s, l) => s + l.consumed, 0)).toBe(5);
  });
});

describe("paidSeatFiguresFromLines", () => {
  const lines = [
    { skuPartNumber: "POWER_BI_STANDARD", enabled: 1_000_000, consumed: 2, unused: 999_998 },
    { skuPartNumber: "FLOW_FREE", enabled: 10_000, consumed: 3, unused: 9_997 },
    { skuPartNumber: "SPB", enabled: 25, consumed: 18, unused: 7 },
  ];

  it("counts only SKUs with a real price, and names what it left out", () => {
    const figures = paidSeatFiguresFromLines(
      lines,
      new Map<string, number | null>([
        ["POWER_BI_STANDARD", null], // no price row — free
        ["FLOW_FREE", null],
        ["SPB", 2200],
      ]),
    );

    expect(figures.provisioned).toBe(25);
    expect(figures.unassigned).toBe(7);
    expect(figures.paidCounts).toEqual({ SPB: 7 });
    expect(figures.excluded).toEqual([
      { skuPartNumber: "POWER_BI_STANDARD", enabled: 1_000_000, reason: "no_price_on_file" },
      { skuPartNumber: "FLOW_FREE", enabled: 10_000, reason: "no_price_on_file" },
    ]);
  });

  it("a price row of ZERO is still not a paid seat", () => {
    // A free SKU that HAS a sku_price_reference row priced at 0 would otherwise
    // slip back in under a 'has a row' test and re-open the whole bug.
    const figures = paidSeatFiguresFromLines(
      lines,
      new Map<string, number | null>([
        ["POWER_BI_STANDARD", 0],
        ["FLOW_FREE", 0],
        ["SPB", 2200],
      ]),
    );
    expect(figures.provisioned).toBe(25);
    expect(figures.excluded.map((e) => e.reason)).toEqual(["zero_price", "zero_price"]);
  });

  it("a fully-assigned paid SKU still counts toward provisioned, with nothing unassigned", () => {
    const figures = paidSeatFiguresFromLines(
      [{ skuPartNumber: "SPB", enabled: 10, consumed: 10, unused: 0 }],
      new Map<string, number | null>([["SPB", 2200]]),
    );
    expect(figures.provisioned).toBe(10);
    expect(figures.unassigned).toBe(0);
    expect(figures.paidCounts).toEqual({});
  });
});

describe("resolvePaidSeatFigures", () => {
  beforeEach(() => {
    mockResultQueue = [];
  });

  it("turns the reported estate into the real paid numbers", async () => {
    // Same page as the reproduction, plus the one purchased SKU the tenant has.
    queueGraphPage(skuPage([...REPORTED_ESTATE, sku("SPB", 8, 5)]));
    queuePrice(null); // POWER_BI_STANDARD — free, no row
    queuePrice(null); // FLOW_FREE
    queuePrice(null); // CCIBOTS_PRIVPREV_VIRAL
    queuePrice({ displayName: "Microsoft 365 Business Premium", monthlyPriceCents: 2200 });

    const seats = (await resolvePaidSeatFigures("tenant-guid-1"))!;

    // The bug's numbers must be gone, not merely smaller.
    expect(seats.provisioned).toBe(8);
    expect(seats.unassigned).toBe(3);
    expect(seats.paidCounts).toEqual({ SPB: 3 });
    expect(seats.excluded.map((e) => e.skuPartNumber)).toEqual([
      "POWER_BI_STANDARD",
      "FLOW_FREE",
      "CCIBOTS_PRIVPREV_VIRAL",
    ]);
    // The check whose stored page this was computed from. `cost:unused-unassigned-
    // licenses` no longer wins on its name alone (#441) — and it is no longer in
    // the assess:copilot-readiness package, so citing it would name a check this
    // tenant's scan does not run.
    expect(seats.checkKey).toBe("cost:license-count-by-sku");
  });

  it("returns null — not 0 — when the tenant has only free SKUs", async () => {
    // The card must then render NOTHING for these stats, per #320's rule: a
    // stat with no real number is omitted, never zeroed.
    queueGraphPage(skuPage(REPORTED_ESTATE));
    queuePrice(null);
    queuePrice(null);
    queuePrice(null);

    expect(await resolvePaidSeatFigures("tenant-guid-1")).toBeNull();
  });

  it("prices each distinct SKU once, however many lines reference it", async () => {
    queueGraphPage(skuPage([sku("SPB", 5, 1), sku("SPB", 5, 1)]));
    queuePrice({ displayName: "Microsoft 365 Business Premium", monthlyPriceCents: 2200 });

    const seats = (await resolvePaidSeatFigures("tenant-guid-1"))!;
    // One price lookup consumed → the queue still holds nothing extra, and both
    // lines were counted.
    expect(seats.provisioned).toBe(10);
    expect(seats.unassigned).toBe(8);
  });

  it("stays null when no /subscribedSkus page can be sourced at all", async () => {
    mockResultQueue.push([]); // no active /subscribedSkus checks
    expect(await resolvePaidSeatFigures("tenant-guid-1")).toBeNull();
  });
});
