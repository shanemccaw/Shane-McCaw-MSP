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
// PER-PACKAGE @workspace LINKING (Git #2152). A wholesale junction of a host's
// node_modules is correct ONLY for a host that holds nothing but third-party
// packages. For a host that also holds an `@workspace/<lib-pkg>` scope (the
// in-repo lib/* packages -- artifacts/api-server, admin-panel, portal,
// msp-website, shane-mccaw-consulting, lib/dashboard-canvas, scripts), a wholesale
// junction is WRONG: a Windows junction redirects the WHOLE directory atomically
// into the main checkout, so `node_modules/@workspace/db` (a relative symlink
// `..\..\..\..\lib\db`, resolved from its PHYSICAL location) lands on MAIN's
// lib/db/src, not this worktree's own edited lib/db/src. #2151 proved that breaks
// `tsc`/typecheck; #2152's Phase 1 proved it breaks REAL Node runtime resolution
// too (`import.meta.resolve("@workspace/db/schema")` from a worktree consumer
// resolved into the main checkout). So for such a host we build a REAL node_modules
// in the worktree: every top-level entry is junctioned from main as before, EXCEPT
// `@workspace`, whose entries are junctioned directly at THIS worktree's own
// lib/<pkg>. Third-party junctioning is otherwise unchanged. See linkDeps().
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
// them into the real store. For a per-package host the wholesale junction is gone,
// replaced by a real node_modules dir full of INNER junctions -- those inner
// reparse points (top-level third-party entries AND each @workspace/<pkg>) must be
// unlinked too, or the recursive worktree removal follows them into the shared
// store (findAndUnlinkWorktreeJunctions handles this, Git #2152). (lib/*/dist is a
// real, worktree-owned directory -- removing the worktree removes it too.)

import { execFileSync } from "node:child_process";
import { readdirSync, existsSync, statSync, lstatSync, mkdirSync, copyFileSync, readFileSync, realpathSync } from "node:fs";
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
 * True if this host's node_modules holds an `@workspace` scope dir (the in-repo
 * lib/* packages). ONLY these hosts need per-package linking (Git #2152); every
 * other host is safe to wholesale-junction as before.
 */
function hostHasWorkspaceScope(repoRoot, hostRel) {
  return existsSync(path.join(repoRoot, hostRel, "node_modules", "@workspace"));
}

/**
 * Resolve THIS worktree's own directory for an `@workspace/<pkg>` entry, so the
 * junction points at the worktree's editable lib/<pkg> src rather than main's.
 * Prefer re-anchoring the main entry's real target under the worktree (handles any
 * lib layout precisely); fall back to the conventional lib/<pkg> then
 * lib/integrations/<pkg> only if main's link is missing/dangling/foreign (e.g. a
 * store poisoned per #1988). Returns null if no worktree lib dir can be found.
 */
function worktreeLibForPkg(repoRoot, worktreePath, mainScopeDir, pkg) {
  // 1. Re-anchor main's healthy target (realpathSync follows the reparse point to
  //    the real dir, e.g. <main>\lib\db); only trust it if it lives UNDER the repo.
  try {
    const real = realpathSync(path.join(mainScopeDir, pkg));
    const rel = path.relative(repoRoot, real);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
      const cand = path.join(worktreePath, rel);
      if (existsSync(path.join(cand, "package.json"))) return cand;
    }
  } catch {
    /* fall through to conventional layout */
  }
  // 2. Conventional layout (all @workspace pkgs live flat under lib/ in this repo).
  for (const rel of [path.join("lib", pkg), path.join("lib", "integrations", pkg)]) {
    const cand = path.join(worktreePath, rel);
    if (existsSync(path.join(cand, "package.json"))) return cand;
  }
  return null;
}

/**
 * Per-package link a host that holds an `@workspace` scope (Git #2152). Builds a
 * REAL node_modules in the worktree: every top-level entry junctioned from main
 * (third-party dep symlinks-to-dirs, scope dirs like @types, .bin -- all
 * directories, proven to resolve correctly even when the main entry is itself a
 * relative symlink into the shared root .pnpm store), EXCEPT `@workspace`, whose
 * entries are junctioned at THIS worktree's own lib/<pkg>. A rare non-directory
 * top-level entry is copied. All created junctions are pushed to `created` so
 * cleanup can unlink them.
 */
function linkHostPerPackage(repoRoot, worktreePath, hostRel, target, link, created) {
  mkdirSync(link, { recursive: true });
  let entries;
  try {
    entries = readdirSync(target);
  } catch (e) {
    console.warn(`  ! could not read ${hostRel}/node_modules: ${e.message}`);
    return;
  }
  for (const name of entries) {
    const srcEntry = path.join(target, name);
    const dstEntry = path.join(link, name);
    if (existsSync(dstEntry)) continue;

    if (name === "@workspace") {
      mkdirSync(dstEntry, { recursive: true });
      let pkgs;
      try {
        pkgs = readdirSync(srcEntry);
      } catch (e) {
        console.warn(`  ! could not read ${hostRel}/node_modules/@workspace: ${e.message}`);
        continue;
      }
      for (const pkg of pkgs) {
        const dstPkg = path.join(dstEntry, pkg);
        if (existsSync(dstPkg)) continue;
        const wtLib = worktreeLibForPkg(repoRoot, worktreePath, srcEntry, pkg);
        if (!wtLib) {
          console.warn(`  ! @workspace/${pkg}: no worktree lib dir found — skipped (would fall back to main)`);
          continue;
        }
        try {
          junction(dstPkg, wtLib);
          created.push(dstPkg);
        } catch (e) {
          console.warn(`  ! could not junction @workspace/${pkg}: ${e.message}`);
        }
      }
      continue;
    }

    // Non-@workspace entry: junction it wholesale from main if it's a directory
    // (statSync follows links; a dangling link throws and is skipped), else copy.
    let st;
    try {
      st = statSync(srcEntry);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      try {
        junction(dstEntry, srcEntry);
        created.push(dstEntry);
      } catch (e) {
        console.warn(`  ! could not junction ${hostRel}/node_modules/${name}: ${e.message}`);
      }
    } else {
      try {
        copyFileSync(srcEntry, dstEntry);
      } catch (e) {
        console.warn(`  ! could not copy ${hostRel}/node_modules/${name}: ${e.message}`);
      }
    }
  }
}

/**
 * Link all dependency dirs from repoRoot into worktreePath.
 * Returns the list of link paths created (for later cleanup).
 *
 * A host with no in-repo @workspace scope is wholesale-junctioned as before (one
 * junction). A host that holds @workspace packages is linked per-package so those
 * packages resolve to the worktree's own lib/*, not main's (Git #2152).
 */
export function linkDeps(repoRoot, worktreePath) {
  if (!isWindows()) {
    throw new Error("linkDeps currently implements the Windows junction recipe only.");
  }
  const created = [];
  for (const host of nodeModulesHosts(repoRoot)) {
    const rel = path.posix.join(host, "node_modules");
    const target = path.join(repoRoot, rel);
    const link = path.join(worktreePath, rel);

    // Branch on what the EXISTING link actually IS, not just this host's CURRENT
    // hostHasWorkspaceScope() classification (Git #2927) -- a host can flip
    // categories over time (e.g. lib/db held an @workspace dep when a long-lived
    // worktree like the dev-server coordinator's own at C:\dev-server was first
    // linked, then stopped; hostHasWorkspaceScope now reads false, but the link it
    // left behind is still the real per-package dir from back then, not a wholesale
    // junction). A reparse point is a live view of target and is always current, so
    // only that short-circuits. A real directory -- whichever path produced it --
    // is NOT a live view and must be re-synced, since it can be missing entries
    // added to target's node_modules after it was built (Git #2927: lib/db's
    // `vitest` devDependency, added weeks after this worktree's node_modules was
    // created, silently never synced in). linkHostPerPackage is idempotent per
    // entry (skips one that already exists), so re-running it is always safe.
    if (existsSync(link)) {
      if (isReparsePoint(link)) continue;
      linkHostPerPackage(repoRoot, worktreePath, host, target, link, created);
      continue;
    }

    if (!hostHasWorkspaceScope(repoRoot, host)) {
      mkdirSync(path.dirname(link), { recursive: true });
      try {
        junction(link, target);
        created.push(link);
      } catch (e) {
        console.warn(`  ! could not junction ${rel}: ${e.message}`);
      }
      continue;
    }

    linkHostPerPackage(repoRoot, worktreePath, host, target, link, created);
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
 *
 * Git #2152: a host with an @workspace scope is now a REAL node_modules dir full of
 * INNER junctions (each top-level third-party entry, plus each @workspace/<pkg>),
 * not a single wholesale junction. Such a real dir must be descended one level (and
 * two levels for @workspace) to unlink every inner reparse point — otherwise the
 * recursive worktree removal that follows would delete THROUGH those inner
 * junctions into the shared store. We only ever descend into REAL directories
 * (never into a reparse point, which would traverse into main).
 */
function tryUnlinkReparse(link, unlinked, remaining) {
  try {
    execFileSync("cmd", ["/c", "rmdir", link], { stdio: "ignore" });
  } catch {}
  if (isReparsePoint(link)) remaining.push(link);
  else unlinked.push(link);
}

/** Unlink inner junctions inside a REAL per-package node_modules (Git #2152):
 *  top-level reparse points, plus one level deeper under a real @workspace dir. */
function unlinkInnerJunctions(nmDir, unlinked, remaining) {
  let children;
  try {
    children = readdirSync(nmDir);
  } catch {
    return;
  }
  for (const child of children) {
    const cp = path.join(nmDir, child);
    if (isReparsePoint(cp)) {
      tryUnlinkReparse(cp, unlinked, remaining);
      continue;
    }
    if (child === "@workspace") {
      let pkgs;
      try {
        pkgs = readdirSync(cp);
      } catch {
        continue;
      }
      for (const pkg of pkgs) {
        const pp = path.join(cp, pkg);
        if (isReparsePoint(pp)) tryUnlinkReparse(pp, unlinked, remaining);
      }
    }
    // Any other real subdir is worktree-owned content, left for the recursive
    // removal to delete safely (it holds no reparse points of ours).
  }
}

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

  const nmRels = hosts.map((h) => path.posix.join(h, "node_modules"));
  const distRels = [];
  for (const group of ["lib", "lib/integrations"]) {
    const dir = path.join(worktreePath, group);
    if (!existsSync(dir)) continue;
    try {
      for (const name of readdirSync(dir)) {
        distRels.push(path.posix.join(group, name, "dist"));
      }
    } catch {}
  }

  const unlinked = [];
  const remaining = [];
  // node_modules: a wholesale junction is rmdir'd directly; a REAL per-package dir
  // (Git #2152) is descended to unlink its inner junctions instead.
  for (const rel of nmRels) {
    const link = path.join(worktreePath, rel);
    if (isReparsePoint(link)) {
      tryUnlinkReparse(link, unlinked, remaining);
      continue;
    }
    let isDir = false;
    try {
      isDir = statSync(link).isDirectory();
    } catch {
      isDir = false;
    }
    if (isDir) unlinkInnerJunctions(link, unlinked, remaining);
  }
  // lib/*/dist: only ever a junction (or a real worktree-owned dir left as-is).
  for (const rel of distRels) {
    const link = path.join(worktreePath, rel);
    if (!isReparsePoint(link)) continue;
    tryUnlinkReparse(link, unlinked, remaining);
  }
  return { unlinked, remaining };
}
