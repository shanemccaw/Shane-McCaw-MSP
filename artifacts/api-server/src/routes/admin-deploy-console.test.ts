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
const mockExecSync = vi.hoisted(() => vi.fn(() => "/repo\n"));

vi.mock("child_process", () => ({
  exec: mockExec,
  execSync: mockExecSync,
}));

vi.mock("../middlewares/requireAuth", () => ({
  requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!(req.headers["x-test-admin"] === "1")) {
      res.status(403).json({ error: "not admin" });
      return;
    }
    req.user = { id: 1, email: "admin-1@test", role: "admin" };
    next();
  },
}));

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
});

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
