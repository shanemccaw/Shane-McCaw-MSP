/**
 * msp-executive-data.test.ts
 *
 * Unit tests for gatherExecutiveBook — the shared risk/opportunity ranking that
 * both the MSP Executive route and the Partner QBR generator ground on.
 *
 * Covers:
 *   - top risks ranked worst-health-first (highest raw score), with the 100−raw
 *     goodness inversion the portal renders
 *   - at-risk count + average goodness roll-up
 *   - opportunity aggregation: sales_offers bridged users.id → msp_customers.id,
 *     summed by adjusted (customer-facing) price with base-price fallback,
 *     ranked by total value, topOfferTitle = the biggest single offer
 *   - offers whose customer isn't in the (scoped) book are excluded
 *   - health snapshots for customers outside the book are ignored
 *   - empty book short-circuits to zeros without touching downstream tables
 *
 * Run: pnpm --filter @workspace/api-server run test -- msp-executive-data
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn(), selectDistinctOn: vi.fn() },
  mspCustomersTable: { id: "id", name: "name", mspId: "mspId" },
  mspUsersTable: { userId: "userId", customerId: "customerId", mspId: "mspId" },
  salesOffersTable: {
    customerId: "customerId", title: "title", adjustedPriceCents: "adjustedPriceCents",
    basePriceCents: "basePriceCents", score: "score", state: "state", mspId: "mspId",
  },
  tenantEngineSnapshotsTable: {
    customerId: "customerId", score: "score", capturedAt: "capturedAt", engineKey: "engineKey",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (c: unknown, v: unknown) => ({ eq: [c, v] }),
  and: (...args: unknown[]) => ({ and: args }),
  desc: (c: unknown) => ({ desc: c }),
  inArray: (c: unknown, v: unknown) => ({ inArray: [c, v] }),
  isNotNull: (c: unknown) => ({ isNotNull: c }),
}));

vi.mock("./logger", () => {
  const stub = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});

import { db } from "@workspace/db";
import { gatherExecutiveBook } from "./msp-executive-data.ts";

const mockSelect = (db as unknown as { select: ReturnType<typeof vi.fn> }).select;
const mockSelectDistinctOn = (db as unknown as { selectDistinctOn: ReturnType<typeof vi.fn> }).selectDistinctOn;

/** Drizzle-style fluent chain, thenable at any point, resolving to `rows`. */
function buildChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit", "innerJoin"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain["then"] = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(rows).then(resolve, reject);
  return chain;
}

const MSP_ID = 900;

const customers = [
  { id: 1, name: "Acme Corp" },
  { id: 2, name: "Beta LLC" },
  { id: 3, name: "Gamma Inc" },
];

// Latest health snapshot per customer (raw score = higher-is-worse risk sum).
const healthRows = [
  { customerId: 1, score: 70, capturedAt: new Date("2026-07-19T10:00:00Z") }, // goodness 30 (at risk)
  { customerId: 2, score: 10, capturedAt: new Date("2026-07-19T10:00:00Z") }, // goodness 90 (healthy)
  { customerId: 3, score: 45, capturedAt: new Date("2026-07-19T10:00:00Z") }, // goodness 55 (at risk)
  { customerId: 999, score: 99, capturedAt: new Date("2026-07-19T10:00:00Z") }, // NOT in book — must be ignored
];

const bridgeRows = [
  { userId: 101, customerId: 1 },
  { userId: 102, customerId: 2 },
  { userId: 103, customerId: 3 },
];

const offerRows = [
  { customerUserId: 101, title: "Backup", adjustedPriceCents: 50000, basePriceCents: 60000, score: 80 },
  { customerUserId: 101, title: "Email Security", adjustedPriceCents: 0, basePriceCents: 30000, score: 40 }, // adjusted 0 → base fallback
  { customerUserId: 102, title: "SIEM", adjustedPriceCents: 100000, basePriceCents: 0, score: 90 },
  { customerUserId: 999, title: "Ghost", adjustedPriceCents: 999999, basePriceCents: 0, score: 10 }, // no bridge → excluded
];

/** Queue the four sequential queries gatherExecutiveBook makes. */
function queueFullBook(opts: {
  customers?: unknown[];
  health?: unknown[];
  bridge?: unknown[];
  offers?: unknown[];
} = {}) {
  mockSelect.mockReturnValueOnce(buildChain(opts.customers ?? customers));          // 1. customers
  mockSelectDistinctOn.mockReturnValueOnce(buildChain(opts.health ?? healthRows));  // 2. health snapshots
  mockSelect.mockReturnValueOnce(buildChain(opts.bridge ?? bridgeRows));            // 3. msp_users bridge
  mockSelect.mockReturnValueOnce(buildChain(opts.offers ?? offerRows));             // 4. offers
}

beforeEach(() => {
  mockSelect.mockReset();
  mockSelectDistinctOn.mockReset();
});

describe("gatherExecutiveBook", () => {
  it("ranks top risks worst-health-first with the goodness inversion", async () => {
    queueFullBook();
    const book = await gatherExecutiveBook(MSP_ID, null);

    expect(book.customerCount).toBe(3);
    expect(book.topRisks.map((r) => r.name)).toEqual(["Acme Corp", "Gamma Inc", "Beta LLC"]);
    expect(book.topRisks[0]).toMatchObject({ name: "Acme Corp", healthScore: 70, goodnessPercent: 30 });
    // A snapshot for a customer outside the book is ignored entirely.
    expect(book.topRisks.some((r) => r.customerId === 999)).toBe(false);
  });

  it("computes the at-risk count and average goodness roll-up", async () => {
    queueFullBook();
    const book = await gatherExecutiveBook(MSP_ID, null);

    // goodness: 30 (at risk), 90, 55 (at risk) → 2 at risk, avg round((30+90+55)/3)=58
    expect(book.rollup.atRiskCount).toBe(2);
    expect(book.rollup.avgGoodnessPercent).toBe(58);
  });

  it("aggregates opportunities via the users.id → msp_customers.id bridge", async () => {
    queueFullBook();
    const book = await gatherExecutiveBook(MSP_ID, null);

    // Beta: single 100000 offer. Acme: 50000 + 30000 (base fallback) = 80000.
    expect(book.topOpportunities.map((o) => o.name)).toEqual(["Beta LLC", "Acme Corp"]);

    const beta = book.topOpportunities.find((o) => o.name === "Beta LLC")!;
    expect(beta).toMatchObject({ totalValueCents: 100000, openOfferCount: 1, topOfferTitle: "SIEM", topScore: 90 });

    const acme = book.topOpportunities.find((o) => o.name === "Acme Corp")!;
    expect(acme.totalValueCents).toBe(80000);
    expect(acme.openOfferCount).toBe(2);
    expect(acme.topOfferTitle).toBe("Backup"); // the biggest single offer (50000 > 30000)
    expect(acme.topScore).toBe(80);
  });

  it("excludes offers whose customer isn't in the book, and rolls up the whole book", async () => {
    queueFullBook();
    const book = await gatherExecutiveBook(MSP_ID, null);

    // The user-999 "Ghost" offer (999999) has no bridge row → never counted.
    expect(book.rollup.totalOpenOpportunityCents).toBe(180000);
    expect(book.rollup.openOfferCount).toBe(3);
    expect(book.topOpportunities.some((o) => o.topOfferTitle === "Ghost")).toBe(false);
  });

  it("short-circuits to zeros for an empty (or fully-unscoped-out) book", async () => {
    // Only the customers query runs; no health/bridge/offer queries are made.
    mockSelect.mockReturnValueOnce(buildChain([]));
    const book = await gatherExecutiveBook(MSP_ID, []);

    expect(book).toMatchObject({
      customerCount: 0,
      topRisks: [],
      topOpportunities: [],
      rollup: { avgGoodnessPercent: null, atRiskCount: 0, totalOpenOpportunityCents: 0, openOfferCount: 0 },
    });
    // Downstream tables were never queried.
    expect(mockSelectDistinctOn).not.toHaveBeenCalled();
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it("respects the topN limit", async () => {
    queueFullBook();
    const book = await gatherExecutiveBook(MSP_ID, null, { topN: 1 });
    expect(book.topRisks).toHaveLength(1);
    expect(book.topRisks[0]!.name).toBe("Acme Corp");
    expect(book.topOpportunities).toHaveLength(1);
    expect(book.topOpportunities[0]!.name).toBe("Beta LLC");
  });
});
