#!/usr/bin/env node
// scripts/dev-server/selftest.mjs
//
// Real verification of the coordination logic against a THROWAWAY temp git repo,
// with a fake restart -- so it never touches the real dev server or checkout.
//
//   node scripts/dev-server/selftest.mjs
//
// Scenarios:
//   1. Deterministic coalescing -- 4 pending requests, ONE runCycle drains them
//      all and restarts exactly once; every commit is confirmed live.
//   2. Already-live join -- requesting a restart for an already-merged commit
//      returns landed+joined with NO new restart.
//   3. Real cross-process concurrency -- N child processes each run the actual
//      request-restart.mjs CLI at once; all commits land, none are lost, and the
//      restart count is < N (batching genuinely happened).
//   4. Merge conflict handling -- a conflicting commit is reported failed and
//      aborted, leaving the server checkout clean and the other commit intact.
//   5. Stale-lock recovery -- a lock owned by a dead pid is broken and retaken.

import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert";

import { loadConfig } from "./config.mjs";
import { git, revParse, isAncestor } from "./git.mjs";
import { enqueue, outcomeFor } from "./queue.mjs";
import { runCycle } from "./coordinator.mjs";
import { tryAcquire, pidAlive } from "./lock.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REQUEST_RESTART = path.join(HERE, "request-restart.mjs");

let PASS = 0;
let FAIL = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    PASS++;
  } catch (e) {
    console.error(`  FAIL  ${name}\n        ${e.message}`);
    FAIL++;
  }
}

function G(repo, args) {
  const r = git(repo, args);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} => ${r.stderr}`);
  return r.stdout.trim();
}

/** Build a temp repo: dev-server branch + N agent branches (distinct files). */
function makeRepo(nAgents, { conflicting = false } = {}) {
  const repo = mkdtempSync(path.join(os.tmpdir(), "dsst-"));
  G(repo, ["init", "-q"]);
  G(repo, ["config", "user.email", "selftest@example.com"]);
  G(repo, ["config", "user.name", "Dev Server Selftest"]);
  G(repo, ["config", "commit.gpgsign", "false"]);
  writeFileSync(path.join(repo, "base.txt"), "base\n");
  if (conflicting) writeFileSync(path.join(repo, "shared.txt"), "line0\n");
  G(repo, ["add", "-A"]);
  G(repo, ["commit", "-q", "-m", "initial"]);
  G(repo, ["branch", "-m", "dev-server"]);
  const initial = revParse(repo, "HEAD");

  const agents = [];
  for (let i = 0; i < nAgents; i++) {
    const branch = `feat${i}`;
    G(repo, ["checkout", "-q", "-b", branch, initial]);
    if (conflicting) {
      writeFileSync(path.join(repo, "shared.txt"), `agent-${i}-change\n`);
    } else {
      writeFileSync(path.join(repo, `agent${i}.txt`), `agent ${i}\n`);
    }
    G(repo, ["add", "-A"]);
    G(repo, ["commit", "-q", "-m", `agent ${i} work`]);
    agents.push({ branch, sha: revParse(repo, "HEAD") });
    G(repo, ["checkout", "-q", "dev-server"]);
  }
  return { repo, initial, agents };
}

function baseEnv(repo, stateDir) {
  return {
    DEV_SERVER_MAIN_ROOT: repo,
    DEV_SERVER_WORKTREE: repo,
    DEV_SERVER_STATE_DIR: stateDir,
    DEV_SERVER_BRANCH: "dev-server",
    DEV_SERVER_FAKE_RESTART: "1",
    DEV_SERVER_HEARTBEAT_MS: "300",
    DEV_SERVER_STALE_LOCK_MS: "5000",
    DEV_SERVER_ACQUIRE_BACKOFF_MS: "120",
    DEV_SERVER_MAX_WAIT_MS: "60000",
  };
}

function applyEnv(env) {
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
}

function restartCount(config) {
  if (!existsSync(config.restartsLog)) return 0;
  return readFileSync(config.restartsLog, "utf8").split(/\r?\n/).filter(Boolean).length;
}

async function main() {
  const cleanup = [];

  // ---------------------------------------------------------------
  // Scenario 1: deterministic coalescing -- one cycle drains a batch.
  // ---------------------------------------------------------------
  console.log("Scenario 1: deterministic coalescing (4 pending -> 1 restart)");
  {
    const { repo, agents } = makeRepo(4);
    cleanup.push(repo);
    const stateDir = path.join(repo, "_state");
    applyEnv(baseEnv(repo, stateDir));
    const config = loadConfig({ cwd: repo });

    let restarts = 0;
    const fakeRestart = async () => {
      restarts++;
      return { oldPid: null, newPid: -1, ready: true, fake: true };
    };

    const ids = agents.map((a) =>
      enqueue(config, { agentId: a.branch, commit: a.sha, worktree: repo })
    );
    const record = await runCycle(config, { restart: fakeRestart });

    check("exactly one restart for the whole batch", () =>
      assert.strictEqual(restarts, 1, `expected 1 restart, got ${restarts}`)
    );
    check("batch size is 4", () =>
      assert.strictEqual(record.batchSize, 4, `batchSize=${record.batchSize}`)
    );
    check("all 4 commits confirmed live (merge-base --is-ancestor)", () => {
      const head = revParse(repo, "HEAD");
      for (const a of agents)
        assert.ok(isAncestor(repo, a.sha, head), `${a.branch} not ancestor of HEAD`);
    });
    check("every request has a landed outcome", () => {
      for (const id of ids) {
        const o = outcomeFor(config, id);
        assert.ok(o && o.landed, `request ${id} not landed`);
      }
    });

    // -------------------------------------------------------------
    // Scenario 2: already-live join -- no new restart.
    // -------------------------------------------------------------
    console.log("Scenario 2: already-live join (no extra restart)");
    const before = restartCount(config); // fake CLI restarts go to restartsLog
    const child = spawnSync(
      process.execPath,
      [REQUEST_RESTART, "--commit", agents[0].sha, "--agent", "rejoin", "--worktree", repo, "--json"],
      { env: { ...process.env }, encoding: "utf8" }
    );
    const res = JSON.parse(child.stdout || "{}");
    check("already-live request reports landed + joined", () =>
      assert.ok(res.landed && res.joined && !res.restarted, `res=${JSON.stringify(res)}`)
    );
    check("no new restart recorded for an already-live join", () =>
      assert.strictEqual(restartCount(config), before, "restart count changed on a join")
    );
  }

  // ---------------------------------------------------------------
  // Scenario 3: real cross-process concurrency.
  // ---------------------------------------------------------------
  console.log("Scenario 3: cross-process concurrency (6 concurrent CLI calls)");
  {
    const N = 6;
    const { repo, agents } = makeRepo(N);
    cleanup.push(repo);
    const stateDir = path.join(repo, "_state");
    applyEnv(baseEnv(repo, stateDir)); // parent + inherited children resolve THIS repo's state dir
    const env = { ...process.env };
    const config = loadConfig({ cwd: repo });

    const { spawn } = await import("node:child_process");
    const procs = agents.map(
      (a) =>
        new Promise((resolve) => {
          const c = spawn(
            process.execPath,
            [REQUEST_RESTART, "--commit", a.sha, "--agent", a.branch, "--worktree", repo, "--json"],
            { env }
          );
          let out = "";
          c.stdout.on("data", (d) => (out += d));
          c.stderr.on("data", () => {});
          c.on("close", () => {
            let parsed = null;
            try {
              parsed = JSON.parse(out);
            } catch {
              /* leave null */
            }
            resolve({ agent: a, parsed });
          });
        })
    );
    const results = await Promise.all(procs);

    check("every concurrent request landed", () => {
      for (const r of results)
        assert.ok(r.parsed && r.parsed.landed, `${r.agent.branch} => ${JSON.stringify(r.parsed)}`);
    });
    check("every commit is live in the server checkout (nothing lost)", () => {
      const head = revParse(repo, "HEAD");
      for (const a of agents)
        assert.ok(isAncestor(repo, a.sha, head), `${a.branch} missing from HEAD`);
    });
    const restarts = restartCount(config);
    check(`coalescing observed: restarts (${restarts}) < requests (${N})`, () =>
      assert.ok(restarts >= 1 && restarts < N, `restarts=${restarts} not in [1, ${N})`)
    );
    console.log(`        (batched ${N} concurrent requests into ${restarts} restart(s))`);
  }

  // ---------------------------------------------------------------
  // Scenario 4: merge conflict handling.
  // ---------------------------------------------------------------
  console.log("Scenario 4: merge conflict is reported + aborted cleanly");
  {
    const { repo, agents } = makeRepo(2, { conflicting: true });
    cleanup.push(repo);
    const stateDir = path.join(repo, "_state");
    applyEnv(baseEnv(repo, stateDir));
    const config = loadConfig({ cwd: repo });

    let restarts = 0;
    const fakeRestart = async () => {
      restarts++;
      return { fake: true };
    };
    const id0 = enqueue(config, { agentId: agents[0].branch, commit: agents[0].sha, worktree: repo });
    const id1 = enqueue(config, { agentId: agents[1].branch, commit: agents[1].sha, worktree: repo });
    await runCycle(config, { restart: fakeRestart });

    const o0 = outcomeFor(config, id0);
    const o1 = outcomeFor(config, id1);
    check("first commit landed", () => assert.ok(o0 && o0.landed, `o0=${JSON.stringify(o0)}`));
    check("conflicting commit reported not-landed + conflict", () =>
      assert.ok(o1 && !o1.landed && o1.conflict, `o1=${JSON.stringify(o1)}`)
    );
    check("server checkout left clean after aborted merge (HEAD resolves, no MERGE_HEAD)", () => {
      assert.ok(revParse(repo, "HEAD"), "HEAD unresolvable");
      assert.ok(!existsSync(path.join(repo, ".git", "MERGE_HEAD")), "MERGE_HEAD present (merge not aborted)");
    });
  }

  // ---------------------------------------------------------------
  // Scenario 5: stale-lock recovery.
  // ---------------------------------------------------------------
  console.log("Scenario 5: stale-lock recovery (dead-pid holder)");
  {
    const { repo } = makeRepo(1);
    cleanup.push(repo);
    const stateDir = path.join(repo, "_state");
    applyEnv(baseEnv(repo, stateDir));
    const config = loadConfig({ cwd: repo });
    mkdirSync(config.lockDir, { recursive: true });
    // A dead pid: find one that isn't alive.
    let deadPid = 999999;
    while (pidAlive(deadPid)) deadPid--;
    writeFileSync(
      path.join(config.lockDir, "owner.json"),
      JSON.stringify({ pid: deadPid, host: os.hostname(), startedAt: Date.now(), heartbeatAt: Date.now() })
    );
    const lock = tryAcquire(config, {});
    check("stale (dead-pid) lock is broken and retaken", () =>
      assert.ok(lock && lock.recovered, "did not recover a dead-pid lock")
    );
    if (lock) lock.release();
  }

  // ---------------------------------------------------------------
  console.log("");
  console.log(`RESULT: ${PASS} passed, ${FAIL} failed`);
  for (const dir of cleanup) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
  process.exit(FAIL === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e.stack || e);
  process.exit(2);
});
