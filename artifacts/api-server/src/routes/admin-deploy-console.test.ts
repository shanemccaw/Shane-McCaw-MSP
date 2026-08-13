/**
 * admin-deploy-console.test.ts
 *
 * The Deploy Console has two shapes with two different threat models:
 *   - the six whitelisted operations (`/deploy/:operation`) — the route
 *     param is only ever a lookup key into a fixed map of literal command
 *     strings, never interpolated;
 *   - the free-text console (`/deploy/console`) — genuinely runs whatever
 *     command the caller sends, by design (a real terminal for a
 *     `requireAdmin`-gated admin), so the load-bearing assertions here are
 *     that it is gated the same way, logs who ran what, and cannot be
 *     reached with an empty command.
 *
 * `child_process.exec` is mocked throughout — this suite must never actually
 * run a command on the machine it executes on.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

process.env["DATABASE_URL"] = "postgres://test";

const mockExec = vi.hoisted(() => vi.fn());
const mockDbQuery = vi.hoisted(() => vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [], rowCount: 1 })));
const mockExecSync = vi.hoisted(() => vi.fn(() => "/repo\n"));

// build-complete (#911) runs its schema SQL on a DEDICATED pooled connection
// (`pool.connect()`), distinct from the `pool.query` run-history uses — so it
// gets its own client mock, whose calls (BEGIN / statements / COMMIT / ROLLBACK)
// are what the transaction tests assert against.
const mockClientQuery = vi.hoisted(() => vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [], rowCount: 1 })));
const mockClientRelease = vi.hoisted(() => vi.fn());
const mockConnect = vi.hoisted(() => vi.fn(async () => ({ query: mockClientQuery, release: mockClientRelease })));

vi.mock("child_process", () => ({
  exec: mockExec,
  execSync: mockExecSync,
}));

// Every completed run is recorded to simulator_run_history through
// lib/run-history.ts, which holds `pool` from @workspace/db. Mocked for the
// same reason `logger` is below (a real import throws without DATABASE_URL),
// and so the recording itself is assertable.
vi.mock("@workspace/db", () => ({
  pool: { query: mockDbQuery, connect: mockConnect },
}));

// This whole file is gated by `requireAdminOrIngestToken()` (Git #702), which
// RETURNS a middleware — the mock mirrors that shape. (`requireAdmin` is kept
// too, harmlessly, since the real module exports both.)
vi.mock("../middlewares/requireAuth", () => {
  const gate = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!(req.headers["x-test-admin"] === "1")) {
      res.status(403).json({ error: "not admin" });
      return;
    }
    req.user = { id: 1, email: "admin-1@test", role: "admin" };
    next();
  };
  return {
    requireAdmin: gate,
    requireAdminOrIngestToken: () => gate,
  };
});

// `logger.ts` transitively pulls in `lib/db`, which throws at import time
// without a real DATABASE_URL — mock it directly rather than relying on
// process.env timing (same pattern as admin-ai-billing.test.ts).
vi.mock("../lib/logger", () => ({
  logger: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import adminDeployConsoleRouter from "./admin-deploy-console";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(adminDeployConsoleRouter);
  return app;
}

/** Resolves the given exec call as if the command succeeded with `stdout`. */
function succeed(stdout: string) {
  mockExec.mockImplementationOnce((_cmd, _opts, cb) => cb(null, stdout, ""));
}

function fail(message: string) {
  mockExec.mockImplementationOnce((_cmd, _opts, cb) => cb(new Error(message), "", ""));
}

beforeEach(() => {
  mockExec.mockReset();
  mockExecSync.mockReset().mockReturnValue("/repo\n");
  mockDbQuery.mockClear();
  mockConnect.mockClear();
  mockClientRelease.mockClear();
  mockClientQuery.mockReset();
  mockClientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
});

/** The parameters of the run-history INSERT, if one was issued. */
function recordedRun(): unknown[] | undefined {
  const insert = mockDbQuery.mock.calls.find((call) => String(call[0]).includes("simulator_run_history"));
  return insert?.[1] as unknown[] | undefined;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("requireAdmin gating", () => {
  it("rejects an unauthenticated caller on the whitelist route", async () => {
    const res = await request(buildApp()).post("/admin/simulator/deploy/git-status");
    expect(res.status).toBe(403);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller on the free-text route", async () => {
    const res = await request(buildApp()).post("/admin/simulator/deploy/console").send({ command: "ls" });
    expect(res.status).toBe(403);
    expect(mockExec).not.toHaveBeenCalled();
  });
});

describe("whitelisted operations", () => {
  it("runs a known operation and reports its real output", async () => {
    succeed("## main...origin/main");
    const res = await request(buildApp())
      .post("/admin/simulator/deploy/git-status")
      .set("x-test-admin", "1");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.steps[0].output).toBe("## main...origin/main");
  });

  it("rejects a key outside the whitelist without ever calling exec", async () => {
    const res = await request(buildApp())
      .post("/admin/simulator/deploy/not-a-real-operation")
      .set("x-test-admin", "1");

    expect(res.status).toBe(400);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("stops full-rebuild at the first failing step and does not run the rest", async () => {
    fail("fatal: not a fast-forward");
    const res = await request(buildApp())
      .post("/admin/simulator/deploy/full-rebuild")
      .set("x-test-admin", "1");

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(mockExec).toHaveBeenCalledTimes(1);
  });
});

describe("free-text console", () => {
  it("runs the exact command sent, not a whitelist lookup", async () => {
    succeed("total 0\ndrwxr-xr-x  2 root root");
    const res = await request(buildApp())
      .post("/admin/simulator/deploy/console")
      .set("x-test-admin", "1")
      .send({ command: "ls -la" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.output).toContain("drwxr-xr-x");
    expect(mockExec).toHaveBeenCalledWith(
      "ls -la",
      expect.objectContaining({ cwd: "/repo" }),
      expect.any(Function),
    );
  });

  it("rejects an empty command without calling exec", async () => {
    const res = await request(buildApp())
      .post("/admin/simulator/deploy/console")
      .set("x-test-admin", "1")
      .send({ command: "   " });

    expect(res.status).toBe(400);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("reports a failed command as ok:false with its output", async () => {
    fail("command not found: fooo");
    const res = await request(buildApp())
      .post("/admin/simulator/deploy/console")
      .set("x-test-admin", "1")
      .send({ command: "fooo" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.output).toContain("command not found");
  });
});

describe("run history", () => {
  // The row is written HERE, by the route, before it answers — not by the
  // browser reporting what it saw. That is what makes a run survive a closed
  // tab and show up in another admin's history.
  const COLS = ["kind", "cmd", "title", "ticket", "started_at", "duration_ms", "ok", "effect", "output"] as const;
  const at = (name: (typeof COLS)[number], params: unknown[]) => params[COLS.indexOf(name)];

  it("records a whitelisted operation with the read/write kind the whitelist declares", async () => {
    succeed("## main...origin/main");
    await request(buildApp()).post("/admin/simulator/deploy/git-status").set("x-test-admin", "1");

    const params = recordedRun();
    expect(params).toBeTruthy();
    expect(at("kind", params!)).toBe("deploy");
    expect(at("ok", params!)).toBe(true);
    expect(at("cmd", params!)).toBe("git status --short --branch");
    // "read only" can only ever come from OPERATION_KIND, never from the text.
    expect(JSON.parse(String(at("effect", params!)))).toEqual(["read only"]);
    expect(String(at("output", params!))).toContain("## main...origin/main");
  });

  it("records a free-typed command without claiming anything about its effect", async () => {
    succeed("done");
    await request(buildApp())
      .post("/admin/simulator/deploy/console")
      .set("x-test-admin", "1")
      .send({ command: "rm -rf /tmp/whatever" });

    const params = recordedRun();
    expect(params).toBeTruthy();
    expect(at("cmd", params!)).toBe("rm -rf /tmp/whatever");
    // No "read only": the whitelist cannot classify text it has never seen,
    // and a wrong read-only chip on a command that wrote is the worst thing
    // Run History could say.
    expect(JSON.parse(String(at("effect", params!)))).toEqual([]);
  });

  it("records a stopped rebuild, naming the step it stopped at", async () => {
    fail("fatal: not a fast-forward");
    await request(buildApp()).post("/admin/simulator/deploy/full-rebuild").set("x-test-admin", "1");

    const params = recordedRun();
    expect(params).toBeTruthy();
    expect(at("ok", params!)).toBe(false);
    expect(JSON.parse(String(at("effect", params!)))).toContain("stopped at git pull --ff-only");
  });

  it("still answers normally when the history table does not exist yet", async () => {
    // The expected state until the manual migration is run. A deploy that
    // succeeded must never be reported as failed because the log could not be
    // written.
    mockDbQuery.mockRejectedValueOnce(
      Object.assign(new Error('relation "simulator_run_history" does not exist'), { code: "42P01" }),
    );
    succeed("## main...origin/main");

    const res = await request(buildApp()).post("/admin/simulator/deploy/git-status").set("x-test-admin", "1");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.steps[0].output).toBe("## main...origin/main");
  });
});

describe("build-complete pipeline (#911)", () => {
  it("is gated by requireDeployAccess like the rest of the file", async () => {
    const res = await request(buildApp()).post("/admin/deploy/build-complete").send({});
    expect(res.status).toBe(403);
    expect(mockExec).not.toHaveBeenCalled();
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("HARD-rejects the whole request if ANY statement is not CREATE/ALTER/INSERT, executing nothing", async () => {
    const res = await request(buildApp())
      .post("/admin/deploy/build-complete")
      .set("x-test-admin", "1")
      .send({ schemaSql: "CREATE TABLE t (id int);\nDROP TABLE other;" });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.offendingStatement).toContain("DROP");
    // No partial execution: no transaction opened, no git pull, no restart.
    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("rejects an UPDATE the same way (write, but not CREATE/ALTER/INSERT)", async () => {
    const res = await request(buildApp())
      .post("/admin/deploy/build-complete")
      .set("x-test-admin", "1")
      .send({ schemaSql: "UPDATE users SET is_admin = true;" });

    expect(res.status).toBe(400);
    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("is not fooled by a leading comment in front of a forbidden statement", async () => {
    const res = await request(buildApp())
      .post("/admin/deploy/build-complete")
      .set("x-test-admin", "1")
      .send({ schemaSql: "-- innocent looking\n/* block */ TRUNCATE audit_log;" });

    expect(res.status).toBe(400);
    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("applies allowed schema SQL in ONE transaction, then pulls, then schedules the deferred restart", async () => {
    succeed("Already up to date.");                 // git pull --ff-only
    succeed("restart scheduled: killing PID 1 …");   // restart (deferred)

    const res = await request(buildApp())
      .post("/admin/deploy/build-complete")
      .set("x-test-admin", "1")
      .send({ schemaSql: "CREATE TABLE t (id int);\nALTER TABLE t ADD COLUMN name text;" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.restarting).toBe(true);
    expect(res.body.pollUrl).toBe("/api/internal/deploy-status");
    // schema SQL + git pull + restart
    expect(res.body.steps).toHaveLength(3);
    expect(res.body.steps[0].label).toContain("apply schema SQL");

    // All-or-nothing: BEGIN … COMMIT on the one dedicated client, then released.
    const clientSql = mockClientQuery.mock.calls.map((c) => String(c[0]));
    expect(clientSql).toContain("BEGIN");
    expect(clientSql).toContain("COMMIT");
    expect(clientSql).not.toContain("ROLLBACK");
    expect(mockClientRelease).toHaveBeenCalled();

    // git pull first, restart second.
    expect(mockExec).toHaveBeenCalledTimes(2);
    expect(String(mockExec.mock.calls[0]![0])).toContain("git pull --ff-only");
    expect(String(mockExec.mock.calls[1]![0])).toContain("kill 1");
  });

  it("rolls back and skips pull/restart when a statement fails mid-transaction", async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (/create table/i.test(sql)) throw new Error("boom");
      return { rows: [], rowCount: 1 };
    });

    const res = await request(buildApp())
      .post("/admin/deploy/build-complete")
      .set("x-test-admin", "1")
      .send({ schemaSql: "CREATE TABLE t (id int);" });

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    const clientSql = mockClientQuery.mock.calls.map((c) => String(c[0]));
    expect(clientSql).toContain("ROLLBACK");
    // The failure stops the pipeline: neither git pull nor restart run.
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("runs git pull then restart with no schemaSql at all", async () => {
    succeed("Already up to date.");   // git pull
    succeed("restart scheduled");     // restart

    const res = await request(buildApp())
      .post("/admin/deploy/build-complete")
      .set("x-test-admin", "1")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.steps).toHaveLength(2);
    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockExec).toHaveBeenCalledTimes(2);
  });

  it("skips the restart when git pull fails (server keeps the current commit)", async () => {
    fail("fatal: not a fast-forward");   // git pull

    const res = await request(buildApp())
      .post("/admin/deploy/build-complete")
      .set("x-test-admin", "1")
      .send({});

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    // Only the git pull exec ran — restart was never scheduled.
    expect(mockExec).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-string schemaSql without touching the DB or shell", async () => {
    const res = await request(buildApp())
      .post("/admin/deploy/build-complete")
      .set("x-test-admin", "1")
      .send({ schemaSql: { not: "a string" } });

    expect(res.status).toBe(400);
    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockExec).not.toHaveBeenCalled();
  });
});
