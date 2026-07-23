/**
 * tenant-signals-stabilization.test.ts
 *
 * Unit tests for the per-signal-key stabilization window wiring:
 *   getSignalStabilizationWindowHours() — resolves a signal's window from its
 *     signal_derivation_rules -> monitor_checks.frequency join, slowest wins
 *   getStabilizedSignals()              — gates a customer's open signals by
 *     their own (not a flat) window
 *
 * Covers:
 *   - legacy signals with no derivation rules fall back to the flat 4h default
 *   - live/hourly/daily map to 4h/6h/48h respectively
 *   - a signal fed by rules of mixed frequency uses the SLOWEST (most
 *     conservative) one, not the fastest or an average
 *   - getStabilizedSignals applies each open signal's own window, not one
 *     flat window for the whole customer
 *   - DB failures fail safe (flat default / empty set), not throw
 *
 * Run: pnpm --filter @workspace/api-server run test -- tenant-signals-stabilization
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("drizzle-orm", () => {
  const sqlFn = (strings: TemplateStringsArray, ...vals: unknown[]) => ({ type: "sql", strings, vals });
  (sqlFn as unknown as { raw: (s: string) => unknown }).raw = (s: string) => ({ type: "sql.raw", s });
  return {
    eq: (...args: unknown[]) => ({ type: "eq", args }),
    and: (...args: unknown[]) => ({ type: "and", args }),
    asc: (...args: unknown[]) => ({ type: "asc", args }),
    desc: (...args: unknown[]) => ({ type: "desc", args }),
    inArray: (...args: unknown[]) => ({ type: "inArray", args }),
    sql: sqlFn,
  };
});

vi.mock("./logger", () => {
  const stub = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});

vi.mock("./sla-engine", () => ({ startSlaTimer: vi.fn() }));

// Chainable + thenable stub — .from/.innerJoin/.where/.orderBy/.limit all
// return the same thenable object; awaiting it at any link resolves to the
// queued rows (mirrors drizzle's builder being awaitable at any stage).
function chainStub(rows: unknown[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    from: () => obj,
    innerJoin: () => obj,
    where: () => obj,
    orderBy: () => obj,
    limit: () => obj,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return obj;
}

let selectRows: unknown[] = [];
// getStabilizedSignals now resolves the customer's linked users first
// (resolveCustomerUserIds — the customer-scoped tenant_signal_history read).
// That query is recognized by its select shape ({ userId: ... } only) and
// answered from `customerUserRows`; every other select (derivation rules)
// falls through to `selectRows`.
const customerUserRows: Array<{ userId: number }> = [{ userId: 42 }];
const { mockSelect, mockExecute } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockExecute: vi.fn(),
}));
mockSelect.mockImplementation((shape?: Record<string, unknown>) => {
  const keys = shape ? Object.keys(shape) : [];
  const isUserResolution = keys.length === 1 && keys[0] === "userId";
  return chainStub(isUserResolution ? customerUserRows : selectRows);
});

vi.mock("@workspace/db", () => ({
  db: { select: mockSelect, execute: mockExecute },
  clientM365ProfilesTable: {},
  scriptRunResultsTable: {},
  mspCustomersTable: { id: "id", tenantId: "tenantId", mspId: "mspId" },
  mspUsersTable: { id: "id", userId: "userId", customerId: "customerId", isActive: "isActive", mspRole: "mspRole", createdAt: "createdAt" },
  tenantMonitorProfilesTable: {},
  signalDerivationRulesTable: { signalKey: "signalKey", sourceKey: "sourceKey" },
  monitorChecksTable: { key: "key", frequency: "frequency" },
}));

import { getSignalStabilizationWindowHours, getStabilizedSignals } from "./tenant-signals.ts";

beforeEach(() => {
  selectRows = [];
  mockSelect.mockClear();
  mockExecute.mockReset();
});

describe("getSignalStabilizationWindowHours", () => {
  it("falls back to the flat 4h default when no derivation rules exist (legacy signal)", async () => {
    selectRows = [];
    const hours = await getSignalStabilizationWindowHours("hasLicensingWaste");
    expect(hours).toBe(4);
  });

  it("resolves 'live' frequency to 4h", async () => {
    selectRows = [{ frequency: "live" }];
    expect(await getSignalStabilizationWindowHours("someLiveSignal")).toBe(4);
  });

  it("resolves 'hourly' frequency to 6h", async () => {
    selectRows = [{ frequency: "hourly" }];
    expect(await getSignalStabilizationWindowHours("hasSecurityGaps")).toBe(6);
  });

  it("resolves 'daily' frequency to 48h", async () => {
    selectRows = [{ frequency: "daily" }];
    expect(await getSignalStabilizationWindowHours("hasExchangeOnPrem")).toBe(48);
  });

  it("picks the SLOWEST frequency when a signal derives from both hourly and daily checks", async () => {
    selectRows = [{ frequency: "hourly" }, { frequency: "daily" }];
    expect(await getSignalStabilizationWindowHours("hasGovernanceGaps")).toBe(48);
  });

  it("picks the slowest regardless of row order", async () => {
    selectRows = [{ frequency: "daily" }, { frequency: "live" }, { frequency: "hourly" }];
    expect(await getSignalStabilizationWindowHours("hasMixedSources")).toBe(48);
  });

  it("falls back to the flat default when the query throws", async () => {
    mockSelect.mockImplementationOnce(() => ({
      from: () => ({ innerJoin: () => ({ where: () => Promise.reject(new Error("db down")) }) }),
    }));
    expect(await getSignalStabilizationWindowHours("anySignal")).toBe(4);
  });
});

describe("getStabilizedSignals", () => {
  const CUSTOMER_ID = 42;
  const now = new Date("2026-07-20T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000).toISOString();

  function mockOpenRows(rows: Array<{ signalKey: string; firedAt: string }>) {
    mockExecute.mockResolvedValueOnce({ rows });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  it("returns an empty set when the customer has no open signals", async () => {
    mockOpenRows([]);
    const result = await getStabilizedSignals(CUSTOMER_ID);
    expect(result.size).toBe(0);
    // Exactly ONE select ran (the customer→linked-users resolution); no
    // derivation-rule lookup is needed when there's nothing open.
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it("stabilizes a legacy (no-rule) signal using the flat 4h default", async () => {
    mockOpenRows([{ signalKey: "hasLicensingWaste", firedAt: hoursAgo(5) }]);
    selectRows = []; // no signal_derivation_rules rows for this key
    const result = await getStabilizedSignals(CUSTOMER_ID);
    expect(result.has("hasLicensingWaste")).toBe(true);
  });

  it("does NOT stabilize a daily-sourced signal that only just fired 6h ago (needs 48h)", async () => {
    mockOpenRows([{ signalKey: "hasExchangeOnPrem", firedAt: hoursAgo(6) }]);
    selectRows = [{ signalKey: "hasExchangeOnPrem", frequency: "daily" }];
    const result = await getStabilizedSignals(CUSTOMER_ID);
    expect(result.has("hasExchangeOnPrem")).toBe(false);
  });

  it("stabilizes a daily-sourced signal once it has been open for 48h+", async () => {
    mockOpenRows([{ signalKey: "hasExchangeOnPrem", firedAt: hoursAgo(50) }]);
    selectRows = [{ signalKey: "hasExchangeOnPrem", frequency: "daily" }];
    const result = await getStabilizedSignals(CUSTOMER_ID);
    expect(result.has("hasExchangeOnPrem")).toBe(true);
  });

  it("does NOT stabilize an hourly-sourced signal fired only 5h ago (needs 6h)", async () => {
    mockOpenRows([{ signalKey: "hasSecurityGaps", firedAt: hoursAgo(5) }]);
    selectRows = [{ signalKey: "hasSecurityGaps", frequency: "hourly" }];
    const result = await getStabilizedSignals(CUSTOMER_ID);
    expect(result.has("hasSecurityGaps")).toBe(false);
  });

  it("stabilizes an hourly-sourced signal once it has been open for 6h+", async () => {
    mockOpenRows([{ signalKey: "hasSecurityGaps", firedAt: hoursAgo(7) }]);
    selectRows = [{ signalKey: "hasSecurityGaps", frequency: "hourly" }];
    const result = await getStabilizedSignals(CUSTOMER_ID);
    expect(result.has("hasSecurityGaps")).toBe(true);
  });

  it("applies each open signal's OWN window independently, not one flat window for the customer", async () => {
    mockOpenRows([
      { signalKey: "hasExchangeOnPrem", firedAt: hoursAgo(10) }, // daily-sourced, needs 48h — NOT stable
      { signalKey: "hasSecurityGaps", firedAt: hoursAgo(10) },   // hourly-sourced, needs 6h — stable
      { signalKey: "hasLicensingWaste", firedAt: hoursAgo(10) }, // legacy, needs flat 4h — stable
    ]);
    selectRows = [
      { signalKey: "hasExchangeOnPrem", frequency: "daily" },
      { signalKey: "hasSecurityGaps", frequency: "hourly" },
    ];
    const result = await getStabilizedSignals(CUSTOMER_ID);
    expect(result.has("hasExchangeOnPrem")).toBe(false);
    expect(result.has("hasSecurityGaps")).toBe(true);
    expect(result.has("hasLicensingWaste")).toBe(true);
  });

  it("uses the slowest frequency for a signal derived from both an hourly and a daily check", async () => {
    mockOpenRows([{ signalKey: "hasGovernanceGaps", firedAt: hoursAgo(10) }]);
    selectRows = [
      { signalKey: "hasGovernanceGaps", frequency: "hourly" },
      { signalKey: "hasGovernanceGaps", frequency: "daily" },
    ];
    const result = await getStabilizedSignals(CUSTOMER_ID);
    // 10h open, but slowest (daily=48h) wins — not yet stable
    expect(result.has("hasGovernanceGaps")).toBe(false);
  });

  it("fails safe to an empty set when the open-signals query throws", async () => {
    mockExecute.mockRejectedValueOnce(new Error("db down"));
    const result = await getStabilizedSignals(CUSTOMER_ID);
    expect(result.size).toBe(0);
  });
});
