/**
 * `admin-dlq.ts` — the platform-wide dead-letter routes.
 *
 * The behaviour worth pinning is the replay gate. Only the portal workflow
 * engine writes a `workflowKey` into a parked payload, and `replayDlqItem` is
 * the only replay path that exists, so every other producer (`msp-jobs`,
 * `zoho-batch-drain`, `engagebay-batch-drain`) parks something nothing knows
 * how to re-run. A Retry that reaches `replayDlqItem` with one of those is a
 * thrown error dressed up as an action, which is why the route refuses first
 * and the list ships `replayable` per row.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── db mock ──────────────────────────────────────────────────────────────────
// A chainable, thenable stub: every builder method returns the same object and
// awaiting it yields the next queued rowset. That covers all four shapes this
// route builds (…where().limit(), …where() awaited directly, and the two the
// count query and lib/dlq's update use) without a shape-per-call mock.
const queued = vi.hoisted(() => [] as unknown[][]);

const dbChain = vi.hoisted(() => {
  const chain: Record<string, unknown> = {};
  for (const method of [
    "select", "from", "leftJoin", "where", "orderBy", "limit",
    "insert", "values", "update", "set", "delete", "returning",
  ]) {
    chain[method] = (..._args: unknown[]) => chain;
  }
  chain["then"] = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(queued.shift() ?? []).then(resolve, reject);
  return chain;
});

vi.mock("@workspace/db", () => ({
  db: dbChain,
  pool: { query: vi.fn() },
  mspDlqStoreTable: {
    id: "id", dlqId: "dlq_id", sourceEventId: "source_event_id", eventType: "event_type",
    payload: "payload", errorMessage: "error_message", errorStack: "error_stack",
    attemptCount: "attempt_count", lastAttemptAt: "last_attempt_at", resolvedAt: "resolved_at",
    resolution: "resolution", mspId: "msp_id", customerId: "customer_id", createdAt: "created_at",
  },
  tenantsTable: { id: "id", customerName: "customer_name" },
}));

vi.mock("../middlewares/requireAuth", () => ({
  requireAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

const replayDlqItem = vi.hoisted(() => vi.fn());
vi.mock("../lib/portal-workflow-engine", () => ({ replayDlqItem }));

const resolveDlqItem = vi.hoisted(() => vi.fn());
vi.mock("../lib/dlq", () => ({ resolveDlqItem }));

import adminDlqRouter from "./admin-dlq";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(adminDlqRouter);
  return app;
}

/** Queue the rowsets the route will await, in order. */
function stub(...rowsets: unknown[][]) {
  queued.length = 0;
  queued.push(...rowsets);
}

const workflowItem = {
  id: 1,
  dlqId: "d-1",
  eventType: "portal_wf.run.failed:onboarding",
  payload: { workflowKey: "onboarding", runId: "r-9", inputPayload: {} },
  errorMessage: "Step 3 threw",
  attemptCount: 3,
  lastAttemptAt: "2026-08-08T09:04:00.000Z",
  resolvedAt: null,
  customerName: "Northwind Traders",
};

const jobItem = {
  id: 2,
  dlqId: "d-2",
  eventType: "graph.sync.users",
  payload: { customerId: 4, scope: "users" },
  errorMessage: "GraphError 429 throttled",
  attemptCount: 5,
  lastAttemptAt: "2026-08-08T08:47:00.000Z",
  resolvedAt: null,
  customerName: "Adventure Works",
};

beforeEach(() => {
  vi.clearAllMocks();
  queued.length = 0;
});

describe("GET /api/admin/dlq", () => {
  it("marks only workflow-sourced items replayable, and reports the real queue length", async () => {
    stub([workflowItem, jobItem], [{ n: 14 }]);

    const res = await request(buildApp()).get("/admin/dlq");

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].replayable).toBe(true);
    expect(res.body.items[1].replayable).toBe(false);
    // 14, not 2 — a page must never read as the whole queue.
    expect(res.body.unresolvedTotal).toBe(14);
  });

  it("caps limit at 500 so a caller cannot ask for the whole table", async () => {
    stub([], [{ n: 0 }]);
    const res = await request(buildApp()).get("/admin/dlq?limit=100000");
    expect(res.body.limit).toBe(500);
  });

  it("treats a payload with a blank workflowKey as not replayable", async () => {
    stub([{ ...workflowItem, payload: { workflowKey: "" } }], [{ n: 1 }]);
    const res = await request(buildApp()).get("/admin/dlq");
    expect(res.body.items[0].replayable).toBe(false);
  });
});

describe("POST /api/admin/dlq/:dlqId/replay", () => {
  it("404s when the item does not exist", async () => {
    stub([]);
    const res = await request(buildApp()).post("/admin/dlq/nope/replay");
    expect(res.status).toBe(404);
    expect(replayDlqItem).not.toHaveBeenCalled();
  });

  it("409s when the item has already been dealt with", async () => {
    stub([{ ...workflowItem, resolvedAt: "2026-08-07T00:00:00.000Z" }]);
    const res = await request(buildApp()).post("/admin/dlq/d-1/replay");
    expect(res.status).toBe(409);
    expect(replayDlqItem).not.toHaveBeenCalled();
  });

  it("refuses an item nothing knows how to re-run, without calling the replay path", async () => {
    stub([jobItem]);
    const res = await request(buildApp()).post("/admin/dlq/d-2/replay");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nothing to re-run/i);
    expect(replayDlqItem).not.toHaveBeenCalled();
  });

  it("replays a workflow item and returns the new run id", async () => {
    stub([workflowItem]);
    replayDlqItem.mockResolvedValue("run-77");
    const res = await request(buildApp()).post("/admin/dlq/d-1/replay");
    expect(res.status).toBe(200);
    expect(replayDlqItem).toHaveBeenCalledWith("d-1");
    expect(res.body).toMatchObject({ ok: true, dlqId: "d-1", newRunId: "run-77" });
  });
});

describe("PATCH /api/admin/dlq/:dlqId", () => {
  it('rejects "replayed" — only the replay route may claim a job actually ran', async () => {
    const res = await request(buildApp()).patch("/admin/dlq/d-1").send({ resolution: "replayed" });
    expect(res.status).toBe(400);
    expect(resolveDlqItem).not.toHaveBeenCalled();
  });

  it("404s when the item is missing or already resolved", async () => {
    stub([]);
    const res = await request(buildApp()).patch("/admin/dlq/d-1").send({ resolution: "manual" });
    expect(res.status).toBe(404);
    expect(resolveDlqItem).not.toHaveBeenCalled();
  });

  it("marks an unresolved item handled", async () => {
    stub([{ id: 1, resolvedAt: null }]);
    resolveDlqItem.mockResolvedValue(true);
    const res = await request(buildApp()).patch("/admin/dlq/d-1").send({ resolution: "manual" });
    expect(res.status).toBe(200);
    expect(resolveDlqItem).toHaveBeenCalledWith("d-1", { resolution: "manual" });
  });
});
