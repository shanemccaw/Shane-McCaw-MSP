/**
 * admin-ai-billing.test.ts
 *
 * AI Cost Governance Phase 3 (#51): the three PlatformAdmin AI Billing
 * endpoints, plus the pure range/rollup helpers they are built on.
 *
 * The load-bearing assertions here are:
 *   - every endpoint is requireAdmin-gated (this is platform-wide spend data);
 *   - the summary's headline total and its three breakdowns are computed from
 *     ONE read, so they always reconcile;
 *   - "today"/"month" bounds follow the VIEWER's timezone, not UTC, and a
 *     hostile tzOffsetMinutes falls back to UTC instead of producing garbage;
 *   - /events applies the same filters to the page of rows and to the count.
 *
 * Run with: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

process.env["DATABASE_URL"] = "postgres://test";

const ADMIN_PASS = "test-admin-pass";

/** Rows the mocked select chain resolves, in call order. */
let selectQueue: unknown[][] = [];
/** Every where() argument seen, so filter/count parity can be asserted. */
const whereCalls: unknown[] = [];
let limitCalls: number[] = [];
let offsetCalls: number[] = [];

vi.mock("@workspace/db", () => {
  // One thenable builder shared by every terminal method: the routes end their
  // chains at different points (.offset(), .limit(), bare await after .where()),
  // so each step must be awaitable AND chainable.
  const makeChain = (): Record<string, unknown> => {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      leftJoin: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      where: vi.fn((w: unknown) => { whereCalls.push(w); return chain; }),
      orderBy: vi.fn(() => chain),
      groupBy: vi.fn(() => chain),
      limit: vi.fn((n: number) => { limitCalls.push(n); return chain; }),
      offset: vi.fn((n: number) => { offsetCalls.push(n); return chain; }),
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

vi.mock("../lib/logger", () => ({
  logger: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  },
}));

import router from "./admin-ai-billing";
import {
  parseBoundedInt,
  parseDateParam,
  parseIdParam,
  parseRange,
  resolveRangeBounds,
  rollupBy,
} from "../lib/ai-billing-rollup.ts";

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return app;
}

const auth = (r: request.Test) => r.set("Authorization", `Bearer ${ADMIN_PASS}`);

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue = [];
  whereCalls.length = 0;
  limitCalls = [];
  offsetCalls = [];
});

// ── Auth ──────────────────────────────────────────────────────────────────────

describe("AI Billing endpoints — admin gate", () => {
  const paths = [
    "/api/admin/ai-billing/events",
    "/api/admin/ai-billing/summary",
    "/api/admin/ai-billing/recent",
  ];

  it("401s every endpoint without an admin token", async () => {
    for (const p of paths) {
      const res = await request(makeApp()).get(p);
      expect(res.status, `${p} must be admin-gated`).toBe(401);
    }
  });
});

// ── GET /events ───────────────────────────────────────────────────────────────

describe("GET /admin/ai-billing/events", () => {
  const EVENT = {
    id: 7,
    eventId: "11111111-1111-1111-1111-111111111111",
    occurredAt: "2026-07-28T12:00:00.000Z",
    mspId: 42,
    mspName: "Acme MSP",
    customerId: 501,
    customerName: "Contoso",
    nodeType: "generate_document",
    feature: "workflow:generate_document",
    triggerSource: "workflow",
    generatedArtifactType: "sow",
    generatedArtifactName: "SOW - Contoso",
    generatedArtifactId: "doc-9",
    costCents: 134,
    costOwner: "msp",
    promptTokens: 1000,
    completionTokens: 500,
    totalTokens: 1500,
    model: "claude-sonnet-4-6",
    runId: "run-1",
    correlationId: "trace-abc",
  };

  it("returns the full traceability row, the filtered total, and the page window", async () => {
    selectQueue = [[EVENT], [{ value: 1 }], [{ value: 134 }]];
    const res = await auth(request(makeApp()).get("/api/admin/ai-billing/events"));

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    // Every Phase 2 traceability column must survive the round trip — this is
    // the whole point of the page.
    expect(res.body.events[0]).toMatchObject({
      nodeType: "generate_document",
      feature: "workflow:generate_document",
      triggerSource: "workflow",
      generatedArtifactType: "sow",
      generatedArtifactName: "SOW - Contoso",
      generatedArtifactId: "doc-9",
      mspName: "Acme MSP",
      customerName: "Contoso",
      correlationId: "trace-abc",
      model: "claude-sonnet-4-6",
      costCents: 134,
    });
    expect(res.body.total).toBe(1);
    expect(res.body.filteredCostCents).toBe(134);
    expect(res.body.limit).toBe(50);
    expect(res.body.offset).toBe(0);
  });

  it("applies the SAME where clause to the row page, the count, and the cost sum", async () => {
    selectQueue = [[EVENT], [{ value: 1 }], [{ value: 134 }]];
    await auth(
      request(makeApp()).get("/api/admin/ai-billing/events?mspId=42&costOwner=msp"),
    );

    // Three queries, three identical where objects — a page of rows can never
    // be filtered differently from the total it is labelled with.
    expect(whereCalls).toHaveLength(3);
    expect(whereCalls[0]).toBe(whereCalls[1]);
    expect(whereCalls[1]).toBe(whereCalls[2]);
  });

  it("issues no where clause at all when nothing is filtered", async () => {
    selectQueue = [[], [{ value: 0 }], [{ value: null }]];
    await auth(request(makeApp()).get("/api/admin/ai-billing/events"));
    expect(whereCalls).toEqual([undefined, undefined, undefined]);
  });

  it("ignores a costOwner outside the real enum rather than filtering on it", async () => {
    selectQueue = [[], [{ value: 0 }], [{ value: null }]];
    await auth(request(makeApp()).get("/api/admin/ai-billing/events?costOwner=nonsense"));
    expect(whereCalls[0]).toBeUndefined();
  });

  it("clamps limit to the page maximum and floors a negative offset", async () => {
    selectQueue = [[], [{ value: 0 }], [{ value: null }]];
    await auth(request(makeApp()).get("/api/admin/ai-billing/events?limit=9999&offset=-5"));
    expect(limitCalls[0]).toBe(200);
    expect(offsetCalls[0]).toBe(0);
  });

  it("reports a null cost sum as 0 rather than NaN", async () => {
    selectQueue = [[], [{ value: 0 }], [{ value: null }]];
    const res = await auth(request(makeApp()).get("/api/admin/ai-billing/events"));
    expect(res.body.filteredCostCents).toBe(0);
  });

  it("500s with a customer-safe message when the query throws", async () => {
    selectQueue = [];
    const { db } = await import("@workspace/db");
    (db.select as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const res = await auth(request(makeApp()).get("/api/admin/ai-billing/events"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to load AI usage events");
  });
});

// ── GET /summary ──────────────────────────────────────────────────────────────

describe("GET /admin/ai-billing/summary", () => {
  const ROWS = [
    { mspId: 42, mspName: "Acme MSP", costCents: 100, costOwner: "msp", nodeType: "generate_document", feature: "doc" },
    { mspId: 42, mspName: "Acme MSP", costCents: 50, costOwner: "msp", nodeType: "chat_message", feature: "chat" },
    { mspId: null, mspName: null, costCents: 25, costOwner: "platform", nodeType: "chat_message", feature: "chat" },
  ];

  it("rolls up total, cost owner, MSP and feature from one read — all reconciling", async () => {
    selectQueue = [ROWS];
    const res = await auth(request(makeApp()).get("/api/admin/ai-billing/summary?range=month"));

    expect(res.status).toBe(200);
    expect(res.body.totalCostCents).toBe(175);
    expect(res.body.eventCount).toBe(3);

    // Every breakdown must sum back to the headline figure.
    const sumOf = (rows: { costCents: number }[]) => rows.reduce((a, r) => a + r.costCents, 0);
    expect(sumOf(res.body.byCostOwner)).toBe(175);
    expect(sumOf(res.body.byMsp)).toBe(175);
    expect(sumOf(res.body.byFeature)).toBe(175);

    expect(res.body.byCostOwner).toEqual([
      { costOwner: "msp", costCents: 150, eventCount: 2 },
      { costOwner: "platform", costCents: 25, eventCount: 1 },
    ]);
  });

  it("labels null-mspId (platform-owned) spend instead of dropping it", async () => {
    selectQueue = [ROWS];
    const res = await auth(request(makeApp()).get("/api/admin/ai-billing/summary?range=month"));
    const platformBucket = res.body.byMsp.find((b: { mspId: number | null }) => b.mspId === null);
    expect(platformBucket).toEqual({
      mspId: null,
      mspName: "Platform (no MSP)",
      costCents: 25,
      eventCount: 1,
    });
  });

  it("defaults an unknown range to today and echoes the resolved window", async () => {
    selectQueue = [[]];
    const res = await auth(request(makeApp()).get("/api/admin/ai-billing/summary?range=decade"));
    expect(res.body.range).toBe("today");
    expect(new Date(res.body.periodEnd).getTime() - new Date(res.body.periodStart).getTime())
      .toBe(86_400_000);
  });

  it("500s with a customer-safe message when the query throws", async () => {
    const { db } = await import("@workspace/db");
    (db.select as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const res = await auth(request(makeApp()).get("/api/admin/ai-billing/summary"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to load AI usage summary");
  });
});

// ── GET /recent ───────────────────────────────────────────────────────────────

describe("GET /admin/ai-billing/recent", () => {
  it("defaults to 10 and clamps an oversized limit", async () => {
    selectQueue = [[]];
    await auth(request(makeApp()).get("/api/admin/ai-billing/recent"));
    expect(limitCalls[0]).toBe(10);

    limitCalls = [];
    selectQueue = [[]];
    await auth(request(makeApp()).get("/api/admin/ai-billing/recent?limit=5000"));
    expect(limitCalls[0]).toBe(50);
  });

  it("returns rows with the fields the StatusBar popover renders", async () => {
    selectQueue = [[
      {
        id: 1,
        eventId: "e1",
        occurredAt: "2026-07-28T12:00:00.000Z",
        costCents: 12,
        mspName: "Acme MSP",
        customerName: "Contoso",
        generatedArtifactName: "SOW - Contoso",
      },
    ]];
    const res = await auth(request(makeApp()).get("/api/admin/ai-billing/recent?limit=10"));
    expect(res.status).toBe(200);
    expect(res.body.events[0]).toMatchObject({
      occurredAt: "2026-07-28T12:00:00.000Z",
      mspName: "Acme MSP",
      customerName: "Contoso",
      generatedArtifactName: "SOW - Contoso",
      costCents: 12,
    });
  });
});

// ── Pure helpers ──────────────────────────────────────────────────────────────

describe("resolveRangeBounds", () => {
  // 2026-07-28T02:30:00Z is still 2026-07-27 (22:30) in US Eastern (offset 240).
  const NOW = new Date("2026-07-28T02:30:00.000Z");

  it("uses UTC days at offset 0", () => {
    const { start, end } = resolveRangeBounds("today", 0, NOW);
    expect(start.toISOString()).toBe("2026-07-28T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-07-29T00:00:00.000Z");
  });

  it("rolls the day at the VIEWER's midnight, not UTC's", () => {
    // The whole reason the offset is threaded through: at 22:30 Eastern the
    // admin's "Today" is still the 27th, and must not have already reset.
    const { start, end } = resolveRangeBounds("today", 240, NOW);
    expect(start.toISOString()).toBe("2026-07-27T04:00:00.000Z");
    expect(end.toISOString()).toBe("2026-07-28T04:00:00.000Z");
  });

  it("brackets the viewer's calendar month, crossing the year boundary correctly", () => {
    const dec = new Date("2026-12-15T12:00:00.000Z");
    const { start, end } = resolveRangeBounds("month", 0, dec);
    expect(start.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("computes a viewer-local month whose window is exactly the month's length", () => {
    const { start, end } = resolveRangeBounds("month", 240, NOW);
    expect(start.toISOString()).toBe("2026-07-01T04:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-01T04:00:00.000Z");
  });

  it("falls back to UTC for an absurd or non-finite offset instead of producing garbage bounds", () => {
    for (const bad of [99999, Number.NaN, Number.POSITIVE_INFINITY, -100000]) {
      const { start } = resolveRangeBounds("today", bad, NOW);
      expect(start.toISOString()).toBe("2026-07-28T00:00:00.000Z");
    }
  });

  it("produces a start strictly before end for every range", () => {
    for (const range of ["today", "month"] as const) {
      const { start, end } = resolveRangeBounds(range, 240, NOW);
      expect(start.getTime()).toBeLessThan(end.getTime());
    }
  });
});

describe("rollupBy", () => {
  it("sums cost and counts events per key, sorted by cost descending", () => {
    const rows = [
      { k: "a", c: 10 },
      { k: "b", c: 30 },
      { k: "a", c: 5 },
    ];
    expect(rollupBy(rows, (r) => r.k, (r) => r.c)).toEqual([
      { key: "b", costCents: 30, eventCount: 1 },
      { key: "a", costCents: 15, eventCount: 2 },
    ]);
  });

  it("breaks cost ties deterministically so the order is stable across calls", () => {
    const rows = [{ k: "z", c: 10 }, { k: "a", c: 10 }];
    const first = rollupBy(rows, (r) => r.k, (r) => r.c).map((b) => b.key);
    const second = rollupBy([...rows].reverse(), (r) => r.k, (r) => r.c).map((b) => b.key);
    expect(first).toEqual(["a", "z"]);
    expect(second).toEqual(first);
  });

  it("returns an empty array for no rows", () => {
    expect(rollupBy([], (r: { k: string }) => r.k, () => 0)).toEqual([]);
  });
});

describe("query-param parsers", () => {
  it("parseRange only ever yields a real range", () => {
    expect(parseRange("month")).toBe("month");
    expect(parseRange("today")).toBe("today");
    expect(parseRange("year")).toBe("today");
    expect(parseRange(undefined)).toBe("today");
  });

  it("parseIdParam rejects zero, negatives, and non-integers", () => {
    expect(parseIdParam("42")).toBe(42);
    expect(parseIdParam("0")).toBeNull();
    expect(parseIdParam("-1")).toBeNull();
    expect(parseIdParam("1.5")).toBeNull();
    expect(parseIdParam("abc")).toBeNull();
    expect(parseIdParam("")).toBeNull();
    expect(parseIdParam(undefined)).toBeNull();
  });

  it("parseBoundedInt clamps and falls back", () => {
    expect(parseBoundedInt("25", 10, 1, 100)).toBe(25);
    expect(parseBoundedInt("500", 10, 1, 100)).toBe(100);
    expect(parseBoundedInt("-3", 10, 1, 100)).toBe(1);
    expect(parseBoundedInt("nope", 10, 1, 100)).toBe(10);
  });

  it("parseDateParam rejects unparseable input rather than yielding an Invalid Date", () => {
    expect(parseDateParam("2026-07-28T00:00:00.000Z")?.toISOString())
      .toBe("2026-07-28T00:00:00.000Z");
    expect(parseDateParam("not-a-date")).toBeNull();
    expect(parseDateParam("")).toBeNull();
    expect(parseDateParam(42)).toBeNull();
  });
});
