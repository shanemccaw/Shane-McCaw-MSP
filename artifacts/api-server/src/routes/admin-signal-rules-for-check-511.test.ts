/**
 * admin-signal-rules-for-check-511.test.ts
 *
 * Regression tests for: GET /api/admin/signal-rules/for-check?checkKey=X — the
 * data source behind Simulator Studio's Endpoint Rules tab (#507).
 *
 * The bug (#511): `monitor_checks.key` and `signal_derivation_rules.signal_key`
 * are two different vocabularies that only sometimes coincide. #507's panel did
 * an exact `bySignal[check.key]` lookup, so a rule that READS a check via its
 * `sourceKey` while being NAMED under its own signal — the reported case,
 * `signal.adoption.email-activity-trend` reading `adoption:email-activity-trend`
 * — was invisible: the panel said "0 groups · 0 rules" for an endpoint the
 * Engine Trace showed a real firing threshold rule against.
 *
 * The real resolution runs here: only `@workspace/db` (the two admin SELECTs
 * plus the monitor_checks catalog read), auth and the logger are mocked, so
 * `computeRuleFedStatus` → `resolveOwningCheckKey` decides sourceKey ownership
 * exactly as it does for the Pillar Matrix and `check-fed`. Both item-count
 * storage conventions monitor-check-trace.ts documents are covered: a
 * `threshold` rule storing the BARE check key, and a `profile_key_*` rule
 * storing the full `<checkKey>__itemCount`.
 *
 * Run with: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

const ADMIN_PASS = "test-admin-pass";

// The @workspace/db mock keeps the REAL schema exports — `monitorChecksTable` is
// used as the dispatch sentinel in the db.select mock below — so lib/db's index
// evaluates, which hard-requires DATABASE_URL at module scope. vi.hoisted runs
// before the hoisted vi.mock factories (pg.Pool is lazy and never connects).
vi.hoisted(() => {
  process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";
  process.env["ADMIN_PASSWORD"] ??= "test-admin-pass";
});

const { mockExecute, mockSelect } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockSelect: vi.fn(),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: { execute: mockExecute, select: mockSelect, transaction: vi.fn() },
  };
});

vi.mock("../middlewares/requireAuth", () => ({
  requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.headers["authorization"] === `Bearer ${ADMIN_PASS}`) return next();
    res.status(401).json({ error: "Unauthorized" });
  },
}));

vi.mock("../lib/logger", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CHECK = "adoption:email-activity-trend";

/** The monitor_checks catalog `computeRuleFedStatus` resolves sourceKeys against. */
const CHECK_DEFINITIONS = [
  { key: CHECK, mapping: [], properties: [], requiresCustomerScript: false },
  { key: "identity:ca-policy-count", mapping: [], properties: [], requiresCustomerScript: false },
  {
    key: "governance:oversharing",
    mapping: [{ sourceField: "count", targetField: "oversharedSiteCount" }],
    properties: [],
    requiresCustomerScript: false,
  },
];

const RULE_ROWS = [
  // 1. THE #511 CASE: named under its own signal, reads the check by bare key
  //    (threshold's storage convention — evaluateRule appends __itemCount).
  { id: 1, signalKey: "signal.adoption.email-activity-trend", groupId: null, ruleType: "threshold", sourceKey: CHECK, compareValue: "10", description: null, sortOrder: 0 },
  // 2. The original, still-valid case: named after the check itself.
  { id: 2, signalKey: CHECK, groupId: null, ruleType: "profile_key_truthy", sourceKey: "emailActivityDeclining", compareValue: null, description: null, sortOrder: 1 },
  // 3. A different check entirely — must not leak in.
  { id: 3, signalKey: "signal.identity.ca", groupId: null, ruleType: "threshold", sourceKey: "identity:ca-policy-count", compareValue: "1", description: null, sortOrder: 0 },
  // 4. The SECOND item-count storage convention: a profile_key_* rule storing
  //    the full synthetic key, in a group of its own.
  { id: 4, signalKey: "signal.adoption.email-activity-trend", groupId: 10, ruleType: "profile_key_gt", sourceKey: `${CHECK}__itemCount`, compareValue: "0", description: null, sortOrder: 2 },
  // 5. A mapping targetField belonging to another check.
  { id: 5, signalKey: "signal.governance.oversharing", groupId: 12, ruleType: "profile_key_gt", sourceKey: "oversharedSiteCount", compareValue: "0", description: null, sortOrder: 0 },
];

const GROUP_ROWS = [
  // Pulled in because rule 4 (matched via sourceKey) belongs to it.
  { id: 10, signalKey: "signal.adoption.email-activity-trend", logic: "OR", label: "Declining email activity", sortOrder: 0 },
  // Pulled in by its OWN signalKey despite having no rules yet.
  { id: 11, signalKey: CHECK, logic: "AND", label: "Empty group", sortOrder: 1 },
  // Another signal's group — must not leak in.
  { id: 12, signalKey: "signal.governance.oversharing", logic: "OR", label: "Oversharing", sortOrder: 0 },
];

/** Mirrors admin-signal-rules-import.test.ts's drizzle SQL text extractor. */
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
let ruleRows: typeof RULE_ROWS;
let groupRows: typeof GROUP_ROWS;

beforeEach(async () => {
  vi.clearAllMocks();
  ruleRows = [...RULE_ROWS];
  groupRows = [...GROUP_ROWS];

  mockExecute.mockImplementation(async (query: unknown) => {
    const text = extractSqlText(query);
    if (text.includes("FROM signal_derivation_rules")) return { rows: ruleRows, rowCount: ruleRows.length };
    if (text.includes("FROM signal_rule_groups")) return { rows: groupRows, rowCount: groupRows.length };
    return { rows: [], rowCount: 0 };
  });

  const { monitorChecksTable } = await import("@workspace/db");
  mockSelect.mockImplementation((() => ({
    from: (table: unknown) => {
      if (table === monitorChecksTable) {
        return Object.assign(Promise.resolve(CHECK_DEFINITIONS), { where: async () => CHECK_DEFINITIONS });
      }
      throw new Error("for-check test: unexpected table in db.select mock");
    },
  })) as never);

  app = express();
  app.use(express.json());
  const { default: adminSignalRulesRouter } = await import("./admin-signal-rules");
  app.use(adminSignalRulesRouter);
});

const authHeader = { Authorization: `Bearer ${ADMIN_PASS}` };

interface MatchedRuleBody { id: number; signalKey: string; matchedVia: "signalKey" | "sourceKey" }

async function forCheck(checkKey: string) {
  return request(app)
    .get(`/admin/signal-rules/for-check?checkKey=${encodeURIComponent(checkKey)}`)
    .set(authHeader);
}

describe("GET /api/admin/signal-rules/for-check — #511 sourceKey discovery", () => {
  it("finds the reported rule: a threshold rule named under a DIFFERENT signal that reads this check", async () => {
    const res = await forCheck(CHECK);

    expect(res.status).toBe(200);
    const rules = res.body.rules as MatchedRuleBody[];
    const reported = rules.find(r => r.id === 1);

    expect(reported).toBeDefined();
    // Matched by what it READS, and reported under its own real name — the
    // panel labels it from this, rather than silently showing it as the check's.
    expect(reported!.matchedVia).toBe("sourceKey");
    expect(reported!.signalKey).toBe("signal.adoption.email-activity-trend");

    // The pre-#511 lookup this replaces (`bySignal[check.key]`) would have
    // returned ONLY rule 2 — hence the reported "0 groups · 0 rules" once the
    // exact-name rule didn't exist either.
    expect(RULE_ROWS.filter(r => r.signalKey === CHECK).map(r => r.id)).toEqual([2]);
  });

  it("returns the UNION of signalKey-matched and sourceKey-matched rules, and nothing else", async () => {
    const res = await forCheck(CHECK);

    const rules = res.body.rules as MatchedRuleBody[];
    expect(rules.map(r => r.id).sort()).toEqual([1, 2, 4]);
    expect(rules.find(r => r.id === 2)!.matchedVia).toBe("signalKey");
    // Second item-count storage convention: the full `<checkKey>__itemCount`
    // sourceKey resolves back to the same check.
    expect(rules.find(r => r.id === 4)!.matchedVia).toBe("sourceKey");
    // Another check's rule and another signal's mapping-targetField rule.
    expect(rules.some(r => r.id === 3 || r.id === 5)).toBe(false);
  });

  it("includes groups referenced by sourceKey-matched rules AND rule-less groups owned by the check key", async () => {
    const res = await forCheck(CHECK);

    const groups = res.body.groups as Array<{ id: number }>;
    // 10: referenced by rule 4 (matched via sourceKey) — its AND/OR context
    // must render even though the group's own signalKey isn't the check key.
    // 11: no rules at all, but owns the check key directly.
    expect(groups.map(g => g.id).sort()).toEqual([10, 11]);
  });

  it("labels a rule as signalKey when the two names already agree (nothing to clarify)", async () => {
    // Same rule id, now ALSO reading the check by bare key — both criteria hold.
    ruleRows = ruleRows.map(r => (r.id === 2 ? { ...r, ruleType: "threshold", sourceKey: CHECK } : r));

    const res = await forCheck(CHECK);
    const rules = res.body.rules as MatchedRuleBody[];

    expect(rules.filter(r => r.id === 2)).toHaveLength(1); // matched once, not twice
    expect(rules.find(r => r.id === 2)!.matchedVia).toBe("signalKey");
  });

  it("returns empty arrays (not an error) for a real check no rule reads or is named after", async () => {
    const res = await forCheck("identity:ca-policy-count");

    expect(res.status).toBe(200);
    // Rule 3 DOES read this one — prove the honest-empty case with a check
    // nothing references at all.
    const bare = await forCheck("governance:oversharing");
    expect(bare.status).toBe(200);
    expect((bare.body.rules as unknown[]).map(r => (r as MatchedRuleBody).id)).toEqual([5]);

    const orphan = await request(app)
      .get("/admin/signal-rules/for-check?checkKey=nothing:reads-this")
      .set(authHeader);
    expect(orphan.status).toBe(200);
    expect(orphan.body.rules).toEqual([]);
    expect(orphan.body.groups).toEqual([]);
  });

  it("400s on a missing checkKey and 401s without admin auth", async () => {
    const missing = await request(app).get("/admin/signal-rules/for-check").set(authHeader);
    expect(missing.status).toBe(400);

    const unauth = await request(app).get(`/admin/signal-rules/for-check?checkKey=${CHECK}`);
    expect(unauth.status).toBe(401);
  });
});
