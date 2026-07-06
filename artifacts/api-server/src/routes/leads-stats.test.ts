/**
 * Tests for GET /api/leads/stats — verifies that archived leads are excluded
 * from all four stat counts (total, newThisWeek, fromContactForm, fromLeadMagnet).
 *
 * Approach:
 *  - mock.module() stubs @workspace/db so no real DB connection is opened.
 *  - The mock db.select().from().where() chain:
 *    a) captures every WHERE condition passed to it (stored in capturedConditions)
 *    b) returns a controlled response queue simulating post-filter DB results
 *  - capturedConditions are inspected after each request to assert the archived
 *    exclusion predicate ("archived" as a param value) is present in all 4 queries.
 *    This catches regressions where ne(status, "archived") is accidentally removed.
 *  - mock.module() stubs requireAdmin as a pass-through (no auth needed).
 *  - All other heavy dependencies (mailer, audit, pdf, lead-scorer, etc.) are
 *    stubbed so the module loads without side-effects.
 *  - The real router from leads.ts is mounted in a lightweight Express server.
 *
 * NOTE: Mock specifiers must exactly match the import specifiers in leads.ts
 * (which now uses explicit .ts extensions on all relative imports).
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */
import { describe, it, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ── Condition inspection ──────────────────────────────────────────────────────
// Drizzle SQL objects have a `queryChunks` array whose elements can be:
//   - Plain primitives (string, number, boolean): these ARE the parameter values
//     e.g. "archived", "contact_form" — stored directly, no wrapper object
//   - { value: Array<string> }: a StringChunk containing raw SQL text
//     e.g. { value: [" <> "] }, { value: ["("] } — skip these, they are SQL operators
//   - Nested SQL objects { queryChunks: [...] }: recurse into them
//   - null / undefined: undefined column references — skip
//
// extractQueryParamValues() collects all plain primitive values from the tree.
// If ne(leadsTable.status, "archived") is in the WHERE clause, "archived" will
// appear in the result.  Removing that predicate makes the assertion below fail.

function extractQueryParamValues(node: unknown): unknown[] {
  // null / undefined in queryChunks = undefined column reference — skip
  if (node === null || node === undefined) return [];

  // Plain primitive (string, number, boolean) = parameter value — collect
  if (typeof node !== "object") return [node];

  const obj = node as Record<string, unknown>;

  // Drizzle SQL object { queryChunks: [...] }: recurse
  if ("queryChunks" in obj && Array.isArray(obj.queryChunks)) {
    const values: unknown[] = [];
    for (const chunk of obj.queryChunks) {
      values.push(...extractQueryParamValues(chunk));
    }
    return values;
  }

  // StringChunk { value: string[] }: raw SQL text fragment (operators, parens) — skip
  if ("value" in obj && Array.isArray(obj.value)) return [];

  // Anything else (Date, etc.) = a non-string param value — collect as-is
  return [obj];
}

// ── Response queue + condition capture ────────────────────────────────────────
// The stats route makes exactly 4 sequential COUNT queries in this order:
//   [0] total active leads             (ne status "archived")
//   [1] active leads created this week (ne archived + gte createdAt weekAgo)
//   [2] active contact_form leads      (ne archived + eq source "contact_form")
//   [3] active lead_magnet leads       (ne archived + eq source "lead_magnet")
//
// Each entry in responseQueue is [{ count: number }] — the shape drizzle returns.
let responseQueue: Array<[{ count: number }]> = [];
let capturedConditions: unknown[] = [];

// ── Soft-delete inflation-aware mode ──────────────────────────────────────────
// When softDeleteMode is true the mock ignores the responseQueue and instead
// simulates a specific dataset to detect whether the stats endpoint excludes
// soft-deleted leads.  See the "soft-delete regression guard" describe block
// below for the full scenario and fixture counts.
let softDeleteMode = false;

// ── Soft-delete fixture dataset ───────────────────────────────────────────────
// 12 leads in total:
//   6 truly active (status != "archived", deletedAt IS NULL)
//   3 archived    (status = "archived", excluded by current ne() predicate)
//   3 soft-deleted (hypothetically have deletedAt IS NOT NULL; status is active)
//
// Breakdown by query:
//   total:        without IS NULL → 9 (inflated)    with IS NULL → 6 (correct)
//   newThisWeek:  without IS NULL → 3 (inflated)    with IS NULL → 2 (correct)
//   contact_form: without IS NULL → 6 (inflated)    with IS NULL → 5 (correct)
//   lead_magnet:  without IS NULL → 3 (inflated)    with IS NULL → 1 (correct)
const SOFT_DELETE_INFLATED = { total: 9, week: 3, contact: 6, magnet: 3 };
const SOFT_DELETE_CORRECT  = { total: 6, week: 2, contact: 5, magnet: 1 };

function makeMockDb() {
  return {
    select: (_cols: unknown) => ({
      from: (_table: unknown) => ({
        where: async (condition: unknown) => {
          capturedConditions.push(condition);

          if (softDeleteMode) {
            // Inspect the WHERE clause structurally to decide which counts to return.
            // extractSqlOperators() reads Drizzle StringChunks for comparison operator
            // text.  isNull(leadsTable.deletedAt) emits "IS NULL" as a StringChunk, so
            // this is the correct (and only) way to detect a soft-delete exclusion.
            const ops = extractSqlOperators(condition);
            const params = extractQueryParamValues(condition);
            const hasSoftDeleteExclusion = ops.includes("IS NULL");
            const bucket = hasSoftDeleteExclusion
              ? SOFT_DELETE_CORRECT
              : SOFT_DELETE_INFLATED;

            // Distinguish the 4 queries by their WHERE params / operators:
            //  contact_form query: params includes "contact_form"
            //  lead_magnet query:  params includes "lead_magnet"
            //  newThisWeek query:  ops includes ">=" (gte createdAt weekAgo)
            //  total query:        none of the above
            if (params.includes("contact_form")) return [{ count: bucket.contact }];
            if (params.includes("lead_magnet"))  return [{ count: bucket.magnet }];
            if (ops.includes(">="))               return [{ count: bucket.week }];
            return [{ count: bucket.total }];
          }

          const next = responseQueue.shift();
          return next ?? [{ count: 0 }];
        },
      }),
    }),
    insert: () => ({ values: async () => [] }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
    delete: () => ({ where: async () => [] }),
  };
}

// ── Register mocks BEFORE the route module is dynamically imported ─────────────
mock.module("@workspace/db", {
  namedExports: {
    db: makeMockDb(),
    leadsTable: { deletedAt: {} },
    emailsTable: {},
    servicesTable: {},
    quizLeadsTable: {},
    leadQualificationsTable: {},
    kanbanTasksTable: {},
    opportunityTasksTable: {},
    opportunitiesTable: {},
    projectsTable: {},
    notificationsTable: {},
    usersTable: {},
  },
});

mock.module("../middlewares/requireAuth.ts", {
  namedExports: {
    requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
    requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  },
});

const noop = () => {};
const noopLogger = {
  info: noop, warn: noop, error: noop, debug: noop,
  fatal: noop, trace: noop, child: () => noopLogger,
};
mock.module("../lib/logger.ts", {
  namedExports: { logger: noopLogger },
});

mock.module("../lib/web-push.ts", {
  namedExports: { sendWebPushToAdmins: async () => {} },
});

mock.module("../lib/mailer.ts", {
  namedExports: {
    sendEmailOrThrow: async () => {},
    sendEmail: async () => {},
    sendEmailFromTemplate: async () => {},
    getEmailTemplateOrFallback: async () => ({ subject: "", html: "" }),
    sendEmailWithAttachment: async () => {},
    brandedEmail: () => ({ subject: "", html: "" }),
    contactInquiryNotificationEmail: () => ({ subject: "", html: "" }),
    serviceOverviewConfirmationEmail: () => ({ subject: "", html: "" }),
    serviceOverviewLeadNotificationEmail: () => ({ subject: "", html: "" }),
  },
});

mock.module("../lib/audit.ts", {
  namedExports: { createAuditLog: async () => {} },
});

mock.module("../lib/service-overview-pdf.ts", {
  namedExports: { generateServiceOverviewPdf: async () => Buffer.from("") },
});

mock.module("../lib/lead-scorer.ts", {
  namedExports: {
    scoreLead: () => ({ score: 0, stage: "Lead" }),
    determineNextStep: () => "Follow up",
  },
});

mock.module("../lib/derive-quiz-signals.ts", {
  namedExports: {
    deriveSignalsFromQuiz: () => ({}),
    loadQuizPainConfig: async () => ({}),
  },
});

// ── Dynamically import the REAL route module AFTER mocks are registered ───────
const { default: leadsRouter } = await import("./leads.ts");

// ── Build a minimal Express app around the real router ────────────────────────
const { default: express } = await import("express");
const app = express();
app.use(express.json());
app.use("/api", leadsRouter);

// ── Start / stop a test HTTP server ──────────────────────────────────────────
let server: http.Server;
let baseUrl: string;

before(
  () =>
    new Promise<void>((resolve) => {
      server = http.createServer(app);
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    }),
);

after(
  () =>
    new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    }),
);

// ── Helper ────────────────────────────────────────────────────────────────────
async function getStats(primeQueue: Array<[{ count: number }]>): Promise<{
  status: number;
  body: Record<string, unknown>;
  conditions: unknown[];
}> {
  responseQueue = [...primeQueue];
  capturedConditions = [];
  const res = await fetch(`${baseUrl}/api/leads/stats`);
  const body = await res.json();
  return {
    status: res.status,
    body: body as Record<string, unknown>,
    conditions: [...capturedConditions],
  };
}

// ── Scenario: mix of archived and active leads ────────────────────────────────
//
// The DB (with the archived-exclusion WHERE clause applied) returns only the
// active counts.  We prime the response queue to reflect that:
//   10 active total  (down from 14: 4 archived)
//    3 active this week (down from 5: 2 archived)
//    7 active contact_form (down from 11: 4 archived)
//    3 active lead_magnet (none archived)
//
// Then we:
//  a) verify the response values match what the DB returns
//  b) inspect each captured WHERE condition to confirm "archived" is referenced
//     in all 4 queries — proving the ne(status, "archived") predicate is present

describe("GET /api/leads/stats — archived leads are excluded from all counts", () => {
  let body: Record<string, unknown>;
  let status: number;
  let conditions: unknown[];

  before(async () => {
    ({ status, body, conditions } = await getStats([
      [{ count: 10 }], // total active
      [{ count: 3 }],  // active this week
      [{ count: 7 }],  // active contact_form
      [{ count: 3 }],  // active lead_magnet
    ]));
  });

  it("returns HTTP 200", () => {
    assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(body)}`);
  });

  it("response contains all four stat fields", () => {
    assert.ok("total" in body, "missing 'total' field");
    assert.ok("newThisWeek" in body, "missing 'newThisWeek' field");
    assert.ok("fromContactForm" in body, "missing 'fromContactForm' field");
    assert.ok("fromLeadMagnet" in body, "missing 'fromLeadMagnet' field");
  });

  it("total reflects only active leads (archived excluded)", () => {
    assert.equal(body.total, 10);
  });

  it("newThisWeek reflects only active leads created this week (archived excluded)", () => {
    assert.equal(body.newThisWeek, 3);
  });

  it("fromContactForm reflects only active contact-form leads (archived excluded)", () => {
    assert.equal(body.fromContactForm, 7);
  });

  it("fromLeadMagnet reflects only active lead-magnet leads (archived excluded)", () => {
    assert.equal(body.fromLeadMagnet, 3);
  });

  // ── Predicate inspection: the core regression guard ─────────────────────────
  // Each of the 4 COUNT queries must include the archived-exclusion predicate.
  // extractQueryParamValues() recursively walks the drizzle SQL condition tree
  // collecting all plain parameter values.  If ne(leadsTable.status, "archived")
  // is absent from any query, "archived" won't appear in that condition's param
  // list and the assertion fails — catching the exact regression this task targets.

  it("the total query WHERE clause includes the archived-exclusion predicate", () => {
    assert.ok(
      conditions.length >= 1,
      "expected at least 1 WHERE condition to be captured (was the stats endpoint called?)",
    );
    const params = extractQueryParamValues(conditions[0]);
    assert.ok(
      params.includes("archived"),
      `total query WHERE clause does not reference "archived". ` +
      `Params found: ${JSON.stringify(params)}. ` +
      `Was ne(leadsTable.status, "archived") removed from the query?`,
    );
  });

  it("the newThisWeek query WHERE clause includes the archived-exclusion predicate", () => {
    assert.ok(conditions.length >= 2, "expected at least 2 WHERE conditions to be captured");
    const params = extractQueryParamValues(conditions[1]);
    assert.ok(
      params.includes("archived"),
      `newThisWeek query WHERE clause does not reference "archived". ` +
      `Params found: ${JSON.stringify(params)}.`,
    );
  });

  it("the fromContactForm query WHERE clause includes the archived-exclusion predicate", () => {
    assert.ok(conditions.length >= 3, "expected at least 3 WHERE conditions to be captured");
    const params = extractQueryParamValues(conditions[2]);
    assert.ok(
      params.includes("archived"),
      `fromContactForm query WHERE clause does not reference "archived". ` +
      `Params found: ${JSON.stringify(params)}.`,
    );
  });

  it("the fromLeadMagnet query WHERE clause includes the archived-exclusion predicate", () => {
    assert.ok(conditions.length >= 4, "expected at least 4 WHERE conditions to be captured");
    const params = extractQueryParamValues(conditions[3]);
    assert.ok(
      params.includes("archived"),
      `fromLeadMagnet query WHERE clause does not reference "archived". ` +
      `Params found: ${JSON.stringify(params)}.`,
    );
  });

  it("all 4 stat queries captured WHERE conditions (none missing)", () => {
    assert.equal(
      conditions.length,
      4,
      `expected exactly 4 WHERE conditions (one per stat query), got ${conditions.length}`,
    );
  });
});

// ── Scenario: all leads are archived → zero counts across the board ───────────

describe("GET /api/leads/stats — all leads archived → all counts are zero", () => {
  let body: Record<string, unknown>;
  let conditions: unknown[];

  before(async () => {
    ({ body, conditions } = await getStats([
      [{ count: 0 }],
      [{ count: 0 }],
      [{ count: 0 }],
      [{ count: 0 }],
    ]));
  });

  it("total is 0 when all leads are archived", () => {
    assert.equal(body.total, 0);
  });

  it("newThisWeek is 0 when all leads are archived", () => {
    assert.equal(body.newThisWeek, 0);
  });

  it("fromContactForm is 0 when all leads are archived", () => {
    assert.equal(body.fromContactForm, 0);
  });

  it("fromLeadMagnet is 0 when all leads are archived", () => {
    assert.equal(body.fromLeadMagnet, 0);
  });

  it("archived exclusion predicate still present when result is zero", () => {
    // Even with all-zero results the WHERE clause must still exclude archived rows.
    assert.equal(conditions.length, 4);
    for (let i = 0; i < 4; i++) {
      const params = extractQueryParamValues(conditions[i]);
      assert.ok(
        params.includes("archived"),
        `query ${i} WHERE clause is missing the archived-exclusion predicate`,
      );
    }
  });
});

// ── Scenario: field-to-query mapping ─────────────────────────────────────────
// Use distinct prime values so any cross-wiring between fields is immediately
// obvious.  Also confirms each of the 4 queries filters for "contact_form" and
// "lead_magnet" in addition to the archived exclusion.

describe("GET /api/leads/stats — stat fields map to the correct DB query", () => {
  let body: Record<string, unknown>;
  let conditions: unknown[];

  before(async () => {
    ({ body, conditions } = await getStats([
      [{ count: 101 }], // total
      [{ count: 7 }],   // newThisWeek
      [{ count: 61 }],  // fromContactForm
      [{ count: 41 }],  // fromLeadMagnet
    ]));
  });

  it("total field maps to the first DB query", () => {
    assert.equal(body.total, 101);
  });

  it("newThisWeek field maps to the second DB query", () => {
    assert.equal(body.newThisWeek, 7);
  });

  it("fromContactForm field maps to the third DB query", () => {
    assert.equal(body.fromContactForm, 61);
  });

  it("fromLeadMagnet field maps to the fourth DB query", () => {
    assert.equal(body.fromLeadMagnet, 41);
  });

  it("the contact_form query also filters by source", () => {
    // The fromContactForm WHERE clause must reference "contact_form" as a param.
    const params = extractQueryParamValues(conditions[2]);
    assert.ok(
      params.includes("contact_form"),
      `fromContactForm query WHERE clause does not reference "contact_form". ` +
      `Params found: ${JSON.stringify(params)}.`,
    );
  });

  it("the lead_magnet query also filters by source", () => {
    const params = extractQueryParamValues(conditions[3]);
    assert.ok(
      params.includes("lead_magnet"),
      `fromLeadMagnet query WHERE clause does not reference "lead_magnet". ` +
      `Params found: ${JSON.stringify(params)}.`,
    );
  });
});

// ── Structural SQL operator extraction ────────────────────────────────────────
// Drizzle builds WHERE conditions as a tree of queryChunks:
//   - Primitive values (string, number, boolean): bound query parameters
//   - StringChunk { value: string[] }: raw SQL text (operators, parens, keywords)
//   - Nested SQL objects { queryChunks: [...] }: recursive sub-expressions
//   - null / undefined: column references (undefined for mocked table columns)
//
// extractSqlOperators() collects SQL comparison operator text from StringChunks.
// This is the ONLY way to detect isNull()/isNotNull() predicates — they emit
// SQL text like "IS NULL", not a bound param value, so extractQueryParamValues()
// (which skips StringChunks entirely) cannot find them.
//
// Operators Drizzle emits (trimmed StringChunk text):
//   ne()        → "<>"          eq()       → "="
//   gte()       → ">="          lte()      → "<="
//   gt()        → ">"           lt()       → "<"
//   isNull()    → "IS NULL"     isNotNull()→ "IS NOT NULL"
//   like()      → "LIKE"        ilike()    → "ILIKE"

const COMPARISON_OPS = new Set([
  "<>", "!=", "=", ">=", "<=", ">", "<",
  "IS NULL", "IS NOT NULL", "LIKE", "ILIKE", "NOT LIKE",
]);

function extractSqlOperators(node: unknown): string[] {
  if (node === null || node === undefined) return [];
  if (typeof node !== "object") return [];

  const obj = node as Record<string, unknown>;

  if ("queryChunks" in obj && Array.isArray(obj.queryChunks)) {
    return (obj.queryChunks as unknown[]).flatMap(extractSqlOperators);
  }

  // StringChunk: { value: string[] } — raw SQL text; check for comparison ops.
  // Normalize to uppercase because drizzle emits word operators in lowercase
  // (e.g. isNull → " is null", not " IS NULL").
  if ("value" in obj && Array.isArray(obj.value)) {
    const raw = (obj.value as unknown[])
      .filter((s): s is string => typeof s === "string")
      .join("")
      .trim();
    const text = raw.toUpperCase();
    return COMPARISON_OPS.has(text) ? [text] : [];
  }

  return [];
}

// ── Soft-delete regression guard ──────────────────────────────────────────────
//
// CONTEXT: The stats endpoint currently excludes archived leads via
//   ne(leadsTable.status, "archived")
//
// RISK: If a soft-delete mechanism is added to leadsTable (e.g. a
// `deletedAt TIMESTAMPTZ` column or `isDeleted BOOLEAN` flag), the stats
// endpoint must also exclude those rows — otherwise soft-deleted leads silently
// inflate every count.
//
// HOW THIS GUARD WORKS:
//  The mock runs in "soft-delete mode" (softDeleteMode = true) which activates
//  the inflation-aware WHERE inspector inside makeMockDb().  For each of the 4
//  stat queries the inspector calls extractSqlOperators() on the WHERE condition.
//  Drizzle's isNull(col) emits "IS NULL" as a raw SQL StringChunk — not a bound
//  param — so this is the correct structural way to detect it.
//
//  - When the WHERE clause contains "IS NULL" (soft-delete exclusion present)
//    the mock returns the CORRECT counts from SOFT_DELETE_CORRECT.
//  - When "IS NULL" is absent the mock returns INFLATED counts from
//    SOFT_DELETE_INFLATED (soft-deleted rows leak through the filter).
//
//  The tests then assert the CORRECT (non-inflated) counts.  This means:
//  - TODAY: no "IS NULL" in WHERE → mock returns inflated → assertions FAIL.
//    This is intentional: the test is a specification of the required contract
//    that does not yet have a passing implementation.
//  - AFTER the endpoint adds isNull(leadsTable.deletedAt): "IS NULL" appears →
//    mock returns correct counts → assertions PASS.
//  - If "IS NULL" is later REMOVED from the endpoint: mock returns inflated
//    counts again → assertions FAIL, catching the regression automatically.
//
// TO MAKE THESE TESTS PASS:
//  Add `isNull(leadsTable.deletedAt)` (plus AND wrapper) to every WHERE clause
//  in the stats endpoint (leads.ts:187-205).  No test file changes needed —
//  the mock will automatically detect the new predicate and switch to correct
//  counts.

describe("GET /api/leads/stats — soft-delete regression guard (spec: soft-deleted leads must be excluded)", () => {
  // Fixture dataset (constants defined alongside makeMockDb above):
  //   12 leads: 6 truly active, 3 archived, 3 soft-deleted
  //   SOFT_DELETE_INFLATED: counts when deletedAt IS NOT excluded (soft-deleted leak through)
  //   SOFT_DELETE_CORRECT:  counts when deletedAt IS excluded (only truly active counted)
  let body: Record<string, unknown>;
  let status: number;
  let conditions: unknown[];

  before(async () => {
    softDeleteMode = true;
    capturedConditions = [];
    try {
      const res = await fetch(`${baseUrl}/api/leads/stats`);
      body = await res.json() as Record<string, unknown>;
      status = res.status;
    } finally {
      softDeleteMode = false;
    }
    conditions = [...capturedConditions];
  });

  it("returns HTTP 200", () => {
    assert.equal(status, 200, `expected 200, got ${status}; body: ${JSON.stringify(body)}`);
  });

  it("response body contains all four stat fields", () => {
    assert.ok("total" in body, "missing 'total'");
    assert.ok("newThisWeek" in body, "missing 'newThisWeek'");
    assert.ok("fromContactForm" in body, "missing 'fromContactForm'");
    assert.ok("fromLeadMagnet" in body, "missing 'fromLeadMagnet'");
  });

  it("all 4 stat queries execute — WHERE conditions captured for every query", () => {
    assert.equal(
      conditions.length,
      4,
      `expected 4 WHERE conditions (one per stat query), got ${conditions.length}`,
    );
  });

  // ── Inflation contract: counts must match SOFT_DELETE_CORRECT (not inflated) ─
  // Each assertion checks that the mock returned the CORRECT (non-inflated) count,
  // which only happens when "IS NULL" is present in the WHERE clause.
  // These FAIL today (IS NULL absent → inflated counts) and PASS once the
  // endpoint adds isNull(leadsTable.deletedAt) to every stat query.

  it("total must exclude soft-deleted leads — expected 6 (not 9 inflated)", () => {
    assert.equal(
      body.total,
      SOFT_DELETE_CORRECT.total,
      `total is ${body.total} but should be ${SOFT_DELETE_CORRECT.total} (not ${SOFT_DELETE_INFLATED.total} inflated). ` +
      `The stats endpoint must add isNull(leadsTable.deletedAt) to the total WHERE clause.`,
    );
  });

  it("newThisWeek must exclude soft-deleted leads — expected 2 (not 3 inflated)", () => {
    assert.equal(
      body.newThisWeek,
      SOFT_DELETE_CORRECT.week,
      `newThisWeek is ${body.newThisWeek} but should be ${SOFT_DELETE_CORRECT.week} (not ${SOFT_DELETE_INFLATED.week} inflated). ` +
      `The stats endpoint must add isNull(leadsTable.deletedAt) to the newThisWeek WHERE clause.`,
    );
  });

  it("fromContactForm must exclude soft-deleted leads — expected 5 (not 6 inflated)", () => {
    assert.equal(
      body.fromContactForm,
      SOFT_DELETE_CORRECT.contact,
      `fromContactForm is ${body.fromContactForm} but should be ${SOFT_DELETE_CORRECT.contact} (not ${SOFT_DELETE_INFLATED.contact} inflated). ` +
      `The stats endpoint must add isNull(leadsTable.deletedAt) to the contact_form WHERE clause.`,
    );
  });

  it("fromLeadMagnet must exclude soft-deleted leads — expected 1 (not 3 inflated)", () => {
    assert.equal(
      body.fromLeadMagnet,
      SOFT_DELETE_CORRECT.magnet,
      `fromLeadMagnet is ${body.fromLeadMagnet} but should be ${SOFT_DELETE_CORRECT.magnet} (not ${SOFT_DELETE_INFLATED.magnet} inflated). ` +
      `The stats endpoint must add isNull(leadsTable.deletedAt) to the lead_magnet WHERE clause.`,
    );
  });

  // ── Structural verification: IS NULL must appear in every WHERE clause ────────
  // Confirms the soft-delete exclusion predicate is structurally present in each
  // query's WHERE condition.  Fails if isNull() is missing from any query.

  it("total query WHERE must include IS NULL (soft-delete exclusion)", () => {
    const ops = extractSqlOperators(conditions[0]);
    assert.ok(
      ops.includes("IS NULL"),
      `total query WHERE is missing "IS NULL". Operators found: ${JSON.stringify(ops)}. ` +
      `Add isNull(leadsTable.deletedAt) to the total stat query in leads.ts.`,
    );
  });

  it("newThisWeek query WHERE must include IS NULL (soft-delete exclusion)", () => {
    const ops = extractSqlOperators(conditions[1]);
    assert.ok(
      ops.includes("IS NULL"),
      `newThisWeek query WHERE is missing "IS NULL". Operators found: ${JSON.stringify(ops)}. ` +
      `Add isNull(leadsTable.deletedAt) to the newThisWeek stat query in leads.ts.`,
    );
  });

  it("fromContactForm query WHERE must include IS NULL (soft-delete exclusion)", () => {
    const ops = extractSqlOperators(conditions[2]);
    assert.ok(
      ops.includes("IS NULL"),
      `fromContactForm query WHERE is missing "IS NULL". Operators found: ${JSON.stringify(ops)}. ` +
      `Add isNull(leadsTable.deletedAt) to the contact_form stat query in leads.ts.`,
    );
  });

  it("fromLeadMagnet query WHERE must include IS NULL (soft-delete exclusion)", () => {
    const ops = extractSqlOperators(conditions[3]);
    assert.ok(
      ops.includes("IS NULL"),
      `fromLeadMagnet query WHERE is missing "IS NULL". Operators found: ${JSON.stringify(ops)}. ` +
      `Add isNull(leadsTable.deletedAt) to the lead_magnet stat query in leads.ts.`,
    );
  });
});
