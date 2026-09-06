#!/usr/bin/env node
// scripts/dev-server/store-doctor-autorepair.selftest.mjs
//
// Git #1980 — focused self-test for the auto-repair wiring added to the post-removal
// canary in worktree-lifecycle.mjs (removeWorktreeSafe). Real evidence
// (.logs/dev-server/cleanups.log, 2026-09-06T14:36Z-15:07Z) showed a poisoned shared
// store surviving NINE further sweep removals over 30+ minutes because the old canary
// only ever logged a console.warn — nothing acted on it. This test proves the fix: the
// moment the post-removal scan finds a foreign link, it is repaired in the same call,
// and the repair outcome (autoRepair) rides on storeAfterRemoval.
//
// This test stands up a throwaway git repo + isolated state dir (env overrides), so it
// never touches the real dev server, real checkout, or real worktree tracking.
//
//   node scripts/dev-server/store-doctor-autorepair.selftest.mjs

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
    console.log("store-doctor auto-repair self-test is Windows-junction-specific — skipping on this platform.");
    process.exit(0);
  }

  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "store-doctor-1980-"));
  const repo = path.join(tmpRoot, "repo");
  const stateDir = path.join(tmpRoot, "state");
  mkdirSync(repo, { recursive: true });

  process.env.DEV_SERVER_MAIN_ROOT = repo;
  process.env.DEV_SERVER_STATE_DIR = stateDir;
  process.env.DEV_SERVER_WORKTREE = path.join(tmpRoot, "dev-server"); // protected, never created
  process.env.DEV_SERVER_BASE_REF = "HEAD";

  const { loadConfig } = await import("./config.mjs");
  const { removeWorktreeSafe } = await import("./worktree-lifecycle.mjs");
  const { scanSharedStore } = await import("./store-doctor.mjs");

  try {
    // --- Real repo, real (unrelated) worktree that will actually be removed. ---
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@t"]);
    git(repo, ["config", "user.name", "t"]);
    writeFileSync(path.join(repo, "README.md"), "x\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "init"]);

    const wt = path.join(tmpRoot, "wt-unrelated");
    git(repo, ["worktree", "add", "-q", "-b", "agent/unrelated", wt, "HEAD"]);

    // --- Poison the SHARED main checkout's node_modules, independent of the worktree
    //     being removed — exactly the real-world shape: an earlier, already-gone
    //     worktree left a foreign link behind in main's store. ---
    const realStoreDir = path.join(repo, "node_modules", ".pnpm", "node_modules", "pkg");
    mkdirSync(realStoreDir, { recursive: true });
    writeFileSync(path.join(realStoreDir, "index.js"), "module.exports = {};\n");

    // A foreign target that does NOT exist (mirrors a swept worktree) but whose path
    // still contains a "\node_modules\" marker store-doctor's candidateUnderRoot can
    // remap back onto the real copy above.
    const goneWorktreeTarget = path.join(tmpRoot, "long-gone-worktree", "node_modules", ".pnpm", "node_modules", "pkg");
    const poisonedLink = path.join(repo, "node_modules", "pkg");
    junction(poisonedLink, goneWorktreeTarget);
    ok(lstatSync(poisonedLink).isSymbolicLink(), "poisoned junction was created at repo/node_modules/pkg");

    const preScan = scanSharedStore(repo);
    ok(!preScan.clean, "pre-removal scan correctly finds the poisoned store");
    ok(preScan.foreignLinks.length === 1, "pre-removal scan finds exactly the one foreign link we planted");

    const config = loadConfig({ cwd: repo });
    const res = removeWorktreeSafe(config, wt, { reason: "selftest cleanup", force: true });

    ok(!!res.storeAfterRemoval, "removeWorktreeSafe records a storeAfterRemoval result");
    ok(res.storeAfterRemoval.clean === false, "storeAfterRemoval reports the pre-repair poisoned state (not silently clean)");
    ok(!!res.storeAfterRemoval.autoRepair, "storeAfterRemoval carries an autoRepair result (Git #1980)");
    ok(res.storeAfterRemoval.autoRepair.repairedLinks === 1, "auto-repair relinked exactly the one foreign link");
    ok(res.storeAfterRemoval.autoRepair.unrepairable === 0, "auto-repair left nothing unrepairable");
    ok(res.storeAfterRemoval.autoRepair.cleanAfterRepair === true, "auto-repair result says the store is clean afterward");

    const postScan = scanSharedStore(repo);
    ok(postScan.clean, "a FRESH scan after removeWorktreeSafe confirms the store is actually clean now");
    ok(existsSync(path.join(poisonedLink, "index.js")), "the repaired link resolves through to the real store content");

    console.log(failures === 0 ? "\nAll store-doctor auto-repair self-tests passed." : `\n${failures} assertion(s) FAILED.`);
  } finally {
    try { git(repo, ["worktree", "prune"]); } catch {}
    try { if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  }

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e.stack || String(e));
  process.exit(2);
});
