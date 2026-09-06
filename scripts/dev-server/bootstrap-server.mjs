#!/usr/bin/env node
// scripts/dev-server/bootstrap-server.mjs
//
// One-time (idempotent) setup of the DEDICATED dev-server checkout that the
// local stack runs from -- separate from every agent's worktree so no agent
// ever writes into the directory the server is executing.
//
//   node scripts/dev-server/bootstrap-server.mjs [--link] [--launch] [--base <ref>]
//
//   --link    junction node_modules + lib/*/dist from the main repo (fast; no
//             per-worktree pnpm install; this is the default path -- see
//             below). Omit only for genuine first-time repo-root setup.
//   --launch  start the server (scripts/dev-all.mjs) after setup.
//   --base    base ref for the dev-server branch (default: config.baseRef).
//
// Safe to re-run: if the worktree/branch already exist it reports and moves on.

import { existsSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.mjs";
import { git, worktreePaths, revParse, shortSha, resolveCommit } from "./git.mjs";
import { linkDeps, buildLibDist } from "./link-deps.mjs";
import { startServer, readServerMeta } from "./server-process.mjs";
import { pidAlive } from "./lock.mjs";

function parse(argv) {
  const a = { link: false, launch: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--link") a.link = true;
    else if (argv[i] === "--launch") a.launch = true;
    else if (argv[i] === "--base") a.base = argv[++i];
  }
  return a;
}

async function main() {
  const a = parse(process.argv.slice(2));
  const config = loadConfig();
  const repo = config.mainRepoRoot;
  const W = config.serverWorktree;
  const base = a.base || config.baseRef;

  console.log(`Bootstrapping dev-server checkout`);
  console.log(`  main repo       : ${repo}`);
  console.log(`  server worktree : ${W}`);
  console.log(`  server branch   : ${config.serverBranch}`);
  console.log(`  base ref        : ${base}`);

  const baseCommit = resolveCommit(repo, base);
  if (!baseCommit) {
    console.error(`! base ref '${base}' does not resolve. Fetch first, or pass --base.`);
    process.exit(1);
  }

  const alreadyWorktree = worktreePaths(repo).some(
    (p) => path.normalize(p).toLowerCase() === path.normalize(W).toLowerCase()
  );

  if (!alreadyWorktree) {
    if (existsSync(W)) {
      console.error(`! ${W} exists but is not a registered worktree. Remove/rename it first.`);
      process.exit(1);
    }
    // -B: create or reset the dev-server branch at base, checked out at W.
    const r = git(repo, ["worktree", "add", "-B", config.serverBranch, W, baseCommit]);
    if (r.code !== 0) {
      console.error(`! git worktree add failed:\n${r.stderr}`);
      process.exit(1);
    }
    console.log(`  created worktree at ${W} on ${config.serverBranch} @ ${shortSha(baseCommit)}`);
  } else {
    console.log(`  worktree already present (HEAD ${shortSha(revParse(W, "HEAD"))})`);
  }

  if (a.link) {
    console.log(`  linking dependencies (junctions)...`);
    const created = linkDeps(repo, W);
    console.log(`  linked ${created.length} dependency dir(s).`);
    // Git #2117 — lib/*/dist is no longer junctioned from the main checkout (that
    // made it reflect whatever branch main happens to be on, not this worktree's
    // own merged HEAD); build it from THIS worktree's own src instead.
    console.log(`  building lib/*/dist from this worktree's own src...`);
    const libsBuilt = buildLibDist(W);
    if (libsBuilt.error) {
      console.log(`  ! lib/*/dist build failed: ${libsBuilt.error}`);
    } else {
      console.log(`  built ${libsBuilt.built.length} lib/*/dist project(s).`);
    }
  } else {
    // Git #1987/#1988: `pnpm install` is not a remedy for broken module resolution
    // and is never prescribed for that -- on an unchanged lockfile it exits without
    // walking a single symlink, so it cannot repair a dangling worktree junction,
    // and a bare re-run refetches the ~1,120-package graph, a real metered cost.
    // `--link` (junctions from the main repo, no install) is the intended default
    // for a worktree; a real `pnpm install` at repo root is only for genuine
    // first-time setup, and even then runs subject to the repo's .pnpmfile.cjs
    // install gates -- it is not a fix for a resolution failure.
    console.log(`  (skip --link) re-run with --link (recommended), or run \`pnpm install\` at repo root only for genuine first-time setup`);
  }

  if (a.launch) {
    const meta = readServerMeta(config);
    if (meta && pidAlive(meta.pid)) {
      console.log(`  server already running (pid ${meta.pid}); not relaunching.`);
    } else {
      const pid = startServer(config);
      console.log(`  launched dev-all.mjs (pid ${pid}); logs -> ${config.devAllLogDir}\\dev-all.log`);
    }
  } else {
    console.log(`  (skip --launch) start it with: node scripts/dev-server/bootstrap-server.mjs --launch`);
  }

  console.log(`Done.`);
}

main().catch((e) => {
  console.error(e.stack || e);
  process.exit(1);
});
