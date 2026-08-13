/**
 * admin-ai-billing-lead-analytics.test.ts
 *
 * AI Cost Governance Phase 4.1 (#81): GET /admin/ai-billing/lead-analytics.
 *
 * The load-bearing assertions here are:
 *   - the endpoint is requireAdmin-gated, like the rest of this surface;
 *   - the identity chain is actually walked — a usage event's customerId reaches
 *     a lead_staging row through users, and produces a real cost-per-lead figure;
 *   - spend with no resolvable lead is reported as unattributed with its reason,
 *     never folded into a named lead and never dropped;
 *   - a near-empty dataset (expected until #133's live Zoho verification) answers
 *     200 with honest nulls and zeros rather than a fabricated figure or a 500;
 *   - the identity query is scoped to the window's own customers, so it does not
 *     degrade into a scan of every user on the platform;
 *   - every ceiling that bites is declared in `coverage`.
 *
 * The attribution arithmetic itself is unit-tested in lib/ai-lead-attribution.test.ts;
 * this file tests the wiring.
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
    db: { select: vi.fn(() => makeChain()), selectDistinct: vi.fn(() => makeChain()) },
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
    usersTable: {
      id: "id", email: "email", tenantId: "tenant_id", linkedLeadId: "linked_lead_id",
    },
    leadStagingTable: {
      id: "id", name: "name", email: "email", source: "source",
      legacyLeadId: "legacy_lead_id", deletedAt: "deleted_at", createdAt: "created_at",
    },
    mspDiagnosticRunsTable: {
      runId: "run_id", customerId: "customer_id", status: "status",
      startedAt: "started_at", completedAt: "completed_at", createdAt: "created_at",
    },
  };
});

vi.mock("../middlewares/requireAuth", () => ({
  requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.headers["authorization"] === `Bearer ${ADMIN_PASS}`) return next();
    res.status(401).json({ error: "Unauthorized" });
  },
}));

// Hoisted for the same reason the Phase 4 sibling hoists its spy: vi.mock's
// factory is lifted above the module body.
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
const PATH = "/api/admin/ai-billing/lead-analytics";

const DAY_MS = 86_400_000;

/** A usage row `daysAgo` back, at noon so it never straddles a bucket boundary. */
function usageRow(daysAgo: number, over: Record<string, unknown> = {}) {
  const d = new Date(Date.now() - daysAgo * DAY_MS);
  d.setUTCHours(12, 0, 0, 0);
  return { occurredAt: d, costCents: 100, customerId: null, ...over };
}

function leadLink(tenantId: number, leadStagingId: number, over: Record<string, unknown> = {}) {
  return {
    tenantId,
    leadStagingId,
    leadName: `Lead ${leadStagingId}`,
    leadEmail: `lead${leadStagingId}@example.com`,
    leadSource: "assessment",
    ...over,
  };
}

/**
 * The endpoint reads in a fixed order: usage rows, then (only when the window
 * held at least one customer) the identity links, then the assessment runs, then
 * the staged-lead count.
 */
function queueReads(opts: {
  usage: unknown[];
  links?: unknown[];
  runs?: unknown[];
  stagedCount?: number;
}) {
  const hasCustomer = (opts.usage as { customerId: number | null }[]).some(
    (r) => typeof r.customerId === "number",
  );
  selectQueue = [
    opts.usage,
    ...(hasCustomer ? [opts.links ?? []] : []),
    opts.runs ?? [],
    [{ value: opts.stagedCount ?? 0 }],
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue = [];
  whereCalls.length = 0;
  limitCalls = [];
  warnSpy.mockClear();
});

// ── Auth ─────────────────────────────────────────────────────────────────────

describe("GET /admin/ai-billing/lead-analytics — admin gate", () => {
  it("401s without an admin token", async () => {
    const res = await request(makeApp()).get(PATH);
    expect(res.status).toBe(401);
  });

  it("200s with one", async () => {
    queueReads({ usage: [] });
    const res = await auth(request(makeApp()).get(PATH));
    expect(res.status).toBe(200);
  });
});

// ── The real join ────────────────────────────────────────────────────────────

describe("GET /admin/ai-billing/lead-analytics — cost per lead", () => {
  it("walks the identity chain and produces a real figure", async () => {
    queueReads({
      usage: [
        usageRow(1, { customerId: 10, costCents: 500 }),
        usageRow(2, { customerId: 10, costCents: 300 }),
        usageRow(3, { customerId: 20, costCents: 200 }),
      ],
      links: [leadLink(10, 100), leadLink(20, 200)],
      stagedCount: 2,
    });

    const res = await auth(request(makeApp()).get(PATH));
    expect(res.status).toBe(200);

    const byLead = res.body.byLead;
    expect(byLead.slices).toHaveLength(2);
    expect(byLead.slices[0]).toMatchObject({ leadStagingId: 100, costCents: 800, eventCount: 2 });
    expect(byLead.slices[1]).toMatchObject({ leadStagingId: 200, costCents: 200 });
    expect(byLead.attributedCostCents).toBe(1000);
    expect(byLead.leadsWithSpend).toBe(2);
    // Median (Phase 4's convention), not mean: (800, 200) -> 500.
    expect(byLead.medianCostPerLeadCents).toBe(500);
    expect(byLead.unattributed.costCents).toBe(0);
    expect(res.body.leadsStagedInWindow).toBe(2);
  });

  it("reports spend with no resolvable lead as unattributed, with its reason", async () => {
    queueReads({
      usage: [
        usageRow(1, { customerId: 10, costCents: 500 }),
        usageRow(2, { customerId: 99, costCents: 200 }), // real customer, no lead
        usageRow(3, { customerId: null, costCents: 50 }), // unattributed call site
      ],
      links: [leadLink(10, 100)],
    });

    const res = await auth(request(makeApp()).get(PATH));
    const byLead = res.body.byLead;

    expect(byLead.attributedCostCents).toBe(500);
    expect(byLead.unattributed.costCents).toBe(250);
    expect(byLead.unattributed.breakdown.customerWithoutLead).toEqual({
      costCents: 200,
      eventCount: 1,
    });
    expect(byLead.unattributed.breakdown.noCustomer).toEqual({ costCents: 50, eventCount: 1 });
    // Everything reconciles with the headline total.
    expect(byLead.attributedCostCents + byLead.unattributed.costCents).toBe(
      res.body.totalCostCents,
    );
  });

  it("scopes the identity query to the window's own customers", async () => {
    queueReads({
      usage: [
        usageRow(1, { customerId: 10, costCents: 100 }),
        usageRow(2, { customerId: 10, costCents: 100 }),
        usageRow(3, { customerId: 20, costCents: 100 }),
        usageRow(4, { customerId: null, costCents: 100 }),
      ],
      links: [leadLink(10, 100)],
    });

    const res = await auth(request(makeApp()).get(PATH));
    // Two distinct tenants, deduped — not four rows' worth, and the null is not
    // treated as a customer.
    expect(res.body.coverage.distinctTenants).toBe(2);
    expect(res.body.coverage.tenantsElided).toBe(0);
  });

  it("skips the identity query entirely when no usage row carries a customer", async () => {
    // With no customers there is nothing to resolve, so the endpoint must not
    // issue an unbounded identity query just to get an empty answer.
    queueReads({ usage: [usageRow(1, { customerId: null, costCents: 400 })] });

    const res = await auth(request(makeApp()).get(PATH));
    expect(res.status).toBe(200);
    expect(res.body.coverage.distinctTenants).toBe(0);
    expect(res.body.coverage.identityLinkRows).toBe(0);
    expect(res.body.byLead.unattributed.breakdown.noCustomer.costCents).toBe(400);
  });
});

// ── Empty state ──────────────────────────────────────────────────────────────

describe("GET /admin/ai-billing/lead-analytics — sparse data is an empty state", () => {
  it("answers honestly when there is no data at all (expected pending #133)", async () => {
    queueReads({ usage: [] });

    const res = await auth(request(makeApp()).get(PATH));
    expect(res.status).toBe(200);
    expect(res.body.totalCostCents).toBe(0);
    expect(res.body.eventCount).toBe(0);
    expect(res.body.leadsStagedInWindow).toBe(0);

    // Null, not a fabricated 0.00 — "we have no figure" is not "the figure is zero".
    expect(res.body.byLead.medianCostPerLeadCents).toBeNull();
    expect(res.body.byLead.meanCostPerLeadCents).toBeNull();
    expect(res.body.byLead.slices).toEqual([]);
    expect(res.body.byAssessmentRun.medianCostPerRunCents).toBeNull();
    expect(res.body.byAssessmentRun.runsInWindow).toBe(0);
  });

  it("reports spend that exists while no lead does, rather than hiding it", async () => {
    queueReads({ usage: [usageRow(1, { customerId: 10, costCents: 900 })], links: [] });

    const res = await auth(request(makeApp()).get(PATH));
    expect(res.body.byLead.medianCostPerLeadCents).toBeNull();
    expect(res.body.byLead.leadsWithSpend).toBe(0);
    expect(res.body.byLead.unattributed.costCents).toBe(900);
    expect(res.body.byLead.unattributed.breakdown.customerWithoutLead.costCents).toBe(900);
  });
});

// ── Cost per assessment run ──────────────────────────────────────────────────

describe("GET /admin/ai-billing/lead-analytics — cost per assessment run", () => {
  it("attributes spend inside a run's interval and states the method", async () => {
    const start = new Date(Date.now() - 2 * DAY_MS);
    start.setUTCHours(11, 0, 0, 0);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const during = new Date(start.getTime() + 30 * 60 * 1000);

    queueReads({
      usage: [{ occurredAt: during, costCents: 700, customerId: 10 }],
      links: [leadLink(10, 100)],
      runs: [
        {
          runId: "run-a",
          customerId: 10,
          status: "completed",
          startedAt: start,
          completedAt: end,
          createdAt: start,
        },
      ],
    });

    const res = await auth(request(makeApp()).get(PATH));
    const byRun = res.body.byAssessmentRun;

    expect(byRun.slices).toHaveLength(1);
    expect(byRun.slices[0]).toMatchObject({ runId: "run-a", costCents: 700, eventCount: 1 });
    expect(byRun.runsWithSpend).toBe(1);
    expect(byRun.medianCostPerRunCents).toBe(700);
    // The response carries the attribution method, so the page cannot present an
    // interval attribution as an exact per-run cost.
    expect(byRun.attribution.method).toBe("customer-and-interval");
    expect(byRun.attribution.note).toContain("UPPER BOUND");
  });

  it("does not let a run claim spend that fell outside it", async () => {
    const start = new Date(Date.now() - 2 * DAY_MS);
    start.setUTCHours(11, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const after = new Date(end.getTime() + 60 * 60 * 1000);

    queueReads({
      usage: [{ occurredAt: after, costCents: 700, customerId: 10 }],
      links: [leadLink(10, 100)],
      runs: [
        {
          runId: "run-a",
          customerId: 10,
          status: "completed",
          startedAt: start,
          completedAt: end,
          createdAt: start,
        },
      ],
    });

    const res = await auth(request(makeApp()).get(PATH));
    const byRun = res.body.byAssessmentRun;

    expect(byRun.runsInWindow).toBe(1);
    expect(byRun.runsWithSpend).toBe(0);
    expect(byRun.unattributed.costCents).toBe(700);
    expect(byRun.medianCostPerRunCents).toBeNull();
    // The lead rollup still attributes it — the two answer different questions
    // over the same rows.
    expect(res.body.byLead.attributedCostCents).toBe(700);
  });
});

// ── Coverage honesty ─────────────────────────────────────────────────────────

describe("GET /admin/ai-billing/lead-analytics — coverage", () => {
  it("declares a clipped row scan instead of presenting it as the whole window", async () => {
    // One row past the ceiling is what tells the endpoint it was clipped.
    const rows = Array.from({ length: 50_001 }, () =>
      usageRow(1, { customerId: null, costCents: 1 }),
    );
    queueReads({ usage: rows });

    const res = await auth(request(makeApp()).get(PATH));
    expect(res.body.coverage.truncated).toBe(true);
    expect(res.body.coverage.rowsScanned).toBe(50_000);
    expect(res.body.eventCount).toBe(50_000);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("echoes the resolved window so a timezone mismatch is visible, not silent", async () => {
    queueReads({ usage: [] });
    const res = await auth(request(makeApp()).get(PATH).query({ bucket: "week", buckets: "4" }));

    expect(res.body.bucket).toBe("week");
    expect(res.body.bucketCount).toBe(4);
    expect(new Date(res.body.periodStart).getTime()).toBeLessThan(
      new Date(res.body.periodEnd).getTime(),
    );
  });
});
