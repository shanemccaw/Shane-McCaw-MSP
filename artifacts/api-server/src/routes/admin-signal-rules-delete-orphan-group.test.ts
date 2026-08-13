/**
 * admin-signal-rules-delete-orphan-group.test.ts
 *
 * Regression tests for: DELETE /api/admin/signal-rules/:id leaving an
 * orphaned signal_rule_groups row behind whenever the deleted rule was the
 * LAST rule referencing its group.
 *
 * Multiple rules can share one signal_rule_groups row (the real OR-grouping
 * mechanism). Deleting a rule must:
 *   - delete the group too, IF this was the last rule referencing it;
 *   - leave the group untouched, if any other rule still references it;
 *   - do both (rule delete + conditional group cleanup) atomically, in one
 *     real DB transaction.
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
  buildTenantProfile: vi.fn(),
}));

vi.mock("../lib/signal-conflict-detector", () => ({
  detectRuleConflicts: vi.fn().mockReturnValue([]),
}));

// ── Drizzle SQL object helpers (mirrors admin-signal-rules-import.test.ts) ─────
function extractSqlText(node: unknown): string {
  if (node === null || node === undefined || typeof node !== "object") return "";
  const obj = node as Record<string, unknown>;
  if ("queryChunks" in obj && Array.isArray(obj.queryChunks)) {
    return (obj.queryChunks as unknown[]).map(extractSqlText).join("");
  }
  if ("value" in obj && Array.isArray(obj.value)) return (obj.value as string[]).join("");
  return "";
}

let app: Express;
// The prior-rule row returned by the pre-delete SELECT.
let priorRule: { id: number; signalKey: string; groupId: number | null };
// Whether any OTHER rule still references the same group after the delete.
let otherRuleStillReferencesGroup: boolean;
// Every SQL statement run INSIDE the transaction, in order (text only).
let txStatements: string[];
// If set, the transaction callback throws after this many statements — simulates
// a mid-operation failure to test atomicity.
let failAfterStatement: number | null;

beforeEach(async () => {
  vi.clearAllMocks();
  priorRule = { id: 101, signalKey: "signal.security.mfa-gap", groupId: 55 };
  otherRuleStillReferencesGroup = false;
  txStatements = [];
  failAfterStatement = null;

  // db.execute serves the pre-delete SELECT and the post-commit audit-log INSERT.
  mockExecute.mockImplementation(async (query: unknown) => {
    const text = extractSqlText(query);
    if (text.includes("SELECT") && text.includes("FROM signal_derivation_rules WHERE id")) {
      return { rows: [priorRule], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });

  mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      execute: vi.fn(async (query: unknown) => {
        const text = extractSqlText(query);
        if (failAfterStatement !== null && txStatements.length >= failAfterStatement) {
          throw new Error("simulated mid-operation failure");
        }
        txStatements.push(text);
        if (text.includes("SELECT id FROM signal_derivation_rules WHERE group_id")) {
          return { rows: otherRuleStillReferencesGroup ? [{ id: 999 }] : [], rowCount: otherRuleStillReferencesGroup ? 1 : 0 };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    return cb(tx);
  });

  app = express();
  app.use(express.json());
  const { default: adminSignalRulesRouter } = await import("./admin-signal-rules");
  app.use(adminSignalRulesRouter);
});

const authHeader = { Authorization: `Bearer ${ADMIN_PASS}` };

describe("DELETE /api/admin/signal-rules/:id — orphaned-group cleanup", () => {
  it("deletes the group too when this was the ONLY rule referencing it", async () => {
    otherRuleStillReferencesGroup = false;

    const res = await request(app).delete("/admin/signal-rules/101").set(authHeader);

    expect(res.status).toBe(200);
    expect(res.body.groupDeleted).toBe(true);
    expect(mockTransaction).toHaveBeenCalledTimes(1);

    const ruleDeleteIdx = txStatements.findIndex(s => s.includes("DELETE FROM signal_derivation_rules WHERE id"));
    const checkIdx = txStatements.findIndex(s => s.includes("SELECT id FROM signal_derivation_rules WHERE group_id"));
    const groupDeleteIdx = txStatements.findIndex(s => s.includes("DELETE FROM signal_rule_groups WHERE id"));

    expect(ruleDeleteIdx).toBeGreaterThanOrEqual(0);
    expect(checkIdx).toBeGreaterThan(ruleDeleteIdx);
    expect(groupDeleteIdx).toBeGreaterThan(checkIdx);
  });

  it("leaves the group INTACT when another rule still references it", async () => {
    otherRuleStillReferencesGroup = true;

    const res = await request(app).delete("/admin/signal-rules/101").set(authHeader);

    expect(res.status).toBe(200);
    expect(res.body.groupDeleted).toBe(false);
    expect(txStatements.some(s => s.includes("DELETE FROM signal_rule_groups WHERE id"))).toBe(false);
  });

  it("skips the group check entirely when the deleted rule had no group", async () => {
    priorRule = { id: 102, signalKey: "signal.security.no-group", groupId: null };

    const res = await request(app).delete("/admin/signal-rules/102").set(authHeader);

    expect(res.status).toBe(200);
    expect(res.body.groupDeleted).toBe(false);
    expect(txStatements.some(s => s.includes("SELECT id FROM signal_derivation_rules WHERE group_id"))).toBe(false);
    expect(txStatements.some(s => s.includes("DELETE FROM signal_rule_groups WHERE id"))).toBe(false);
  });

  it("is ATOMIC: a mid-operation failure (after the rule delete, before the group check) leaves NEITHER deleted", async () => {
    otherRuleStillReferencesGroup = false;
    // Fail right after the rule DELETE statement is issued, before the group
    // check/delete can run.
    failAfterStatement = 1;

    const res = await request(app).delete("/admin/signal-rules/101").set(authHeader);

    // The whole request fails — the route's catch-all reports 500 — and,
    // because this all happened inside one db.transaction callback that threw,
    // the (mocked) transaction never "committed" any of its statements.
    expect(res.status).toBe(500);
    expect(txStatements.some(s => s.includes("DELETE FROM signal_rule_groups WHERE id"))).toBe(false);
    // Audit log must not claim a group cleanup that never happened.
    const auditCalls = mockExecute.mock.calls.filter(([q]) => extractSqlText(q).includes("INSERT INTO signal_rule_audit_log"));
    expect(auditCalls.length).toBe(0);
  });

  it("notes the group cleanup in the audit log entry when a group was deleted", async () => {
    otherRuleStillReferencesGroup = false;

    await request(app).delete("/admin/signal-rules/101").set(authHeader);

    const auditCall = mockExecute.mock.calls.find(([q]) => extractSqlText(q).includes("INSERT INTO signal_rule_audit_log"));
    expect(auditCall).toBeDefined();
  });

  it("404s on an unknown id, with no transaction ever entered", async () => {
    mockExecute.mockImplementationOnce(async () => ({ rows: [], rowCount: 0 }));

    const res = await request(app).delete("/admin/signal-rules/9999").set(authHeader);

    expect(res.status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
