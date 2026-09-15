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
  const { sweepWorktrees, worktreeLastActivityMs, registerWorktree } = await import("./worktree-lifecycle.mjs");

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

    // --- Git #1958 — the SAME worktree, once its activity ages past the grace (maxAgeMs:1),
    //     STILL holds the untracked WIP file, i.e. real uncommitted work. Before #1958 the
    //     non-force sweep removed it here; that is the exact silent data loss #1958 filed (even
    //     the #1971 rescue-to-branch tears down the tree a paused build would resume into). It
    //     is now RETAINED for resume instead. We assert on the retain REASON so a mere
    //     grace-window retention (which would read "active recently") can't false-pass this. ---
    const s2 = sweepWorktrees(config, { dryRun: true, maxAgeMs: 1 });
    const r2 = s2.retained.find((r) => norm(path.resolve(r.path)) === norm(path.resolve(liveWt)));
    ok(r2 && /1958/.test(r2.reason || ""),
      "an aged-out worktree that STILL holds uncommitted work is RETAINED for resume (Git #1958)");
    ok(!inList(s2.removed, liveWt),
      "an aged-out work-bearing worktree is NOT a non-force removal candidate (Git #1958)");

    // --- #2537 no-permanent-leak guarantee preserved: an explicit force/--all sweep STILL
    //     reclaims the work-bearing worktree (removeWorktreeSafe rescues to rescued/* first),
    //     so retained-for-resume never becomes an unbounded leak. ---
    const s3 = sweepWorktrees(config, { dryRun: true, maxAgeMs: 1, force: true });
    ok(inList(s3.removed, liveWt),
      "a force/--all sweep still reclaims the work-bearing worktree — no permanent leak (#2537 preserved)");

    // --- Git #4244 — a re-dispatched build's worktree, exactly the profile that got swept
    //     live: a registry record with a DEAD creatorPid (the prior dispatch's process is long
    //     gone), no recent on-disk activity (the mtime-based #2537 fallback aged out too), and a
    //     CLEAN tree (no uncommitted work for #1958's retain-for-resume to catch either) — i.e.
    //     every existing retention signal genuinely says "orphaned". BuildConsole's own
    //     protectedPaths report (its authoritative in-process _running list) must retain it
    //     anyway, since it's the real defense-in-depth this fix adds. ---
    const redispatchWt = path.join(tmpRoot, "wt-redispatch-4244");
    git(repo, ["worktree", "add", "-q", "-b", "agent/redispatch-4244", redispatchWt, "HEAD"]);
    // A pid guaranteed not alive right now. The real assertion here is about protectedPaths
    // overriding a DEAD/absent pid, not about exercising pidAlive() itself (already covered by
    // lock.mjs's own tests) — an out-of-realistic-range pid is a stable, portable stand-in.
    const deadPid = 999999;
    registerWorktree(config, {
      name: "redispatch-4244",
      path: redispatchWt,
      branch: "agent/redispatch-4244",
      creatorPid: deadPid,
    });
    // Backdate the record so it's past every existing grace window (createdAt/lastActiveAt both
    // stale) and clear of the freshly-written liveWt's activity above.
    const { updateWorktreeRecord } = await import("./worktree-lifecycle.mjs");
    updateWorktreeRecord(config, redispatchWt, { createdAt: Date.now() - 60 * 60 * 1000 });

    // maxAgeMs: 1 — the `git worktree add` above just wrote fresh mtimes into this worktree's
    // own .git dir, so the #2537 on-disk-activity grace fallback would otherwise retain it on
    // that basis alone; aging it out here isolates the actual signal this test cares about
    // (dead pid + protectedPaths), matching how the #1958 case above ages liveWt the same way.
    const s4 = sweepWorktrees(config, { dryRun: true, maxAgeMs: 1 }); // no protectedPaths — control run
    ok(inList(s4.removed, redispatchWt),
      "control: with no protectedPaths, the dead-pid/no-activity/clean-tree worktree IS a removal candidate");

    const s5 = sweepWorktrees(config, { dryRun: true, maxAgeMs: 1, protectedPaths: [redispatchWt] });
    const r5 = s5.retained.find((r) => norm(path.resolve(r.path)) === norm(path.resolve(redispatchWt)));
    ok(r5 && /4244/.test(r5.reason || ""),
      "Git #4244: a worktree BuildConsole reports as a live build's cwd is RETAINED regardless of dead creatorPid/no activity");
    ok(!inList(s5.removed, redispatchWt),
      "Git #4244: the protected worktree is NOT a removal candidate");

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
