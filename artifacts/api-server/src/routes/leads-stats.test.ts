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

function makeMockDb() {
  return {
    select: (_cols: unknown) => ({
      from: (_table: unknown) => ({
        where: async (condition: unknown) => {
          capturedConditions.push(condition);
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
    leadsTable: {},
    emailsTable: {},
    servicesTable: {},
    quizLeadsTable: {},
    leadQualificationsTable: {},
    kanbanTasksTable: {},
    opportunityTasksTable: {},
    opportunitiesTable: {},
    projectsTable: {},
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
