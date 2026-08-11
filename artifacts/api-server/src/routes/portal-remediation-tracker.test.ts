/**
 * portal-remediation-tracker.test.ts — Git #730, Phase A of epic #647.
 *
 * Two things are worth guarding here and they are both correctness rather than
 * plumbing:
 *
 *   1. THE STEP-ID CATALOGUE HAS NOT DRIFTED. The route holds "s1".."s30" only
 *      to reject writes for steps that do not exist; the real catalogue is
 *      msp-portal's `previewRemediationGuide.ts`. This test reads that file
 *      directly, so a step added, removed or renumbered there fails here rather
 *      than silently 400ing a real customer's tick.
 *   2. `completed_at` IS DERIVED, NEVER TAKEN FROM THE CLIENT, and un-ticking
 *      CLEARS it. A stale completion timestamp left behind by a withdrawn tick
 *      would be the platform quietly holding a claim the customer retracted.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Captures every insert().values(...) / onConflictDoUpdate(...) payload the
// route builds, which is where the completed_at derivation actually lives.
let mockInsertValues: any[] = [];
let mockConflictSets: any[] = [];
let mockSelectResultsQueue: any[][] = [];

vi.mock("@workspace/db", () => {
  const makeSelectChain = () => {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      limit: () => chain,
      then: (onfulfilled: any, onrejected?: any) =>
        Promise.resolve(mockSelectResultsQueue.shift() ?? []).then(onfulfilled, onrejected),
    };
    return chain;
  };

  const insertChain: any = {
    values: (v: any) => {
      mockInsertValues.push(v);
      return insertChain;
    },
    onConflictDoUpdate: (cfg: { target: unknown; set: Record<string, unknown> }) => {
      mockConflictSets.push(cfg.set);
      return insertChain;
    },
    then: (onfulfilled: any) => Promise.resolve({}).then(onfulfilled),
  };

  return {
    db: {
      select: vi.fn(() => makeSelectChain()),
      insert: vi.fn(() => insertChain),
    },
    remediationTrackerStepsTable: {
      customerId: "customer_id",
      stepId: "step_id",
      status: "status",
      completedAt: "completed_at",
      updatedByUserId: "updated_by_user_id",
      updatedAt: "updated_at",
    },
    REMEDIATION_TRACKER_STEP_STATUS: ["not_started", "completed"] as const,
  };
});

// requireRole is exercised elsewhere; here it is stubbed so the tests can drive
// the handler's own customerId resolution directly.
vi.mock("../middlewares/requireAuth", () => ({
  requireRole: () => (_req: any, _res: any, next: () => void) => next(),
  requireAuth: (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock("../lib/logger", () => {
  const child = vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child }));
  return { logger: { child, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

import router, { REMEDIATION_TRACKER_STEP_IDS } from "./portal-remediation-tracker";

function makeApp(user: Record<string, unknown> | null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (user) (req as any).user = user;
    next();
  });
  app.use("/api", router);
  return app;
}

const CUSTOMER = { id: 7, customerId: 42, role: "client" };

beforeEach(() => {
  mockInsertValues = [];
  mockConflictSets = [];
  mockSelectResultsQueue = [];
});

describe("the route's step ids still match the guide's own catalogue", () => {
  it("is exactly the ids in previewRemediationGuide.ts, in its order", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const guidePath = path.resolve(
      here,
      "../../../msp-portal/src/components/copilot-journey/previewRemediationGuide.ts",
    );
    const source = readFileSync(guidePath, "utf8");
    const catalogueIds = [...source.matchAll(/^ {4}id: "(s\d+)",\r?$/gm)].map((m) => m[1]);

    // Guards the guard: if the regex ever stops matching the file's shape this
    // would silently pass on an empty list.
    expect(catalogueIds.length).toBeGreaterThan(0);
    expect(catalogueIds).toEqual([...REMEDIATION_TRACKER_STEP_IDS]);
  });
});

describe("GET /api/portal/remediation-tracker", () => {
  it("403s a token with no customer identity", async () => {
    const res = await request(makeApp({ id: 1, role: "admin" })).get("/api/portal/remediation-tracker");
    expect(res.status).toBe(403);
  });

  it("returns an empty list for a customer who has never ticked anything", async () => {
    mockSelectResultsQueue = [[]];
    const res = await request(makeApp(CUSTOMER)).get("/api/portal/remediation-tracker");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ steps: [] });
  });

  it("serves stored rows and drops any id the guide no longer holds", async () => {
    const when = new Date("2026-08-10T09:00:00.000Z");
    mockSelectResultsQueue = [
      [
        { stepId: "s1", status: "completed", completedAt: when, updatedAt: when },
        { stepId: "s99", status: "completed", completedAt: when, updatedAt: when },
      ],
    ];
    const res = await request(makeApp(CUSTOMER)).get("/api/portal/remediation-tracker");
    expect(res.status).toBe(200);
    expect(res.body.steps).toHaveLength(1);
    expect(res.body.steps[0]).toEqual({
      stepId: "s1",
      status: "completed",
      completedAt: when.toISOString(),
      updatedAt: when.toISOString(),
    });
  });
});

describe("PUT /api/portal/remediation-tracker/steps/:stepId", () => {
  it("rejects a step id the guide does not hold", async () => {
    const res = await request(makeApp(CUSTOMER))
      .put("/api/portal/remediation-tracker/steps/s31")
      .send({ status: "completed" });
    expect(res.status).toBe(400);
    expect(mockInsertValues).toHaveLength(0);
  });

  it("rejects a status outside the stored vocabulary", async () => {
    const res = await request(makeApp(CUSTOMER))
      .put("/api/portal/remediation-tracker/steps/s3")
      .send({ status: "self_resolve" });
    expect(res.status).toBe(400);
    expect(mockInsertValues).toHaveLength(0);
  });

  it("stamps completed_at from the server on a tick, and records who did it", async () => {
    mockSelectResultsQueue = [[{ stepId: "s3", status: "completed", completedAt: new Date(), updatedAt: new Date() }]];
    const res = await request(makeApp(CUSTOMER))
      .put("/api/portal/remediation-tracker/steps/s3")
      // A client-supplied completedAt must be ignored entirely.
      .send({ status: "completed", completedAt: "1999-01-01T00:00:00.000Z" });

    expect(res.status).toBe(200);
    expect(mockInsertValues).toHaveLength(1);
    expect(mockInsertValues[0].customerId).toBe(42);
    expect(mockInsertValues[0].stepId).toBe("s3");
    expect(mockInsertValues[0].updatedByUserId).toBe(7);
    expect(mockInsertValues[0].completedAt).toBeInstanceOf(Date);
    expect(mockInsertValues[0].completedAt.getFullYear()).not.toBe(1999);
    expect(mockConflictSets[0].completedAt).toBeInstanceOf(Date);
  });

  it("clears completed_at when a step is un-ticked", async () => {
    mockSelectResultsQueue = [[{ stepId: "s3", status: "not_started", completedAt: null, updatedAt: new Date() }]];
    const res = await request(makeApp(CUSTOMER))
      .put("/api/portal/remediation-tracker/steps/s3")
      .send({ status: "not_started" });

    expect(res.status).toBe(200);
    expect(mockInsertValues[0].completedAt).toBeNull();
    // The upsert branch matters more than the insert branch: an existing row is
    // the case where a stale timestamp could survive.
    expect(mockConflictSets[0].completedAt).toBeNull();
    expect(res.body.step.completedAt).toBeNull();
  });
});
