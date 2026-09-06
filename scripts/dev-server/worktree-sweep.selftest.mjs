#!/usr/bin/env node
// scripts/dev-server/worktree-sweep.selftest.mjs
//
// Git #2537 — focused self-test for the worktree sweep's liveness check. The periodic
// auto-sweep runs force:false and used to depend ENTIRELY on a tracking record existing
// with a live stored owner-pid; a recordless `agent/*` worktree (or one whose stamped pid
// died while the real session ran under another pid) fell through every retention check
// and was deleted out from under a live session (the #2537 data-loss report). The fix folds
// real on-disk activity into the grace check (worktreeLastActivityMs), independent of the
// record/pid, so a worktree that is being actively written to is never swept.
//
// This test stands up a throwaway git repo + isolated state dir (env overrides), so it never
// touches the real dev server, real checkout, or real worktree tracking. Every sweep here is
// dry-run: it asserts the RETAIN/CANDIDATE decision without removing anything.
//
//   node scripts/dev-server/worktree-sweep.selftest.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
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

async function main() {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "wt-sweep-2537-"));
  const repo = path.join(tmpRoot, "repo");
  const stateDir = path.join(tmpRoot, "state");
  mkdirSync(repo, { recursive: true });

  // Isolate config BEFORE importing the modules that call loadConfig().
  process.env.DEV_SERVER_MAIN_ROOT = repo;
  process.env.DEV_SERVER_STATE_DIR = stateDir;
  process.env.DEV_SERVER_WORKTREE = path.join(tmpRoot, "dev-server"); // protected, never created
  process.env.DEV_SERVER_BASE_REF = "HEAD";

  const { loadConfig } = await import("./config.mjs");
  const { sweepWorktrees, worktreeLastActivityMs } = await import("./worktree-lifecycle.mjs");

  try {
    // --- Build a real repo with a real agent/* worktree, no tracking record. ---
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@t"]);
    git(repo, ["config", "user.name", "t"]);
    writeFileSync(path.join(repo, "README.md"), "x\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "init"]);

    const liveWt = path.join(tmpRoot, "wt-live-a");
    git(repo, ["worktree", "add", "-q", "-b", "agent/live-a", liveWt, "HEAD"]);
    // A live session writes to its worktree — simulate a fresh edit right now.
    writeFileSync(path.join(liveWt, "work-in-progress.txt"), "editing\n");

    const config = loadConfig({ cwd: repo });

    // --- worktreeLastActivityMs unit checks ---
    const act = worktreeLastActivityMs(liveWt);
    ok(act > 0, "worktreeLastActivityMs returns a real timestamp for a populated worktree");
    ok(Date.now() - act < 60_000, "reported activity is recent (freshly written worktree)");
    ok(worktreeLastActivityMs(path.join(tmpRoot, "does-not-exist")) === 0,
      "worktreeLastActivityMs returns 0 for a missing path (no false liveness)");

    const norm = (p) => p.toLowerCase().replace(/\//g, "\\");
    const inList = (list, p) => list.some((r) => norm(path.resolve(r.path)) === norm(path.resolve(p)));

    // --- Core #2537 assertion: a recordless, freshly-active agent/* worktree is RETAINED
    //     by the normal (30-min-grace) non-force sweep, NOT removed. ---
    const s1 = sweepWorktrees(config, { dryRun: true }); // default maxAgeMs = 30 min, force = false
    ok(inList(s1.retained, liveWt),
      "recordless but freshly-active agent/* worktree is RETAINED by the non-force sweep (the #2537 fix)");
    ok(!inList(s1.removed, liveWt),
      "recordless but freshly-active agent/* worktree is NOT a removal candidate");

    // --- Non-regression: the same worktree, once its activity ages past the grace, IS still
    //     reclaimable — the fix protects LIVE work, it does not permanently leak dead worktrees.
    //     A 1 ms grace makes even just-written activity "too old", exercising the expiry branch. ---
    const s2 = sweepWorktrees(config, { dryRun: true, maxAgeMs: 1 });
    ok(inList(s2.removed, liveWt),
      "an agent/* worktree with no recent activity (grace expired) is still a removal candidate — no permanent leak");

    console.log(failures === 0 ? "\nAll worktree-sweep self-tests passed." : `\n${failures} assertion(s) FAILED.`);
  } finally {
    // Detach worktrees before removing the tree so nothing lingers, then nuke the temp root.
    try { git(repo, ["worktree", "prune"]); } catch {}
    try { if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  }

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e.stack || String(e));
  process.exit(2);
});
