/**
 * `version.ts` — Git #666.
 *
 * The behaviour worth pinning: production has no `.git` directory, so the
 * synchronous git shellout in `computeVersionInfo()` always throws there.
 * Before this fix, the catch block returned a hardcoded, meaningless
 * placeholder unconditionally. Now it kicks off an async read of the real
 * `deployed_version_stamp` table and serves that once it resolves, falling
 * back to the generic placeholder only if that table is empty too.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(() => {
    throw new Error("git: command not found (simulated production — no .git directory)");
  }),
}));

const queued = vi.hoisted(() => [] as unknown[][]);

const dbChain = vi.hoisted(() => {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "from", "orderBy", "limit", "insert", "values", "returning"]) {
    chain[method] = (..._args: unknown[]) => chain;
  }
  chain["then"] = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(queued.shift() ?? []).then(resolve, reject);
  return chain;
});

vi.mock("@workspace/db", () => ({
  db: dbChain,
  deployedVersionStampTable: {
    id: "id",
    commitHash: "commit_hash",
    commitMessage: "commit_message",
    deployedAt: "deployed_at",
  },
}));

// Rejects by default so requireAdminOrDeployToken's fall-through path is
// actually exercised, not masked by an always-allow stub. A request can opt
// into "authenticated admin session" with a test-only header.
vi.mock("../middlewares/requireAuth", () => ({
  requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.header("x-test-admin-session") === "yes") {
      next();
      return;
    }
    res.status(401).json({ error: "Invalid or expired token" });
  },
}));

/** Queue the rowsets the route will await, in order. */
function stub(...rowsets: unknown[][]) {
  queued.length = 0;
  queued.push(...rowsets);
}

function buildApp(router: express.IRouter) {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

/** Let the module's fire-and-forget fallback promise settle before asserting. */
async function flushMicrotasks() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe("GET /version — Git #666 deployed_version_stamp fallback", () => {
  beforeEach(() => {
    vi.resetModules();
    queued.length = 0;
  });

  it("serves the real deployed stamp once the async DB lookup resolves", async () => {
    stub([{ id: 3, commitHash: "abc1234", commitMessage: "Real deploy commit", deployedAt: new Date() }]);

    const { default: versionRouter } = await import("./version");
    await flushMicrotasks();

    const app = buildApp(versionRouter);
    const res = await request(app).get("/version");

    expect(res.status).toBe(200);
    expect(res.body.hash).toBe("abc1234");
    expect(res.body.display).toBe("1.0.0 (abc1234)");
  });

  it("falls back to the generic placeholder when deployed_version_stamp is empty", async () => {
    stub([]);

    const { default: versionRouter } = await import("./version");
    await flushMicrotasks();

    const app = buildApp(versionRouter);
    const res = await request(app).get("/version");

    expect(res.status).toBe(200);
    expect(res.body.hash).toBe("unknown");
    expect(res.body.display).toBe("1.0.0 (unknown)");
  });
});

describe("POST /admin/version-stamp", () => {
  const originalDeployToken = process.env.DEPLOY_STAMP_TOKEN;

  beforeEach(() => {
    vi.resetModules();
    queued.length = 0;
    delete process.env.DEPLOY_STAMP_TOKEN;
  });

  afterEach(() => {
    if (originalDeployToken === undefined) delete process.env.DEPLOY_STAMP_TOKEN;
    else process.env.DEPLOY_STAMP_TOKEN = originalDeployToken;
  });

  it("writes a row and returns it for a real admin session", async () => {
    stub([]); // startup fallback lookup (empty)
    const { default: versionRouter } = await import("./version");
    await flushMicrotasks();

    stub([{ id: 5, commitHash: "def5678", commitMessage: "Deploy commit", deployedAt: new Date() }]);

    const app = buildApp(versionRouter);
    const res = await request(app)
      .post("/admin/version-stamp")
      .set("x-test-admin-session", "yes")
      .send({ commitHash: "def5678", commitMessage: "Deploy commit" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.stamp.commitHash).toBe("def5678");
  });

  it("400s when commitHash/commitMessage are missing", async () => {
    stub([]);
    const { default: versionRouter } = await import("./version");
    await flushMicrotasks();

    const app = buildApp(versionRouter);
    const res = await request(app)
      .post("/admin/version-stamp")
      .set("x-test-admin-session", "yes")
      .send({});

    expect(res.status).toBe(400);
  });

  it("401s with no admin session and no deploy token configured", async () => {
    stub([]);
    const { default: versionRouter } = await import("./version");
    await flushMicrotasks();

    const app = buildApp(versionRouter);
    const res = await request(app)
      .post("/admin/version-stamp")
      .send({ commitHash: "def5678", commitMessage: "Deploy commit" });

    expect(res.status).toBe(401);
  });

  it("accepts a correct X-Deploy-Token even with no admin session — the postBuild path", async () => {
    process.env.DEPLOY_STAMP_TOKEN = "real-deploy-secret";
    stub([]);
    const { default: versionRouter } = await import("./version");
    await flushMicrotasks();

    stub([{ id: 6, commitHash: "aaa1111", commitMessage: "postBuild deploy", deployedAt: new Date() }]);

    const app = buildApp(versionRouter);
    const res = await request(app)
      .post("/admin/version-stamp")
      .set("X-Deploy-Token", "real-deploy-secret")
      .send({ commitHash: "aaa1111", commitMessage: "postBuild deploy" });

    expect(res.status).toBe(200);
    expect(res.body.stamp.commitHash).toBe("aaa1111");
  });

  it("rejects an incorrect X-Deploy-Token and does not fall back to admin session", async () => {
    process.env.DEPLOY_STAMP_TOKEN = "real-deploy-secret";
    stub([]);
    const { default: versionRouter } = await import("./version");
    await flushMicrotasks();

    const app = buildApp(versionRouter);
    const res = await request(app)
      .post("/admin/version-stamp")
      .set("X-Deploy-Token", "wrong-secret")
      .send({ commitHash: "aaa1111", commitMessage: "postBuild deploy" });

    expect(res.status).toBe(401);
  });
});
