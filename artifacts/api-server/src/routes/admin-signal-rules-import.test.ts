/**
 * admin-signal-rules-import.test.ts
 *
 * Regression test for: POST /api/admin/signal-rules/import never persisting rows.
 * Root cause: signal_key/rule_type/source_key are NOT NULL columns on
 * signal_derivation_rules; a single malformed row in the import payload threw
 * mid-transaction, rolling back the entire import (zero rows written) with a
 * generic 500 "Import failed" and no indication of which row/field was bad —
 * indistinguishable from a silent no-op.
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
  SIGNAL_SEVERITIES: ["low", "medium", "high", "critical"],
  coerceDecayRate: (rows: unknown[]) => rows,
}));

vi.mock("../lib/signal-conflict-detector", () => ({
  detectRuleConflicts: vi.fn().mockReturnValue([]),
}));

let app: Express;
let insertedRuleRows: Array<Record<string, unknown>>;

beforeEach(async () => {
  vi.clearAllMocks();
  insertedRuleRows = [];

  // db.execute is used for the pre-import snapshot (getAllRules/getAllGroups
  // SELECTs + signal_rule_versions INSERT). Any RETURNING id needs a row back.
  mockExecute.mockImplementation(async () => ({ rows: [{ id: 1 }], rowCount: 0 }));

  mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
    const tx = {
      execute: vi.fn(async () => ({ rows: [{ id: 9001 }], rowCount: 1 })),
    };
    await cb(tx);
  });

  app = express();
  app.use(express.json());
  const { default: adminSignalRulesRouter } = await import("./admin-signal-rules");
  app.use(adminSignalRulesRouter);
});

const authHeader = { Authorization: `Bearer ${ADMIN_PASS}` };

describe("POST /api/admin/signal-rules/import", () => {
  it("rejects and writes nothing when a rule is missing sourceKey — no more silent no-op", async () => {
    const res = await request(app)
      .post("/admin/signal-rules/import")
      .set(authHeader)
      .send({
        version: 1,
        signals: [
          {
            key: "adj:test-signal",
            rules: [
              { id: 1001, ruleType: "profile_key_truthy", description: "missing sourceKey", weight: 0, pricingImpact: 0 },
            ],
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation/i);
    expect(res.body.details).toEqual(expect.arrayContaining([expect.stringContaining("missing sourceKey")]));
    // Transaction must never have been entered — zero writes attempted.
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("rejects and writes nothing when a rule is missing signalKey", async () => {
    const res = await request(app)
      .post("/admin/signal-rules/import")
      .set(authHeader)
      .send({
        version: 1,
        rules: [
          { ruleType: "profile_key_truthy", sourceKey: "hasFoo", weight: 0, pricingImpact: 0 },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(expect.arrayContaining([expect.stringContaining("missing signalKey")]));
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("accepts a well-formed payload and actually persists rules via the transaction", async () => {
    const res = await request(app)
      .post("/admin/signal-rules/import")
      .set(authHeader)
      .send({
        version: 1,
        signals: [
          {
            key: "adj:real-signal",
            rules: [
              { id: 1001, ruleType: "profile_key_truthy", sourceKey: "hasFoo", description: "real rule", weight: 0, pricingImpact: 0 },
              { id: 1002, ruleType: "profile_key_falsy", sourceKey: "hasBar", description: "real rule 2", weight: 0, pricingImpact: 0 },
            ],
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(2);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });
});
