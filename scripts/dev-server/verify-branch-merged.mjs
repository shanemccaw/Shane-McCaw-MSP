#!/usr/bin/env node
// scripts/dev-server/verify-branch-merged.mjs
//
// Git #1447 Part 1. A session must run this before writing a DONE bookend for a
// branch it worked on, to confirm the branch's own claim of "done" actually landed
// on main -- not just that its local worktree looks clean. Follow-up to #1434: a
// live check found #1411/#1412/#1413/#1415/#1427 all sat DONE-looking with unmerged
// commits main never got, because nothing enforced this check at bookend time.
//
// Usage:
//   node scripts/dev-server/verify-branch-merged.mjs [branch] [--base <ref>] [--json]
//
//   <branch>   defaults to the current branch of the repo at cwd.
//   --base     the ref to check ancestry against (default: origin/main, falling
//              back to main if no `origin` remote is configured).
//
// Exit code 0  -> branch HEAD is an ancestor of (already merged into) base. Safe to
//                 write DONE.
// Exit code 1  -> branch HEAD is NOT an ancestor of base -- there are commits on the
//                 branch that main does not have. Do NOT write DONE; either merge/
//                 push and retry, or write an honest MERGE-BLOCKED / still-IN-FLIGHT
//                 bookend state instead, and say so in the completion comment.

import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.mjs";
import { git, isAncestor, currentBranch, revParse } from "./git.mjs";

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--json") a.json = true;
    else if (t === "--base") a.base = argv[++i];
    else a._.push(t);
  }
  return a;
}

export function verifyBranchMerged({ cwd, branch, base } = {}) {
  // Resolve `repoRoot` from the actual cwd (the worktree the session is running
  // in), NOT config.mainRepoRoot -- worktrees share one .git object store, but
  // HEAD/current-branch is per-worktree, so checking the wrong one silently
  // reports on the wrong branch.
  const repoRoot = cwd || process.cwd();
  const config = loadConfig({ cwd: repoRoot });

  const resolvedBranch = branch || currentBranch(repoRoot);
  if (!resolvedBranch) {
    return { ok: false, error: "Could not resolve current branch (detached HEAD?)." };
  }

  // Refresh remote-tracking refs so the ancestry check reflects what's actually on
  // the remote, not a stale local `origin/main` from session start.
  git(repoRoot, ["fetch", "origin", "main", "--quiet"]);

  let resolvedBase = base || config.baseRef || "origin/main";
  if (revParse(repoRoot, resolvedBase) === null) {
    // No `origin` remote reachable in this checkout -- fall back to local main.
    resolvedBase = "main";
  }

  const branchSha = revParse(repoRoot, resolvedBranch);
  const baseSha = revParse(repoRoot, resolvedBase);
  if (!branchSha || !baseSha) {
    return {
      ok: false,
      error: `Could not resolve one of branch=${resolvedBranch} (${branchSha}) / base=${resolvedBase} (${baseSha}).`,
    };
  }

  const merged = isAncestor(repoRoot, branchSha, baseSha);
  const aheadRes = git(repoRoot, ["rev-list", "--count", `${resolvedBase}..${resolvedBranch}`]);
  const aheadCount = aheadRes.code === 0 ? Number(aheadRes.stdout.trim()) || 0 : null;

  return {
    ok: true,
    merged,
    branch: resolvedBranch,
    base: resolvedBase,
    branchSha,
    baseSha,
    aheadCount,
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const res = verifyBranchMerged({ branch: args._[0], base: args.base });

  if (!res.ok) {
    console.error(`[verify-branch-merged] error: ${res.error}`);
    process.exit(2);
  }

  if (args.json) {
    console.log(JSON.stringify(res, null, 2));
  } else if (res.merged) {
    console.log(`[verify-branch-merged] OK — '${res.branch}' (${res.branchSha.slice(0, 8)}) is merged into '${res.base}'. Safe to write DONE.`);
  } else {
    console.log(
      `[verify-branch-merged] NOT MERGED — '${res.branch}' (${res.branchSha.slice(0, 8)}) has ${res.aheadCount} commit(s) ` +
        `ahead of '${res.base}' (${res.baseSha.slice(0, 8)}) that are not on ${res.base}. Do NOT write DONE — merge/push and ` +
        `retry, or write an honest MERGE-BLOCKED / still-IN-FLIGHT bookend and say so in the completion comment.`
    );
  }

  process.exit(res.merged ? 0 : 1);
}
