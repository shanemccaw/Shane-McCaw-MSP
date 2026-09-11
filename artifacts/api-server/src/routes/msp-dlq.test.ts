/**
 * `msp-dlq.ts` — the MSP-console-scoped dead-letter routes.
 *
 * Git #3446: neither the single-item nor bulk replay route precheck
 * `payload.workflowKey` before calling `replayDlqItem`, which throws for
 * every producer except the portal workflow engine's own failure path
 * (`msp-jobs`, `zoho-batch-drain`, `engagebay-batch-drain` all park raw
 * job/batch payloads). Live local Postgres: 30 unresolved rows in this
 * MSP's queue, 0 with a `workflowKey` — every Replay click failed with a
 * bare 500. This pins the `isReplayable()` guard ported from `admin-dlq.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── db mock ──────────────────────────────────────────────────────────────────
// Same chainable/thenable stub pattern as admin-dlq.test.ts.
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
  mspDlqStoreTable: {
    id: "id", dlqId: "dlq_id", sourceEventId: "source_event_id", eventType: "event_type",
    payload: "payload", errorMessage: "error_message", errorStack: "error_stack",
    attemptCount: "attempt_count", lastAttemptAt: "last_attempt_at", resolvedAt: "resolved_at",
    resolution: "resolution", mspId: "msp_id", customerId: "customer_id", createdAt: "created_at",
  },
  tenantsTable: { id: "id", tenantId: "tenant_id", customerName: "customer_name" },
}));

vi.mock("../middlewares/requireAuth.ts", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as any).user = { mspId: 1 };
    next();
  },
  requireCapability: (_capability: string) =>
    (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

const replayDlqItem = vi.hoisted(() => vi.fn());
vi.mock("../lib/portal-workflow-engine.ts", () => ({ replayDlqItem }));

import mspDlqRouter from "./msp-dlq.ts";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(mspDlqRouter);
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
  mspId: 1,
  customerId: 4,
};

// Representative of the real live rows — a zoho job-queue failure, no
// workflowKey at all.
const zohoJobItem = {
  id: 2,
  dlqId: "d-2",
  eventType: "zoho_upsert_lead",
  payload: { customerId: 4, leadId: "L-88" },
  errorMessage: "Zoho 429 throttled",
  attemptCount: 5,
  lastAttemptAt: "2026-08-08T08:47:00.000Z",
  resolvedAt: null,
  mspId: 1,
  customerId: 4,
};

beforeEach(() => {
  vi.clearAllMocks();
  queued.length = 0;
});

describe("GET /msp/dlq", () => {
  it("marks only workflow-sourced items replayable", async () => {
    stub([workflowItem, zohoJobItem]);

    const res = await request(buildApp()).get("/msp/dlq");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].replayable).toBe(true);
    expect(res.body[1].replayable).toBe(false);
  });
});

describe("POST /msp/dlq/:dlqId/replay", () => {
  it("404s when the item does not exist", async () => {
    stub([]);
    const res = await request(buildApp()).post("/msp/dlq/nope/replay");
    expect(res.status).toBe(404);
    expect(replayDlqItem).not.toHaveBeenCalled();
  });

  it("409s when the item has already been dealt with", async () => {
    stub([{ ...workflowItem, resolvedAt: "2026-08-07T00:00:00.000Z" }]);
    const res = await request(buildApp()).post("/msp/dlq/d-1/replay");
    expect(res.status).toBe(409);
    expect(replayDlqItem).not.toHaveBeenCalled();
  });

  it("refuses a non-workflow item with an actionable 400, without calling the replay path", async () => {
    stub([zohoJobItem]);
    const res = await request(buildApp()).post("/msp/dlq/d-2/replay");
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/nothing to re-run/i);
    expect(replayDlqItem).not.toHaveBeenCalled();
  });

  it("replays a workflow item and returns the new run id", async () => {
    stub([workflowItem]);
    replayDlqItem.mockResolvedValue("run-77");
    const res = await request(buildApp()).post("/msp/dlq/d-1/replay");
    expect(res.status).toBe(200);
    expect(replayDlqItem).toHaveBeenCalledWith("d-1");
    expect(res.body).toMatchObject({ ok: true, dlqId: "d-1", newRunId: "run-77" });
  });
});

describe("POST /msp/dlq/bulk-replay", () => {
  it("reports non-replayable items as failed results without calling the replay path, alongside a real replay", async () => {
    stub([workflowItem, zohoJobItem]);
    replayDlqItem.mockResolvedValue("run-78");

    const res = await request(buildApp())
      .post("/msp/dlq/bulk-replay")
      .send({ dlqIds: ["d-1", "d-2"] });

    expect(res.status).toBe(200);
    expect(replayDlqItem).toHaveBeenCalledTimes(1);
    expect(replayDlqItem).toHaveBeenCalledWith("d-1");
    expect(res.body.replayedCount).toBe(1);
    const byId = Object.fromEntries(res.body.results.map((r: any) => [r.dlqId, r]));
    expect(byId["d-1"]).toMatchObject({ success: true, newRunId: "run-78" });
    expect(byId["d-2"].success).toBe(false);
    expect(byId["d-2"].error).toMatch(/nothing to re-run/i);
  });

  it("mounts at /msp/dlq/bulk-replay, not /api/msp/dlq/bulk-replay (Git #3445)", async () => {
    stub([]);
    const res = await request(buildApp())
      .post("/api/msp/dlq/bulk-replay")
      .send({ dlqIds: [] });
    expect(res.status).toBe(404);
  });
});
