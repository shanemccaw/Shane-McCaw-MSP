#!/usr/bin/env node
// scripts/dev-server/provision-worktree.mjs
//
// Create an ISOLATED per-agent worktree off the base ref, so an agent never
// edits the shared checkout the dev server runs from. Short path by convention
// (deep Design/_ds/... tree + long root overruns Windows MAX_PATH).
//
//   node scripts/dev-server/provision-worktree.mjs <name> [--path <dir>] [--base <ref>] [--link]
//
//   <name>    branch/worktree label (e.g. "1210-checkout-fix")
//   --path    worktree dir (default: C:\wt\<name> on Windows)
//   --base    base ref (default: config.baseRef, i.e. origin/main)
//   --link    junction node_modules + lib/*/dist so you can build immediately
//
// Prints the exact request-restart command to run when the agent's build is done.

import path from "node:path";
import os from "node:os";
import { existsSync } from "node:fs";
import { loadConfig, isWindows } from "./config.mjs";
import { git, resolveCommit, shortSha } from "./git.mjs";
import { linkDeps } from "./link-deps.mjs";
import { registerWorktree } from "./worktree-lifecycle.mjs";

function parse(argv) {
  const a = { link: false, _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--link") a.link = true;
    else if (t === "--path") a.path = argv[++i];
    else if (t === "--base") a.base = argv[++i];
    else a._.push(t);
  }
  return a;
}

function main() {
  const a = parse(process.argv.slice(2));
  const name = a._[0];
  if (!name) {
    console.error("usage: node scripts/dev-server/provision-worktree.mjs <name> [--path <dir>] [--base <ref>] [--link]");
    process.exit(1);
  }
  const config = loadConfig();
  const repo = config.mainRepoRoot;
  const base = a.base || config.baseRef;
  const branch = `agent/${name}`;
  const wtPath = a.path || (isWindows() ? path.join("C:\\wt", name) : path.join(path.dirname(repo), `wt-${name}`));

  const baseCommit = resolveCommit(repo, base);
  if (!baseCommit) {
    console.error(`! base ref '${base}' does not resolve. Try: git fetch origin main`);
    process.exit(1);
  }
  if (existsSync(wtPath)) {
    console.error(`! ${wtPath} already exists. Choose another --path or remove it.`);
    process.exit(1);
  }

  const r = git(repo, ["worktree", "add", "-b", branch, wtPath, baseCommit]);
  if (r.code !== 0) {
    console.error(`! git worktree add failed:\n${r.stderr}`);
    process.exit(1);
  }

  registerWorktree(config, {
    name,
    path: wtPath,
    branch,
    baseRef: base,
    baseCommit,
    creatorPid: process.pid,
    creatorHost: os.hostname(),
    status: "active",
  });

  console.log(`Created worktree`);
  console.log(`  path   : ${wtPath}`);
  console.log(`  branch : ${branch}`);
  console.log(`  base   : ${base} @ ${shortSha(baseCommit)}`);

  if (a.link) {
    console.log(`  linking dependencies (junctions)...`);
    const created = linkDeps(repo, wtPath);
    console.log(`  linked ${created.length} dependency dir(s).`);
  }

  console.log("");
  console.log(`Work in ${wtPath}. When your build is committed there, publish it to the dev server with:`);
  console.log(`  cd ${wtPath}`);
  console.log(`  node scripts/dev-server/request-restart.mjs --agent ${name}`);
  console.log(`  (or pass --cleanup to remove the worktree automatically upon success)`);
}

main();
