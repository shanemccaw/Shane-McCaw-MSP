/**
 * msp-customer-directory-metrics.test.ts — Git #3666.
 *
 * Unit tests for fetchCustomerDirectoryMetrics: the seats/people/lastScanAt/
 * openSignals resolver behind the MSP Console's "Managed Tenants" directory
 * list (GET /api/msp/customers).
 *
 * Covers:
 *   - all four metrics populate correctly for a normal, fully-scanned customer
 *   - a customer with no M365 tenantId gets null seats/people (nothing to key
 *     that lookup by) but still gets a real openSignals/lastScanAt from its
 *     customerId
 *   - a customer absent from every source table (never scanned, no signals)
 *     gets the honest defaults — null/null/null/0 — not a fabricated figure
 *   - seats is null when resolvePaidSeatFigures finds nothing priced (real,
 *     already-established `license-waste-source.ts` behavior — see this
 *     module's own header for why the PAID figure is used at all, not the
 *     unfiltered total)
 *   - an empty customer list short-circuits without touching the database
 *
 * Run: pnpm --filter @workspace/api-server run test -- msp-customer-directory-metrics
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn(), selectDistinctOn: vi.fn() },
  tenantMonitorProfilesTable: {
    tenantId: "tenantId", checkKey: "checkKey", extractedProperties: "extractedProperties",
    collectedAt: "collectedAt",
  },
  tenantSignalHistoryTable: { customerId: "customerId", resolvedAt: "resolvedAt" },
  mspDiagnosticRunsTable: { customerId: "customerId", completedAt: "completedAt", status: "status" },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (c: unknown, v: unknown) => ({ eq: [c, v] }),
  inArray: (c: unknown, v: unknown) => ({ inArray: [c, v] }),
  isNull: (c: unknown) => ({ isNull: c }),
  desc: (c: unknown) => ({ desc: c }),
  max: (c: unknown) => ({ max: c }),
  count: () => ({ count: true }),
}));

vi.mock("./logger.ts", () => {
  const stub = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});

const { mockResolvePaidSeatFigures } = vi.hoisted(() => ({ mockResolvePaidSeatFigures: vi.fn() }));
vi.mock("./license-waste-source.ts", () => ({
  resolvePaidSeatFigures: mockResolvePaidSeatFigures,
}));

import { db } from "@workspace/db";
import { fetchCustomerDirectoryMetrics } from "./msp-customer-directory-metrics.ts";

const mockSelect = (db as unknown as { select: ReturnType<typeof vi.fn> }).select;
const mockSelectDistinctOn = (db as unknown as { selectDistinctOn: ReturnType<typeof vi.fn> }).selectDistinctOn;

/** Drizzle-style fluent chain, thenable at any point, resolving to `rows`. */
function buildChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "groupBy", "orderBy"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain["then"] = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(rows).then(resolve, reject);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

/** Wires the two db.select rows (openSignals / lastScan), the one db.selectDistinctOn rows (people), and resolvePaidSeatFigures' per-tenant return (seats), by real distinguishing shape — not call order. */
function wireRows(opts: {
  openSignalsRows?: unknown[];
  lastScanRows?: unknown[];
  peopleRows?: unknown[];
  seatsByTenantId?: Record<string, { provisioned: number } | null>;
}) {
  mockSelect.mockImplementation((cols: Record<string, unknown>) => {
    if ("openCount" in cols) return buildChain(opts.openSignalsRows ?? []);
    if ("lastScanAt" in cols) return buildChain(opts.lastScanRows ?? []);
    throw new Error(`unexpected db.select projection: ${JSON.stringify(Object.keys(cols))}`);
  });
  mockSelectDistinctOn.mockImplementation((_distinctCols: unknown, projection: Record<string, unknown>) => {
    if ("extractedProperties" in projection) return buildChain(opts.peopleRows ?? []);
    throw new Error(`unexpected db.selectDistinctOn projection: ${JSON.stringify(Object.keys(projection))}`);
  });
  mockResolvePaidSeatFigures.mockImplementation(async (tenantId: string) => opts.seatsByTenantId?.[tenantId] ?? null);
}

describe("fetchCustomerDirectoryMetrics", () => {
  it("returns an empty map without touching the database for an empty customer list", async () => {
    const result = await fetchCustomerDirectoryMetrics([]);
    expect(result.size).toBe(0);
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockSelectDistinctOn).not.toHaveBeenCalled();
    expect(mockResolvePaidSeatFigures).not.toHaveBeenCalled();
  });

  it("populates all four metrics for a normal, fully-scanned customer", async () => {
    wireRows({
      openSignalsRows: [{ customerId: 1, openCount: "3" }],
      lastScanRows: [{ customerId: 1, lastScanAt: new Date("2026-09-06T23:07:08.981Z") }],
      peopleRows: [{ tenantId: "tenant-1", extractedProperties: { totalUserCount: 25 } }],
      seatsByTenantId: { "tenant-1": { provisioned: 1 } },
    });

    const result = await fetchCustomerDirectoryMetrics([{ id: 1, tenantId: "tenant-1" }]);

    expect(result.get(1)).toEqual({
      seats: 1,
      people: 25,
      lastScanAt: "2026-09-06T23:07:08.981Z",
      openSignals: 3,
    });
    expect(mockResolvePaidSeatFigures).toHaveBeenCalledWith("tenant-1");
  });

  it("gives null seats/people (no tenantId to key by) but real openSignals/lastScanAt for an unclaimed customer", async () => {
    wireRows({
      openSignalsRows: [{ customerId: 2, openCount: "1" }],
      lastScanRows: [{ customerId: 2, lastScanAt: new Date("2026-08-01T00:00:00Z") }],
      peopleRows: [],
      seatsByTenantId: {},
    });

    const result = await fetchCustomerDirectoryMetrics([{ id: 2, tenantId: null }]);

    expect(result.get(2)).toEqual({
      seats: null,
      people: null,
      lastScanAt: "2026-08-01T00:00:00.000Z",
      openSignals: 1,
    });
    // No tenantIds in the book at all → the people query is never issued and
    // resolvePaidSeatFigures is never called.
    expect(mockSelectDistinctOn).not.toHaveBeenCalled();
    expect(mockResolvePaidSeatFigures).not.toHaveBeenCalled();
  });

  it("gives the honest defaults for a customer absent from every source table", async () => {
    wireRows({ openSignalsRows: [], lastScanRows: [], peopleRows: [], seatsByTenantId: {} });

    const result = await fetchCustomerDirectoryMetrics([{ id: 3, tenantId: "tenant-3" }]);

    expect(result.get(3)).toEqual({ seats: null, people: null, lastScanAt: null, openSignals: 0 });
  });

  it("reports null seats when resolvePaidSeatFigures finds nothing priced", async () => {
    wireRows({
      openSignalsRows: [],
      lastScanRows: [],
      peopleRows: [],
      seatsByTenantId: { "tenant-4": null },
    });

    const result = await fetchCustomerDirectoryMetrics([{ id: 4, tenantId: "tenant-4" }]);

    expect(result.get(4)?.seats).toBeNull();
  });

  it("keys people/seats rows back to the right customer across a multi-tenant page", async () => {
    wireRows({
      openSignalsRows: [],
      lastScanRows: [],
      peopleRows: [
        { tenantId: "tenant-A", extractedProperties: { totalUserCount: 10 } },
        { tenantId: "tenant-B", extractedProperties: { totalUserCount: 40 } },
      ],
      seatsByTenantId: {
        "tenant-A": { provisioned: 5 },
        "tenant-B": { provisioned: 200 },
      },
    });

    const result = await fetchCustomerDirectoryMetrics([
      { id: 10, tenantId: "tenant-A" },
      { id: 20, tenantId: "tenant-B" },
    ]);

    expect(result.get(10)).toMatchObject({ seats: 5, people: 10 });
    expect(result.get(20)).toMatchObject({ seats: 200, people: 40 });
  });
});
