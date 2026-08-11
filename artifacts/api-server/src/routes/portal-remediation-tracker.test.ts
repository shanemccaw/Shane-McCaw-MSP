/**
 * portal-remediation-tracker.test.ts — Git #730 (Phase A), widened in #731
 * (Phase B) for the real per-step action vocabulary.
 *
 * Three things are worth guarding here and they are all correctness rather
 * than plumbing:
 *
 *   1. THE STEP-ID CATALOGUE HAS NOT DRIFTED. The route holds "s1".."s30" only
 *      to reject writes for steps that do not exist; the real catalogue is
 *      msp-portal's `previewRemediationGuide.ts`. This test reads that file
 *      directly, so a step added, removed or renumbered there fails here rather
 *      than silently 400ing a real customer's tick.
 *   2. `completed_at` IS DERIVED, NEVER TAKEN FROM THE CLIENT, and un-ticking
 *      CLEARS it. A stale completion timestamp left behind by a withdrawn tick
 *      would be the platform quietly holding a claim the customer retracted.
 *   3. THE STATUS VOCABULARY HAS NOT DRIFTED EITHER. `lib/db`'s schema and
 *      msp-portal's `useRemediationTracker.ts` each hold their own copy of
 *      `REMEDIATION_TRACKER_STEP_STATUS` (msp-portal carries no dependency on
 *      `@workspace/db`), and this test reads both real files directly so the
 *      two cannot silently disagree about what a valid status is.
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
    REMEDIATION_TRACKER_STEP_STATUS: [
      "not_started",
      "completed",
      "already_handled",
      "not_applicable",
      "deferred",
      "shane_handles",
    ] as const,
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
import { REMEDIATION_TRACKER_STEP_STATUS } from "@workspace/db";

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

describe("the status vocabulary has not drifted between lib/db and msp-portal", () => {
  it("useRemediationTracker.ts's mirror is exactly lib/db's real REMEDIATION_TRACKER_STEP_STATUS", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));

    const schemaPath = path.resolve(here, "../../../../lib/db/src/schema/msp.ts");
    const schemaSource = readFileSync(schemaPath, "utf8");
    const schemaMatch = schemaSource.match(
      /export const REMEDIATION_TRACKER_STEP_STATUS = \[([\s\S]*?)\] as const;/,
    );
    expect(schemaMatch).not.toBeNull();
    const schemaValues = [...(schemaMatch?.[1] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1]);

    const hookPath = path.resolve(
      here,
      "../../../msp-portal/src/components/copilot-journey/useRemediationTracker.ts",
    );
    const hookSource = readFileSync(hookPath, "utf8");
    const hookMatch = hookSource.match(/export const REMEDIATION_TRACKER_STEP_STATUS = \[([\s\S]*?)\] as const;/);
    expect(hookMatch).not.toBeNull();
    const hookValues = [...(hookMatch?.[1] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1]);

    // Guards the guard: an empty extraction on either side would pass a
    // vacuous comparison.
    expect(schemaValues.length).toBeGreaterThan(0);
    expect(hookValues).toEqual(schemaValues);
    // And the route's own validation is fed from the same (mocked-here) export,
    // so pins it to the same list rather than trusting the mock in isolation.
    expect([...REMEDIATION_TRACKER_STEP_STATUS]).toEqual(schemaValues);
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

  it.each(["already_handled", "not_applicable", "deferred", "shane_handles"] as const)(
    "accepts the #731 action status %s and stores no completed_at for it",
    async (status) => {
      mockSelectResultsQueue = [[{ stepId: "s5", status, completedAt: null, updatedAt: new Date() }]];
      const res = await request(makeApp(CUSTOMER)).put("/api/portal/remediation-tracker/steps/s5").send({ status });

      expect(res.status).toBe(200);
      expect(mockInsertValues[0].status).toBe(status);
      // None of the four actioned statuses is a self-resolve: `completed_at`
      // stays null the same as `not_started`'s.
      expect(mockInsertValues[0].completedAt).toBeNull();
      expect(mockConflictSets[0].completedAt).toBeNull();
    },
  );
});
