#!/usr/bin/env node
// scripts/dev-server/git-maintenance.mjs
//
// Git #2796 — real, automated, ONGOING repo housekeeping. A one-time manual cleanup
// (355 stale `agent/*` branches, ~10k loose objects, ~23 stray `C:\wt\*` dirs) was
// already done by hand once; nothing kept it clean, so it re-accumulates. This is the
// mechanism, not another one-off pass: three independent, individually-safe sweeps
// meant to run on a recurring schedule (wired into BuildConsole's own periodic tick,
// see QueueWatcherService.MaybeRunGitMaintenance / desktop/BuildConsole/Services/
// WorktreeCleanupService.cs), and also runnable by hand or from a scheduled task.
//
//   1. pruneMergedAgentBranches — delete `agent/*` branches (local AND the real
//      remote branch behind `origin/agent/*`) but ONLY when the branch tip is a
//      verified `git merge-base --is-ancestor` of the base ref. Never touches a
//      branch that isn't provably merged, never touches a branch checked out in a
//      live worktree, never touches anything but `agent/*`.
//   2. pruneLooseObjects — periodic `git gc --prune=2.weeks.ago`, run only once the
//      loose object count crosses a threshold, so the "too many unreachable loose
//      objects" warning (and the auto-pack tax it triggers on every git command)
//      doesn't sit unaddressed indefinitely the way it did before this existed.
//   3. sweepStrayWorktreeDirs — reconcile `C:\wt\*` against `git worktree list`.
//      Anything NOT a registered worktree is a leftover (the #2118/#2720 class);
//      remove it only once it has aged past a safety window (never touches a dir
//      that might still be mid-provision) and only after confirming it holds no
//      real uncommitted/unpushed work (detectWorktreeWork — a dir with no `.git`
//      at all, which is the common case here, trivially passes that check) and
//      unlinking any node_modules/dist junctions first so removal can never follow
//      a reparse point into the shared dependency store (the same #1988 guard
//      removeWorktreeSafe already uses for registered worktrees) — and, since #2986,
//      the same #1980 post-removal store-doctor scan+auto-repair canary too, so this
//      duplicate removal path can no longer poison the shared store silently the way
//      it did before removeWorktreeSafe's copy of this logic got that canary.
//
// Usage:
//   node scripts/dev-server/git-maintenance.mjs [--dry-run] [--json]
//     [--branches-only] [--gc-only] [--strays-only]
//     [--base <ref>] [--loose-threshold <n>] [--min-age-hours <n>] [--no-fetch]

import path from "node:path";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { loadConfig, isWindows } from "./config.mjs";
import { git, revParse, isAncestor, listWorktrees, deleteBranch } from "./git.mjs";
import {
  appendCleanupLog,
  detectWorktreeWork,
  normalizePath,
  worktreeLastActivityMs,
} from "./worktree-lifecycle.mjs";
import { findAndUnlinkWorktreeJunctions } from "./link-deps.mjs";
import { scanSharedStore, repairSharedStore } from "./store-doctor.mjs";

/** Default root agents provision isolated worktrees under (mirrors provision-worktree.mjs). */
export function defaultWtRoot() {
  return process.env.DEV_SERVER_WT_ROOT || (isWindows() ? "C:\\wt" : path.join(path.dirname(process.cwd()), "wt"));
}

// ---------------------------------------------------------------------------
// 1. Merged agent/* branch pruning
// ---------------------------------------------------------------------------

/** Local + remote-tracking `agent/*` branch short names, deduped. */
function listAgentBranches(repoRoot) {
  const local = new Set();
  const remote = new Set();

  const localRes = git(repoRoot, ["for-each-ref", "--format=%(refname:short)", "refs/heads/agent/"]);
  if (localRes.code === 0) {
    for (const line of localRes.stdout.split("\n")) {
      const short = line.trim();
      if (short) local.add(short);
    }
  }

  const remoteRes = git(repoRoot, ["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin/agent/"]);
  if (remoteRes.code === 0) {
    for (const line of remoteRes.stdout.split("\n")) {
      const short = line.trim(); // e.g. "origin/agent/1411-q704"
      if (short) remote.add(short.replace(/^origin\//, ""));
    }
  }

  return { local: [...local].sort(), remote: [...remote].sort() };
}

/**
 * Delete every `agent/*` branch (local + real remote) whose tip is a verified
 * ancestor of `base`. Anything not provably merged is left alone and reported as
 * "retained" (stranded), never deleted — this is deliberately the mirror image of
 * check-stranded-branches.mjs's "stranded" list.
 */
export function pruneMergedAgentBranches(config, opts = {}) {
  const dryRun = !!opts.dryRun;
  const repoRoot = config.mainRepoRoot;

  if (!opts.noFetch) {
    git(repoRoot, ["fetch", "origin", "--prune", "--quiet"]);
  }

  let resolvedBase = opts.base || config.baseRef || "origin/main";
  if (revParse(repoRoot, resolvedBase) === null) resolvedBase = "main";
  const baseSha = revParse(repoRoot, resolvedBase);
  if (!baseSha) {
    return { ok: false, error: `Could not resolve base ref '${resolvedBase}'.` };
  }

  const currentBranchRes = git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const currentBranch = currentBranchRes.code === 0 ? currentBranchRes.stdout.trim() : null;

  // Never touch a branch some live worktree has checked out, even if it's merged --
  // deleting a checked-out branch is refused by git anyway, but skip it up front so
  // it's reported clearly rather than as a failed delete.
  const checkedOutBranches = new Set(
    listWorktrees(repoRoot)
      .map((w) => w.branch)
      .filter(Boolean)
  );

  const { local, remote } = listAgentBranches(repoRoot);
  const deletedLocal = [];
  const deletedRemote = [];
  const retained = [];
  const failed = [];

  for (const branch of local) {
    if (branch === currentBranch) {
      retained.push({ branch, scope: "local", reason: "currently checked out (HEAD)" });
      continue;
    }
    if (checkedOutBranches.has(branch)) {
      retained.push({ branch, scope: "local", reason: "checked out in a live worktree" });
      continue;
    }
    const sha = revParse(repoRoot, branch);
    if (!sha) continue;
    if (!isAncestor(repoRoot, sha, baseSha)) {
      retained.push({ branch, scope: "local", sha, reason: "not an ancestor of base — unmerged/in-flight" });
      continue;
    }
    if (dryRun) {
      deletedLocal.push({ branch, sha, dryRun: true });
      continue;
    }
    const res = deleteBranch(repoRoot, branch, { force: false }); // -d: refuses if git itself disagrees it's merged
    if (res.code === 0) {
      deletedLocal.push({ branch, sha });
    } else {
      failed.push({ branch, scope: "local", error: res.stderr || res.stdout });
    }
  }

  for (const branch of remote) {
    const remoteRef = `origin/${branch}`;
    const sha = revParse(repoRoot, remoteRef);
    if (!sha) continue;
    if (!isAncestor(repoRoot, sha, baseSha)) {
      retained.push({ branch, scope: "remote", sha, reason: "not an ancestor of base — unmerged/in-flight" });
      continue;
    }
    if (dryRun) {
      deletedRemote.push({ branch, sha, dryRun: true });
      continue;
    }
    const push = git(repoRoot, ["push", "origin", "--delete", branch]);
    if (push.code === 0 || /remote ref does not exist/i.test(push.stderr)) {
      deletedRemote.push({ branch, sha });
      // Drop the now-dangling remote-tracking ref locally too.
      git(repoRoot, ["update-ref", "-d", `refs/remotes/origin/${branch}`]);
    } else {
      failed.push({ branch, scope: "remote", error: push.stderr || push.stdout });
    }
  }

  const result = {
    ok: true,
    base: resolvedBase,
    baseSha,
    inspectedCount: local.length + remote.length,
    deletedCount: deletedLocal.length + deletedRemote.length,
    retainedCount: retained.length,
    failedCount: failed.length,
    deletedLocal,
    deletedRemote,
    retained,
    failed,
    dryRun,
  };

  try {
    appendCleanupLog(config, {
      action: "git-maintenance:prune-branches",
      dryRun,
      deletedLocalCount: deletedLocal.length,
      deletedRemoteCount: deletedRemote.length,
      retainedCount: retained.length,
      failedCount: failed.length,
    });
  } catch {}

  return result;
}

// ---------------------------------------------------------------------------
// 2. Loose object pruning
// ---------------------------------------------------------------------------

function parseCountObjects(text) {
  const out = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = line.match(/^(\S+):\s*(\d+)/);
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}

/**
 * Run `git gc --prune=2.weeks.ago` (the same expiry window `git gc --auto` uses by
 * default) once the loose object count crosses `threshold`. Deliberately NOT
 * `--prune=now` -- that would remove the reflog/dangling-commit safety net a just-
 * deleted branch's tip briefly needs (e.g. if it's re-discovered stranded moments
 * later); the 2-week window matches git's own defaults for that reason.
 */
export function pruneLooseObjects(config, opts = {}) {
  const dryRun = !!opts.dryRun;
  const threshold = opts.threshold ?? 2000;
  const repoRoot = config.mainRepoRoot;

  const before = git(repoRoot, ["count-objects", "-v"]);
  if (before.code !== 0) {
    return { ok: false, error: before.stderr || before.stdout };
  }
  const beforeCounts = parseCountObjects(before.stdout);
  const looseCount = beforeCounts.count ?? 0;

  if (looseCount < threshold) {
    return {
      ok: true,
      ran: false,
      looseCountBefore: looseCount,
      threshold,
      reason: `below threshold (${looseCount} < ${threshold}) — no gc needed`,
    };
  }

  if (dryRun) {
    return {
      ok: true,
      ran: false,
      dryRun: true,
      looseCountBefore: looseCount,
      threshold,
      reason: `would run 'git gc --prune=2.weeks.ago' (${looseCount} >= ${threshold})`,
    };
  }

  const gc = git(repoRoot, ["gc", "--prune=2.weeks.ago"]);
  const after = git(repoRoot, ["count-objects", "-v"]);
  const afterCounts = after.code === 0 ? parseCountObjects(after.stdout) : {};

  const result = {
    ok: gc.code === 0,
    ran: true,
    looseCountBefore: looseCount,
    looseCountAfter: afterCounts.count ?? null,
    threshold,
    gcError: gc.code === 0 ? null : gc.stderr || gc.stdout,
  };

  try {
    appendCleanupLog(config, {
      action: "git-maintenance:gc",
      ...result,
    });
  } catch {}

  return result;
}

// ---------------------------------------------------------------------------
// 3. Stray C:\wt\* directory sweep
// ---------------------------------------------------------------------------

function dirMtimeMs(p) {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Reconcile every top-level directory under `wtRoot` against `git worktree list`.
 * Anything not a currently-registered worktree is a leftover (either the #2118/
 * #2720 empty-dir class self-healed one at a time on the next provision, or older
 * debris left behind entirely -- e.g. from before that self-heal existed, or a
 * worktree whose `.git` link was already destroyed without the directory being
 * cleaned up). Safety, in order:
 *
 *   - a minimum age gate (default 24h, keyed off the most recent activity the same
 *     way the registered-worktree sweep judges liveness) so a directory mid-
 *     provisioning is never touched;
 *   - detectWorktreeWork() -- if the directory somehow still IS a functional git
 *     worktree (has a working `.git` link) with real dirty/unpushed work, it is
 *     retained, never removed. The common real case here has no `.git` at all
 *     (git itself has already forgotten it), which trivially passes as "no work".
 *   - junctions (node_modules/dist) inside are unlinked FIRST via the same #1988
 *     guard used for registered-worktree removal, so a recursive delete can never
 *     follow a reparse point into the shared dependency store.
 */
export function sweepStrayWorktreeDirs(config, opts = {}) {
  const dryRun = !!opts.dryRun;
  const wtRoot = opts.wtRoot || defaultWtRoot();
  const minAgeMs = opts.minAgeMs ?? 24 * 60 * 60 * 1000; // 24h

  if (!existsSync(wtRoot)) {
    return { ok: true, wtRoot, inspectedCount: 0, removedCount: 0, retainedCount: 0, removed: [], retained: [] };
  }

  let entries;
  try {
    entries = readdirSync(wtRoot, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch (e) {
    return { ok: false, error: e.message };
  }

  const registered = new Set(listWorktrees(config.mainRepoRoot).map((w) => normalizePath(w.path)));

  const removed = [];
  const retained = [];

  for (const entry of entries) {
    const dirPath = path.join(wtRoot, entry.name);
    const norm = normalizePath(dirPath);
    if (registered.has(norm)) continue; // real, currently-registered worktree — not ours to touch

    // A name someone deliberately marked as a manual backup/rescue (e.g. the
    // `_stray-<id>-backup` convention from a prior incident) is never auto-deleted --
    // it exists specifically because a human decided it needed to survive past the
    // normal lifecycle. Always surfaced for manual review instead.
    if (/backup/i.test(entry.name)) {
      retained.push({ path: dirPath, reason: "name marks it a deliberate manual backup — never auto-deleted, needs human review" });
      continue;
    }

    const lastTouch = Math.max(dirMtimeMs(dirPath), worktreeLastActivityMs(dirPath));
    const ageMs = Date.now() - lastTouch;
    if (lastTouch > 0 && ageMs < minAgeMs) {
      retained.push({ path: dirPath, reason: `active recently (${Math.round(ageMs / 60000)}m ago < grace ${Math.round(minAgeMs / 60000)}m)` });
      continue;
    }

    const work = detectWorktreeWork(config, dirPath);
    if (work.hasWork) {
      retained.push({ path: dirPath, reason: "still holds uncommitted/unpushed work — left in place" });
      continue;
    }

    if (dryRun) {
      removed.push({ path: dirPath, dryRun: true });
      continue;
    }

    let junctionsUnlinked = [];
    let remaining = [];
    try {
      const r = findAndUnlinkWorktreeJunctions(dirPath);
      junctionsUnlinked = r.unlinked;
      remaining = r.remaining;
    } catch (e) {
      remaining = [`(junction enumeration failed: ${e.message})`];
    }
    if (remaining.length > 0) {
      retained.push({ path: dirPath, reason: `${remaining.length} junction(s) could not be unlinked (${remaining.join(", ")}) — left in place (Git #1988)` });
      continue;
    }

    let fsRemoved = false;
    try {
      rmSync(dirPath, { recursive: true, force: true });
      fsRemoved = !existsSync(dirPath);
    } catch {
      if (isWindows()) {
        try {
          execFileSync("cmd", ["/c", "rmdir", "/S", "/Q", dirPath], { stdio: "ignore" });
          fsRemoved = !existsSync(dirPath);
        } catch {}
      }
    }

    removed.push({ path: dirPath, junctionsUnlinkedCount: junctionsUnlinked.length, fsRemoved });
  }

  // Git #2986 — this sweep unlinks junctions and rmSync's a stray dir exactly like
  // removeWorktreeSafe (worktree-lifecycle.mjs) does for a registered worktree, but
  // until now it was a SEPARATE, duplicated removal code path that never carried the
  // Git #1980 store-doctor canary that call site got. Real evidence in #2986: every
  // "removed" log entry with a poisoned storeAfterRemoval (670 foreign / 393 dangling
  // links, 2026-09-06T14:36Z-15:07Z) came from removeWorktreeSafe BEFORE #1980 landed
  // at 15:46Z; every removal logged SINCE #1980 landed has come through THIS
  // "git-maintenance:stray-dirs" path instead (no "removed" action from
  // worktree-lifecycle.mjs appears in cleanups.log after 15:07Z), which never scanned
  // or repaired the shared store at all -- so #1980 fixed one call site while this one,
  // silently, kept the pre-#1980 unprotected behavior and is a live candidate for
  // producing the exact api-server/node_modules/vitest-missing symptom #2986 reports.
  // Only scan/repair when this sweep actually removed something -- an empty run has
  // nothing that could have poisoned the store.
  let storeAfterRemoval = null;
  if (!dryRun && removed.length > 0) {
    try {
      const scan = scanSharedStore(config.mainRepoRoot);
      storeAfterRemoval = {
        clean: scan.clean,
        foreign: scan.foreignLinks.length,
        dangling: scan.danglingLinks.length,
        poisonedBins: scan.poisonedBins.length,
      };
      if (!scan.clean) {
        console.warn(
          `[git-maintenance] WARNING: shared store at ${config.mainRepoRoot} is POISONED after sweeping ${removed.length} stray dir(s) ` +
            `(foreign=${scan.foreignLinks.length}, dangling=${scan.danglingLinks.length}, poisonedBins=${scan.poisonedBins.length}). ` +
            `Auto-repairing now (Git #1980/#2986) — see storeAutoRepair in this log entry.`
        );
        let repairRes = null;
        try {
          repairRes = repairSharedStore(config.mainRepoRoot, scan);
        } catch (e) {
          repairRes = { error: e.message };
        }
        const rescan = scanSharedStore(config.mainRepoRoot);
        storeAfterRemoval.autoRepair = {
          repairedLinks: repairRes?.repairedLinks?.length ?? 0,
          repairedBins: repairRes?.repairedBins?.length ?? 0,
          unrepairable: repairRes?.unrepairable?.length ?? 0,
          error: repairRes?.error ?? null,
          cleanAfterRepair: rescan.clean,
        };
        console.warn(
          `[git-maintenance] store-doctor auto-repair: relinked ${storeAfterRemoval.autoRepair.repairedLinks} link(s), ` +
            `rewrote ${storeAfterRemoval.autoRepair.repairedBins} shim(s), unrepairable ${storeAfterRemoval.autoRepair.unrepairable} — ` +
            `store is now ${rescan.clean ? "CLEAN" : "STILL POISONED"}.` +
            (rescan.clean ? "" : " Diagnose remaining entries with: node scripts/dev-server/store-doctor.mjs")
        );
      }
    } catch (e) {
      storeAfterRemoval = { error: e.message };
    }
  }

  const result = {
    ok: true,
    wtRoot,
    inspectedCount: entries.length,
    removedCount: removed.length,
    retainedCount: retained.length,
    removed,
    retained,
    dryRun,
    storeAfterRemoval,
  };

  try {
    appendCleanupLog(config, {
      action: "git-maintenance:stray-dirs",
      dryRun,
      removedCount: removed.length,
      retainedCount: retained.length,
      storeAfterRemoval,
    });
  } catch {}

  return result;
}

// ---------------------------------------------------------------------------
// Orchestration + CLI
// ---------------------------------------------------------------------------

export function runGitMaintenance(config, opts = {}) {
  const report = { ok: true, ranAt: new Date().toISOString() };
  if (!opts.gcOnly && !opts.straysOnly) {
    report.branches = pruneMergedAgentBranches(config, opts);
  }
  if (!opts.branchesOnly && !opts.straysOnly) {
    report.gc = pruneLooseObjects(config, opts);
  }
  if (!opts.branchesOnly && !opts.gcOnly) {
    report.strays = sweepStrayWorktreeDirs(config, opts);
  }
  return report;
}

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--json") a.json = true;
    else if (t === "--dry-run") a.dryRun = true;
    else if (t === "--no-fetch") a.noFetch = true;
    else if (t === "--branches-only") a.branchesOnly = true;
    else if (t === "--gc-only") a.gcOnly = true;
    else if (t === "--strays-only") a.straysOnly = true;
    else if (t === "--base") a.base = argv[++i];
    else if (t === "--loose-threshold") a.threshold = Number(argv[++i]);
    else if (t === "--min-age-hours") a.minAgeMs = Number(argv[++i]) * 60 * 60 * 1000;
    else a._.push(t);
  }
  return a;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const report = runGitMaintenance(config, args);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`[git-maintenance] run at ${report.ranAt}${args.dryRun ? " (DRY RUN)" : ""}`);
    if (report.branches) {
      const b = report.branches;
      if (!b.ok) console.log(`  branches: ERROR — ${b.error}`);
      else console.log(`  branches: inspected=${b.inspectedCount} deleted=${b.deletedCount} retained=${b.retainedCount} failed=${b.failedCount}`);
    }
    if (report.gc) {
      const g = report.gc;
      if (!g.ok) console.log(`  gc: ERROR — ${g.error}`);
      else console.log(`  gc: ran=${g.ran} looseBefore=${g.looseCountBefore}${g.looseCountAfter != null ? ` looseAfter=${g.looseCountAfter}` : ""} (${g.reason || ""})`);
    }
    if (report.strays) {
      const s = report.strays;
      if (!s.ok) console.log(`  strays: ERROR — ${s.error}`);
      else console.log(`  strays: inspected=${s.inspectedCount} removed=${s.removedCount} retained=${s.retainedCount}`);
    }
  }
}
