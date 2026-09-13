/**
 * Integration tests for GET /api/admin/run-script/:jobRef/status — the poll
 * endpoint `artifacts/admin-panel/src/lib/scriptPoller.ts` uses to drive the
 * kanban script-running badge.
 *
 * This replaces the old `admin-script-runner.test.ts` suite, which tested a
 * route (`GET /api/admin/runbook-jobs/output`) that no longer exists anywhere
 * in `artifacts/api-server/src/routes` (Git #3882). The architecture changed,
 * not just the path: the old route's premise — that the client's poll request
 * itself patches `kanbanTasksTable.taskMetadata` (`runningJobRef` /
 * `lastJobStatus`) to clear the stale "Running" badge — no longer holds.
 * `scriptPoller.ts` is explicit about this now: "the backend owns kanban task
 * updates." The real kanban sync happens server-side, in this same file's
 * background job-completion handler (after `waitForJobCompletion`), not in
 * the client-poll GET handler. The GET route tested here is a pure read of
 * `scriptRunResultsTable` — it performs no DB writes at all.
 *
 * Approach:
 *  - mock.module() stubs @workspace/db so no real DB connection is opened.
 *    A smart fake db returns a configurable scriptRunResultsTable row.
 *  - mock.module() stubs ../lib/azure-automation.ts with a controllable
 *    getJobOutput() for the still-running case.
 *  - requireAdmin, logger, and other heavy side-effect deps are stubbed.
 *  - The REAL router from admin-m365-run.ts is mounted in a lightweight
 *    Express server and exercised over HTTP with node:fetch.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */
import { describe, it, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

const FAKE_JOB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

// ── Controllable script_run_results row ──────────────────────────────────────
// Set this before each test to control what the GET route reads back.
let fakeRunResultRow: Record<string, unknown> | null = null;

// ── DB mock ───────────────────────────────────────────────────────────────────
const mockScriptRunResultsTable = { _name: "script_run_results", jobId: {} };

function makeMockDb() {
  return {
    select: () => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => ({
          limit: (_n: unknown) => Promise.resolve(fakeRunResultRow ? [fakeRunResultRow] : []),
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
  };
}

// ── Register mocks BEFORE importing the route module ─────────────────────────
mock.module("@workspace/db", {
  namedExports: {
    db: makeMockDb(),
    pool: { query: async () => ({ rows: [] }) },
    scriptRunResultsTable: mockScriptRunResultsTable,
    // Remaining tables imported by admin-m365-run.ts — stubs only, unexercised here
    powershellScriptsTable: {},
    scriptModulesTable: {},
    clientScoresTable: {},
    clientM365ProfilesTable: {},
    azureTenantCredentialsTable: {},
    clientAppRegistrationsTable: {},
    clientAutomationRunsTable: {},
    usersTable: {},
    servicesTable: {},
    kanbanTasksTable: {},
    projectsTable: {},
  },
});

mock.module("../middlewares/requireAuth.ts", {
  namedExports: {
    requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
    requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  },
});

mock.module("../lib/azure-automation.ts", {
  namedExports: {
    getJobStatus: async (_jobId: string) => ({ status: "Running", statusDetails: null }),
    getJobOutput: async (_jobId: string) => [
      { sequence: 1, streamType: "Output", text: "still working..." },
    ],
    isTerminalStatus: (s: string) => ["Completed", "Failed", "Stopped", "Suspended"].includes(s),
    createScriptJob: async () => ({ jobId: FAKE_JOB_ID, status: "New" }),
  },
});

const noop = () => {};
const noopLogger = {
  info: noop, warn: noop, error: noop, debug: noop,
  fatal: noop, trace: noop, child: () => noopLogger,
};
mock.module("../lib/logger.ts", { namedExports: { logger: noopLogger } });

mock.module("../lib/kanban-phase-advance.ts", {
  namedExports: {
    advancePhaseIfComplete: async () => {},
    syncProjectProgress: async () => {},
  },
});

mock.module("../lib/sse-channels.ts", {
  namedExports: { broadcastKanbanChange: () => {} },
});

mock.module("../lib/ai-analyzer.ts", {
  namedExports: { runAiAnalyzer: async () => ({}) },
});

mock.module("../lib/parse-m365-script-output.ts", {
  namedExports: { parseM365ScriptOutput: (_raw: unknown) => ({}) },
});

mock.module("../lib/azure-keyvault.ts", {
  namedExports: { getSecretValue: async () => "secret" },
});

mock.module("../lib/audit.ts", {
  namedExports: { createAuditLog: async () => {} },
});

mock.module("../lib/m365-profile-update.ts", {
  namedExports: {
    applyProfileUpdates: async () => {},
    snapshotHealthFromProfile: async () => {},
  },
});

mock.module("../lib/ai-billing.ts", {
  namedExports: { resolveBillingMspId: async () => null },
});

// ── Dynamically import the REAL route AFTER mocks are registered ──────────────
const { default: m365RunRouter } = await import("./admin-m365-run.ts");

// ── Build a minimal Express app ───────────────────────────────────────────────
const { default: express } = await import("express");
const app = express();
app.use(express.json());
app.use("/api", m365RunRouter);

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

beforeEach(() => {
  fakeRunResultRow = null;
});

// ── Helper ────────────────────────────────────────────────────────────────────
async function pollStatus(jobRef: string) {
  const res = await fetch(`${baseUrl}/api/admin/run-script/${jobRef}/status`);
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/admin/run-script/:jobRef/status", () => {
  describe("when the job is still running", () => {
    beforeEach(() => {
      fakeRunResultRow = {
        id: 1,
        status: "running",
        parsedFindings: null,
        recommendations: null,
        scoreImpact: null,
        rawOutput: null,
      };
    });

    it("responds HTTP 200 with status: running and live output pulled from Azure", async () => {
      const { status, body } = await pollStatus(FAKE_JOB_ID);
      assert.equal(status, 200);
      assert.equal(body["status"], "running");
      assert.deepEqual(body["outputLines"], ["still working..."]);
    });
  });

  describe("when the job has completed (terminal)", () => {
    beforeEach(() => {
      fakeRunResultRow = {
        id: 1,
        status: "completed",
        parsedFindings: [{ id: "f1" }],
        recommendations: ["do the thing"],
        scoreImpact: { overall: 5 },
        rawOutput: { output: "All done.\nSecond line." },
      };
    });

    it("responds HTTP 200 with status: completed and the stored output, findings and recommendations", async () => {
      const { status, body } = await pollStatus(FAKE_JOB_ID);
      assert.equal(status, 200);
      assert.equal(body["status"], "completed");
      assert.deepEqual(body["outputLines"], ["All done.", "Second line."]);
      assert.deepEqual(body["findings"], [{ id: "f1" }]);
      assert.deepEqual(body["recommendations"], ["do the thing"]);
      assert.deepEqual(body["scoreImpact"], { overall: 5 });
    });
  });

  describe("unknown jobRef", () => {
    it("returns HTTP 404", async () => {
      fakeRunResultRow = null;
      const { status, body } = await pollStatus("does-not-exist");
      assert.equal(status, 404);
      assert.equal(body["error"], "Job not found");
    });
  });
});
