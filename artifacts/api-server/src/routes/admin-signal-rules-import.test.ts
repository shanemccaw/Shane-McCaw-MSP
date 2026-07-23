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

// ── Restore truncation regression ─────────────────────────────────────────────
// Regression test for: POST /admin/signal-rules/versions/:id/restore restoring
// the right ROW COUNT from a snapshot but writing only the base columns
// (signal_key, logic, label, sort_order, msp_id / + rule identity columns),
// silently resetting every intelligence field (weight, securityImpact,
// crmFitContribution, …) to column defaults even though the snapshot JSON
// carried real values for all of them.

// Drizzle SQL object helpers — see leads-stats.test.ts for the chunk shapes.
function extractSqlText(node: unknown): string {
  if (node === null || node === undefined || typeof node !== "object") return "";
  const obj = node as Record<string, unknown>;
  if ("queryChunks" in obj && Array.isArray(obj.queryChunks)) {
    return (obj.queryChunks as unknown[]).map(extractSqlText).join("");
  }
  if ("value" in obj && Array.isArray(obj.value)) return (obj.value as string[]).join("");
  return "";
}
function extractSqlParams(node: unknown): unknown[] {
  if (node === null || node === undefined) return [];
  if (typeof node !== "object") return [node];
  const obj = node as Record<string, unknown>;
  if ("queryChunks" in obj && Array.isArray(obj.queryChunks)) {
    return (obj.queryChunks as unknown[]).flatMap(extractSqlParams);
  }
  if ("value" in obj && Array.isArray(obj.value)) return []; // raw SQL text chunk
  return [obj];
}

describe("POST /api/admin/signal-rules/versions/:id/restore", () => {
  it("writes the snapshot's intelligence field values, not column defaults", async () => {
    // Snapshot shaped exactly like getAllRules()/getAllGroups() output —
    // camelCase keys, full intelligence field set, real non-zero values
    // (mirrors the confirmed live snapshot: weight 88, securityImpact 84,
    // crmFitContribution 15).
    const snapshot = {
      groups: [{
        id: 42, signalKey: "sig:real", logic: "AND", label: "Real Group", sortOrder: 3,
        priority: 7, weight: 88, pricingImpact: 12, priorityScoreContribution: 9, pricingValueContribution: 4,
        governanceImpact: 21, securityImpact: 84, complianceImpact: 33, adoptionImpact: 5, copilotImpact: 6,
        architectureImpact: 11, trendValue: 2, trendDirection: "up", decayRate: 0.25, ttlDays: 30, confidence: 90,
        severity: "high", category: "security:dlp_gap", pillar: "security",
        crmFitContribution: 15, crmPainContribution: 8, crmMaturityContribution: 3, crmIntentContribution: 2, crmUrgencyContribution: 1,
      }],
      rules: [{
        id: 1001, signalKey: "sig:real", groupId: 42, ruleType: "profile_key_truthy", sourceKey: "hasFoo",
        compareValue: null, description: "real rule", sortOrder: 1,
        priority: 6, weight: 88, pricingImpact: 10, priorityScoreContribution: 7, pricingValueContribution: 3,
        governanceImpact: 20, securityImpact: 84, complianceImpact: 30, adoptionImpact: 4, copilotImpact: 5,
        architectureImpact: 9, trendValue: 1, trendDirection: "down", decayRate: 0.5, ttlDays: 14, confidence: 80,
        severity: "critical", category: "security:mfa_gap", pillar: "security",
        crmFitContribution: 15, crmPainContribution: 6, crmMaturityContribution: 2, crmIntentContribution: 1, crmUrgencyContribution: 4,
      }],
    };

    // db.execute: the version SELECT must return the snapshot; everything else
    // (pre-restore backup's getAllRules/getAllGroups + version INSERT) keeps the
    // generic { id } row.
    mockExecute.mockImplementation(async (q: unknown) => {
      const text = extractSqlText(q);
      if (text.includes("FROM signal_rule_versions") && text.includes("SELECT snapshot")) {
        return { rows: [{ snapshot }], rowCount: 1 };
      }
      if (text.includes("FROM signal_derivation_rules") || text.includes("FROM signal_rule_groups")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [{ id: 1 }], rowCount: 1 };
    });

    const txQueries: unknown[] = [];
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      const tx = {
        execute: vi.fn(async (q: unknown) => {
          txQueries.push(q);
          return { rows: [{ id: 9001 }], rowCount: 1 };
        }),
      };
      await cb(tx);
    });

    const res = await request(app)
      .post("/admin/signal-rules/versions/5/restore")
      .set(authHeader)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.restored).toBe(1);

    const groupInsert = txQueries.find(q => extractSqlText(q).includes("INSERT INTO signal_rule_groups"));
    const ruleInsert = txQueries.find(q => extractSqlText(q).includes("INSERT INTO signal_derivation_rules"));
    expect(groupInsert).toBeDefined();
    expect(ruleInsert).toBeDefined();

    // Column lists must include the full intelligence set (snake_case).
    for (const col of [
      "priority", "weight", "pricing_impact", "priority_score_contribution", "pricing_value_contribution",
      "governance_impact", "security_impact", "compliance_impact", "adoption_impact", "copilot_impact",
      "architecture_impact", "trend_value", "trend_direction", "decay_rate", "ttl_days", "confidence",
      "severity", "category", "pillar", "crm_fit_contribution", "crm_pain_contribution",
      "crm_maturity_contribution", "crm_intent_contribution", "crm_urgency_contribution",
    ]) {
      expect(extractSqlText(groupInsert)).toContain(col);
      expect(extractSqlText(ruleInsert)).toContain(col);
    }

    // The snapshot's real values must appear as bound params — the exact values
    // that were silently dropped by the truncated INSERTs.
    const groupParams = extractSqlParams(groupInsert);
    expect(groupParams).toEqual(expect.arrayContaining([88, 84, 15, 21, 0.25, "up", "high", "security:dlp_gap"]));
    const ruleParams = extractSqlParams(ruleInsert);
    expect(ruleParams).toEqual(expect.arrayContaining([88, 84, 15, 20, 0.5, "down", "critical", "security:mfa_gap"]));
  });

  it("restores pre-intelligence-era snapshots (missing fields) with inert defaults", async () => {
    const snapshot = {
      groups: [{ id: 7, signalKey: "sig:old", logic: "OR", label: "Old Group", sortOrder: 0 }],
      rules: [{ id: 2001, signalKey: "sig:old", groupId: 7, ruleType: "threshold", sourceKey: "someCheck", compareValue: "3", description: null, sortOrder: 0 }],
    };
    mockExecute.mockImplementation(async (q: unknown) => {
      const text = extractSqlText(q);
      if (text.includes("FROM signal_rule_versions") && text.includes("SELECT snapshot")) {
        return { rows: [{ snapshot }], rowCount: 1 };
      }
      if (text.includes("FROM signal_derivation_rules") || text.includes("FROM signal_rule_groups")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [{ id: 1 }], rowCount: 1 };
    });
    const txQueries: unknown[] = [];
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      const tx = {
        execute: vi.fn(async (q: unknown) => { txQueries.push(q); return { rows: [{ id: 9001 }], rowCount: 1 }; }),
      };
      await cb(tx);
    });

    const res = await request(app)
      .post("/admin/signal-rules/versions/6/restore")
      .set(authHeader)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.restored).toBe(1);

    const ruleInsert = txQueries.find(q => extractSqlText(q).includes("INSERT INTO signal_derivation_rules"));
    const ruleParams = extractSqlParams(ruleInsert);
    // Inert defaults, never undefined/NULL for the NOT NULL intelligence columns.
    expect(ruleParams).toEqual(expect.arrayContaining([0, "flat", "low"]));
    expect(ruleParams).not.toEqual(expect.arrayContaining([undefined]));
  });
});
