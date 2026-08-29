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
import { readdirSync, existsSync, statSync, mkdirSync, copyFileSync } from "node:fs";
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

/**
 * Names of git-ignored local env files worth copying into a fresh worktree, expressed
 * the same way .gitignore does (lines 72-74): `.env`, `.env.local`, `.env.*.local`. A
 * worktree checks out tracked files only, so these never arrive on their own -- and
 * without DATABASE_URL/local secrets a worktree can't reach the database at all (Git
 * #1633). Copy, not junction: this is a single file, and copy avoids a worktree
 * accidentally mutating the main checkout's real file if an agent ever edits its own.
 */
function envFileNames(repoRoot) {
  const names = [];
  for (const candidate of [".env", ".env.local"]) {
    if (existsSync(path.join(repoRoot, candidate))) names.push(candidate);
  }
  for (const name of readdirSync(repoRoot)) {
    if (/^\.env\..+\.local$/.test(name) && statSync(path.join(repoRoot, name)).isFile()) {
      names.push(name);
    }
  }
  return names;
}

/**
 * Copy every git-ignored local env file (`.env`, `.env.local`, `.env.*.local`) from
 * repoRoot into worktreePath. Unconditional -- called regardless of --link, since a
 * missing env file is a correctness problem (no DB access), not a build-speed one.
 * Idempotent: skips a file already present in the worktree (an agent may have
 * intentionally created its own). Never hard-fails provisioning and never logs file
 * contents -- filenames only.
 * Returns { copied: string[], skipped: string[], missing: boolean }.
 */
export function copyEnvFiles(repoRoot, worktreePath) {
  const copied = [];
  const skipped = [];
  const names = envFileNames(repoRoot);
  for (const name of names) {
    const dest = path.join(worktreePath, name);
    if (existsSync(dest)) {
      skipped.push(name);
      continue;
    }
    try {
      copyFileSync(path.join(repoRoot, name), dest);
      copied.push(name);
    } catch (e) {
      console.warn(`  ! could not copy ${name}: ${e.message}`);
    }
  }
  return { copied, skipped, missing: names.length === 0 };
}

/** Finds and unlinks all node_modules and dist junctions inside a worktree path. */
export function findAndUnlinkWorktreeJunctions(worktreePath) {
  if (!isWindows()) return [];
  const hosts = [""]; // worktree root itself
  for (const group of ["artifacts", "lib", "lib/integrations", "scripts"]) {
    const dir = path.join(worktreePath, group);
    if (!existsSync(dir)) continue;
    if (group === "scripts") {
      hosts.push("scripts");
      continue;
    }
    try {
      for (const name of readdirSync(dir)) {
        hosts.push(path.posix.join(group, name));
      }
    } catch {}
  }

  const rels = [];
  for (const h of hosts) {
    rels.push(path.posix.join(h, "node_modules"));
  }
  for (const group of ["lib", "lib/integrations"]) {
    const dir = path.join(worktreePath, group);
    if (!existsSync(dir)) continue;
    try {
      for (const name of readdirSync(dir)) {
        rels.push(path.posix.join(group, name, "dist"));
      }
    } catch {}
  }

  const unlinked = [];
  for (const rel of rels) {
    const link = path.join(worktreePath, rel);
    try {
      if (existsSync(link) && statSync(link).isDirectory()) {
        execFileSync("cmd", ["/c", "rmdir", link], { stdio: "ignore" });
        unlinked.push(link);
      }
    } catch {}
  }
  return unlinked;
}
