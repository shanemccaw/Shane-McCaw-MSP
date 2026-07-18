import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

/**
 * Tests for POST /api/dashboard/resolve.
 *
 * The DB is mocked with a FIFO queue: each terminal query (a `.select()` chain
 * that is awaited, or `.selectDistinctOn` / `.selectDistinct`) shifts the next
 * queued result array off `mockResultQueue`. Tests that resolve a single metric
 * queue exactly the rows that metric's resolver reads, in order. `assertCustomerAccess`
 * (the cross-MSP ownership check) is exercised through its real code path against
 * a mocked mspCustomersTable lookup.
 */

let mockResultQueue: any[][] = [];

vi.mock("@workspace/db", () => {
  // A chainable, thenable query builder. Every chain method returns the same
  // object; awaiting it (or calling a terminal like .then) resolves to the next
  // queued result array. `.limit()` callers destructure [row] — an array works.
  function makeChain() {
    const chain: any = {
      from: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      groupBy: () => chain,
      limit: () => chain,
      then: (onFulfilled: any, onRejected: any) =>
        Promise.resolve(mockResultQueue.shift() ?? []).then(onFulfilled, onRejected),
    };
    return chain;
  }

  const mockDb = {
    select: vi.fn(() => makeChain()),
    selectDistinct: vi.fn(() => makeChain()),
    selectDistinctOn: vi.fn(() => makeChain()),
  };

  // Column stubs — resolvers only reference `.column` identity for drizzle
  // builders; the mock ignores them, so empty objects suffice. We give real
  // property keys so `eq(table.col, x)` doesn't blow up on undefined.
  const tbl = (cols: string[]) => Object.fromEntries(cols.map((c) => [c, c]));

  return {
    db: mockDb,
    mspCustomersTable: tbl(["id", "mspId", "tenantId", "status", "industry"]),
    tenantMonitorProfilesTable: tbl(["tenantId", "checkKey", "extractedProperties", "rawResponse", "collectedAt", "status"]),
    monitorChecksTable: tbl(["key", "mapping"]),
    mspAlertEventsTable: tbl(["mspId", "firedAt", "severity", "summary", "ruleKey", "deepLinkPath"]),
    mspAlertRulesTable: tbl(["enabled"]),
    clientHealthHistoryTable: tbl(["clientId", "category", "score", "recordedAt"]),
    engineScoreDailyRollupTable: tbl(["customerId", "mspId", "engineKey", "day", "score"]),
    projectsTable: tbl(["clientUserId", "status"]),
    kanbanTasksTable: tbl(["projectId", "column", "updatedAt"]),
    mspChargesTable: tbl(["mspId", "amountCents", "status", "chargedAt"]),
    invoicesTable: tbl(["clientUserId", "amount", "status"]),
    salesOffersTable: tbl(["id", "mspId", "customerId", "state", "adjustedPriceCents"]),
    salesOfferEventsTable: tbl(["offerId", "eventName"]),
    mspSalesBundleAssignmentsTable: tbl(["customerId", "mspId", "status"]),
    mspDiagnosticRunsTable: tbl(["customerId", "mspId", "status", "createdAt", "packageKey", "runId"]),
    mspDiagnosticFindingsTable: tbl(["customerId", "severity"]),
    aiUsageEventsTable: tbl(["mspId", "occurredAt", "feature", "nodeType", "totalTokens", "costCents"]),
    aiBalanceLedgerTable: tbl(["mspId", "balanceAfterCents", "amountCents", "createdAt"]),
    portalWfRunsTable: tbl(["mspId", "status", "createdAt"]),
    portalWfOperatorTasksTable: tbl(["mspId", "status"]),
    mspJobQueueTable: tbl(["mspId", "status"]),
    industryBenchmarkReferenceTable: tbl(["pillar", "industryAvgPct"]),
    tenantEngineSnapshotsTable: tbl(["customerId", "engineKey", "score", "breakdown", "capturedAt"]),
  };
});

// SLA / scope-creep engines are live-compute — mock them so engine_snapshot
// resolvers for sla/scope-creep don't hit real engine internals.
vi.mock("../lib/sla-engine.ts", () => ({
  runSlaEngineForTenant: vi.fn(async () => ({ engine: "sla", score: 80, compliancePct: 95, activeBreaches: 2, warningTimers: 1, runningTimers: 5, breakdown: [], policies: [], rawSignals: [], timestamp: "" })),
}));
vi.mock("../lib/scope-creep-engine.ts", () => ({
  runScopeCreepEngineForTenant: vi.fn(async () => ({ engine: "scope_creep", score: { compositeScore: 20, driftScore: 0, expansionScore: 0, timelineSlipScore: 0, openDetections: 0, openViolations: 0, compliancePct: 100 }, breakdown: [], policies: [], rawSignals: [], timestamp: "" })),
}));

import router from "./dashboard-data";

const app = express();
app.use(express.json());
app.use("/api", router);

const JWT_SECRET = "test-secret";
process.env.JWT_SECRET = JWT_SECRET;

function customerToken(overrides: Record<string, unknown> = {}): string {
  return jwt.sign(
    { id: 1, email: "c@co.com", role: "client", mspRole: "CustomerUser", mspId: 1, customerId: 10, ...overrides },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

function operatorToken(overrides: Record<string, unknown> = {}): string {
  return jwt.sign(
    { id: 2, email: "op@msp.com", role: "client", mspRole: "MSPOperator", mspId: 1, ...overrides },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

function resolve(token: string, body: Record<string, unknown>) {
  return request(app).post("/api/dashboard/resolve").set("Authorization", `Bearer ${token}`).send(body);
}

describe("POST /api/dashboard/resolve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResultQueue = [];
  });

  // ── Auth ──
  it("401s without a token", async () => {
    const res = await request(app).post("/api/dashboard/resolve").send({ metrics: ["engine.healthScore"] });
    expect(res.status).toBe(401);
  });

  it("403s a Free/anon role below CustomerUser", async () => {
    const token = jwt.sign({ id: 9, email: "f@f.com", role: "client", mspRole: "Free", mspId: 1 }, JWT_SECRET, { expiresIn: "1h" });
    // Free is admitted by requireRole("CustomerUser")? No — Free < CustomerUser, so 403.
    const res = await resolve(token, { metrics: ["engine.healthScore"] });
    expect(res.status).toBe(403);
  });

  it("400s on empty metrics array", async () => {
    const res = await resolve(customerToken(), { metrics: [] });
    expect(res.status).toBe(400);
  });

  // ── Cross-MSP ownership rejection (MSPOperator) ──
  it("403s when an operator requests a customer belonging to another MSP", async () => {
    // assertCustomerAccess → mspCustomersTable lookup returns no row (not owned).
    mockResultQueue = [[]]; // ownership query → empty = not owned
    const res = await resolve(operatorToken({ mspId: 1 }), { metrics: ["engine.healthScore"], customerId: 999 });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not permitted/i);
  });

  it("403s when a CustomerUser names a different customerId", async () => {
    const res = await resolve(customerToken({ customerId: 10 }), { metrics: ["engine.healthScore"], customerId: 11 });
    expect(res.status).toBe(403);
  });

  // ── engine_snapshot metric ──
  it("resolves an engine_snapshot metric from the latest snapshot", async () => {
    // getRecentEngineSnapshots → one row.
    mockResultQueue = [[{ score: 87, capturedAt: new Date("2026-01-01T00:00:00Z") }]];
    const res = await resolve(customerToken(), { metrics: ["engine.healthScore"] });
    expect(res.status).toBe(200);
    const r = res.body.results["engine.healthScore"];
    expect(r.status).toBe("ok");
    expect(r.data.value).toBe(87);
    expect(r.shape).toBe("scalar");
  });

  it("resolves sla.compliancePercent via live engine (not lossy snapshot)", async () => {
    const res = await resolve(customerToken(), { metrics: ["sla.compliancePercent"] });
    expect(res.status).toBe(200);
    const r = res.body.results["sla.compliancePercent"];
    expect(r.status).toBe("ok");
    expect(r.data.value).toBe(95);
  });

  // ── monitor_profile metric (customerId→tenantId + mapping fallback) ──
  it("resolves a monitor_profile metric via tenantId + extractedProperties", async () => {
    mockResultQueue = [
      [{ tenantId: "tenant-guid-abc" }], // resolveTenantId
      [{ extractedProperties: { _itemCount: 42 }, rawResponse: null, collectedAt: new Date(), status: "ok" }], // latestCheckProps
      [{ mapping: [{ targetField: "registeredCount" }] }], // loadCheckMapping (no registeredCount → falls back to _itemCount)
    ];
    const res = await resolve(customerToken(), { metrics: ["identity.mfaRegisteredCount"] });
    expect(res.status).toBe(200);
    const r = res.body.results["identity.mfaRegisteredCount"];
    expect(r.status).toBe("ok");
    expect(r.data.value).toBe(42);
  });

  it("returns not_available for a customer with no tenant_id (no fake zero)", async () => {
    mockResultQueue = [[{ tenantId: null }]]; // resolveTenantId → null
    const res = await resolve(customerToken(), { metrics: ["identity.mfaRegisteredCount"] });
    const r = res.body.results["identity.mfaRegisteredCount"];
    expect(r.status).toBe("not_available");
    expect(r.reason).toBe("no_tenant_id");
  });

  // ── needs_aggregation transform (monitor_profile group-by) ──
  it("resolves a needs_aggregation distribution by grouping raw items", async () => {
    mockResultQueue = [
      [{ tenantId: "t-1" }], // resolveTenantId
      [{ // latestCheckProps — raw alert list to group by severity
        extractedProperties: { alerts_values: [{ severity: "high" }, { severity: "high" }, { severity: "medium" }] },
        rawResponse: null, collectedAt: new Date(), status: "ok",
      }],
    ];
    const res = await resolve(customerToken(), { metrics: ["security.alertsBySeverity"] });
    expect(res.status).toBe(200);
    const r = res.body.results["security.alertsBySeverity"];
    expect(r.status).toBe("ok");
    expect(r.shape).toBe("distribution");
    const high = r.data.buckets.find((b: any) => b.label === "high");
    expect(high.value).toBe(2);
  });

  // ── not_collected metric ──
  it("returns not_available (not a zero) for a not_collected metric", async () => {
    const res = await resolve(customerToken(), { metrics: ["licensing.costTrend"] });
    const r = res.body.results["licensing.costTrend"];
    expect(r.status).toBe("not_available");
    expect(r.reason).toBe("not_collected");
  });

  // ── msp-scope aggregate metric ──
  it("resolves an msp-scope aggregate (SUM of succeeded charges) for an operator", async () => {
    mockResultQueue = [[{ cents: 250000 }]]; // total revenue sum
    const res = await resolve(operatorToken(), { metrics: ["financial.totalRevenue"] });
    expect(res.status).toBe(200);
    const r = res.body.results["financial.totalRevenue"];
    expect(r.status).toBe("ok");
    expect(r.data.value).toBe(2500); // cents → dollars
    expect(r.meta.aggregation).toBe("sum");
  });

  it("forbids an msp-scope metric for a CustomerUser", async () => {
    const res = await resolve(customerToken(), { metrics: ["financial.totalRevenue"] });
    expect(res.status).toBe(200);
    const r = res.body.results["financial.totalRevenue"];
    expect(r.status).toBe("not_available");
    expect(r.reason).toBe("scope_forbidden");
  });

  // ── unknown metric + batch isolation ──
  it("isolates unknown/failed metrics without failing the batch", async () => {
    mockResultQueue = [[{ score: 50, capturedAt: new Date() }]]; // for engine.healthScore
    const res = await resolve(customerToken(), { metrics: ["engine.healthScore", "does.not.exist"] });
    expect(res.status).toBe(200);
    expect(res.body.results["engine.healthScore"].status).toBe("ok");
    expect(res.body.results["does.not.exist"].status).toBe("error");
  });
});
