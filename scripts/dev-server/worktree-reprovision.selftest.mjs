#!/usr/bin/env node
// scripts/dev-server/worktree-reprovision.selftest.mjs
//
// Git #1958 — focused self-test for the pause/resume re-provision data-loss guards.
//
// The #1550 incident: a build session was paused/torn-down mid-session; its isolated
// worktree was swept (owner pid dead) and a resumed session re-provisioned a FRESH worktree
// off a newer origin/main — silently discarding the prior session's uncommitted work and
// orphaning its one pushed commit, while handing the resumed session a clean `git status`
// with zero trace. Two guards close that:
//
//   1. detectWorktreeWork() — the single source of truth for "does this worktree still hold
//      real work?", used by BOTH the removal rescue (#1971) and the sweep's new retain-in-place
//      decision (Check 4), so they can never disagree. BuildConsole's own untracked markers are
//      filtered out (never counted as work).
//   2. findOrphanedRescueBranches() + writeReprovisionMarker() — when a (re-)provision lands
//      over a name that already has rescued/<name>-* work NOT reachable from the new HEAD, a
//      visible marker is dropped into the worktree so a resumed session never trusts a clean
//      checkout. This is the "at minimum, tell the resumed session" the issue asks for.
//
// Stands up a throwaway git repo + isolated state dir (env overrides) — never touches the real
// dev server, checkout, or worktree tracking.
//
//   node scripts/dev-server/worktree-reprovision.selftest.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync, utimesSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let failures = 0;
function ok(cond, msg) {
  if (cond) console.log(`  ok  - ${msg}`);
  else { failures++; console.error(`  FAIL - ${msg}`); }
}
function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/**
 * Backdate every path worktreeLastActivityMs() reads for `wtPath` to `whenSec` seconds ago, so
 * the sweep's on-disk activity grace (#2537) reads the worktree as genuinely inactive. Without
 * this a freshly-created test worktree always looks "active recently" and Check 2 retains it
 * before any later check runs — and the mtime can even read marginally AHEAD of Date.now(), so a
 * tiny maxAgeMs cannot be relied on. Backdating is the deterministic way to test the later checks.
 */
function backdateWorktreeActivity(wtPath, whenSec = 7200) {
  const t = new Date(Date.now() - whenSec * 1000);
  const touch = (p) => { try { utimesSync(p, t, t); } catch {} };
  touch(wtPath);
  let entries = [];
  try { entries = readdirSync(wtPath, { withFileTypes: true }); } catch {}
  for (const e of entries) touch(path.join(wtPath, e.name));
  const gitPointer = path.join(wtPath, ".git");
  touch(gitPointer);
  try {
    const raw = readFileSync(gitPointer, "utf8").trim();
    const m = /^gitdir:\s*(.+)$/m.exec(raw);
    if (m) {
      const gitDir = path.resolve(wtPath, m[1].trim());
      touch(gitDir);
      for (const f of ["HEAD", "index", "ORIG_HEAD", "COMMIT_EDITMSG", "FETCH_HEAD", path.join("logs", "HEAD")]) {
        touch(path.join(gitDir, f));
      }
    }
  } catch {}
}

async function main() {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "wt-reprov-1958-"));
  const repo = path.join(tmpRoot, "repo");
  mkdirSync(repo, { recursive: true });

  process.env.DEV_SERVER_MAIN_ROOT = repo;
  process.env.DEV_SERVER_STATE_DIR = path.join(tmpRoot, "state");
  process.env.DEV_SERVER_WORKTREE = path.join(tmpRoot, "dev-server");
  process.env.DEV_SERVER_BASE_REF = "main"; // resolve base against the main branch tip

  const { loadConfig } = await import("./config.mjs");
  const {
    detectWorktreeWork,
    findOrphanedRescueBranches,
    writeReprovisionMarker,
    REPROVISION_MARKER_NAME,
    sweepWorktrees,
  } = await import("./worktree-lifecycle.mjs");

  try {
    // --- Real repo: main branch with an initial commit (the "origin/main" the base tracks). ---
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@t"]);
    git(repo, ["config", "user.name", "t"]);
    writeFileSync(path.join(repo, "README.md"), "base\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "init"]);
    const baseCommit = git(repo, ["rev-parse", "HEAD"]);

    const config = loadConfig({ cwd: repo });

    // === detectWorktreeWork ===================================================================
    // A worktree on the base tip with a clean tree holds no work.
    const cleanWt = path.join(tmpRoot, "wt-clean");
    git(repo, ["worktree", "add", "-q", "-b", "agent/clean", cleanWt, baseCommit]);
    let d = detectWorktreeWork(config, cleanWt);
    ok(!d.hasWork && !d.dirty && !d.unpushed, "clean worktree on base tip: hasWork=false");

    // An uncommitted change makes it dirty → hasWork.
    writeFileSync(path.join(cleanWt, "impl.ts"), "export const x = 1;\n");
    d = detectWorktreeWork(config, cleanWt);
    ok(d.hasWork && d.dirty, "uncommitted change: hasWork=true (dirty)");

    // BuildConsole's own untracked markers are bookkeeping, NOT work — filtered out.
    rmSync(path.join(cleanWt, "impl.ts"), { force: true });
    writeFileSync(path.join(cleanWt, REPROVISION_MARKER_NAME), "{}\n");
    writeFileSync(path.join(cleanWt, ".stale-worktree.json"), "{}\n");
    d = detectWorktreeWork(config, cleanWt);
    ok(!d.hasWork, "only the reprovision/stale markers present: hasWork=false (markers filtered)");
    rmSync(path.join(cleanWt, REPROVISION_MARKER_NAME), { force: true });
    rmSync(path.join(cleanWt, ".stale-worktree.json"), { force: true });

    // A committed-but-unmerged commit (not an ancestor of base) counts as unpushed work.
    writeFileSync(path.join(cleanWt, "impl.ts"), "export const x = 2;\n");
    git(cleanWt, ["add", "-A"]);
    git(cleanWt, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "wip"]);
    d = detectWorktreeWork(config, cleanWt);
    ok(d.hasWork && d.unpushed, "committed-but-unmerged commit: hasWork=true (unpushed)");

    // === findOrphanedRescueBranches ===========================================================
    // No rescued/<name>-* branches yet → nothing orphaned.
    const name = "1550-q897";
    ok(findOrphanedRescueBranches(config, name, cleanWt).length === 0,
      "no rescued/<name>-* branches: findOrphanedRescueBranches returns []");

    // Simulate a prior session's rescued work: a rescued/<name>-<ts> branch at a commit that is
    // NOT reachable from a freshly re-provisioned worktree's HEAD (the #1550 shape).
    const orphanCommit = git(cleanWt, ["rev-parse", "HEAD"]); // the unmerged wip commit above
    const rescueBranch = `rescued/${name}-2026-08-30T10-00-00-000Z`;
    git(repo, ["branch", rescueBranch, orphanCommit]);

    // A FRESH worktree re-provisioned off the base tip (does not contain orphanCommit).
    const freshWt = path.join(tmpRoot, "wt-fresh");
    git(repo, ["worktree", "add", "-q", "-b", `agent/${name}`, freshWt, baseCommit]);
    let orphaned = findOrphanedRescueBranches(config, name, freshWt);
    ok(orphaned.length === 1 && orphaned[0].branch === rescueBranch,
      "rescued branch not reachable from fresh HEAD is reported as orphaned");

    // A worktree whose HEAD already CONTAINS the rescued tip must NOT be re-warned.
    ok(findOrphanedRescueBranches(config, name, cleanWt).length === 0,
      "rescued tip already reachable from HEAD: not reported (no double-warn)");

    // A different name shares nothing — no cross-name false positives.
    ok(findOrphanedRescueBranches(config, "9999-other", freshWt).length === 0,
      "rescued branches of another name are not matched (prefix isolation)");

    // === writeReprovisionMarker ================================================================
    const marker = writeReprovisionMarker(config, freshWt, orphaned);
    const markerPath = path.join(freshWt, REPROVISION_MARKER_NAME);
    ok(marker && existsSync(markerPath), "writeReprovisionMarker drops the marker file");
    const parsed = JSON.parse(readFileSync(markerPath, "utf8"));
    ok(Array.isArray(parsed.rescuedBranches) && parsed.rescuedBranches.includes(rescueBranch),
      "marker names the rescued branch(es) for recovery");

    // Nothing to warn about → no marker, returns null.
    ok(writeReprovisionMarker(config, cleanWt, []) === null,
      "writeReprovisionMarker with no orphaned work returns null and writes nothing");
    ok(!existsSync(path.join(cleanWt, REPROVISION_MARKER_NAME)),
      "no marker is written when there is nothing to warn about");

    // The marker just written must not itself register as work (feeds back into detect cleanly).
    const dFresh = detectWorktreeWork(config, freshWt);
    ok(!dFresh.hasWork, "a worktree holding only the reprovision marker still reads hasWork=false");

    // === Sweep Check 4: bounded retain-then-reclaim lifecycle ==================================
    // A work-bearing worktree with a dead owner is (1) RETAINED for resume on the first sweep
    // (marked stale, starting the debug window), then (2) once that debug window expires, it is
    // RECLAIMED — the retention is a bounded resume window, not a permanent non-force leak
    // (#2537). Owner-pid is set to an impossible pid so the sweep never treats it as live.
    // Recordless (no tracking record) so the sweep's activity grace keys ONLY off the on-disk
    // mtimes we backdate — a record would carry a fresh createdAt/lastActiveAt that retains it
    // regardless. A recordless `agent/*` worktree still passes the ownership gate (#1371).
    const parkWt = path.join(tmpRoot, "wt-park");
    git(repo, ["worktree", "add", "-q", "-b", "agent/park", parkWt, baseCommit]);
    writeFileSync(path.join(parkWt, "impl.ts"), "export const y = 1;\n"); // uncommitted work
    backdateWorktreeActivity(parkWt); // age it past the activity grace deterministically

    // Sweep 1 (non-force, real): first sighting → retained-for-resume + marked stale.
    const sw1 = sweepWorktrees(config, {});
    const retain1 = sw1.retained.find((r) => path.resolve(r.path).toLowerCase() === path.resolve(parkWt).toLowerCase());
    ok(retain1 && /1958/.test(retain1.reason || ""),
      "sweep 1: dead-owner worktree with uncommitted work is RETAINED for resume + marked stale (Git #1958)");
    ok(existsSync(path.join(parkWt, ".stale-worktree.json")),
      "sweep 1: a stale marker was written (the resume window has started)");

    // Backdate again (the marker write bumped mtimes) and expire BOTH the activity grace and the
    // debug window (debugMaxAgeMs:0) so the second sweep reaches Check 4 already-parked.
    backdateWorktreeActivity(parkWt);
    const sw2 = sweepWorktrees(config, { debugMaxAgeMs: 0 });
    const removed2 = sw2.removed.find((r) => r && path.resolve(r.path).toLowerCase() === path.resolve(parkWt).toLowerCase());
    ok(!!removed2,
      "sweep 2: once the resume window expires, the work-bearing worktree IS reclaimed — bounded, no permanent leak (#2537)");
    ok(removed2 && removed2.rescuedBranch,
      "sweep 2: the reclaim RESCUED the uncommitted work to a rescued/* branch first (Git #1971) — never a silent discard");

    console.log(failures === 0 ? "\nAll worktree-reprovision self-tests passed." : `\n${failures} assertion(s) FAILED.`);
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
