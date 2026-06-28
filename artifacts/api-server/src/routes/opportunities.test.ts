/**
 * Integration tests for opportunity deletion orphan cleanup.
 *
 * Approach:
 *  - mock.module() stubs @workspace/db so no real DB connection is opened.
 *  - The mock db tracks all delete() calls by table name so the test can
 *    assert that kanban_tasks and opportunity_tasks rows are removed when an
 *    opportunity is purged.
 *  - mock.module() stubs generateWorkflowTasks to return exactly 1 task,
 *    eliminating Promise.all concurrency that would make the response queue
 *    order non-deterministic.
 *  - mock.module() stubs requireAdmin as a pass-through (no auth needed).
 *  - The real router from opportunities.ts is mounted in a lightweight Express
 *    server and called over HTTP.
 *
 * Test scenario (full happy-path lifecycle):
 *   1. POST /api/leads/qualification/1/approve  → creates opportunity + kanban task
 *   2. DELETE /api/opportunities/42             → soft-deletes the opportunity
 *   3. DELETE /api/opportunities/42/purge       → hard-deletes; must clean up tasks
 *
 * Regression guard:
 *   If the purge handler ever stops deleting opportunity_tasks or kanban_tasks
 *   rows the deleteCalls assertions below will fail, surfacing the bug
 *   immediately instead of leaving ghost tasks on the board.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */
import { describe, it, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ── Query-param extractor (mirrors the one in leads-stats.test.ts) ─────────────
// Drizzle SQL objects store param values inside { queryChunks: [...] } trees.
// Plain primitives in the tree are the actual parameter values (e.g. 42, "deleted").
// This walker collects all primitives, letting us assert IDs appear in WHERE clauses.

function extractQueryParamValues(node: unknown): unknown[] {
  if (node === null || node === undefined) return [];
  if (typeof node !== "object") return [node];
  const obj = node as Record<string, unknown>;
  if ("queryChunks" in obj && Array.isArray(obj.queryChunks)) {
    const values: unknown[] = [];
    for (const chunk of obj.queryChunks) {
      values.push(...extractQueryParamValues(chunk));
    }
    return values;
  }
  if ("value" in obj && Array.isArray(obj.value)) return [];
  // Arrays (e.g. the list passed to inArray) — recurse into elements
  if (Array.isArray(node)) {
    const values: unknown[] = [];
    for (const el of node) values.push(...extractQueryParamValues(el));
    return values;
  }
  return [obj];
}

// ── Response queue ─────────────────────────────────────────────────────────────
// Every db.select(...).where(...) and db.insert(...).values(...) pops from this.
// Build the queue in the exact order the route code executes each operation.

let responseQueue: unknown[][] = [];

function shiftResponse(): unknown[] {
  return (responseQueue.shift() ?? []) as unknown[];
}

// ── Delete call log ───────────────────────────────────────────────────────────
// Each entry records the table name and the extracted WHERE-clause params so we
// can assert both THAT a table was deleted from AND WHICH rows were targeted.

interface DeleteCall {
  tableName: string;
  conditionParams: unknown[];
}
let deleteCalls: DeleteCall[] = [];

// ── Mock table stubs ──────────────────────────────────────────────────────────
// Each stub carries a __tableName tag so the delete() handler can identify it.

const mockOpportunitiesTable = { __tableName: "opportunities" };
const mockOpportunityTasksTable = { __tableName: "opportunity_tasks" };
const mockKanbanTasksTable = { __tableName: "kanban_tasks" };
const mockLeadsTable = { __tableName: "leads" };
const mockLeadQualificationsTable = { __tableName: "lead_qualifications" };
const mockProjectsTable = { __tableName: "projects" };

// ── Mock DB factory ───────────────────────────────────────────────────────────
// All chain methods consume the response queue on the call that returns the
// final awaitable value:
//   select → consumed by where(); limit() re-uses the same row
//   insert → consumed by values(); returning() re-uses the same row
//   update → consumed by where(); returning() re-uses the same row
//   delete → NOT queue-consuming; recorded in deleteCalls instead

function makeMockDb() {
  return {
    select: (_cols?: unknown) => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => {
          const row = shiftResponse();
          return Object.assign(Promise.resolve(row), {
            limit: (_n: unknown) => Promise.resolve(row),
            orderBy: (..._args: unknown[]) =>
              Object.assign(Promise.resolve(row), {
                limit: (_n: unknown) => Promise.resolve(row),
                offset: (_n: unknown) => Promise.resolve(row),
              }),
          });
        },
        limit: (_n: unknown) => Promise.resolve(shiftResponse()),
        orderBy: (..._args: unknown[]) =>
          Object.assign(Promise.resolve(shiftResponse()), {
            limit: (_n: unknown) => Promise.resolve(shiftResponse()),
            offset: (_n: unknown) => Promise.resolve(shiftResponse()),
          }),
      }),
    }),

    insert: (_table: unknown) => ({
      values: (_data: unknown) => {
        const row = shiftResponse();
        return Object.assign(Promise.resolve(row), {
          returning: (_cols?: unknown) => Promise.resolve(row),
        });
      },
    }),

    update: (_table: unknown) => ({
      set: (_data: unknown) => ({
        where: (_cond: unknown) => {
          const row = shiftResponse();
          return Object.assign(Promise.resolve(row), {
            returning: (_cols?: unknown) => Promise.resolve(row),
          });
        },
      }),
    }),

    delete: (table: unknown) => ({
      where: (_cond: unknown) => {
        const tbl =
          (table as { __tableName?: string })?.__tableName ?? "unknown";
        const params = extractQueryParamValues(_cond);
        deleteCalls.push({ tableName: tbl, conditionParams: params });
        return Promise.resolve([]);
      },
    }),
  };
}

// ── Register mocks BEFORE the route module is dynamically imported ─────────────
mock.module("@workspace/db", {
  namedExports: {
    db: makeMockDb(),
    opportunitiesTable: mockOpportunitiesTable,
    opportunityTasksTable: mockOpportunityTasksTable,
    kanbanTasksTable: mockKanbanTasksTable,
    leadsTable: mockLeadsTable,
    leadQualificationsTable: mockLeadQualificationsTable,
    projectsTable: mockProjectsTable,
  },
});

mock.module("../middlewares/requireAuth.ts", {
  namedExports: {
    requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
    requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  },
});

// Return exactly 1 task template so Promise.all inside approve runs serially
// and the response queue order is deterministic.
mock.module("../lib/workflow-tasks.ts", {
  namedExports: {
    generateWorkflowTasks: (_workflowType: unknown, _leadName: unknown) => [
      {
        title: "Discovery Call",
        description: "Schedule and conduct initial discovery call",
        dueDaysFromNow: 3,
        assignedTo: "Shane",
      },
    ],
    daysFromNow: (days: number) =>
      new Date(Date.now() + days * 24 * 60 * 60 * 1000),
  },
});

// ── Dynamically import the REAL router AFTER mocks are in place ───────────────
const { default: opportunitiesRouter } = await import("./opportunities.ts");

// ── Build a minimal Express app around the real router ────────────────────────
const { default: express } = await import("express");
const app = express();
app.use(express.json());
app.use("/api", opportunitiesRouter);

// ── Test HTTP server lifecycle ─────────────────────────────────────────────────
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

// ── Helpers ───────────────────────────────────────────────────────────────────

async function post(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, { method: "POST" });
  return { status: res.status, body: await res.json() };
}

async function del(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, { method: "DELETE" });
  return { status: res.status, body: await res.json() };
}

// ── Full lifecycle scenario ───────────────────────────────────────────────────
//
// Queue layout (consumed in order):
//   Approve (POST /api/leads/qualification/1/approve):
//     [0]  select qual by id                    → [{id:1, leadId:10, ...}]
//     [1]  select lead by id                    → [{id:10, name:"Test Lead", ...}]
//     [2]  select project by title              → []   (no existing project)
//     [3]  insert project + returning           → [{id:1, title:"Lead Opportunities"}]
//     [4]  insert opportunity + returning       → [{id:42, leadId:10}]
//     [5]  insert kanban task + returning({id}) → [{id:100}]
//     [6]  insert opportunity_task (no return)  → []
//     [7]  update qual (no return)              → []
//     [8]  update lead (no return)              → []
//
//   Soft-delete (DELETE /api/opportunities/42):
//     [9]  select opportunity by id             → [{id:42, state:"new"}]
//     [10] update opportunity + returning       → [{id:42, state:"deleted"}]
//
//   Purge (DELETE /api/opportunities/42/purge):
//     [11] select opportunity by id             → [{id:42, state:"deleted"}]
//     [12] select opportunity_tasks (kanban IDs)→ [{kanbanTaskId:100}]
//     [deletes — not queue-consuming, tracked in deleteCalls]

describe("Opportunity deletion — orphan kanban/task cleanup", () => {
  let approveStatus: number;
  let softDeleteStatus: number;
  let purgeStatus: number;
  let approveBody: unknown;
  let softDeleteBody: unknown;
  let purgeBody: unknown;

  before(async () => {
    // Prime the response queue in the exact order the route code issues queries.
    responseQueue = [
      // [0] qual select
      [
        {
          id: 1,
          leadId: 10,
          status: "pending",
          workflowType: "DiscoveryCall",
          newScore: 85,
          scoreFit: 8,
          scorePain: 7,
          scoreMaturity: 6,
          scoreIntent: 8,
          scoreUrgency: 7,
          evidence: null,
          recommendedNextStep: null,
          stage: "Opportunity",
          snoozedUntil: null,
        },
      ],
      // [1] lead select
      [{ id: 10, name: "Test Lead", email: "test@example.com", company: "Acme" }],
      // [2] project select → empty (triggers insert)
      [],
      // [3] project insert + returning
      [
        {
          id: 1,
          title: "Lead Opportunities",
          status: "active",
          projectType: "project",
          phase: "Sales",
        },
      ],
      // [4] opportunity insert + returning
      [{ id: 42, leadId: 10, state: "new" }],
      // [5] kanban task insert + returning({id})
      [{ id: 100 }],
      // [6] opportunity_task insert (no returning — resolves to [])
      [],
      // [7] leadQualifications update (no returning)
      [],
      // [8] leads update (no returning)
      [],
      // [9] soft-delete: select opportunity
      [{ id: 42, state: "new" }],
      // [10] soft-delete: update opportunity + returning
      [{ id: 42, state: "deleted", deletedAt: new Date().toISOString() }],
      // [11] purge: select opportunity
      [{ id: 42, state: "deleted" }],
      // [12] purge: select opportunity_tasks for kanban IDs
      [{ kanbanTaskId: 100 }],
    ];

    deleteCalls = [];

    ({ status: approveStatus, body: approveBody } = await post(
      "/api/leads/qualification/1/approve",
    ));

    ({ status: softDeleteStatus, body: softDeleteBody } = await del(
      "/api/opportunities/42",
    ));

    ({ status: purgeStatus, body: purgeBody } = await del(
      "/api/opportunities/42/purge",
    ));
  });

  // ── HTTP responses ──────────────────────────────────────────────────────────

  it("approve returns HTTP 200", () => {
    assert.equal(
      approveStatus,
      200,
      `expected 200, got ${approveStatus}; body: ${JSON.stringify(approveBody)}`,
    );
  });

  it("approve response includes opportunityId", () => {
    assert.ok(
      approveBody !== null &&
        typeof approveBody === "object" &&
        "opportunityId" in (approveBody as object),
      `expected { opportunityId: ... } in body, got: ${JSON.stringify(approveBody)}`,
    );
  });

  it("soft-delete returns HTTP 200", () => {
    assert.equal(
      softDeleteStatus,
      200,
      `expected 200, got ${softDeleteStatus}; body: ${JSON.stringify(softDeleteBody)}`,
    );
  });

  it("soft-delete response includes ok:true", () => {
    const b = softDeleteBody as Record<string, unknown>;
    assert.equal(b.ok, true);
  });

  it("purge returns HTTP 200", () => {
    assert.equal(
      purgeStatus,
      200,
      `expected 200, got ${purgeStatus}; body: ${JSON.stringify(purgeBody)}`,
    );
  });

  it("purge response includes ok:true", () => {
    const b = purgeBody as Record<string, unknown>;
    assert.equal(b.ok, true);
  });

  // ── Core regression guards ──────────────────────────────────────────────────

  it("purge issues exactly 3 delete calls (opportunity_tasks, kanban_tasks, opportunities)", () => {
    assert.equal(
      deleteCalls.length,
      3,
      `expected 3 delete calls after purge, got ${deleteCalls.length}. ` +
        `Calls: ${JSON.stringify(deleteCalls.map((c) => c.tableName))}. ` +
        `Was the orphan cleanup code removed from the purge handler?`,
    );
  });

  it("opportunity_tasks rows are deleted during purge", () => {
    const call = deleteCalls.find((c) => c.tableName === "opportunity_tasks");
    assert.ok(
      call !== undefined,
      `No delete call against opportunity_tasks was recorded. ` +
        `Tables deleted: ${JSON.stringify(deleteCalls.map((c) => c.tableName))}`,
    );
  });

  it("opportunity_tasks delete targets the correct opportunityId (42)", () => {
    const call = deleteCalls.find((c) => c.tableName === "opportunity_tasks");
    assert.ok(call !== undefined, "opportunity_tasks delete not found");
    const params = call.conditionParams;
    assert.ok(
      params.includes(42),
      `opportunity_tasks WHERE clause does not reference opportunityId 42. ` +
        `Params found: ${JSON.stringify(params)}`,
    );
  });

  it("kanban_tasks rows are deleted during purge (board clutter cleared)", () => {
    const call = deleteCalls.find((c) => c.tableName === "kanban_tasks");
    assert.ok(
      call !== undefined,
      `No delete call against kanban_tasks was recorded. ` +
        `Tables deleted: ${JSON.stringify(deleteCalls.map((c) => c.tableName))}. ` +
        `This means ghost kanban tasks would be left on the board after deleting an opportunity.`,
    );
  });

  it("kanban_tasks delete targets the correct task ID (100) created during approval", () => {
    const call = deleteCalls.find((c) => c.tableName === "kanban_tasks");
    assert.ok(call !== undefined, "kanban_tasks delete not found");
    const params = call.conditionParams;
    assert.ok(
      params.includes(100),
      `kanban_tasks WHERE clause does not reference task ID 100. ` +
        `Params found: ${JSON.stringify(params)}. ` +
        `The purge handler may be passing the wrong IDs to the delete condition.`,
    );
  });

  it("opportunities row itself is deleted during purge", () => {
    const call = deleteCalls.find((c) => c.tableName === "opportunities");
    assert.ok(
      call !== undefined,
      `No delete call against opportunities was recorded. ` +
        `Tables deleted: ${JSON.stringify(deleteCalls.map((c) => c.tableName))}`,
    );
  });

  it("opportunities delete targets the correct opportunity ID (42)", () => {
    const call = deleteCalls.find((c) => c.tableName === "opportunities");
    assert.ok(call !== undefined, "opportunities delete not found");
    const params = call.conditionParams;
    assert.ok(
      params.includes(42),
      `opportunities WHERE clause does not reference ID 42. ` +
        `Params found: ${JSON.stringify(params)}`,
    );
  });
});

// ── Regression: purge of an opportunity with NO kanban tasks ──────────────────
//
// When all opportunity tasks were created without a linked kanban task
// (kanbanTaskId = null), the purge handler must still delete the
// opportunity_tasks rows and the opportunity itself — without crashing or
// attempting to delete from kanban_tasks with an empty list.

describe("Opportunity deletion — no kanban tasks linked (null kanbanTaskId)", () => {
  let purgeStatus: number;
  let purgeBody: unknown;

  before(async () => {
    responseQueue = [
      // purge: select opportunity
      [{ id: 55, state: "deleted" }],
      // purge: select opportunity_tasks → all have null kanbanTaskId
      [{ kanbanTaskId: null }, { kanbanTaskId: null }],
    ];
    deleteCalls = [];

    ({ status: purgeStatus, body: purgeBody } = await del(
      "/api/opportunities/55/purge",
    ));
  });

  it("purge returns HTTP 200 when no kanban tasks are linked", () => {
    assert.equal(
      purgeStatus,
      200,
      `expected 200, got ${purgeStatus}; body: ${JSON.stringify(purgeBody)}`,
    );
  });

  it("opportunity_tasks are still deleted even when kanbanTaskId is null", () => {
    const call = deleteCalls.find((c) => c.tableName === "opportunity_tasks");
    assert.ok(
      call !== undefined,
      `opportunity_tasks delete was not called when kanbanTaskIds are all null. ` +
        `Tables deleted: ${JSON.stringify(deleteCalls.map((c) => c.tableName))}`,
    );
  });

  it("kanban_tasks delete is NOT called when there are no linked kanban task IDs", () => {
    const call = deleteCalls.find((c) => c.tableName === "kanban_tasks");
    assert.equal(
      call,
      undefined,
      `kanban_tasks delete was called even though no kanban IDs were linked. ` +
        `The handler should guard with "if (kanbanTaskIds.length > 0)".`,
    );
  });

  it("opportunity itself is still deleted when no kanban tasks are linked", () => {
    const call = deleteCalls.find((c) => c.tableName === "opportunities");
    assert.ok(
      call !== undefined,
      `opportunities delete was not called. ` +
        `Tables deleted: ${JSON.stringify(deleteCalls.map((c) => c.tableName))}`,
    );
  });
});

// ── Guard: purge must be refused when opportunity is not soft-deleted ──────────
//
// The route explicitly requires state === "deleted" before purging.
// This ensures an active opportunity cannot be wiped accidentally.

describe("Opportunity deletion — purge refused when not soft-deleted", () => {
  let purgeStatus: number;
  let purgeBody: unknown;

  before(async () => {
    responseQueue = [
      // purge: select opportunity — state is "new", not "deleted"
      [{ id: 99, state: "new" }],
    ];
    deleteCalls = [];

    ({ status: purgeStatus, body: purgeBody } = await del(
      "/api/opportunities/99/purge",
    ));
  });

  it("purge returns HTTP 400 when opportunity is not soft-deleted", () => {
    assert.equal(
      purgeStatus,
      400,
      `expected 400, got ${purgeStatus}; body: ${JSON.stringify(purgeBody)}`,
    );
  });

  it("no delete calls are issued when purge is refused", () => {
    assert.equal(
      deleteCalls.length,
      0,
      `expected 0 delete calls when purge is blocked, got ${deleteCalls.length}`,
    );
  });
});
