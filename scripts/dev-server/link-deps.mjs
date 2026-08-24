// scripts/dev-server/link-deps.mjs
//
// A worktree checks out SOURCE only -- no node_modules, no built lib/*/dist. To
// actually build/run in a worktree without a full (slow, disk-heavy) `pnpm
// install` per worktree, junction the real dependency dirs from the main repo
// into the worktree. This is the recipe proven by earlier sessions (see memory
// "isolated-msp-portal-build-needs-all-workspace-node-modules"):
//
//   * junction EVERY workspace-package node_modules (~18: root + all
//     artifacts/* and lib/*), not just root + one app, or Rollup fails to
//     resolve cross-package imports.
//   * junction each lib/*/dist too, or tsc fails TS6305 (composite projects
//     expect the built .d.ts).
//
// CLEANUP ORDER MATTERS: always `rmdir` the junctions FIRST, then remove the
// worktree. Removing a worktree while junctions remain deletes THROUGH them into
// the real store.

import { execFileSync } from "node:child_process";
import { readdirSync, existsSync, statSync, mkdirSync } from "node:fs";
import path from "node:path";
import { isWindows } from "./config.mjs";

/** Directories (relative to repo root) that hold a node_modules worth linking. */
function nodeModulesHosts(repoRoot) {
  const hosts = [""]; // repo root itself
  for (const group of ["artifacts", "lib", "lib/integrations", "scripts"]) {
    const dir = path.join(repoRoot, group);
    if (!existsSync(dir)) continue;
    if (group === "scripts") {
      hosts.push("scripts");
      continue;
    }
    for (const name of readdirSync(dir)) {
      const rel = path.posix.join(group, name);
      if (existsSync(path.join(repoRoot, rel, "package.json"))) hosts.push(rel);
    }
  }
  return hosts.filter((rel) => existsSync(path.join(repoRoot, rel, "node_modules")));
}

/** lib/* packages that publish a dist/ (composite project outputs). */
function libDistDirs(repoRoot) {
  const out = [];
  for (const group of ["lib", "lib/integrations"]) {
    const dir = path.join(repoRoot, group);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const rel = path.posix.join(group, name, "dist");
      if (existsSync(path.join(repoRoot, rel))) out.push(rel);
    }
  }
  return out;
}

function junction(linkPath, targetPath) {
  // Junctions need no admin rights (unlike symlinks) and work across drives.
  execFileSync("cmd", ["/c", "mklink", "/J", linkPath, targetPath], { stdio: "ignore" });
}

/**
 * Link all dependency dirs from repoRoot into worktreePath.
 * Returns the list of link paths created (for later cleanup).
 */
export function linkDeps(repoRoot, worktreePath) {
  if (!isWindows()) {
    throw new Error("linkDeps currently implements the Windows junction recipe only.");
  }
  const created = [];
  const rels = [
    ...nodeModulesHosts(repoRoot).map((h) => path.posix.join(h, "node_modules")),
    ...libDistDirs(repoRoot),
  ];
  for (const rel of rels) {
    const target = path.join(repoRoot, rel);
    const link = path.join(worktreePath, rel);
    if (existsSync(link)) continue; // already linked / present
    mkdirSync(path.dirname(link), { recursive: true });
    try {
      junction(link, target);
      created.push(link);
    } catch (e) {
      console.warn(`  ! could not junction ${rel}: ${e.message}`);
    }
  }
  return created;
}

/** Remove junctions created by linkDeps. rmdir removes only the link, not target. */
export function unlinkDeps(links) {
  for (const link of links) {
    try {
      if (existsSync(link) && statSync(link).isDirectory()) {
        execFileSync("cmd", ["/c", "rmdir", link], { stdio: "ignore" });
      }
    } catch {
      /* ignore */
    }
  }
}
