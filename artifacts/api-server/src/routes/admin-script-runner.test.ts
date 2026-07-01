/**
 * Integration tests for GET /api/admin/runbook-jobs/output — the poll endpoint
 * that drives the kanban script-running badge.
 *
 * Regression guard: when a runbook job reaches a terminal status (Completed or
 * Failed), the poll endpoint must clear `runningJobRef` and stamp `lastJobStatus`
 * with the terminal value in the kanban task's taskMetadata.  If that update is
 * skipped, the card shows a stale "Running" badge after the browser is closed
 * mid-script and the page is re-opened.
 *
 * Approach:
 *  - mock.module() stubs @workspace/db so no real DB connection is opened.
 *    A smart fake db tracks which table is updated and captures the exact
 *    `set()` arguments passed for kanbanTasksTable.
 *  - mock.module() stubs ../lib/azure-automation.ts with a controllable status
 *    (azureStatusToReturn) so each test can simulate Completed / Failed / Running.
 *  - requireAdmin, logger, and other heavy side-effect deps are stubbed.
 *  - The REAL router from admin-script-runner.ts is mounted in a lightweight
 *    Express server and exercised over HTTP with node:fetch.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */
import { describe, it, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ── Controllable Azure status ──────────────────────────────────────────────────
// Set this before each test to control what getJobStatus() returns.
let azureStatusToReturn = "Completed";

// ── Kanban task fixture ────────────────────────────────────────────────────────
// Simulates a task that has been started: runningJobRef is set to the active
// Azure job ID.  This is exactly the state that produces the stale badge.
const FAKE_TASK_ID = 42;
const FAKE_JOB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const fakeTask = {
  id: FAKE_TASK_ID,
  projectId: 1,
  taskMetadata: {
    runningJobRef: FAKE_JOB_ID,
    lastJobStatus: "Running",
  },
};

// ── DB mock — captures kanban updates ─────────────────────────────────────────
// Sentinel objects let us identify tables by reference inside the mock.
const mockKanbanTasksTable          = { _name: "kanban_tasks", id: {} };
const mockRunbookJobHistoryTable    = { _name: "runbook_job_history", jobId: {} };
const mockScriptRunResultsTable     = { _name: "script_run_results", jobId: {} };
const mockClientAutomationRunsTable = { _name: "client_automation_runs" };

// Holds the last set() args from an update(kanbanTasksTable) call.
// Reset in beforeEach so tests don't share state.
let capturedKanbanSetArgs: Record<string, unknown> | null = null;
// Tracks whether any kanban update was attempted.
let kanbanUpdateCalled = false;

function makeMockDb() {
  return {
    select: () => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => ({
          limit: (_n: unknown) => Promise.resolve([fakeTask]),
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (data: Record<string, unknown>) => {
        if (table === mockKanbanTasksTable) {
          kanbanUpdateCalled = true;
          capturedKanbanSetArgs = data;
        }
        return {
          where: (_cond: unknown) => Promise.resolve(),
        };
      },
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([]),
      }),
    }),
  };
}

// ── Register mocks BEFORE importing the route module ─────────────────────────
// All mock.module() calls must precede the dynamic import below so that when
// the route module is loaded its top-level imports resolve to the stubs.

mock.module("@workspace/db", {
  namedExports: {
    db: makeMockDb(),
    // Tables exported as sentinel objects so the route can reference them
    kanbanTasksTable:          mockKanbanTasksTable,
    runbookJobHistoryTable:    mockRunbookJobHistoryTable,
    scriptRunResultsTable:     mockScriptRunResultsTable,
    clientAutomationRunsTable: mockClientAutomationRunsTable,
    // Remaining tables used by other routes in the same file — stubs only
    azureTenantCredentialsTable:  {},
    clientAppRegistrationsTable:  {},
    usersTable:                   {},
    projectsTable:                {},
    powershellScriptsTable:       {},
    scriptModulesTable:           {},
  },
});

mock.module("../middlewares/requireAuth.ts", {
  namedExports: {
    requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
    requireAuth:  (_req: unknown, _res: unknown, next: () => void) => next(),
  },
});

mock.module("../lib/azure-automation.ts", {
  namedExports: {
    getJobStatus: async (_jobId: string) => ({
      status: azureStatusToReturn,
      statusDetails: null,
    }),
    getJobOutput: async (_jobId: string) => [
      { sequence: 1, streamType: "Output", text: "All done." },
    ],
    isTerminalStatus: (s: string) =>
      ["Completed", "Failed", "Stopped", "Suspended"].includes(s),
    isAzureConfigured:   () => true,
    listRunbooks:        async () => [],
    createRunbookJob:    async () => ({ jobId: FAKE_JOB_ID, status: "New" }),
    pushScriptToAzure:   async () => {},
  },
});

const noop = () => {};
const noopLogger = {
  info:  noop, warn: noop, error: noop, debug: noop,
  fatal: noop, trace: noop, child: () => noopLogger,
};
mock.module("../lib/logger.ts", {
  namedExports: { logger: noopLogger },
});

mock.module("../lib/azure-keyvault.ts", {
  namedExports: {
    getCredential:  async () => ({ tenantId: "t", clientId: "c", clientSecret: "s" }),
    getSecretValue: async () => "secret",
  },
});

mock.module("../lib/sms.ts", {
  namedExports: { sendAdminSms: async () => {} },
});

mock.module("../lib/ps-guard.ts", {
  namedExports: {
    hasPsKeywords:        (_s: string) => true,
    hasPsKeywordsFullText: (_s: string) => true,
    validatePsSyntax:     async () => ({ valid: true, errors: [] }),
  },
});

mock.module("@workspace/integrations-anthropic-ai", {
  namedExports: {
    anthropic: {
      messages: {
        create:  async () => ({ content: [{ type: "text", text: "" }] }),
        stream:  () => ({ on: () => ({}), finalMessage: async () => ({}) }),
      },
    },
  },
});

// ── Dynamically import the REAL route AFTER mocks are registered ──────────────
const { default: scriptRunnerRouter } = await import("./admin-script-runner.ts");

// ── Build a minimal Express app ───────────────────────────────────────────────
const { default: express } = await import("express");
const app = express();
app.use(express.json());
app.use("/api", scriptRunnerRouter);

// ── Start / stop test HTTP server ─────────────────────────────────────────────
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

// Reset captured state before every test
beforeEach(() => {
  capturedKanbanSetArgs = null;
  kanbanUpdateCalled    = false;
});

// ── Helper ────────────────────────────────────────────────────────────────────
async function pollOutput(jobId: string, kanbanTaskId: number) {
  const url = `${baseUrl}/api/admin/runbook-jobs/output?jobId=${jobId}&kanbanTaskId=${kanbanTaskId}`;
  const res  = await fetch(url);
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/admin/runbook-jobs/output — stale 'Running' badge regression guard", () => {
  describe("when Azure reports Completed (terminal)", () => {
    beforeEach(() => {
      azureStatusToReturn = "Completed";
    });

    it("responds HTTP 200 with terminal: true", async () => {
      const { status, body } = await pollOutput(FAKE_JOB_ID, FAKE_TASK_ID);
      assert.equal(status, 200);
      assert.equal(body["terminal"], true, `expected terminal=true; got ${JSON.stringify(body)}`);
    });

    it("responds with kanbanMetaUpdated: true confirming the DB patch was applied", async () => {
      const { body } = await pollOutput(FAKE_JOB_ID, FAKE_TASK_ID);
      assert.equal(
        body["kanbanMetaUpdated"],
        true,
        `expected kanbanMetaUpdated=true; got ${JSON.stringify(body)}`,
      );
    });

    it("clears runningJobRef to null in the DB update so the badge disappears on reload", async () => {
      await pollOutput(FAKE_JOB_ID, FAKE_TASK_ID);
      assert.ok(
        kanbanUpdateCalled,
        "expected db.update(kanbanTasksTable) to be called",
      );
      const meta = capturedKanbanSetArgs?.["taskMetadata"] as Record<string, unknown>;
      assert.strictEqual(
        meta?.["runningJobRef"],
        null,
        `expected runningJobRef=null; got ${JSON.stringify(meta)}`,
      );
    });

    it("stamps lastJobStatus with the terminal value Completed", async () => {
      await pollOutput(FAKE_JOB_ID, FAKE_TASK_ID);
      const meta = capturedKanbanSetArgs?.["taskMetadata"] as Record<string, unknown>;
      assert.equal(
        meta?.["lastJobStatus"],
        "Completed",
        `expected lastJobStatus=Completed; got ${JSON.stringify(meta)}`,
      );
    });
  });

  describe("when Azure reports Failed (terminal)", () => {
    beforeEach(() => {
      azureStatusToReturn = "Failed";
    });

    it("responds HTTP 200 with terminal: true", async () => {
      const { status, body } = await pollOutput(FAKE_JOB_ID, FAKE_TASK_ID);
      assert.equal(status, 200);
      assert.equal(body["terminal"], true);
    });

    it("clears runningJobRef to null so no stale badge lingers", async () => {
      await pollOutput(FAKE_JOB_ID, FAKE_TASK_ID);
      const meta = capturedKanbanSetArgs?.["taskMetadata"] as Record<string, unknown>;
      assert.strictEqual(
        meta?.["runningJobRef"],
        null,
        `expected runningJobRef=null after Failed; got ${JSON.stringify(meta)}`,
      );
    });

    it("stamps lastJobStatus with the terminal value Failed", async () => {
      await pollOutput(FAKE_JOB_ID, FAKE_TASK_ID);
      const meta = capturedKanbanSetArgs?.["taskMetadata"] as Record<string, unknown>;
      assert.equal(
        meta?.["lastJobStatus"],
        "Failed",
        `expected lastJobStatus=Failed; got ${JSON.stringify(meta)}`,
      );
    });
  });

  describe("when Azure reports Running (non-terminal)", () => {
    beforeEach(() => {
      azureStatusToReturn = "Running";
    });

    it("responds HTTP 200 with terminal: false", async () => {
      const { status, body } = await pollOutput(FAKE_JOB_ID, FAKE_TASK_ID);
      assert.equal(status, 200);
      assert.equal(
        body["terminal"],
        false,
        `expected terminal=false for Running; got ${JSON.stringify(body)}`,
      );
    });

    it("does NOT update kanban taskMetadata while the job is still running", async () => {
      await pollOutput(FAKE_JOB_ID, FAKE_TASK_ID);
      assert.equal(
        kanbanUpdateCalled,
        false,
        "expected NO db.update(kanbanTasksTable) while job is still Running",
      );
    });
  });

  describe("missing jobId parameter", () => {
    it("returns HTTP 400", async () => {
      const res = await fetch(`${baseUrl}/api/admin/runbook-jobs/output`);
      assert.equal(res.status, 400);
    });
  });
});
