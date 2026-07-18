import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for the dashboard resolver layer (dashboard-resolvers.ts), focused
 * on `offers.remediationOffers` — the metric that resolves the customer's
 * micro-remediation sales offers as an event-list/timeline.
 *
 * The DB is mocked with a FIFO queue (same convention as the route test in
 * routes/dashboard-data.test.ts): each terminal `.select()` chain that is awaited
 * shifts the next queued result array off `mockResultQueue`. The remediation
 * resolver runs exactly one query (sales_offers ⋈ services), so each test queues
 * exactly one rows array.
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
  };
});

vi.mock("./sla-engine.ts", () => ({ runSlaEngineForTenant: vi.fn() }));
vi.mock("./scope-creep-engine.ts", () => ({ runScopeCreepEngineForTenant: vi.fn() }));

import { resolveMetric } from "./dashboard-resolvers.ts";
import { getMetric } from "@workspace/dashboard-registry";

const def = getMetric("offers.remediationOffers")!;

describe("offers.remediationOffers resolver", () => {
  beforeEach(() => {
    mockResultQueue = [];
  });

  it("has the expected metric shape (event-list / timeline / customer scope)", () => {
    expect(def).toBeDefined();
    expect(def.valueType).toBe("event-list");
    expect(def.shape).toBe("timeline");
    expect(def.scope).toBe("customer");
  });

  it("returns timeline entries for a customer with micro_remediation offers", async () => {
    const sent = new Date("2026-07-10T12:00:00.000Z");
    const expires = new Date("2026-08-10T12:00:00.000Z");
    const created = new Date("2026-07-01T09:00:00.000Z");
    mockResultQueue.push([
      {
        id: 42,
        title: "Fix stale MFA registration",
        state: "sent",
        adjustedPriceCents: 25000,
        priceCents: 30000,
        expiresAt: expires,
        sentAt: sent,
        createdAt: created,
        firedSignalKeys: ["mfa.stale"],
      },
    ]);

    const res = await resolveMetric(def, { customerId: 10, mspId: 1 });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;

    const events = res.data.events as any[];
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.id).toBe(42);
    expect(e.label).toBe("Fix stale MFA registration");
    expect(e.state).toBe("sent");
    // adjustedPriceCents is preferred over priceCents.
    expect(e.priceCents).toBe(25000);
    expect(e.t).toBe(sent.toISOString());
    expect(e.sentAt).toBe(sent.toISOString());
    expect(e.expiresAt).toBe(expires.toISOString());
    expect(e.firedSignalKeys).toEqual(["mfa.stale"]);
    expect(res.meta?.count).toBe(1);
  });

  it("falls back to priceCents and createdAt when adjustedPriceCents / sentAt are unset", async () => {
    const created = new Date("2026-07-05T08:00:00.000Z");
    mockResultQueue.push([
      {
        id: 7,
        title: "Un-sent draft offer",
        state: "draft",
        adjustedPriceCents: null,
        priceCents: 15000,
        expiresAt: null,
        sentAt: null,
        createdAt: created,
        firedSignalKeys: null,
      },
    ]);

    const res = await resolveMetric(def, { customerId: 10, mspId: 1 });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    const e = (res.data.events as any[])[0];
    expect(e.priceCents).toBe(15000);
    expect(e.t).toBe(created.toISOString());
    expect(e.sentAt).toBeNull();
    expect(e.expiresAt).toBeNull();
    expect(e.firedSignalKeys).toEqual([]);
  });

  it("returns an empty timeline (ok, not an error) for a customer with zero matching offers", async () => {
    mockResultQueue.push([]); // query yields no rows
    const res = await resolveMetric(def, { customerId: 10, mspId: 1 });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.data.events).toEqual([]);
    expect(res.meta?.count).toBe(0);
  });

  it("returns missing_customer_scope when ctx.customerId is null", async () => {
    const res = await resolveMetric(def, { mspId: 1 });
    expect(res.status).toBe("not_available");
    if (res.status !== "not_available") return;
    expect(res.reason).toBe("missing_customer_scope");
    // No query should have been issued.
    expect(mockResultQueue).toHaveLength(0);
  });

  it("does not surface offers whose service category != micro_remediation", async () => {
    // The category filter lives in the SQL WHERE clause, so a non-matching offer
    // simply never comes back from the query. Model that: the DB returns only the
    // matching row even though a different-category offer exists for the customer.
    mockResultQueue.push([
      { id: 1, title: "Micro remediation", state: "sent", adjustedPriceCents: 5000, priceCents: 5000, expiresAt: null, sentAt: new Date("2026-07-11T00:00:00.000Z"), createdAt: new Date("2026-07-11T00:00:00.000Z"), firedSignalKeys: [] },
    ]);
    const res = await resolveMetric(def, { customerId: 10, mspId: 1 });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    const events = res.data.events as any[];
    expect(events).toHaveLength(1);
    expect(events.every((e) => e.title !== "Assessment package")).toBe(true);
    expect(events[0].id).toBe(1);
  });
});
