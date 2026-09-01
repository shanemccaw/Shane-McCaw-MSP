// scripts/dev-server/link-deps.mjs
//
// A worktree checks out SOURCE only -- no node_modules, no built lib/*/dist. To
// actually build/run in a worktree without a full (slow, disk-heavy) `pnpm
// install` per worktree, junction the real THIRD-PARTY dependency dirs from the
// main repo into the worktree. This is the recipe proven by earlier sessions (the
// "isolated worktree build needs all workspace node_modules" lesson):
//
//   * junction EVERY workspace-package node_modules (~18: root + all
//     artifacts/* and lib/*), not just root + one app, or Rollup fails to
//     resolve cross-package imports.
//
// lib/*/dist is NOT junctioned (Git #2117 -- it used to be, alongside
// node_modules, per the TS6305 note this comment previously carried). Junctioning
// dist from the main checkout means a worktree session's own edits to lib/*/src are
// invisible to tsc/pnpm typecheck in any consuming package, AND a worktree can see
// phantom errors (or phantom clean passes) that are really just whichever unrelated
// branch the main checkout happens to be on. Instead, dist is BUILT per-worktree,
// from that worktree's own src, via `tsc --build` -- see buildLibDist() below.
//
// CLEANUP ORDER MATTERS: always `rmdir` the node_modules junctions FIRST, then
// remove the worktree. Removing a worktree while junctions remain deletes THROUGH
// them into the real store. (lib/*/dist is now a real, worktree-owned directory --
// removing the worktree removes it too, no junction hazard there.)

import { execFileSync } from "node:child_process";
import { readdirSync, existsSync, statSync, lstatSync, mkdirSync, copyFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { isWindows } from "./config.mjs";

/**
 * Reparse-point (junction OR symlink) detection via lstat, which — unlike
 * existsSync/statSync — does NOT follow the link, so it still detects a junction
 * whose target is gone (Git #1988: existsSync-based checks skipped exactly those
 * dangling junctions and left them live through worktree removal).
 */
export function isReparsePoint(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

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

/**
 * lib/* (and lib/integrations/*) packages with a composite tsconfig.json --
 * these are the ones that need a built dist/ for TS project-reference
 * consumers (composite: true, emitDeclarationOnly). Checked by tsconfig
 * content, not by an existing dist/, since a fresh worktree has none yet.
 */
function compositeLibDirs(repoRoot) {
  const out = [];
  for (const group of ["lib", "lib/integrations"]) {
    const dir = path.join(repoRoot, group);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const rel = path.posix.join(group, name);
      const tsconfigPath = path.join(repoRoot, rel, "tsconfig.json");
      if (!existsSync(tsconfigPath)) continue;
      let content;
      try {
        content = readFileSync(tsconfigPath, "utf8");
      } catch {
        continue;
      }
      if (/"composite"\s*:\s*true/.test(content)) out.push(rel);
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
  const rels = nodeModulesHosts(repoRoot).map((h) => path.posix.join(h, "node_modules"));
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

/**
 * Build each lib/* composite project's dist/ FROM THE WORKTREE'S OWN src (Git
 * #2117), using tsc's project-reference build mode. Requires node_modules to
 * already be junctioned (linkDeps) so `typescript` is resolvable -- this does
 * NOT install or download anything, it only compiles source that's already
 * checked out in the worktree.
 *
 * Best-effort like linkDeps: a build failure is reported on the result, not
 * thrown -- the worktree itself is still valid (just without a fresh dist)
 * without it.
 *
 * @returns {{ built: string[], error: string|null }}
 */
export function buildLibDist(worktreePath) {
  const projects = compositeLibDirs(worktreePath);
  if (projects.length === 0) return { built: [], error: null };

  const tscBin = path.join(worktreePath, "node_modules", "typescript", "bin", "tsc");
  if (!existsSync(tscBin)) {
    return { built: [], error: "typescript not found in worktree node_modules -- link-deps must run first" };
  }

  try {
    execFileSync(process.execPath, [tscBin, "--build", ...projects], {
      cwd: worktreePath,
      stdio: "pipe",
    });
    return { built: projects, error: null };
  } catch (e) {
    const output = (e.stdout?.toString() || "") + (e.stderr?.toString() || "");
    return { built: projects, error: (output || e.message || String(e)).slice(0, 4000) };
  }
}

/** Remove junctions created by linkDeps. rmdir removes only the link, not target.
 *  Git #1988: keyed off lstat (isReparsePoint), not existsSync — a junction whose
 *  target is already gone must STILL be unlinked, and a real directory (e.g. from a
 *  deliberate WORKTREE_ISOLATED_INSTALL) must never be rmdir'd here. */
export function unlinkDeps(links) {
  for (const link of links) {
    try {
      if (isReparsePoint(link)) {
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

/**
 * Finds and unlinks all node_modules and dist junctions inside a worktree path.
 *
 * Git #1988 changes:
 *   * detection is lstat-based (isReparsePoint) so DANGLING junctions are unlinked
 *     too — the old existsSync check followed the link and skipped them, leaving a
 *     live reparse point in place for the subsequent worktree removal;
 *   * real directories are never touched (an agent may have deliberately created a
 *     local node_modules via WORKTREE_ISOLATED_INSTALL — worktree removal handles it);
 *   * returns { unlinked, remaining }: `remaining` lists reparse points that were
 *     found but could NOT be removed. Callers MUST refuse to delete the worktree
 *     while `remaining` is non-empty — removal tooling that follows reparse points
 *     would delete THROUGH them into the real shared store (the header warning).
 */
export function findAndUnlinkWorktreeJunctions(worktreePath) {
  if (!isWindows()) return { unlinked: [], remaining: [] };
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
  const remaining = [];
  for (const rel of rels) {
    const link = path.join(worktreePath, rel);
    if (!isReparsePoint(link)) continue;
    try {
      execFileSync("cmd", ["/c", "rmdir", link], { stdio: "ignore" });
    } catch {}
    if (isReparsePoint(link)) remaining.push(link);
    else unlinked.push(link);
  }
  return { unlinked, remaining };
}
