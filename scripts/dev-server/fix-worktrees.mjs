#!/usr/bin/env node
// scripts/dev-server/fix-worktrees.mjs
//
// Sweeps every live agent worktree (see provision-worktree.mjs /
// worktree-lifecycle.mjs) and brings any whose branch carries real commits
// origin/main doesn't have yet onto main — the "a session finished or crashed
// without ever pushing" class of stuck worktree. Fired from the Terminal
// panel's "Fix Worktrees" chip, which pastes the command for Shane to review
// and press Enter — this script performs the real merge + push once invoked
// (pass --dry-run for a preview that touches nothing).
//
// For each worktree (excluding the main checkout and the dedicated dev-server
// worktree):
//   - directory is gone                -> `git worktree prune` and skip
//   - already checked out to `main`    -> skip, nothing to fix
//   - detached HEAD / no branch        -> too ambiguous to auto-fix: NEEDS AGENT
//   - uncommitted changes in the tree  -> too risky to touch automatically: NEEDS AGENT
//   - branch HEAD already an ancestor of origin/main -> nothing to do
//   - otherwise: merge the branch into a throwaway detached worktree of
//     origin/main and push, retrying fetch+merge+push a few times if
//     origin/main moved under us (the shared-main CAS-push pattern used
//     elsewhere in scripts/dev-server). A real merge conflict aborts cleanly
//     and is reported as NEEDS AGENT rather than guessed at.
//
// Never touches the agent's own worktree directory — all merging happens in a
// scratch worktree that's removed afterward, whether it succeeds or not.
//
// Usage:
//   node scripts/dev-server/fix-worktrees.mjs [--dry-run] [--json]
//
// Exit code is always 0 (this is a sweep/report tool, not a pass/fail gate) —
// read the printed summary, or use --json for a machine-readable one.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.mjs";
import { git, revParse, isAncestor, listWorktrees, mergeNoEdit, removeWorktree } from "./git.mjs";

function parseArgs(argv) {
  const a = { dryRun: false, json: false };
  for (const t of argv) {
    if (t === "--dry-run") a.dryRun = true;
    else if (t === "--json") a.json = true;
  }
  return a;
}

// worktree-lifecycle.mjs's markWorktreeStale() drops this untracked marker file
// into a worktree it's retaining for debugging (see cleanup-worktree.mjs
// --mark-stale). It is BuildConsole's own bookkeeping, never real uncommitted
// work, so it must not by itself count as "dirty" -- a worktree whose ONLY
// change is this file has nothing an agent needs to review.
const STALE_MARKER = ".stale-worktree.json";

function isDirty(cwd) {
  const r = git(cwd, ["status", "--porcelain"]);
  if (r.code !== 0) return true;
  const realChanges = r.stdout
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .filter((line) => line.slice(3) !== STALE_MARKER);
  return realChanges.length > 0;
}

/**
 * Merge `branchSha` onto origin/main via a throwaway detached worktree, then
 * push — retrying fetch+merge+push a few times if origin/main moved under us.
 * Never touches the agent's own worktree; the scratch worktree is always
 * cleaned up, success or failure.
 */
function mergeAndPush(repo, branchSha, branchLabel) {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "fix-worktree-merge-"));
  try {
    const add = git(repo, ["worktree", "add", "--detach", tmpDir, "origin/main"]);
    if (add.code !== 0) {
      return { status: "needs_agent", detail: `Could not create a scratch worktree off origin/main: ${add.stderr.trim()}` };
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      const merge = mergeNoEdit(tmpDir, branchSha, `Merge ${branchLabel} into main (fix-worktrees.mjs)`);
      if (!merge.ok) {
        return {
          status: "needs_agent",
          detail: `Merge conflict bringing '${branchLabel}' onto main — needs a real merge, not automatable. ${(merge.stderr.split("\n")[0] || "").trim()}`.trim(),
        };
      }

      const push = git(tmpDir, ["push", "origin", "HEAD:main"]);
      if (push.code === 0) {
        return {
          status: "merged",
          detail: `Merged and pushed '${branchLabel}' onto main (${merge.sha.slice(0, 8)}).`,
          sha: merge.sha,
        };
      }

      // Rejected -- origin/main moved under us. Refetch and retry from the new tip.
      git(repo, ["fetch", "origin", "main", "--quiet"]);
      const freshMain = revParse(repo, "origin/main");
      if (!freshMain) {
        return { status: "needs_agent", detail: "Push was rejected and origin/main could not be re-resolved to retry." };
      }
      const reset = git(tmpDir, ["reset", "--hard", freshMain]);
      if (reset.code !== 0) {
        return { status: "needs_agent", detail: "Push was rejected and the scratch worktree could not be reset to retry." };
      }
    }

    return {
      status: "needs_agent",
      detail: "Push kept getting rejected after 5 retries — origin/main is moving too fast to land this automatically. Get an agent to push it.",
    };
  } finally {
    try { removeWorktree(repo, tmpDir, { force: true }); } catch { /* best effort */ }
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

/**
 * @returns {{ ok: boolean, error?: string, originMain?: string, results?: any[] }}
 */
export function fixWorktrees({ dryRun = false } = {}) {
  const config = loadConfig();
  const repo = config.mainRepoRoot;

  git(repo, ["fetch", "origin", "main", "--quiet"]);
  const originMain = revParse(repo, "origin/main");
  if (!originMain) {
    return { ok: false, error: "Could not resolve origin/main — check the repo's `origin` remote and network." };
  }

  const protectedPaths = new Set(
    [repo, config.serverWorktree].filter(Boolean).map((p) => path.resolve(p).toLowerCase())
  );

  const worktrees = listWorktrees(repo).filter(
    (w) => !protectedPaths.has(path.resolve(w.path).toLowerCase())
  );

  const results = [];
  for (const wt of worktrees) {
    const entry = { path: wt.path, branch: wt.branch, status: "", detail: "" };

    if (!existsSync(wt.path)) {
      git(repo, ["worktree", "prune"]);
      entry.status = "pruned";
      entry.detail = "Directory no longer exists — pruned the stale worktree record.";
      results.push(entry);
      continue;
    }

    if (wt.detached || !wt.branch) {
      // No branch to merge from, but the detached commit itself might already be
      // an ancestor of origin/main (e.g. a scratch/merge worktree left behind
      // after its work already landed) -- check before giving up on it.
      const headSha = revParse(wt.path, "HEAD");
      if (headSha && isAncestor(repo, headSha, originMain)) {
        entry.status = "already_merged";
        entry.detail = "Detached HEAD, but that commit is already an ancestor of origin/main — nothing to do.";
      } else {
        entry.status = "needs_agent";
        entry.detail = "Detached HEAD with commits not on origin/main — no branch to merge from. Get an agent to look at it.";
      }
      results.push(entry);
      continue;
    }

    if (wt.branch === "main") {
      entry.status = "already_main";
      results.push(entry);
      continue;
    }

    // Resolve merge status BEFORE the dirty gate -- a worktree can be genuinely
    // dirty (or carry the harmless stale-debug marker) and STILL already be fully
    // merged; checking ancestry first means that case reports as already_merged
    // instead of being masked as needs_agent by an unrelated dirty check.
    const branchSha = revParse(wt.path, wt.branch);
    if (!branchSha) {
      entry.status = "needs_agent";
      entry.detail = "Could not resolve the branch's own HEAD commit.";
      results.push(entry);
      continue;
    }

    if (isAncestor(repo, branchSha, originMain)) {
      entry.status = "already_merged";
      entry.detail = "Branch HEAD is already an ancestor of origin/main — nothing to do.";
      results.push(entry);
      continue;
    }

    const aheadRes = git(repo, ["rev-list", "--count", `origin/main..${branchSha}`]);
    entry.ahead = aheadRes.code === 0 ? Number(aheadRes.stdout.trim()) || 0 : null;

    if (isDirty(wt.path)) {
      entry.status = "needs_agent";
      entry.detail = `Uncommitted changes in the worktree (on top of ${entry.ahead ?? "?"} unmerged commit(s)) — too risky to auto-merge. Get an agent to review, commit or discard, then re-run.`;
      results.push(entry);
      continue;
    }

    if (dryRun) {
      entry.status = "would_merge";
      entry.detail = `${entry.ahead ?? "?"} commit(s) not on origin/main — would merge + push.`;
      results.push(entry);
      continue;
    }

    Object.assign(entry, mergeAndPush(repo, branchSha, wt.branch));
    results.push(entry);
  }

  return { ok: true, originMain, results };
}

const STATUS_LABEL = {
  already_main: "OK",
  already_merged: "OK",
  pruned: "PRUNED",
  would_merge: "WOULD MERGE",
  merged: "MERGED",
  needs_agent: "NEEDS AGENT",
};

function printReport(res) {
  if (!res.ok) {
    console.error(`! ${res.error}`);
    return;
  }
  console.log(`fix-worktrees — origin/main @ ${res.originMain.slice(0, 8)}`);
  if (res.results.length === 0) {
    console.log("No agent worktrees found — nothing to check.");
    return;
  }

  const needsAgent = [];
  for (const r of res.results) {
    const label = STATUS_LABEL[r.status] || r.status;
    console.log(`[${label}] ${r.branch ?? "(detached)"} — ${r.path}`);
    if (r.detail) console.log(`    ${r.detail}`);
    if (r.status === "needs_agent") needsAgent.push(r);
  }

  console.log("");
  if (needsAgent.length > 0) {
    console.log(`${needsAgent.length} worktree(s) need a real agent, not this script:`);
    for (const r of needsAgent) console.log(`  - ${r.branch ?? r.path}: ${r.detail}`);
  } else {
    console.log("Everything else is on main or already in sync.");
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const res = fixWorktrees({ dryRun: args.dryRun });
  if (args.json) console.log(JSON.stringify(res, null, 2));
  else printReport(res);
  process.exit(0);
}
