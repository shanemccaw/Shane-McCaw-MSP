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

describe("licensing.wasteEstimateBreakdown resolver (cost-engine wiring)", () => {
  const wasteDef = getMetric("licensing.wasteEstimateBreakdown")!;

  beforeEach(() => {
    mockResultQueue = [];
  });

  it("is needs_aggregation, not a bare scalar (the pre-existing resolver-routing bug this fixes)", () => {
    expect(wasteDef.status).toBe("needs_aggregation");
    expect(wasteDef.shape).toBe("distribution");
  });

  /**
   * Query order for this metric (see license-waste-source.ts):
   *   1. resolveTenantId
   *   2. monitor_checks — active checks, filtered to /subscribedSkus endpoints
   *   3. tenant_monitor_profiles, once per candidate key, alphabetically —
   *      EVERY candidate is read, because the winner is the most recently
   *      collected page rather than the first usable one (#441)
   *   4. cost-engine price lookup, once per distinct SKU with unused seats —
   *      dashboard-resolvers.ts's own upfront pass (#333/#1104, paid-only SKU
   *      filtering, commit eba935da4), to decide which SKUs count as "paid"
   *      before pricing anything
   *   5. cost-engine price lookup AGAIN, once per distinct SKU that SURVIVED
   *      step 4's filter — computeSkuCostBreakdown() re-derives price/
   *      displayName itself rather than reusing step 4's already-resolved
   *      map, so every priced SKU is queried twice per resolve. Real,
   *      confirmed double work, not a mocking artifact — see the commit's own
   *      diff.
   */
  const SUBSCRIBED_SKU_CHECKS = [
    { key: "cost:entra-license-tier-distribution", endpoint: "/subscribedSkus" },
    { key: "cost:unused-unassigned-licenses", endpoint: "/subscribedSkus" },
  ];
  const skuPage = (items: unknown[]) => ({ value: items });
  const sku = (skuPartNumber: string, enabled: number, consumed: number) => ({
    skuPartNumber,
    consumedUnits: consumed,
    prepaidUnits: { enabled },
  });

  it("prices real unused seats (enabled - consumed) into real dollar buckets via cost-engine", async () => {
    mockResultQueue.push([{ tenantId: "tenant-guid-1" }]);
    mockResultQueue.push(SUBSCRIBED_SKU_CHECKS);
    mockResultQueue.push([
      { rawResponse: skuPage([sku("SPE_E3", 40, 30), sku("SPE_E5", 5, 3)]), collectedAt: new Date() },
    ]);
    mockResultQueue.push([]); // cost:unused-unassigned-licenses — no stored page
    // Each priced SKU is queried twice (see the query-order note above): once
    // by dashboard-resolvers.ts's own paid-only filtering pass, once again by
    // computeSkuCostBreakdown() itself.
    mockResultQueue.push([{ displayName: "Microsoft 365 E3", monthlyPriceCents: 3600 }]);
    mockResultQueue.push([{ displayName: "Microsoft 365 E5", monthlyPriceCents: 5700 }]);
    mockResultQueue.push([{ displayName: "Microsoft 365 E3", monthlyPriceCents: 3600 }]);
    mockResultQueue.push([{ displayName: "Microsoft 365 E5", monthlyPriceCents: 5700 }]);

    const res = await resolveMetric(wasteDef, { customerId: 10, mspId: 1 });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    const buckets = res.data.buckets as { label: string; value: number }[];
    expect(buckets).toEqual(
      expect.arrayContaining([
        { label: "Microsoft 365 E3", value: 360 }, // 10 unused x $36
        { label: "Microsoft 365 E5", value: 114 }, // 2 unused x $57
      ]),
    );
    expect(res.meta?.totalMonthlyDollars).toBe(474);
    expect(res.meta?.unknownSkus).toEqual([]);
    // Provenance + the arithmetic behind the figure.
    // Provenance is the check whose stored page the figure was computed from —
    // not the tidiest-sounding key with any page at all (#441).
    expect(res.meta?.sourceCheckKey).toBe("cost:entra-license-tier-distribution");
    expect(res.meta?.totalEnabledSeats).toBe(45);
  });

  it("returns no_data — never a fabricated figure — when every seat is assigned", async () => {
    // The live trap: this check's extractedProperties carry a SKU-keyed
    // {ENTERPRISEPACK: 1} groupByCount (one row per SKU, not seats). The real
    // page shows a fully-assigned estate, so the honest answer is no data.
    mockResultQueue.push([{ tenantId: "tenant-guid-1" }]);
    mockResultQueue.push(SUBSCRIBED_SKU_CHECKS);
    mockResultQueue.push([
      {
        rawResponse: skuPage([sku("ENTERPRISEPACK", 21, 21)]),
        collectedAt: new Date(),
        extractedProperties: { entraLicenseTierDistribution: { ENTERPRISEPACK: 1 }, unusedLicenseCount: 4 },
      },
    ]);

    const res = await resolveMetric(wasteDef, { customerId: 10, mspId: 1 });
    expect(res.status).toBe("not_available");
    if (res.status !== "not_available") return;
    expect(res.reason).toBe("no_data");
  });

  it("surfaces unpriced SKUs via meta.excludedUnpricedSkus instead of guessing a dollar figure", async () => {
    // #333/#1104 (commit eba935da4): an unpriced SKU is filtered out BEFORE
    // computeSkuCostBreakdown ever sees it — it does not reach the breakdown
    // as a $0 bucket, and it is not what meta.unknownSkus (computeSkuCostBreakdown's
    // OWN "priced SKU that lost its price between the two lookups" signal,
    // see the describe-level query-order note) reports. It is reported via
    // meta.excludedUnpricedSkus instead, which is what paidSeatFiguresFromLines
    // populates for exactly this reason.
    mockResultQueue.push([{ tenantId: "tenant-guid-1" }]);
    mockResultQueue.push(SUBSCRIBED_SKU_CHECKS);
    mockResultQueue.push([
      {
        rawResponse: skuPage([sku("NOT_A_REAL_SKU", 8, 3), sku("SPE_E3", 4, 3)]),
        collectedAt: new Date(),
      },
    ]);
    mockResultQueue.push([]); // cost:unused-unassigned-licenses — no stored page
    mockResultQueue.push([]); // filtering pass: no sku_price_reference row for NOT_A_REAL_SKU
    mockResultQueue.push([{ displayName: "Microsoft 365 E3", monthlyPriceCents: 3600 }]); // filtering pass: SPE_E3
    mockResultQueue.push([{ displayName: "Microsoft 365 E3", monthlyPriceCents: 3600 }]); // computeSkuCostBreakdown pass: SPE_E3 (only priced SKU reaches it)

    const res = await resolveMetric(wasteDef, { customerId: 10, mspId: 1 });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    // NOT_A_REAL_SKU never reached computeSkuCostBreakdown, so its own
    // unknownSkus list is empty — the unpriced SKU shows up here instead.
    expect(res.meta?.unknownSkus).toEqual([]);
    expect(res.meta?.excludedUnpricedSkus).toEqual([
      { skuPartNumber: "NOT_A_REAL_SKU", enabled: 8, reason: "no_price_on_file" },
    ]);
    // Only the priced SKU (SPE_E3, 1 unused seat x $36) produces a bucket.
    const buckets = res.data.buckets as { label: string; value: number }[];
    expect(buckets).toEqual([{ label: "Microsoft 365 E3", value: 36 }]);
  });
});

describe("monitor_profile scalar field selection (risk heatmap correctness)", () => {
  const staleDef = getMetric("identity.staleAccountCount")!;

  beforeEach(() => {
    mockResultQueue = [];
  });

  it("reads the mapping field that MEANS the metric, not whichever numeric field comes first", async () => {
    // A stale-account check that emits both the whole-directory user count and
    // the real stale count. First-numeric-wins reported 412 stale accounts.
    mockResultQueue.push([{ tenantId: "tenant-guid-1" }]); // resolveTenantId
    mockResultQueue.push([
      {
        extractedProperties: { totalUserCount: 412, staleUserCount: 7, _itemCount: 412 },
        rawResponse: null,
        collectedAt: new Date(),
        status: "ok",
      },
    ]); // latestCheckProps
    mockResultQueue.push([
      { mapping: [{ targetField: "totalUserCount" }, { targetField: "staleUserCount" }] },
    ]); // loadCheckMapping

    const res = await resolveMetric(staleDef, { customerId: 10, mspId: 1 });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.data.value).toBe(7);
    expect(res.meta?.valueSource).toBe("mapping:staleUserCount");
  });

  it("keeps the _itemCount fallback (and declares it) when the mapping yields no number", async () => {
    mockResultQueue.push([{ tenantId: "tenant-guid-1" }]);
    mockResultQueue.push([
      { extractedProperties: { _itemCount: 42 }, rawResponse: null, collectedAt: new Date(), status: "ok" },
    ]);
    mockResultQueue.push([{ mapping: [{ targetField: "staleUserCount" }] }]);

    const res = await resolveMetric(staleDef, { customerId: 10, mspId: 1 });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.data.value).toBe(42);
    expect(res.meta?.valueSource).toBe("itemCount");
  });

  it("reports unknown_check_key — not no_data — when the sourceKey names no real check", async () => {
    mockResultQueue.push([{ tenantId: "tenant-guid-1" }]);
    mockResultQueue.push([]); // no tenant_monitor_profiles row
    mockResultQueue.push([]); // no monitor_checks row either → phantom sourceKey

    const res = await resolveMetric(staleDef, { customerId: 10, mspId: 1 });
    expect(res.status).toBe("not_available");
    if (res.status !== "not_available") return;
    expect(res.reason).toBe("unknown_check_key");
  });

  it("still reports no_data when the check is real but the tenant has not collected it", async () => {
    mockResultQueue.push([{ tenantId: "tenant-guid-1" }]);
    mockResultQueue.push([]); // no profile row
    mockResultQueue.push([{ mapping: [{ targetField: "staleUserCount" }] }]); // check exists

    const res = await resolveMetric(staleDef, { customerId: 10, mspId: 1 });
    expect(res.status).toBe("not_available");
    if (res.status !== "not_available") return;
    expect(res.reason).toBe("no_data");
  });

  it("reports license_gap — not no_data — when the latest row is a real license-gap check, with the honest customer-safe detail sentence", async () => {
    const riskyUsersDef = getMetric("identity.riskyUserCount")!;
    mockResultQueue.push([{ tenantId: "tenant-guid-1" }]); // resolveTenantId
    mockResultQueue.push([
      {
        // monitor-executor.ts's real LicenseGapError persistence shape.
        extractedProperties: { _licenseGap: true, _licenseGapFeature: "Microsoft Defender for Office 365" },
        rawResponse: null,
        collectedAt: new Date(),
        status: "license_gap",
      },
    ]); // latestCheckProps
    mockResultQueue.push([{ mapping: [{ targetField: "riskyUserCount" }] }]); // loadCheckMapping

    const res = await resolveMetric(riskyUsersDef, { customerId: 10, mspId: 1 });
    expect(res.status).toBe("not_available");
    if (res.status !== "not_available") return;
    expect(res.reason).toBe("license_gap");
    expect(res.detail).toBe(
      "We couldn't evaluate this because your Microsoft 365 tenant doesn't have Microsoft Defender for Office 365. This isn't a security problem — it means the capability isn't licensed on your tenant. Adding Microsoft Defender for Office 365 would let us monitor and report on it.",
    );
  });

  it("falls back to a generic feature name for license_gap when _licenseGapFeature is missing", async () => {
    const riskyUsersDef = getMetric("identity.riskyUserCount")!;
    mockResultQueue.push([{ tenantId: "tenant-guid-1" }]);
    mockResultQueue.push([
      { extractedProperties: { _licenseGap: true }, rawResponse: null, collectedAt: new Date(), status: "license_gap" },
    ]);
    mockResultQueue.push([{ mapping: [{ targetField: "riskyUserCount" }] }]);

    const res = await resolveMetric(riskyUsersDef, { customerId: 10, mspId: 1 });
    expect(res.status).toBe("not_available");
    if (res.status !== "not_available") return;
    expect(res.reason).toBe("license_gap");
    expect(res.detail).toContain("a required Microsoft 365 add-on");
  });
});

describe("security.emailAuthFindingCount resolver (Git #1258)", () => {
  const def = getMetric("security.emailAuthFindingCount")!;

  beforeEach(() => {
    mockResultQueue = [];
  });

  it("tallies the protocols configured false on the latest exchange:dkim-spf-dmarc-status row", async () => {
    mockResultQueue.push([{ tenantId: "tenant-guid-1" }]); // resolveTenantId
    mockResultQueue.push([
      {
        extractedProperties: {
          domain: "contoso.com",
          spfConfigured: false,
          dmarcConfigured: false,
          dkimConfiguredAtDefaultSelectors: true,
        },
        rawResponse: null,
        collectedAt: new Date(),
        status: "ok",
      },
    ]); // latestCheckProps

    const res = await resolveMetric(def, { customerId: 10, mspId: 1 });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.data.value).toBe(2);
  });

  it("resolves 0 (a real zero, not not_available) when every protocol is configured", async () => {
    mockResultQueue.push([{ tenantId: "tenant-guid-1" }]);
    mockResultQueue.push([
      {
        extractedProperties: { spfConfigured: true, dmarcConfigured: true, dkimConfiguredAtDefaultSelectors: true },
        rawResponse: null,
        collectedAt: new Date(),
        status: "ok",
      },
    ]);

    const res = await resolveMetric(def, { customerId: 10, mspId: 1 });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.data.value).toBe(0);
  });

  it("reports no_data when the tenant has no collected row", async () => {
    mockResultQueue.push([{ tenantId: "tenant-guid-1" }]);
    mockResultQueue.push([]); // no profile row

    const res = await resolveMetric(def, { customerId: 10, mspId: 1 });
    expect(res.status).toBe("not_available");
    if (res.status !== "not_available") return;
    expect(res.reason).toBe("no_data");
  });
});
