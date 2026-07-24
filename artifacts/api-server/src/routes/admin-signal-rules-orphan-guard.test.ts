/**
 * admin-signal-rules-orphan-guard.test.ts
 *
 * Regression tests for: POST /api/admin/signal-rules creating a rule against a
 * signal_key with NO custom_signals catalog entry.
 *
 * Such a rule evaluates and "fires" in the simulator/trace (rule evaluation is
 * naming-convention-agnostic by design) but is INVISIBLE to real dashboard
 * scoring, which only aggregates rules whose signal_key is a registered
 * custom_signals catalog signal. The bug let the Simulator's free-text key field
 * create these silent orphans with no warning.
 *
 * The fix enforces, SERVER-SIDE (so a direct API call cannot bypass the UI):
 *   • an existing catalogued signal → rule inserts normally;
 *   • an uncatalogued key with no newSignal data → 422, nothing written;
 *   • an uncatalogued key WITH newSignal { label, description } → the catalog
 *     row and the rule are created together, atomically, in one transaction.
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

// No conflicts in these tests — the guard being tested is orthogonal to conflict
// detection, so keep it inert.
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
// Whether the catalog SELECT should report the signal as already existing.
let signalInCatalog: boolean;
// Every SQL statement run INSIDE the transaction, in order (text only).
let txStatements: string[];

beforeEach(async () => {
  vi.clearAllMocks();
  signalInCatalog = false;
  txStatements = [];

  // db.execute serves three top-level reads/writes in the create path:
  //   1. the catalog membership check (SELECT 1 FROM custom_signals …)
  //   2. getAllRules()'s SELECT … FROM signal_derivation_rules (conflict pre-check)
  //   3. appendAuditLog()'s INSERT INTO signal_rule_audit_log (post-commit)
  mockExecute.mockImplementation(async (query: unknown) => {
    const text = extractSqlText(query);
    if (text.includes("custom_signals")) {
      // The orphan guard's existence probe.
      return { rows: signalInCatalog ? [{ exists: 1 }] : [], rowCount: signalInCatalog ? 1 : 0 };
    }
    // getAllRules / audit-log inserts / anything else: empty is fine.
    return { rows: [], rowCount: 0 };
  });

  // db.transaction runs the atomic (custom_signals?) + rule INSERT. The rule
  // INSERT ... RETURNING must hand back a row carrying at least `id`.
  mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      execute: vi.fn(async (query: unknown) => {
        const text = extractSqlText(query);
        txStatements.push(text);
        if (text.includes("INSERT INTO signal_derivation_rules")) {
          return { rows: [{ id: 4242, signalKey: "x", ruleType: "profile_key_truthy", sourceKey: "hasFoo" }], rowCount: 1 };
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

const baseRule = {
  ruleType: "profile_key_truthy",
  sourceKey: "hasFoo",
  description: "test rule",
};

describe("POST /api/admin/signal-rules — orphaned-signal guard", () => {
  it("creates a rule normally against an EXISTING catalogued signal (no newSignal needed)", async () => {
    signalInCatalog = true;

    const res = await request(app)
      .post("/admin/signal-rules")
      .set(authHeader)
      .send({ signalKey: "signal.security.mfa-gap", ...baseRule });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(4242);
    // The rule was inserted, and NO new custom_signals row was created for an
    // already-catalogued signal.
    expect(txStatements.some(s => s.includes("INSERT INTO signal_derivation_rules"))).toBe(true);
    expect(txStatements.some(s => s.includes("INSERT INTO custom_signals"))).toBe(false);
  });

  it("REJECTS (422) an uncatalogued signal_key with no newSignal data — no silent orphan, nothing written", async () => {
    signalInCatalog = false;

    const res = await request(app)
      .post("/admin/signal-rules")
      .set(authHeader)
      .send({ signalKey: "governance:id_count", ...baseRule });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("SIGNAL_NOT_IN_CATALOG");
    expect(res.body.error).toMatch(/catalog/i);
    // The transaction must never have been entered — zero writes attempted.
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("REJECTS (422) an uncatalogued signal_key when newSignal is missing a label or description", async () => {
    signalInCatalog = false;

    const res = await request(app)
      .post("/admin/signal-rules")
      .set(authHeader)
      .send({ signalKey: "signal.custom.new-thing", ...baseRule, newSignal: { label: "Only a label" } });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("NEW_SIGNAL_INCOMPLETE");
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("creates the catalog row AND the rule ATOMICALLY when newSignal { label, description } is provided", async () => {
    signalInCatalog = false;

    const res = await request(app)
      .post("/admin/signal-rules")
      .set(authHeader)
      .send({
        signalKey: "signal.custom.new-thing",
        ...baseRule,
        newSignal: { label: "New Thing", description: "A genuinely new signal for coverage." },
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(4242);
    // Both writes happened, in the SAME transaction, catalog row FIRST so the
    // rule can never be committed without its backing signal.
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    const catalogIdx = txStatements.findIndex(s => s.includes("INSERT INTO custom_signals"));
    const ruleIdx = txStatements.findIndex(s => s.includes("INSERT INTO signal_derivation_rules"));
    expect(catalogIdx).toBeGreaterThanOrEqual(0);
    expect(ruleIdx).toBeGreaterThanOrEqual(0);
    expect(catalogIdx).toBeLessThan(ruleIdx);
  });

  it("blocks a DIRECT API call (no UI) that names an uncatalogued signal — proving enforcement is server-side", async () => {
    // This request mimics curl-ing the endpoint directly, exactly as the
    // Simulator's free-text field used to POST. The server must reject it on
    // its own, with no client-side help.
    signalInCatalog = false;

    const res = await request(app)
      .post("/admin/signal-rules")
      .set(authHeader)
      .send({ signalKey: "totally.made.up.key", ruleType: "profile_key_truthy", sourceKey: "whatever" });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("SIGNAL_NOT_IN_CATALOG");
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("still enforces the base required-field validation (missing sourceKey → 400) before the catalog check", async () => {
    const res = await request(app)
      .post("/admin/signal-rules")
      .set(authHeader)
      .send({ signalKey: "signal.security.mfa-gap", ruleType: "profile_key_truthy" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
