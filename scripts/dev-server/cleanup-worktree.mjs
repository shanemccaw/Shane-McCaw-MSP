#!/usr/bin/env node
// scripts/dev-server/cleanup-worktree.mjs
//
// CLI entrypoint for explicit worktree removal, stale/debug marking, and automated orphan sweeping.
//
// Usage:
//   # Clean up a specific worktree by name or path
//   node scripts/dev-server/cleanup-worktree.mjs <name-or-path> [--reason <msg>] [--force]
//
//   # Sweep all orphaned, inactive, or expired worktrees
//   node scripts/dev-server/cleanup-worktree.mjs --sweep [--force] [--all] [--max-age <ms>] [--dry-run] [--json]
//
//   # Mark a crashed/failed worktree as stale for debugging
//   node scripts/dev-server/cleanup-worktree.mjs --mark-stale <name-or-path> --reason "type error in build"
//
//   # List all worktrees and their tracking status
//   node scripts/dev-server/cleanup-worktree.mjs --list [--json]

import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.mjs";
import { listWorktrees } from "./git.mjs";
import {
  removeWorktreeSafe,
  markWorktreeStale,
  sweepWorktrees,
  listWorktreeRecords,
  getWorktreeRecord,
  normalizePath,
} from "./worktree-lifecycle.mjs";
import { pidAlive } from "./lock.mjs";

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--json") a.json = true;
    else if (t === "--sweep") a.sweep = true;
    else if (t === "--list") a.list = true;
    else if (t === "--mark-stale") a.markStale = argv[++i] || true;
    else if (t === "--reason") a.reason = argv[++i];
    else if (t === "--force") a.force = true;
    else if (t === "--all") a.all = true;
    else if (t === "--dry-run") a.dryRun = true;
    else if (t === "--max-age") a.maxAgeMs = Number(argv[++i]);
    else a._.push(t);
  }
  return a;
}

export async function runCleanupCli(args) {
  const config = loadConfig();

  // 1. List worktrees
  if (args.list) {
    const gitWts = listWorktrees(config.mainRepoRoot);
    const records = listWorktreeRecords(config);
    const recMap = new Map(records.map((r) => [normalizePath(r.path), r]));

    const items = gitWts.map((wt) => {
      const norm = normalizePath(wt.path);
      const isMain = norm === normalizePath(config.mainRepoRoot);
      const isServer = norm === normalizePath(config.serverWorktree);
      const rec = recMap.get(norm);
      const alive = rec?.creatorPid ? pidAlive(rec.creatorPid) : null;
      return {
        path: wt.path,
        branch: wt.branch || "(detached)",
        head: wt.head?.slice(0, 8),
        type: isMain ? "main-repo" : isServer ? "dev-server" : "agent-worktree",
        status: rec?.status || "untracked",
        creatorPid: rec?.creatorPid || null,
        pidAlive: alive,
        debugReason: rec?.debugReason || null,
        createdAt: rec?.createdAt ? new Date(rec.createdAt).toISOString() : null,
      };
    });

    if (args.json) {
      console.log(JSON.stringify({ worktrees: items }, null, 2));
    } else {
      console.log("Git Worktrees for repository:");
      for (const item of items) {
        const typePill = item.type === "main-repo" ? "[MAIN]" : item.type === "dev-server" ? "[DEV-SERVER]" : "[AGENT]";
        const pidPill = item.creatorPid ? `pid ${item.creatorPid} (${item.pidAlive ? "alive" : "dead"})` : "";
        const statusPill = item.debugReason ? `⚠️ STALE: ${item.debugReason}` : item.status;
        console.log(`  ${typePill} ${item.path} (${item.branch}) ${statusPill} ${pidPill}`);
      }
    }
    return { ok: true, items };
  }

  // 2. Mark stale
  if (args.markStale) {
    const target = typeof args.markStale === "string" ? args.markStale : args._[0];
    if (!target) {
      console.error("error: specify a worktree name or path to mark stale");
      process.exit(1);
    }
    const reason = args.reason || "retained for debugging";
    const res = markWorktreeStale(config, target, { reason });
    if (args.json) {
      console.log(JSON.stringify(res, null, 2));
    }
    return res;
  }

  // 3. Sweep
  if (args.sweep) {
    const res = sweepWorktrees(config, {
      dryRun: args.dryRun,
      force: args.force || args.all,
      maxAgeMs: args.maxAgeMs,
    });
    if (args.json) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      console.log(`Worktree sweep completed${args.dryRun ? " (DRY RUN)" : ""}:`);
      console.log(`  Inspected : ${res.inspectedCount}`);
      console.log(`  Removed   : ${res.removedCount}`);
      console.log(`  Retained  : ${res.retainedCount}`);
      if (res.removed.length) {
        console.log("  Removed worktrees:");
        for (const r of res.removed) console.log(`    - ${r.path} (${r.reason})`);
      }
      if (res.retained.length) {
        console.log("  Retained worktrees:");
        for (const r of res.retained) console.log(`    - ${r.path} (${r.reason})`);
      }
    }
    return res;
  }

  // 4. Single worktree cleanup
  const target = args._[0];
  if (!target) {
    console.error("usage: node scripts/dev-server/cleanup-worktree.mjs <name-or-path> [--reason <msg>] [--force]");
    console.error("       node scripts/dev-server/cleanup-worktree.mjs --sweep [--force] [--dry-run]");
    console.error("       node scripts/dev-server/cleanup-worktree.mjs --list");
    process.exit(1);
  }

  const reason = args.reason || "manual cleanup";
  try {
    const res = removeWorktreeSafe(config, target, {
      reason,
      force: !!args.force,
    });
    if (args.json) {
      console.log(JSON.stringify(res, null, 2));
    }
    return res;
  } catch (err) {
    console.error(`[worktree-cleanup] Error: ${err.message}`);
    process.exit(1);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  runCleanupCli(args).catch((err) => {
    console.error(`[worktree-cleanup] Fatal error: ${err.stack || err}`);
    process.exit(2);
  });
}
