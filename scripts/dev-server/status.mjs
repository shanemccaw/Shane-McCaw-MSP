#!/usr/bin/env node
// scripts/dev-server/status.mjs
//
// Diagnostic: print the resolved coordinator config, the current lock/cycle
// state, the tracked server process, and the exact server-log paths any agent
// can read. Add --json for machine-readable output.
//
//   node scripts/dev-server/status.mjs [--json]

import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.mjs";
import { readOwner, pidAlive, isHeld } from "./lock.mjs";
import { readServerMeta } from "./server-process.mjs";
import { listPending } from "./queue.mjs";
import { revParse, shortSha } from "./git.mjs";

import { listWorktrees } from "./git.mjs";
import { listWorktreeRecords, normalizePath } from "./worktree-lifecycle.mjs";

function readJson(f) {
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return null;
  }
}

function lastLines(file, n = 5) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-n)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function collectStatus(cwd = process.cwd()) {
  const config = loadConfig({ cwd });
  const meta = readServerMeta(config);
  const gitWts = listWorktrees(config.mainRepoRoot);
  const records = listWorktreeRecords(config);
  const recMap = new Map(records.map((r) => [normalizePath(r.path), r]));

  const agentWorktrees = gitWts
    .filter(
      (w) =>
        normalizePath(w.path) !== normalizePath(config.mainRepoRoot) &&
        normalizePath(w.path) !== normalizePath(config.serverWorktree)
    )
    .map((w) => {
      const rec = recMap.get(normalizePath(w.path));
      return {
        path: w.path,
        branch: w.branch || "(detached)",
        head: shortSha(w.head),
        status: rec?.status || "untracked",
        creatorPid: rec?.creatorPid || null,
        pidAlive: rec?.creatorPid ? pidAlive(rec.creatorPid) : null,
        debugReason: rec?.debugReason || null,
      };
    });

  return {
    mainRepoRoot: config.mainRepoRoot,
    stateDir: config.stateDir,
    serverWorktree: config.serverWorktree,
    serverWorktreeExists: config.serverWorktreeExists,
    serverBranch: config.serverBranch,
    serverHead: config.serverWorktreeExists ? revParse(config.serverWorktree, "HEAD") : null,
    devAllLogDir: config.devAllLogDir,
    devAllLogFile: meta?.logFile || `${config.devAllLogDir}\\dev-all.log`,
    lock: {
      held: isHeld(config),
      owner: readOwner(config.lockDir),
    },
    currentCycle: existsSync(config.currentCycleFile) ? readJson(config.currentCycleFile) : null,
    pending: listPending(config).map((r) => ({ id: r.id, agent: r.agentId, commit: shortSha(r.commit) })),
    server: meta
      ? { pid: meta.pid, alive: pidAlive(meta.pid), startedAt: meta.startedAt, apiPort: meta.apiPort }
      : null,
    agentWorktrees,
    recentCleanups: lastLines(config.cleanupsLog, 5),
    recentCycles: lastLines(config.cyclesLog, 5).map((c) => ({
      cycleId: c.cycleId,
      restarted: c.restarted,
      batchSize: c.batchSize,
      mergedCount: c.mergedCount,
      conflicts: c.conflicts,
      serverHead: shortSha(c.serverHeadFinal),
    })),
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const json = process.argv.includes("--json");
  const s = collectStatus();
  if (json) {
    console.log(JSON.stringify(s, null, 2));
  } else {
    console.log("Dev-server coordinator status");
    console.log("  main repo        :", s.mainRepoRoot);
    console.log("  state dir        :", s.stateDir);
    console.log("  server worktree  :", s.serverWorktree, s.serverWorktreeExists ? "" : "(MISSING -- run bootstrap-server.mjs)");
    console.log("  server branch    :", s.serverBranch);
    console.log("  server HEAD      :", shortSha(s.serverHead));
    console.log("  server log       :", s.devAllLogFile);
    console.log("  lock held        :", s.lock.held, s.lock.owner ? `(pid ${s.lock.owner.pid}, cycle ${s.lock.owner.cycleId || "-"})` : "");
    console.log("  current cycle    :", s.currentCycle ? `${s.currentCycle.cycleId} [${s.currentCycle.phase}]` : "(idle)");
    console.log("  pending requests :", s.pending.length ? s.pending.map((p) => `${p.commit}/${p.agent}`).join(", ") : "(none)");
    console.log("  server process   :", s.server ? `pid ${s.server.pid} ${s.server.alive ? "alive" : "DEAD"} port ${s.server.apiPort}` : "(not launched via coordinator)");
    console.log(`  agent worktrees  : ${s.agentWorktrees.length} present`);
    for (const w of s.agentWorktrees) {
      const pidInfo = w.creatorPid ? `pid ${w.creatorPid} (${w.pidAlive ? "alive" : "dead"})` : "";
      const statusPill = w.debugReason ? `⚠️ STALE (${w.debugReason})` : `[${w.status}]`;
      console.log(`     ${w.path} -> ${statusPill} ${pidInfo}`);
    }
    if (s.recentCleanups?.length) {
      console.log("  recent cleanups  :");
      for (const cl of s.recentCleanups) {
        console.log(`     ${new Date(cl.timestamp).toLocaleTimeString()} ${cl.action.toUpperCase()} ${cl.path} (${cl.reason})`);
      }
    }
    if (s.recentCycles.length) {
      console.log("  recent cycles    :");
      for (const c of s.recentCycles)
        console.log(`     ${c.cycleId}  batch=${c.batchSize} merged=${c.mergedCount} conflicts=${c.conflicts} restarted=${c.restarted} -> ${c.serverHead}`);
    }
  }
}
