import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * #464 - security.secureScore resolved "unshaped" for tenants whose real
 * tenant_monitor_profiles.extractedProperties row uses secureScoreCurrent /
 * secureScoreMax rather than currentScore / maxScore. Confirmed against the
 * real test tenant's stored row: secureScoreCurrent ~147, secureScoreMax ~259.
 *
 * The DB is mocked with a FIFO queue (same convention as dashboard-resolvers.test.ts):
 * latestCheckProps runs exactly one query against tenant_monitor_profiles.
 */

let mockResultQueue: any[][] = [];

vi.mock("@workspace/db", () => {
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

  const tbl = (cols: string[]) => Object.fromEntries(cols.map((c) => [c, c]));

  return {
    db: mockDb,
    tenantsTable: tbl(["id", "mspId", "tenantId", "customerName", "status", "industry"]),
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
    salesOffersTable: tbl(["id", "mspId", "customerId", "serviceId", "title", "state", "adjustedPriceCents", "priceCents", "expiresAt", "sentAt", "createdAt", "firedSignalKeys"]),
    salesOfferEventsTable: tbl(["offerId", "eventName"]),
    servicesTable: tbl(["id", "category"]),
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
    skuPriceReferenceTable: tbl(["skuPartNumber", "displayName", "monthlyPriceCents"]),
  };
});

vi.mock("./sla-engine.ts", () => ({ runSlaEngineForTenant: vi.fn() }));
vi.mock("./scope-creep-engine.ts", () => ({ runScopeCreepEngineForTenant: vi.fn() }));

import { resolveMetric } from "./dashboard-resolvers.ts";
import { getMetric } from "@workspace/dashboard-registry";

const def = getMetric("security.secureScore")!;

describe("security.secureScore resolver (#464 field-name mismatch)", () => {
  beforeEach(() => {
    mockResultQueue = [];
  });

  it("resolves current/max from secureScoreCurrent/secureScoreMax (real test-tenant field names)", async () => {
    mockResultQueue.push([{ tenantId: "tenant-464" }]);
    mockResultQueue.push([
      {
        extractedProperties: { secureScoreCurrent: 147, secureScoreMax: 259 },
        rawResponse: null,
        collectedAt: new Date("2026-08-01T00:00:00.000Z"),
        status: "ok",
      },
    ]);

    const res = await resolveMetric(def, { customerId: 10, mspId: 1 });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.meta?.current).toBe(147);
    expect(res.meta?.max).toBe(259);
    expect(res.data.value).toBe(Math.round((147 / 259) * 1000) / 10);
  });

  it("still resolves from the pre-existing currentScore/maxScore field names (no regression)", async () => {
    mockResultQueue.push([{ tenantId: "tenant-legacy" }]);
    mockResultQueue.push([
      {
        extractedProperties: { currentScore: 60, maxScore: 100 },
        rawResponse: null,
        collectedAt: new Date("2026-08-01T00:00:00.000Z"),
        status: "ok",
      },
    ]);

    const res = await resolveMetric(def, { customerId: 11, mspId: 1 });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.meta?.current).toBe(60);
    expect(res.meta?.max).toBe(100);
    expect(res.data.value).toBe(60);
  });

  it("prefers the pre-existing currentScore/maxScore names over the new ones when both are present", async () => {
    mockResultQueue.push([{ tenantId: "tenant-both" }]);
    mockResultQueue.push([
      {
        extractedProperties: { currentScore: 60, maxScore: 100, secureScoreCurrent: 147, secureScoreMax: 259 },
        rawResponse: null,
        collectedAt: new Date("2026-08-01T00:00:00.000Z"),
        status: "ok",
      },
    ]);

    const res = await resolveMetric(def, { customerId: 12, mspId: 1 });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.meta?.current).toBe(60);
    expect(res.meta?.max).toBe(100);
  });
});
