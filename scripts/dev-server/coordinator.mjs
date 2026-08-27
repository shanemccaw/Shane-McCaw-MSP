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
import { tryAcquire } from "./lock.mjs";
import * as bs from "./buildset.mjs";
import * as st from "./service-targeting.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      perRequest[req.id] = {
        merged: true,
        commit: req.commit,
        ...(res.autoRestored ? { autoRestored: res.autoRestored } : {}),
      };
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

// ===========================================================================
// BUILD SETS -- deferred single restart for an explicitly-grouped set of builds.
//
// The functions below are the build-set counterpart to runCycle(). They deliberately
// do NOT touch the general pending queue (queue.mjs) at all -- a set member merges
// ONLY its own commit and NEVER restarts on its own. The single restart fires just
// once, when the whole set is complete. Ungrouped builds keep going through
// runCycle() unchanged.
//
// All three functions assume they run with the coordinator MUTEX held, except
// finishSetFromCli() which acquires it itself.
// ===========================================================================

/** Build a restart action (real, unless config.fakeRestart records it instead --
 * matching request-restart.mjs's makeRestart, kept local so the CLI paths can fire
 * a restart without importing the agent entrypoint). */
function makeRestartAction(config) {
  if (config.fakeRestart) {
    return async (_cfg, opts = {}) => {
      mkdirSync(path.dirname(config.restartsLog), { recursive: true });
      appendFileSync(
        config.restartsLog,
        JSON.stringify({
          at: Date.now(),
          pid: process.pid,
          head: revParse(config.serverWorktree, "HEAD"),
          set: true,
          only: opts.only || null,
        }) + "\n"
      );
      return { oldPid: null, newPid: -1, ready: true, fake: true, only: opts.only || null };
    };
  }
  // Lazy import so paths that never restart don't load the process manager.
  return async (cfg, opts = {}) => {
    const { restartServer } = await import("./server-process.mjs");
    return restartServer(cfg, opts);
  };
}

/**
 * If (and only if) the set is now complete and its restart hasn't already fired,
 * trigger EXACTLY ONE restart for the combined changes of the whole set. Idempotent
 * and single-shot: the `restart.fired` flag on the manifest -- written under the
 * held mutex -- guarantees no second restart even under concurrent completions.
 *
 * Assumes the coordinator mutex is HELD by the caller.
 */
export async function maybeFireSetRestart(config, deps, name, { byAgent } = {}) {
  const set = bs.readSet(config, name);
  if (!set) return { complete: false, restarted: false };
  if (set.restart?.fired) return { complete: true, restarted: false, alreadyFired: true };
  if (!bs.isComplete(set)) return { complete: false, restarted: false };

  const W = config.serverWorktree;
  const advanced = bs.treeAdvanced(set);
  const serverHeadBefore = revParse(W, "HEAD");
  const cycleId = `set-${Date.now()}-${process.pid}`;

  // --- Selective service targeting ------------------------------------------
  // Compute the set's COMBINED changed-file footprint (the union of each merged
  // member's changes since the set's recorded base), classify it into services,
  // and plan which services this ONE restart should rebuild / start / stop / keep.
  // The API server stays always-on (never rebuilt just because a front-end
  // changed); a front-end that the set didn't touch and isn't already running is
  // not spun up. If the footprint can't be resolved (e.g. a set opened before
  // baseHead was recorded), fall back to a FULL restart -- never silently
  // under-restart.
  let plan = null;
  let footprint = null;
  let targeting = "full";
  if (advanced) {
    footprint = st.collectSetChangedFiles(W, set, { baseRef: set.baseHead || null });
    if (footprint.resolvedFrom !== "none" && footprint.files.length > 0) {
      const cls = st.classifyChangedFiles(footprint.files);
      // Running services: real meta in production; empty under fakeRestart
      // (selftest) so the pure decision path never loads the process manager.
      let running = new Set();
      if (!config.fakeRestart) {
        try {
          const sp = await import("./server-process.mjs");
          running = sp.readRunningServices(config);
        } catch {
          /* treat as none running */
        }
      }
      plan = st.planServiceTargeting({
        changedServices: cls.changedServices,
        shared: cls.shared,
        running,
        stopUnneeded: config.setStopUnneeded,
        byService: cls.byService,
        sharedFiles: cls.sharedFiles,
      });
      targeting = "selective";
    }
  }

  let restart = { skipped: true, oldPid: null, newPid: null, ready: null };
  let reason;
  if (!advanced) {
    reason = "build set complete -- no member merged; restart skipped (nothing new to reload)";
  } else if (plan) {
    reason = `build set complete -- ONE selective restart: ${st.describePlan(plan, set.name)}`;
    restart = {
      skipped: false,
      targeting,
      ...(await deps.restart(config, { only: plan.neededRunning, plan })),
    };
  } else {
    reason =
      "build set complete -- ONE restart of all services (combined footprint unresolved -> full restart)";
    restart = { skipped: false, targeting, ...(await deps.restart(config)) };
  }

  const serverHeadFinal = revParse(W, "HEAD");
  bs.markRestartFired(config, name, {
    cycleId,
    serverHead: serverHeadFinal,
    byAgent,
    reason,
    restarted: advanced,
  });
  bs.logSetEvent(config, {
    kind: "restart",
    setName: set.name,
    cycleId,
    restarted: advanced,
    reason,
    serverHeadBefore,
    serverHeadFinal,
    merged: bs.mergedCount(set),
    terminal: bs.terminalCount(set),
    expected: set.expected,
    members: Object.keys(set.members),
    byAgent,
    // Selective service targeting: exactly what was decided and which changed
    // files drove each decision (Shane's requirement -- a durable record of why
    // each service was rebuilt / started / stopped / kept).
    targeting,
    base: footprint?.base || null,
    changedFiles: footprint?.files || [],
    plan: plan
      ? {
          summary: st.describePlan(plan, set.name),
          rebuild: plan.toRebuild,
          start: plan.toStart,
          stop: plan.toStop,
          neededRunning: plan.neededRunning,
          shared: plan.shared,
          actions: plan.actions.map((a) => ({
            service: a.service,
            action: a.action,
            triggers: a.triggers,
            reason: a.reason,
          })),
        }
      : null,
  });
  // Mirror into the shared cycles.log so status.mjs / observability see set restarts
  // alongside ordinary cycles.
  appendCycleRecord(config, {
    cycleId,
    setName: set.name,
    setRestart: true,
    startedAt: Date.now(),
    finishedAt: Date.now(),
    runnerPid: process.pid,
    serverWorktree: W,
    serverBranch: config.serverBranch,
    serverHeadBefore,
    serverHeadFinal,
    restarted: advanced,
    restart,
    mergedCount: bs.mergedCount(set),
    members: Object.keys(set.members),
    targeting,
    targetedServices: plan ? plan.neededRunning : null,
  });
  return {
    complete: true,
    restarted: advanced,
    cycleId,
    serverHeadFinal,
    reason,
    targeting,
    plan: plan
      ? { rebuild: plan.toRebuild, start: plan.toStart, stop: plan.toStop, neededRunning: plan.neededRunning }
      : null,
  };
}

/**
 * One build-set member finished: merge its commit into the server checkout (per the
 * SAME merge mechanics runCycle uses) WITHOUT restarting, record it in the set, and
 * -- only if this completes the whole set -- fire the single restart.
 *
 * Assumes the coordinator mutex is HELD by the caller.
 */
export async function runSetMemberCycle(config, deps, { commit, agentId, setName, memberKey, expected }) {
  const W = config.serverWorktree;
  // Stamp the set's base = the server HEAD BEFORE any member merged (openSet only
  // records it on first creation), so the combined footprint for selective
  // targeting is measured against the true pre-set state.
  bs.openSet(config, setName, {
    expected,
    openedBy: agentId ? "agent" : "cli",
    baseHead: revParse(W, "HEAD"),
  });

  const serverHeadBefore = revParse(W, "HEAD");
  const resolved = resolveCommit(W, commit) || commit;

  let status;
  let error;
  let autoRestored;
  if (!resolved) {
    status = "conflict";
    error = "unresolvable commit";
  } else if (isAncestor(W, resolved, serverHeadBefore)) {
    // Already in the server checkout (an earlier member merged it, or a duplicate).
    status = "already-live";
  } else {
    const res = mergeNoEdit(
      W,
      resolved,
      `dev-server[set:${setName}]: merge ${shortSha(resolved)} from ${agentId || "agent"}`
    );
    if (res.ok) {
      status = "merged";
      autoRestored = res.autoRestored;
    } else {
      status = "conflict";
      error = res.stderr;
    }
  }

  const key = String(memberKey || (resolved ? shortSha(resolved) : commit) || `m-${Date.now()}`);
  const set = bs.recordMember(config, setName, { key, commit: resolved || commit, agentId, status, error });
  bs.logSetEvent(config, {
    kind: "member",
    setName: set.name,
    key,
    status,
    commit: resolved ? shortSha(resolved) : null,
    agentId,
    terminal: bs.terminalCount(set),
    merged: bs.mergedCount(set),
    expected: set.expected,
    closed: set.closed,
    ...(autoRestored ? { autoRestored } : {}),
  });

  const fire = await maybeFireSetRestart(config, deps, setName, { byAgent: agentId || key });
  const fresh = bs.readSet(config, setName) || set;

  return {
    buildSet: setName,
    memberKey: key,
    status,
    error: error || null,
    landed: status === "merged" || status === "already-live",
    merged: status === "merged",
    conflict: status === "conflict",
    setComplete: fire.complete,
    restarted: fire.restarted,
    // Only the caller that fired the restart runs the combined test pass for the
    // whole set -- exactly once, never once-per-build.
    runSetTests: !!fire.restarted,
    cycleId: fire.cycleId || null,
    setProgress: bs.progress(fresh),
    serverHead: revParse(W, "HEAD"),
  };
}

/**
 * CLI-facing completion trigger (used by `buildset.mjs drop`/`close`). Acquires the
 * coordinator mutex itself, then fires the single restart iff the set is now
 * complete. Safe to call repeatedly (single-shot via restart.fired).
 */
export async function finishSetFromCli(config, name, { byAgent } = {}) {
  const deps = { restart: makeRestartAction(config) };
  const deadline = Date.now() + config.maxWaitMs;
  while (Date.now() < deadline) {
    const lock = tryAcquire(config, {});
    if (lock) {
      try {
        return await maybeFireSetRestart(config, deps, name, { byAgent });
      } finally {
        lock.release();
      }
    }
    await sleep(config.acquireBackoffMs + Math.floor(Math.random() * 200));
  }
  return { complete: false, restarted: false, error: "timed out acquiring lock for build set completion" };
}
