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
 *  - mock.module() stubs ../lib/ps-execution-client.ts with a recording
 *    callPsExecution() (Git #4262 — the route no longer touches the retired
 *    azure-automation.ts stub at all), so POST /admin/run-script is exercised
 *    through to the container call.
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
const dbUpdates: Array<Record<string, unknown>> = [];
const psCalls: Array<{ cmdletKey: string; params: Record<string, unknown> }> = [];

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
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => { dbUpdates.push(values); return Promise.resolve(); },
      }),
    }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: 7 }]) }) }),
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
    tenantsTable: {},
  },
});

mock.module("../middlewares/requireAuth.ts", {
  namedExports: {
    requireAdmin: (req: any, _res: unknown, next: () => void) => {
      req.user = { id: 1, email: "admin@test.local", role: "admin" };
      next();
    },
    requireAuth: (req: any, _res: unknown, next: () => void) => {
      req.user = { id: 1, email: "admin@test.local", role: "admin" };
      next();
    },
    requireCapability: () => (req: any, _res: unknown, next: () => void) => {
      req.user = { id: 1, email: "admin@test.local", role: "admin" };
      next();
    },
  },
});

// PlatformAdmin cross-platform scope (#4255) — MSP scoping itself is
// live-verified against the real DB, not exercised in this mocked suite.
mock.module("../lib/msp-client-scope.ts", {
  namedExports: {
    requireClientScope: async () => ({ mspId: null }),
    resolveClientScope: async () => ({ mspId: null }),
    clientInScope: async () => true,
  },
});

class FakePsExecutionError extends Error {
  kind = "script_error";
  cmdletKey = "";
  containerErrorKind: string | undefined = undefined;
}
mock.module("../lib/ps-execution-client.ts", {
  namedExports: {
    callPsExecution: async (cmdletKey: string, params: Record<string, unknown>) => {
      psCalls.push({ cmdletKey, params });
      return { items: [{ Name: "conn" }], rawResponse: [{ Name: "conn" }] };
    },
    PsExecutionError: FakePsExecutionError,
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

mock.module("../lib/audit.ts", {
  namedExports: { createAuditLog: async () => {}, auditPrivilegedRead: async () => {}, resolveAuditActorRole: () => "platform_admin" },
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
  dbUpdates.length = 0;
  psCalls.length = 0;
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
        abandoned: false,
      };
    });

    it("responds HTTP 200 with status: running and no output yet (the container call is synchronous)", async () => {
      const { status, body } = await pollStatus(FAKE_JOB_ID);
      assert.equal(status, 200);
      assert.equal(body["status"], "running");
      assert.deepEqual(body["outputLines"], []);
      assert.equal(dbUpdates.length, 0);
    });
  });

  describe("when a running row outlived the ps-execution timeout (api-server restarted mid-run)", () => {
    beforeEach(() => {
      fakeRunResultRow = {
        id: 1,
        status: "running",
        parsedFindings: null,
        recommendations: null,
        scoreImpact: null,
        rawOutput: null,
        abandoned: true,
      };
    });

    it("marks the run failed and reports it, instead of leaving the poller spinning", async () => {
      const { status, body } = await pollStatus(FAKE_JOB_ID);
      assert.equal(status, 200);
      assert.equal(body["status"], "failed");
      assert.equal(dbUpdates[0]?.["status"], "failed");
      assert.match(String((body["outputLines"] as string[])[0]), /abandoned/);
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

// ── POST /api/admin/run-script (Git #4262) ────────────────────────────────────

const TESTBED_TENANT_GUID = "11111111-2222-3333-4444-555555555555";

async function postRun(body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/api/admin/run-script`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const rawTenantBody = {
  libraryScriptId: "b339648d-fe2c-45aa-9a5e-bd7f40274489",
  tenantId: TESTBED_TENANT_GUID,
  clientId: "ignored-client-id",
  clientSecret: "ignored-secret",
};

describe("POST /api/admin/run-script", () => {
  it("refuses a library script with no ps-execution catalog binding (422) — no run row, no container call", async () => {
    // Every select in the mocked db reads this row back; for the POST it is the powershell_scripts row.
    fakeRunResultRow = { id: rawTenantBody.libraryScriptId, title: "Unbound Script", psCmdletKey: null, psParams: null };
    const { status, body } = await postRun(rawTenantBody);
    assert.equal(status, 422);
    assert.match(String(body["error"]), /no server-side execution binding/);
    assert.equal(psCalls.length, 0);
  });

  it("runs a bound script through callPsExecution with its catalog key, the stored params, and a server-resolved Organization", async () => {
    fakeRunResultRow = {
      id: rawTenantBody.libraryScriptId,
      title: "Bound Script",
      psCmdletKey: "get-connection-info",
      // A stored Organization must never pick the tenant — the gated one wins.
      psParams: { Organization: "someone-else.onmicrosoft.com" },
      domain: "testbed.onmicrosoft.com",
    };
    const { status, body } = await postRun(rawTenantBody);
    assert.equal(status, 200);
    assert.equal(body["status"], "running");
    assert.match(String(body["jobRef"]), /^[0-9a-f-]{36}$/);
    assert.equal(body["resultId"], 7);

    // Background processing is detached — wait for the container call to land.
    for (let i = 0; i < 50 && dbUpdates.every(u => u["status"] === undefined); i++) {
      await new Promise(r => setTimeout(r, 10));
    }
    assert.equal(psCalls.length, 1);
    assert.equal(psCalls[0].cmdletKey, "get-connection-info");
    assert.equal(psCalls[0].params["Organization"], "testbed.onmicrosoft.com");
    assert.ok(!("ClientSecret" in psCalls[0].params));
    const final = dbUpdates.find(u => u["status"] !== undefined);
    assert.equal(final?.["status"], "completed");
  });
});
