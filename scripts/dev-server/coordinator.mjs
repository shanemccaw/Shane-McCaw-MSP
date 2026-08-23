// scripts/dev-server/coordinator.mjs
//
// runCycle() is the single mutex-protected unit of work: MERGE -> RESTART ->
// CONFIRM. It is only ever called by whoever currently holds the lock.
//
// Batching (the CI-style coalescing): a cycle does not process just the one
// request that triggered it -- it claims EVERY request pending at cycle start
// and merges them all, then restarts ONCE. Requests that arrive after the claim
// snapshot are left in the queue for the next cycle. That is exactly how a CI
// system batches commits that land while a build is already running.

import { writeFileSync, rmSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import {
  revParse,
  isAncestor,
  mergeNoEdit,
  resolveCommit,
  shortSha,
} from "./git.mjs";
import { claimAllPending, finalize } from "./queue.mjs";

function writeCurrentCycle(config, obj) {
  mkdirSync(path.dirname(config.currentCycleFile), { recursive: true });
  writeFileSync(config.currentCycleFile, JSON.stringify(obj, null, 2));
}

function clearCurrentCycle(config) {
  try {
    rmSync(config.currentCycleFile, { force: true });
  } catch {
    /* ignore */
  }
}

function appendCycleRecord(config, record) {
  try {
    mkdirSync(path.dirname(config.cyclesLog), { recursive: true });
    appendFileSync(config.cyclesLog, JSON.stringify(record) + "\n");
  } catch {
    /* observability best-effort */
  }
}

/**
 * Run one merge+restart+confirm cycle against the server worktree.
 *
 * @param config  loadConfig() result
 * @param deps    { restart } -- restart() => Promise<{oldPid,newPid,ready}>.
 *                Injected so selftest can supply a fake restart; production
 *                wires server-process.restartServer.
 * @param opts    { lock } -- the held lock handle, so we can stamp cycleId onto
 *                owner.json (lets waiters see what's being batched).
 */
export async function runCycle(config, deps, opts = {}) {
  const W = config.serverWorktree;
  const cycleId = `c-${Date.now()}-${process.pid}`;
  const startedAt = Date.now();

  const serverHeadBefore = revParse(W, "HEAD");
  writeCurrentCycle(config, {
    cycleId,
    runnerPid: process.pid,
    startedAt,
    phase: "claiming",
    serverHeadBefore,
  });
  if (opts.lock?.update) opts.lock.update({ cycleId });

  // 1) Claim the whole pending batch.
  const batch = claimAllPending(config);

  // 2) Resolve + classify each request.
  const perRequest = {}; // id -> outcome
  const toMerge = [];
  for (const req of batch) {
    const commit = resolveCommit(W, req.commit) || req.commit;
    if (!commit) {
      perRequest[req.id] = {
        landed: false,
        error: "unresolvable commit",
        commit: req.commit,
      };
      continue;
    }
    if (isAncestor(W, commit, serverHeadBefore)) {
      // Already live in the server checkout (an earlier cycle merged it, or two
      // agents produced the same commit). Nothing to merge; it's landed.
      perRequest[req.id] = {
        landed: true,
        alreadyLive: true,
        commit,
        confirmed: true,
      };
      continue;
    }
    toMerge.push({ ...req, commit });
  }

  writeCurrentCycle(config, {
    cycleId,
    runnerPid: process.pid,
    startedAt,
    phase: "merging",
    serverHeadBefore,
    batch: batch.map((r) => r.id),
    merging: toMerge.map((r) => shortSha(r.commit)),
  });

  // 3) Merge each pending commit into the server branch, one at a time. A
  //    conflict aborts only that one merge (worktree left clean) and is
  //    reported honestly; the rest of the batch still proceeds.
  const merged = [];
  for (const req of toMerge) {
    const res = mergeNoEdit(
      W,
      req.commit,
      `dev-server: merge ${shortSha(req.commit)} from ${req.agentId || "agent"}`
    );
    if (res.ok) {
      perRequest[req.id] = { merged: true, commit: req.commit };
      merged.push(req);
    } else {
      perRequest[req.id] = {
        landed: false,
        merged: false,
        conflict: true,
        commit: req.commit,
        error: res.stderr,
      };
    }
  }

  const serverHeadAfterMerge = revParse(W, "HEAD");
  const changed = merged.length > 0 && serverHeadAfterMerge !== serverHeadBefore;

  // 4) Restart the server process ONCE, only if the tree actually advanced.
  let restart = { oldPid: null, newPid: null, ready: null, skipped: true };
  if (changed) {
    writeCurrentCycle(config, {
      cycleId,
      runnerPid: process.pid,
      startedAt,
      phase: "restarting",
      serverHeadBefore,
      serverHeadAfterMerge,
      batch: batch.map((r) => r.id),
    });
    restart = { skipped: false, ...(await deps.restart(config)) };
  }

  // 5) CONFIRM with real git: the server checkout HEAD must now genuinely
  //    contain each merged commit.
  const serverHeadFinal = revParse(W, "HEAD");
  for (const req of merged) {
    const confirmed = isAncestor(W, req.commit, serverHeadFinal);
    perRequest[req.id] = {
      ...perRequest[req.id],
      landed: confirmed,
      confirmed,
      serverHead: serverHeadFinal,
    };
  }

  // 6) Publish outcomes so waiters can join without a second restart.
  for (const req of batch) {
    finalize(config, req.id, {
      cycleId,
      ...(perRequest[req.id] || { landed: false, error: "no outcome" }),
    });
  }

  const record = {
    cycleId,
    startedAt,
    finishedAt: Date.now(),
    runnerPid: process.pid,
    serverWorktree: W,
    serverBranch: config.serverBranch,
    serverHeadBefore,
    serverHeadFinal,
    restarted: changed,
    restart,
    batchSize: batch.length,
    mergedCount: merged.length,
    conflicts: Object.values(perRequest).filter((o) => o.conflict).length,
    perRequest,
  };
  appendCycleRecord(config, record);
  clearCurrentCycle(config);
  return record;
}
