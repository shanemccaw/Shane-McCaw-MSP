#!/usr/bin/env node
// scripts/dev-server/check-stranded-branches.mjs
//
// Git #1447 Part 2. A genuinely NEW check, separate from the worktree-lifecycle
// sweep (worktree-lifecycle.mjs / cleanup-worktree.mjs), which only answers "is
// this local checkout directory stale and safe to delete" -- it has zero concept
// of whether a branch's commits actually landed on main. This script answers the
// other question: does any `agent/*` branch have commits main does not have?
//
// Root cause this exists to catch (see #1447's own writeup of the #1434
// follow-up): #1411/#1412/#1413/#1415/#1427 all sat with unmerged commits on
// stale branches, and nothing surfaced it -- the worktree sweep reported
// "Orphaned: 0" because the local worktree directories were fine; the branches
// themselves were the problem. Do not fold this into that sweep's "orphaned"
// count -- they are different questions.
//
// Usage:
//   node scripts/dev-server/check-stranded-branches.mjs [--base <ref>] [--json]
//
// A branch is "stranded" if `git rev-list --count <base>..<branch>` > 0, i.e. it
// has commits ahead of base that base does not have. Checked against every
// `origin/agent/*` remote-tracking branch (refreshed via `git fetch --prune`
// first) plus any local `agent/*` branch not tracked to a remote at all.

import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.mjs";
import { git, revParse } from "./git.mjs";

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--json") a.json = true;
    else if (t === "--base") a.base = argv[++i];
    else if (t === "--no-fetch") a.noFetch = true;
    else a._.push(t);
  }
  return a;
}

function listAgentBranches(repoRoot) {
  const names = new Set();

  // Remote-tracking agent/* branches (the normal case -- pushed work).
  const remoteRes = git(repoRoot, [
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/remotes/origin/agent/",
  ]);
  if (remoteRes.code === 0) {
    for (const line of remoteRes.stdout.split("\n")) {
      const short = line.trim();
      if (!short) continue;
      names.add(short); // e.g. "origin/agent/1411-q704"
    }
  }

  // Local-only agent/* branches with no remote tracking ref -- unpushed work,
  // still worth flagging as stranded relative to base.
  const localRes = git(repoRoot, ["for-each-ref", "--format=%(refname:short)", "refs/heads/agent/"]);
  if (localRes.code === 0) {
    for (const line of localRes.stdout.split("\n")) {
      const short = line.trim();
      if (!short) continue;
      if (!names.has(`origin/${short}`)) names.add(short);
    }
  }

  return [...names].sort();
}

export function checkStrandedBranches({ cwd, base, noFetch } = {}) {
  const repoRoot = cwd || process.cwd();
  const config = loadConfig({ cwd: repoRoot });

  if (!noFetch) {
    git(repoRoot, ["fetch", "origin", "--prune", "--quiet"]);
  }

  let resolvedBase = base || config.baseRef || "origin/main";
  if (revParse(repoRoot, resolvedBase) === null) {
    resolvedBase = "main";
  }
  const baseSha = revParse(repoRoot, resolvedBase);
  if (!baseSha) {
    return { ok: false, error: `Could not resolve base ref '${resolvedBase}'.` };
  }

  const branches = listAgentBranches(repoRoot);
  const stranded = [];
  const clean = [];

  for (const branch of branches) {
    const branchSha = revParse(repoRoot, branch);
    if (!branchSha) continue; // ref vanished mid-sweep, skip rather than error

    const aheadRes = git(repoRoot, ["rev-list", "--count", `${resolvedBase}..${branch}`]);
    const aheadCount = aheadRes.code === 0 ? Number(aheadRes.stdout.trim()) || 0 : null;

    const dateRes = git(repoRoot, ["log", "-1", "--format=%cI", branch]);
    const lastCommitDate = dateRes.code === 0 ? dateRes.stdout.trim() : null;

    const entry = { branch, headSha: branchSha, aheadCount, lastCommitDate };

    if (aheadCount === null) {
      // rev-list failed (e.g. unrelated history) -- surface it rather than silently
      // dropping the branch from the report.
      stranded.push({ ...entry, error: aheadRes.stderr || "rev-list failed" });
    } else if (aheadCount > 0) {
      stranded.push(entry);
    } else {
      clean.push(entry);
    }
  }

  return {
    ok: true,
    base: resolvedBase,
    baseSha,
    inspectedCount: branches.length,
    strandedCount: stranded.length,
    cleanCount: clean.length,
    stranded,
    clean,
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const res = checkStrandedBranches({ base: args.base, noFetch: args.noFetch });

  if (!res.ok) {
    console.error(`[check-stranded-branches] error: ${res.error}`);
    process.exit(2);
  }

  if (args.json) {
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.log(`Stranded-branch sweep against '${res.base}' (${res.baseSha.slice(0, 8)}):`);
    console.log(`  Inspected : ${res.inspectedCount}`);
    console.log(`  Stranded  : ${res.strandedCount}`);
    console.log(`  Clean     : ${res.cleanCount}`);
    if (res.stranded.length) {
      console.log("  Stranded branches (commits ahead of base, NOT represented on main):");
      for (const b of res.stranded) {
        const suffix = b.error ? ` — ERROR: ${b.error}` : ` — ${b.aheadCount} commit(s) ahead, last commit ${b.lastCommitDate}`;
        console.log(`    - ${b.branch} (${b.headSha.slice(0, 8)})${suffix}`);
      }
    }
  }

  // Non-fatal exit: this is a reporting sweep, not a gate. Exit 0 even when
  // branches are found stranded -- callers (CLI, Home-screen sweep) inspect
  // strandedCount, not the exit code, to decide what to show.
  process.exit(0);
}
