/**
 * admin-ai-billing-analytics.test.ts
 *
 * AI Cost Governance Phase 4 (#52): GET /admin/ai-billing/analytics.
 *
 * The load-bearing assertions here are:
 *   - the endpoint is requireAdmin-gated, like the rest of this surface;
 *   - the series, all three dimension rollups and the headline total come from
 *     ONE read and therefore always reconcile;
 *   - unattributed spend is reported as unattributed on every dimension, never
 *     folded into a named bucket;
 *   - the anomaly rule ships with the response, direction included, so the page
 *     states the rule it was actually judged by;
 *   - a scan that hits the row ceiling says so, and marks the buckets it could
 *     not fully see rather than reporting them as quiet.
 *
 * The window/bucketing arithmetic itself is unit-tested in
 * lib/ai-billing-analytics.test.ts; this file tests the wiring.
 *
 * Run with: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

process.env["DATABASE_URL"] = "postgres://test";

const ADMIN_PASS = "test-admin-pass";

let selectQueue: unknown[][] = [];
const whereCalls: unknown[] = [];
let limitCalls: number[] = [];

vi.mock("@workspace/db", () => {
  const makeChain = (): Record<string, unknown> => {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      leftJoin: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      where: vi.fn((w: unknown) => { whereCalls.push(w); return chain; }),
      orderBy: vi.fn(() => chain),
      groupBy: vi.fn(() => chain),
      limit: vi.fn((n: number) => { limitCalls.push(n); return chain; }),
      offset: vi.fn(() => chain),
      then: (resolve: (v: unknown) => unknown) => resolve(selectQueue.shift() ?? []),
    };
    return chain;
  };

  return {
    db: { select: vi.fn(() => makeChain()) },
    aiUsageEventsTable: {
      id: "id", eventId: "event_id", occurredAt: "occurred_at", mspId: "msp_id",
      customerId: "customer_id", nodeType: "node_type", feature: "feature",
      triggerSource: "trigger_source", generatedArtifactType: "generated_artifact_type",
      generatedArtifactName: "generated_artifact_name", generatedArtifactId: "generated_artifact_id",
      costCents: "cost_cents", costOwner: "cost_owner", promptTokens: "prompt_tokens",
      completionTokens: "completion_tokens", totalTokens: "total_tokens", model: "model",
      runId: "run_id", correlationId: "correlation_id",
    },
    mspsTable: { id: "id", name: "name" },
    tenantsTable: { id: "id", customerName: "customer_name" },
  };
});

vi.mock("../middlewares/requireAuth", () => ({
  requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.headers["authorization"] === `Bearer ${ADMIN_PASS}`) return next();
    res.status(401).json({ error: "Unauthorized" });
  },
}));

// Hoisted: vi.mock's factory is lifted above the module body, so a plain const
// here would not exist yet when the route module binds its logger.
const { warnSpy } = vi.hoisted(() => ({ warnSpy: vi.fn() }));
vi.mock("../lib/logger", () => ({
  logger: {
    child: () => ({ info: vi.fn(), warn: warnSpy, error: vi.fn(), debug: vi.fn() }),
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  },
}));

import router from "./admin-ai-billing";

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return app;
}

const auth = (r: request.Test) => r.set("Authorization", `Bearer ${ADMIN_PASS}`);
const PATH = "/api/admin/ai-billing/analytics";

const DAY_MS = 86_400_000;
/** A row that landed `daysAgo` days back, at noon-ish so it never straddles a boundary. */
function usageRow(daysAgo: number, over: Record<string, unknown> = {}) {
  const d = new Date(Date.now() - daysAgo * DAY_MS);
  d.setUTCHours(12, 0, 0, 0);
  return {
    occurredAt: d,
    costCents: 100,
    customerId: null,
    customerName: null,
    mspId: null,
    mspName: null,
    generatedArtifactType: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue = [];
  whereCalls.length = 0;
  limitCalls = [];
  warnSpy.mockClear();
});

// ── Auth ──────────────────────────────────────────────────────────────────────

describe("GET /admin/ai-billing/analytics — admin gate", () => {
  it("401s without an admin token", async () => {
    const res = await request(makeApp()).get(PATH);
    expect(res.status).toBe(401);
  });

  it("200s with one", async () => {
    selectQueue = [[]];
    const res = await auth(request(makeApp()).get(PATH));
    expect(res.status).toBe(200);
  });
});

// ── Shape and reconciliation ──────────────────────────────────────────────────

describe("GET /admin/ai-billing/analytics — rollups reconcile", () => {
  it("computes the series, all three dimensions and the total from one read", async () => {
    selectQueue = [
      [
        usageRow(3, { costCents: 300, customerId: 1, customerName: "Acme", mspId: 5, mspName: "North", generatedArtifactType: "sow" }),
        usageRow(2, { costCents: 700, customerId: 2, customerName: "Globex", mspId: 5, mspName: "North", generatedArtifactType: "sow" }),
        usageRow(1, { costCents: 500, customerId: 1, customerName: "Acme", mspId: 6, mspName: "South", generatedArtifactType: "assessment" }),
      ],
    ];

    const res = await auth(request(makeApp()).get(`${PATH}?bucket=day&buckets=14`));

    expect(res.status).toBe(200);
    // ONE read backs everything below.
    expect(selectQueue).toHaveLength(0);

    expect(res.body.totalCostCents).toBe(1500);
    expect(res.body.eventCount).toBe(3);

    const seriesTotal = res.body.series.reduce(
      (a: number, p: { costCents: number }) => a + p.costCents,
      0,
    );
    expect(seriesTotal).toBe(1500);

    for (const key of ["byCustomer", "byMsp", "byArtifactType"] as const) {
      expect(res.body[key].totalCostCents).toBe(1500);
    }

    expect(res.body.byCustomer.slices.map((s: { label: string }) => s.label)).toEqual([
      "Acme",
      "Globex",
    ]);
    expect(res.body.byArtifactType.slices[0]).toMatchObject({ key: "sow", costCents: 1000 });
  });

  it("returns a gapless series covering exactly the requested bucket count", async () => {
    selectQueue = [[usageRow(2, { costCents: 250 })]];

    const res = await auth(request(makeApp()).get(`${PATH}?bucket=day&buckets=10`));

    expect(res.body.bucketCount).toBe(10);
    expect(res.body.series).toHaveLength(10);
    // Every bucket present, most of them honestly zero.
    expect(res.body.series.filter((p: { costCents: number }) => p.costCents === 0).length).toBe(9);
    expect(new Date(res.body.periodStart).getTime()).toBeLessThan(
      new Date(res.body.periodEnd).getTime(),
    );
  });

  it("clamps a hostile bucket count instead of unbounding the window", async () => {
    selectQueue = [[]];
    const res = await auth(request(makeApp()).get(`${PATH}?bucket=month&buckets=100000`));

    expect(res.body.bucketCount).toBe(36);
    expect(res.body.series).toHaveLength(36);
  });
});

// ── Unattributed rows ─────────────────────────────────────────────────────────

describe("GET /admin/ai-billing/analytics — unattributed spend", () => {
  it("reports NULL attribution separately on every dimension", async () => {
    selectQueue = [
      [
        usageRow(2, { costCents: 400, customerId: 9, customerName: "Acme", mspId: 3, mspName: "North", generatedArtifactType: "sow" }),
        usageRow(2, { costCents: 600 }), // null customer, null msp, no artifact
      ],
    ];

    const res = await auth(request(makeApp()).get(PATH));

    expect(res.body.byCustomer.unattributed).toMatchObject({ costCents: 600, eventCount: 1 });
    expect(res.body.byMsp.unattributed).toMatchObject({ costCents: 600, eventCount: 1 });
    expect(res.body.byArtifactType.unattributed).toMatchObject({ costCents: 600, eventCount: 1 });

    // And it is nowhere among the named buckets.
    for (const key of ["byCustomer", "byMsp", "byArtifactType"] as const) {
      const named = res.body[key].slices as { costCents: number }[];
      expect(named.reduce((a, s) => a + s.costCents, 0)).toBe(400);
    }
  });
});

// ── The anomaly rule ──────────────────────────────────────────────────────────

describe("GET /admin/ai-billing/analytics — anomaly rule", () => {
  it("ships the rule, its direction and its wording with the data", async () => {
    selectQueue = [[]];
    const res = await auth(request(makeApp()).get(`${PATH}?bucket=day&buckets=14`));

    expect(res.body.anomalies.rule.direction).toBe("high-is-bad");
    expect(res.body.anomalies.rule.factor).toBe(3);
    expect(res.body.anomalies.rule.description).toContain("high is bad");
    // The wording names the bucket size actually charted.
    expect(res.body.anomalies.rule.description).toContain("day");
    expect(res.body.anomalies.anomalies).toEqual([]);
  });

  it("flags a spike above the rolling baseline", async () => {
    // Ten steady days at 100c, then 2000c the day before yesterday. Yesterday and
    // today stay quiet so the spike is not the in-progress bucket. The window is
    // sized to start exactly at the first steady day, so there is no run of
    // leading empty buckets for the steady days to look like a spike against.
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => usageRow(i + 3, { costCents: 100 })),
      usageRow(2, { costCents: 2000 }),
    ];
    selectQueue = [rows];

    const res = await auth(request(makeApp()).get(`${PATH}?bucket=day&buckets=13`));

    expect(res.body.anomalies.anomalies).toHaveLength(1);
    expect(res.body.anomalies.anomalies[0]).toMatchObject({
      costCents: 2000,
      reason: "above-baseline",
      severity: "severe",
    });
  });

  it("does not flag the same movement downwards", async () => {
    // The mirror: a sustained 2000c/day baseline that collapses to 100c.
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => usageRow(i + 3, { costCents: 2000 })),
      usageRow(2, { costCents: 100 }),
    ];
    selectQueue = [rows];

    const res = await auth(request(makeApp()).get(`${PATH}?bucket=day&buckets=13`));

    expect(res.body.anomalies.anomalies).toEqual([]);
  });

  it("does not judge the in-progress bucket", async () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => usageRow(i + 1, { costCents: 100 })),
      // Today, already far above the baseline but not yet a complete day.
      { ...usageRow(0, { costCents: 9999 }), occurredAt: new Date() },
    ];
    selectQueue = [rows];

    const res = await auth(request(makeApp()).get(`${PATH}?bucket=day&buckets=11`));

    expect(res.body.anomalies.anomalies).toEqual([]);
    expect(res.body.anomalies.skipped.partialBucket).toBeGreaterThanOrEqual(1);
  });
});

// ── Coverage honesty ──────────────────────────────────────────────────────────

describe("GET /admin/ai-billing/analytics — coverage", () => {
  it("reports full coverage when the scan was not clipped", async () => {
    selectQueue = [[usageRow(1, { costCents: 100 })]];
    const res = await auth(request(makeApp()).get(PATH));

    expect(res.body.coverage).toMatchObject({
      rowsScanned: 1,
      truncated: false,
      observedFrom: null,
    });
    // One row of headroom past the ceiling is requested, so hitting it is detectable.
    expect(limitCalls[0]).toBe(50_001);
  });

  it("declares truncation and marks the unread buckets partial rather than quiet", async () => {
    // One row past the ceiling, all on the same recent day: everything older
    // than that day is unread, not empty.
    const rows = Array.from({ length: 50_001 }, () => usageRow(1, { costCents: 1 }));
    selectQueue = [rows];

    const res = await auth(request(makeApp()).get(`${PATH}?bucket=day&buckets=10`));

    expect(res.body.coverage.truncated).toBe(true);
    expect(res.body.coverage.rowsScanned).toBe(50_000);
    expect(res.body.coverage.observedFrom).not.toBeNull();
    expect(warnSpy).toHaveBeenCalled();

    // The clipped older buckets are partial, so the anomaly rule refuses to read
    // them as a quiet baseline that the newest day then "spikes" above.
    const olderPartial = res.body.series
      .slice(0, 5)
      .every((p: { partial: boolean }) => p.partial);
    expect(olderPartial).toBe(true);
    expect(res.body.anomalies.anomalies).toEqual([]);
  });
});

// ── Filters ───────────────────────────────────────────────────────────────────

describe("GET /admin/ai-billing/analytics — filters", () => {
  /** Structural fingerprint of a where clause, for same/different comparisons. */
  function fingerprint(v: unknown): string {
    try {
      return JSON.stringify(v) ?? String(v);
    } catch {
      return String(v);
    }
  }

  async function whereFor(query: string): Promise<string> {
    whereCalls.length = 0;
    selectQueue = [[]];
    const res = await auth(request(makeApp()).get(`${PATH}${query}`));
    expect(res.status).toBe(200);
    return fingerprint(whereCalls[0]);
  }

  it("narrows the clause for each non-date filter the ledger accepts", async () => {
    // The window bounds are always present; each filter must add to them.
    const base = await whereFor("?bucket=day&buckets=7");

    for (const q of [
      "?bucket=day&buckets=7&mspId=4",
      "?bucket=day&buckets=7&customerId=9",
      "?bucket=day&buckets=7&costOwner=platform",
      "?bucket=day&buckets=7&generatedArtifactType=sow",
      "?bucket=day&buckets=7&feature=generate_document",
    ]) {
      expect(await whereFor(q)).not.toBe(base);
    }
  });

  it("ignores junk filters rather than filtering on them or erroring", async () => {
    const base = await whereFor("?bucket=day&buckets=7");

    // A non-numeric id and a costOwner outside the real enum are both dropped,
    // yielding exactly the unfiltered clause — not a filter on garbage.
    expect(await whereFor("?bucket=day&buckets=7&mspId=notanumber")).toBe(base);
    expect(await whereFor("?bucket=day&buckets=7&costOwner=nonsense")).toBe(base);
  });
});
