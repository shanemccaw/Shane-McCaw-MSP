#!/usr/bin/env node
// scripts/dev-server/request-restart.mjs
//
// AGENT ENTRYPOINT. An agent calls this after its build completes in its OWN
// worktree, to get its committed changes merged into the dev-server checkout and
// the local server restarted -- coordinated safely against up to ~8 concurrent
// agents.
//
//   node scripts/dev-server/request-restart.mjs \
//        [--commit <sha>] [--agent <id>] [--worktree <path>] [--json]
//
// Defaults: --commit = HEAD of the cwd, --agent = host+pid, --worktree = cwd.
//
// The coalescing contract (matches how CI batches commits landing mid-build):
//
//   * If the commit is ALREADY an ancestor of the server HEAD, it's live. We
//     just wait for any in-flight cycle to finish (so the server has actually
//     restarted with it) and return -- WITHOUT triggering a second restart.
//     This is "your change got pulled into another agent's cycle -> join it".
//
//   * Otherwise we enqueue a request and loop:
//       - If we win the mutex, WE become the cycle runner: drain the whole
//         pending queue, merge every commit, restart once, confirm.
//       - If someone else holds the mutex, we watch for OUR request's outcome
//         (the running/next cycle will batch it) and return when it lands --
//         again with no extra restart. If the current cycle already claimed its
//         batch before we enqueued, our request simply waits for the next cycle,
//         which naturally coalesces us with any other agents waiting.

import os from "node:os";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.mjs";
import { revParse, isAncestor, resolveCommit, shortSha } from "./git.mjs";
import { tryAcquire, isHeld } from "./lock.mjs";
import {
  enqueue,
  outcomeFor,
  recoverOrphans,
  cleanup,
} from "./queue.mjs";
import { runCycle } from "./coordinator.mjs";
import { restartServer } from "./server-process.mjs";
import { existsSync } from "node:fs";

import { removeWorktreeSafe, markWorktreeStale, normalizePath } from "./worktree-lifecycle.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const a = { json: false, cleanup: false, keepForDebug: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--json") a.json = true;
    else if (t === "--commit") a.commit = argv[++i];
    else if (t === "--agent") a.agent = argv[++i];
    else if (t === "--worktree") a.worktree = argv[++i];
    else if (t === "--branch") a.branch = argv[++i];
    else if (t === "--cleanup" || t === "--cleanup-worktree") a.cleanup = true;
    else if (t === "--keep-for-debug" || t === "--debug") a.keepForDebug = true;
    else if (t === "--cleanup-on-failure") a.cleanupOnFailure = true;
  }
  return a;
}

/** The restart action handed to the coordinator (real, unless FAKE_RESTART). */
function makeRestart(config) {
  if (config.fakeRestart) {
    // Selftest / dry safety: record the restart instead of touching a process.
    return async () => {
      const { appendFileSync, mkdirSync } = await import("node:fs");
      const path = await import("node:path");
      mkdirSync(path.dirname(config.restartsLog), { recursive: true });
      appendFileSync(
        config.restartsLog,
        JSON.stringify({ at: Date.now(), pid: process.pid, head: revParse(config.serverWorktree, "HEAD") }) + "\n"
      );
      return { oldPid: null, newPid: -1, ready: true, fake: true };
    };
  }
  return restartServer;
}

export async function requestRestart(opts = {}) {
  const cwd = opts.worktree || process.cwd();
  const config = loadConfig({ cwd });
  const W = config.serverWorktree;

  const agentId = opts.agent || process.env.DEV_AGENT_ID || `${os.hostname()}#${process.pid}`;
  const rawCommit = opts.commit || "HEAD";
  // Resolve the commit in the AGENT's worktree (that's where it exists), which
  // shares the object store with the server worktree.
  const commit = resolveCommit(cwd, rawCommit) || resolveCommit(W, rawCommit);

  if (!config.serverWorktreeExists) {
    return {
      landed: false,
      restarted: false,
      error: `server worktree not found at ${W}. Run: node scripts/dev-server/bootstrap-server.mjs`,
      config: summarizeConfig(config),
    };
  }
  if (!commit) {
    return { landed: false, restarted: false, error: `could not resolve commit '${rawCommit}'` };
  }

  cleanup(config); // opportunistic housekeeping of old .done markers

  // --- Fast path: already live? ---
  if (isAncestor(W, commit, revParse(W, "HEAD"))) {
    await waitForQuietCycle(config);
    return {
      landed: true,
      restarted: false,
      joined: true,
      commit,
      serverHead: revParse(W, "HEAD"),
      note: "commit already live in the dev-server checkout; joined without a new restart",
    };
  }

  // --- Enqueue our request, then race for the mutex or wait to be batched. ---
  const reqId = enqueue(config, { agentId, commit, worktree: cwd, branch: opts.branch });
  const deadline = Date.now() + config.maxWaitMs;
  const restart = makeRestart(config);

  while (Date.now() < deadline) {
    // Did a concurrent cycle already land our request (batched us in)?
    const done = outcomeFor(config, reqId);
    if (done) return { ...done, reqId, joined: !done.restarted, commit };

    // Or is it already live now (merged by a cycle that hasn't finalized us yet)?
    if (isAncestor(W, commit, revParse(W, "HEAD"))) {
      // wait for that cycle to finish, then report
      await waitForQuietCycle(config);
      const done2 = outcomeFor(config, reqId);
      return {
        landed: true,
        restarted: done2 ? !!done2.restarted : false,
        joined: true,
        reqId,
        commit,
        serverHead: revParse(W, "HEAD"),
      };
    }

    // Try to become the cycle runner.
    const lock = tryAcquire(config, {
      onBreak: () => recoverOrphans(config), // reclaim a crashed runner's batch
    });
    if (lock) {
      try {
        if (lock.recovered) recoverOrphans(config);
        const record = await runCycle(config, { restart }, { lock });
        const mine = record.perRequest[reqId] || outcomeFor(config, reqId);
        return {
          ...(mine || { landed: isAncestor(W, commit, revParse(W, "HEAD")) }),
          reqId,
          ranCycle: true,
          restarted: record.restarted,
          cycleId: record.cycleId,
          serverHead: record.serverHeadFinal,
          batchSize: record.batchSize,
          commit,
        };
      } finally {
        lock.release();
      }
    }

    // Someone else holds it -- wait and re-check.
    await sleep(config.acquireBackoffMs + Math.floor(Math.random() * 200));
  }

  return {
    landed: false,
    restarted: false,
    reqId,
    commit,
    error: `timed out after ${config.maxWaitMs}ms waiting for a merge+restart cycle`,
  };
}

/** Wait until no cycle is actively running (current-cycle.json cleared / lock free). */
async function waitForQuietCycle(config, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!existsSync(config.currentCycleFile) && !isHeld(config)) return true;
    await sleep(300);
  }
  return false;
}

function summarizeConfig(config) {
  return {
    serverWorktree: config.serverWorktree,
    serverBranch: config.serverBranch,
    stateDir: config.stateDir,
    devAllLogDir: config.devAllLogDir,
  };
}

// --- CLI ---
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const a = parseArgs(process.argv.slice(2));
  const targetWorktree = a.worktree || process.cwd();
  const config = loadConfig({ cwd: targetWorktree });

  requestRestart(a)
    .then((res) => {
      if (res.landed) {
        if (a.cleanup) {
          try {
            const cleanRes = removeWorktreeSafe(config, targetWorktree, {
              reason: "request-restart successful merge into dev-server",
            });
            res.worktreeCleaned = cleanRes;
          } catch (e) {
            console.warn(`[dev-server] Warning: worktree cleanup failed: ${e.message}`);
          }
        }
      } else {
        if (a.keepForDebug) {
          try {
            const staleRes = markWorktreeStale(config, targetWorktree, {
              reason: res.error || "failed restart / merge conflict",
              commit: res.commit,
              error: res.error,
            });
            res.worktreeMarkedStale = staleRes;
          } catch {}
        } else if (a.cleanupOnFailure) {
          try {
            const cleanRes = removeWorktreeSafe(config, targetWorktree, {
              reason: `request-restart failed: ${res.error || "conflict"}`,
            });
            res.worktreeCleaned = cleanRes;
          } catch {}
        }
      }

      if (a.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        const c = res.commit ? shortSha(res.commit) : "?";
        if (res.landed) {
          console.log(
            `[dev-server] OK  commit ${c} is live${res.restarted ? " (restarted)" : res.joined ? " (joined an in-flight/complete cycle -- no extra restart)" : ""}. server HEAD ${shortSha(res.serverHead)}`
          );
          if (res.worktreeCleaned) {
            console.log(`[dev-server] Cleaned worktree: ${targetWorktree}`);
          }
        } else if (res.rolledBack) {
          console.error(
            `[dev-server] 🔴 ROLLED BACK  commit ${c}: ${res.error}. Restored server to ${shortSha(res.restoredCommit || res.serverHeadBefore)}`
          );
          if (res.worktreeMarkedStale) {
            console.log(`[dev-server] Retained worktree for debugging: ${targetWorktree} (.stale-worktree.json written)`);
          }
        } else {
          console.error(`[dev-server] FAILED  commit ${c}: ${res.error || (res.conflict ? "merge conflict" : "not landed")}`);
          if (res.worktreeMarkedStale) {
            console.log(`[dev-server] Retained worktree for debugging: ${targetWorktree} (.stale-worktree.json written)`);
          }
        }
      }
      process.exit(res.landed ? 0 : 1);
    })
    .catch((err) => {
      console.error(`[dev-server] ERROR ${err.stack || err}`);
      process.exit(2);
    });
}
