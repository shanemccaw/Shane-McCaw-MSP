#!/usr/bin/env node
// scripts/dev-server/git-maintenance-straydir-autorepair.selftest.mjs
//
// Git #2986 — focused self-test for the post-removal store-doctor canary added to
// sweepStrayWorktreeDirs (git-maintenance.mjs). Real evidence (.logs/dev-server/
// cleanups.log) showed the shared store got poisoned on 2026-09-06T14:36Z-15:07Z via
// removeWorktreeSafe (worktree-lifecycle.mjs) BEFORE the Git #1980 canary landed at
// 15:46Z — but every "removed" log entry SINCE #1980 landed has come through THIS
// "git-maintenance:stray-dirs" sweep instead, which duplicated the same
// junction-unlink + rmSync removal logic without ever getting #1980's canary. This
// test proves sweepStrayWorktreeDirs now scans + auto-repairs the shared store after
// removing a stray dir, the same way removeWorktreeSafe already does (see
// store-doctor-autorepair.selftest.mjs for that original test).
//
// This test stands up a throwaway git repo + isolated state dir (env overrides), so
// it never touches the real dev server, real checkout, or real worktree tracking.
//
//   node scripts/dev-server/git-maintenance-straydir-autorepair.selftest.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, lstatSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let failures = 0;
function ok(cond, msg) {
  if (cond) {
    console.log(`  ok  - ${msg}`);
  } else {
    failures++;
    console.error(`  FAIL - ${msg}`);
  }
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function junction(link, target) {
  execFileSync("cmd", ["/c", "mklink", "/J", link, target], { stdio: "ignore" });
}

async function main() {
  if (process.platform !== "win32") {
    console.log("git-maintenance stray-dir auto-repair self-test is Windows-junction-specific — skipping on this platform.");
    process.exit(0);
  }

  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "git-maint-2986-"));
  const repo = path.join(tmpRoot, "repo");
  const stateDir = path.join(tmpRoot, "state");
  const wtRoot = path.join(tmpRoot, "wt");
  mkdirSync(repo, { recursive: true });
  mkdirSync(wtRoot, { recursive: true });

  process.env.DEV_SERVER_MAIN_ROOT = repo;
  process.env.DEV_SERVER_STATE_DIR = stateDir;
  process.env.DEV_SERVER_WORKTREE = path.join(tmpRoot, "dev-server"); // protected, never created
  process.env.DEV_SERVER_BASE_REF = "HEAD";

  const { loadConfig } = await import("./config.mjs");
  const { sweepStrayWorktreeDirs } = await import("./git-maintenance.mjs");
  const { scanSharedStore } = await import("./store-doctor.mjs");

  try {
    // --- Real repo, no registered worktrees — the stray dir below is unregistered. ---
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@t"]);
    git(repo, ["config", "user.name", "t"]);
    writeFileSync(path.join(repo, "README.md"), "x\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "init"]);

    // A stray leftover dir under wtRoot with no `.git` at all — the common real case
    // per this sweep's own header comment — old enough (minAgeMs: 0 below) and with
    // no uncommitted work, so it is eligible for removal.
    const strayDir = path.join(wtRoot, "stray-leftover");
    mkdirSync(strayDir, { recursive: true });
    writeFileSync(path.join(strayDir, "placeholder.txt"), "x\n");

    // --- Poison the SHARED main checkout's node_modules, independent of the stray
    //     dir being swept — exactly the real-world shape: an earlier, already-gone
    //     worktree left a foreign link behind in main's store. ---
    const realStoreDir = path.join(repo, "node_modules", ".pnpm", "node_modules", "pkg");
    mkdirSync(realStoreDir, { recursive: true });
    writeFileSync(path.join(realStoreDir, "index.js"), "module.exports = {};\n");

    const goneWorktreeTarget = path.join(tmpRoot, "long-gone-worktree", "node_modules", ".pnpm", "node_modules", "pkg");
    const poisonedLink = path.join(repo, "node_modules", "pkg");
    junction(poisonedLink, goneWorktreeTarget);
    ok(lstatSync(poisonedLink).isSymbolicLink(), "poisoned junction was created at repo/node_modules/pkg");

    const preScan = scanSharedStore(repo);
    ok(!preScan.clean, "pre-sweep scan correctly finds the poisoned store");
    ok(preScan.foreignLinks.length === 1, "pre-sweep scan finds exactly the one foreign link we planted");

    const config = loadConfig({ cwd: repo });
    const res = sweepStrayWorktreeDirs(config, { wtRoot, minAgeMs: 0 });

    ok(res.ok === true, "sweepStrayWorktreeDirs returns ok");
    ok(res.removedCount === 1, "sweepStrayWorktreeDirs removed the one stray dir");
    ok(!existsSync(strayDir), "the stray dir is actually gone from disk");
    ok(!!res.storeAfterRemoval, "sweepStrayWorktreeDirs records a storeAfterRemoval result (Git #2986)");
    ok(res.storeAfterRemoval.clean === false, "storeAfterRemoval reports the pre-repair poisoned state (not silently clean)");
    ok(!!res.storeAfterRemoval.autoRepair, "storeAfterRemoval carries an autoRepair result (Git #1980/#2986)");
    ok(res.storeAfterRemoval.autoRepair.repairedLinks === 1, "auto-repair relinked exactly the one foreign link");
    ok(res.storeAfterRemoval.autoRepair.unrepairable === 0, "auto-repair left nothing unrepairable");
    ok(res.storeAfterRemoval.autoRepair.cleanAfterRepair === true, "auto-repair result says the store is clean afterward");

    const postScan = scanSharedStore(repo);
    ok(postScan.clean, "a FRESH scan after sweepStrayWorktreeDirs confirms the store is actually clean now");
    ok(existsSync(path.join(poisonedLink, "index.js")), "the repaired link resolves through to the real store content");

    console.log(failures === 0 ? "\nAll git-maintenance stray-dir auto-repair self-tests passed." : `\n${failures} assertion(s) FAILED.`);
  } finally {
    try { if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  }

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e.stack || String(e));
  process.exit(2);
});
