/**
 * admin-signal-rules-category-pillar-469.test.ts
 *
 * Regression test for Git #469: category -> pillar assignment on new
 * signal_derivation_rules rows is now enforced server-side through
 * parseIntelligenceFields (see category-pillar-mapping.ts), not left to a
 * one-time SQL seed script nobody re-runs. Exercises the real route +
 * real category-pillar-mapping module (only db/logger/tenant-signals/
 * conflict-detector are mocked, mirroring admin-signal-rules-import.test.ts).
 *
 * Run with: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

process.env["DATABASE_URL"] = "postgres://test";
process.env["ADMIN_PASSWORD"] = "test-admin-pass";

const ADMIN_PASS = "test-admin-pass";

const { mockExecute, mockTransaction } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    execute: mockExecute,
    transaction: mockTransaction,
  },
  scriptRunResultsTable: {},
  engagementProjectsTable: {},
  usersTable: {},
}));

vi.mock("../middlewares/requireAuth", () => ({
  requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const auth = req.headers["authorization"] ?? "";
    if (auth === `Bearer ${ADMIN_PASS}`) return next();
    res.status(401).json({ error: "Unauthorized" });
  },
}));

vi.mock("../lib/logger", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock("../lib/tenant-signals", () => ({
  getAllSignalDefinitions: vi.fn().mockResolvedValue([]),
  getProjectSignalDefinitions: vi.fn().mockResolvedValue([]),
  getAdjustmentSignalDefinitions: vi.fn().mockResolvedValue([]),
  getBuiltinSignalKeys: vi.fn().mockResolvedValue(new Set()),
  computeTenantSignals: vi.fn().mockReturnValue({ firedSignals: new Set(), trace: [] }),
  projectMatchesSignals: vi.fn().mockReturnValue({ included: false }),
  getDisabledSignalKeys: vi.fn().mockResolvedValue(new Set()),
  SIGNAL_TREND_DIRECTIONS: ["up", "down", "flat"],
  SIGNAL_SEVERITIES: ["informational", "low", "medium", "high", "critical"],
  coerceDecayRate: (rows: unknown[]) => rows,
}));

vi.mock("../lib/signal-conflict-detector", () => ({
  detectRuleConflicts: vi.fn().mockReturnValue([]),
}));

let app: Express;
let insertedChunkValues: unknown[];

/** Flattens a drizzle-orm `sql` template's queryChunks down to the interpolated values (skips the raw-text chunk objects). */
function interpolatedValues(query: { queryChunks?: unknown[] }): unknown[] {
  return (query.queryChunks ?? []).filter((c) => typeof c !== "object" || c === null);
}

beforeEach(async () => {
  vi.clearAllMocks();
  insertedChunkValues = [];

  mockExecute.mockImplementation(async () => ({ rows: [{ id: 1 }], rowCount: 0 }));

  mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
    const tx = {
      execute: vi.fn(async (query: { queryChunks?: unknown[] }) => {
        insertedChunkValues = interpolatedValues(query);
        return { rows: [{ id: 9001 }], rowCount: 1 };
      }),
    };
    await cb(tx);
  });

  app = express();
  app.use(express.json());
  const { default: adminSignalRulesRouter } = await import("./admin-signal-rules");
  app.use(adminSignalRulesRouter);
});

const authHeader = { Authorization: `Bearer ${ADMIN_PASS}` };

function post(body: Record<string, unknown>) {
  return request(app).post("/admin/signal-rules").set(authHeader).send(body);
}

describe("POST /api/admin/signal-rules — category -> pillar (Git #469)", () => {
  it("derives pillar from a governed category and overrides a mismatched client-sent pillar", async () => {
    const res = await post({
      signalKey: "compliance:missing-labels",
      ruleType: "profile_key_truthy",
      sourceKey: "hasMissingLabels",
      category: "sensitivity-labels:not-applied",
      pillar: "governance", // deliberately wrong — the mapping must win
    });

    expect(res.status).toBe(201);
    expect(insertedChunkValues).toContain("compliance");
    expect(insertedChunkValues).not.toContain("governance");
  });

  it("rejects creation for the devices category with a clear, distinct error", async () => {
    const res = await post({
      signalKey: "devices:compliance-drift",
      ruleType: "profile_key_truthy",
      sourceKey: "hasDeviceDrift",
      category: "devices:compliance-drift",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/deliberate/i);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("rejects creation for a genuinely unrecognized category domain instead of defaulting to governance", async () => {
    const res = await post({
      signalKey: "mystery:new-check",
      ruleType: "profile_key_truthy",
      sourceKey: "hasMystery",
      category: "mystery:new-check",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not silently default/i);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("leaves an out-of-scope engine's category (e.g. crm.*) untouched", async () => {
    const res = await post({
      signalKey: "crm:strong-deal-fit",
      ruleType: "profile_key_truthy",
      sourceKey: "hasStrongDealFit",
      category: "crm:strong_deal_fit",
      pillar: "crm",
    });

    expect(res.status).toBe(201);
    expect(insertedChunkValues).toContain("crm");
  });
});
