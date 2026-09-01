#!/usr/bin/env node
// scripts/dev-server/provision-worktree.mjs
//
// Create an ISOLATED per-agent worktree off the base ref, so an agent never
// edits the shared checkout the dev server runs from. Short path by convention
// (deep Design/_ds/... tree + long root overruns Windows MAX_PATH).
//
//   node scripts/dev-server/provision-worktree.mjs <name> [--path <dir>] [--base <ref>] [--link] [--owner-pid <n>] [--json]
//
//   <name>        branch/worktree label (e.g. "1210-checkout-fix")
//   --path        worktree dir (default: C:\wt\<name> on Windows)
//   --base        base ref (default: config.baseRef, i.e. origin/main)
//   --link        junction node_modules + lib/*/dist so you can build immediately
//                 (shared, NOT re-installed — one copy, zero re-download; Git #1372)
//   --owner-pid   pid of the long-lived process that owns this build (BuildConsole
//                 or the shell). The cleanup sweep retains the worktree while this
//                 pid is alive, so a live mid-build worktree is never swept out from
//                 under a running session. Defaults to this process's PARENT pid
//                 (process.ppid) — i.e. whoever launched the provisioner — never the
//                 provisioner's own short-lived pid.
//   --json        emit a single machine-readable JSON result object and nothing else
//                 (for BuildConsole to parse).
//
// Registers the worktree in the lifecycle tracker (Git #1371 — previously the
// provisioner never called registerWorktree, so a live worktree had no record and
// the sweep could delete it mid-build). Idempotent: re-provisioning an already-live
// worktree of the same path reuses it instead of failing.

import path from "node:path";
import { existsSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { loadConfig, isWindows } from "./config.mjs";
import { git, resolveCommit, shortSha, listWorktrees } from "./git.mjs";
import { linkDeps, buildLibDist, copyEnvFiles } from "./link-deps.mjs";
import { scanSharedStore } from "./store-doctor.mjs";
import {
  registerWorktree,
  getWorktreeRecord,
  updateWorktreeRecord,
  normalizePath,
} from "./worktree-lifecycle.mjs";

function parse(argv) {
  const a = { link: false, json: false, _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--link") a.link = true;
    else if (t === "--json") a.json = true;
    else if (t === "--path") a.path = argv[++i];
    else if (t === "--base") a.base = argv[++i];
    else if (t === "--owner-pid") a.ownerPid = Number(argv[++i]);
    else a._.push(t);
  }
  return a;
}

/**
 * Provision (or reuse) an isolated worktree. Pure-ish: returns a result object,
 * never calls process.exit — the caller decides how to render/exit. Safe to import.
 *
 * @returns {{ ok, name, path, branch, base, baseCommit, linked, reused, recordId, error? }}
 */
export function provisionWorktree({ name, path: wantPath, base: wantBase, link = false, ownerPid } = {}) {
  if (!name) return { ok: false, error: "name is required" };

  const config = loadConfig();
  const repo = config.mainRepoRoot;
  const base = wantBase || config.baseRef;
  const branch = `agent/${name}`;
  const wtPath =
    wantPath ||
    (isWindows() ? path.join("C:\\wt", name) : path.join(path.dirname(repo), `wt-${name}`));
  // The owner is the long-lived launcher, NOT the provisioner (which exits at once).
  const creatorPid = Number.isFinite(ownerPid) && ownerPid > 0 ? ownerPid : process.ppid;

  const baseCommit = resolveCommit(repo, base);
  if (!baseCommit) {
    return { ok: false, error: `base ref '${base}' does not resolve. Try: git fetch origin main` };
  }

  // Git #1988 — check the SHARED store this worktree is about to junction into, so a
  // poisoned store is visible at provisioning time (seconds) instead of mid-session as
  // an inexplicable tsc/vitest failure. Detection only: provisioning proceeds either
  // way (blocking every build on a poisoned store would strand the whole queue), but
  // the result rides on the returned object and the human path prints it loudly.
  // Repair stays the explicit `store-doctor.mjs --repair` operation, never automatic.
  let storeHealth = null;
  try {
    const scan = scanSharedStore(repo);
    storeHealth = {
      clean: scan.clean,
      foreign: scan.foreignLinks.length,
      dangling: scan.danglingLinks.length,
      poisonedBins: scan.poisonedBins.length,
    };
  } catch (e) {
    storeHealth = { error: e.message };
  }

  // --- Idempotency: if the path already exists, reuse it if it is a real worktree. ---
  if (existsSync(wtPath)) {
    const norm = normalizePath(wtPath);
    const existing = listWorktrees(repo).find((w) => normalizePath(w.path) === norm);
    if (existing) {
      // Already a live worktree — ensure it is tracked (re-stamp the owner pid so the
      // sweep keeps retaining it for the new owner), and return without re-creating.
      const rec =
        getWorktreeRecord(config, wtPath) ||
        registerWorktree(config, {
          name,
          path: wtPath,
          branch: existing.branch || branch,
          baseRef: base,
          baseCommit,
          creatorPid,
        });
      // Git #1971 — re-activating a reused worktree clears any keep-for-debug retention (and
      // its on-disk marker) left by a prior failure or session-limit park. The worktree is
      // live again under the new owner pid; leaving it flagged stale would keep it out of the
      // normal sweep for 24h after this resumed session actually finishes.
      updateWorktreeRecord(config, wtPath, {
        creatorPid,
        status: "active",
        keepForDebug: false,
        debugReason: null,
      });
      try { rmSync(path.join(wtPath, ".stale-worktree.json"), { force: true }); } catch {}
      // Env files (#1633): unconditional, not gated behind --link, and idempotent --
      // even a reused worktree may be missing one if it was provisioned before this fix.
      // Git #1646 — do NOT call logEnvCopy() here: this function is also invoked with
      // --json by BuildConsole (WorktreeProvisionService), which requires stdout to be
      // NOTHING but the final JSON.stringify(res) line. logEnvCopy() unconditionally
      // wrote a plain-text "env : copied/skipped ..." line to stdout BEFORE that JSON,
      // which made JsonDocument.Parse(stdout.Trim()) throw on every single provision
      // call (reproduced live) — the C# catch-block then reports Ok=true with an empty
      // Path and no Error, which QueueWatcherService.LaunchItem misread as a launch
      // failure with a blank reason ("Worktree provisioning FAILED ... : ."), so every
      // queued build failed before claude.exe was ever started. envFiles is returned on
      // the result instead; only main()'s human-readable (non --json) path prints it.
      const envResult = copyEnvFiles(repo, wtPath);
      return {
        ok: true,
        name,
        path: wtPath,
        branch: existing.branch || branch,
        base,
        baseCommit,
        linked: false,
        reused: true,
        recordId: rec?.id || null,
        envFiles: envResult,
        storeHealth,
      };
    }
    return {
      ok: false,
      error: `${wtPath} exists but is not a registered git worktree. Remove it or pass a different --path.`,
    };
  }

  // --- Create the worktree. ---
  let r = git(repo, ["worktree", "add", "-b", branch, wtPath, baseCommit]);
  if (r.code !== 0) {
    // Common case: the ephemeral branch already exists (a prior worktree of this name
    // was removed but its branch lingered). Attach the existing branch instead of
    // resetting it (no data loss), rather than hard-failing.
    if (/already exists|already used/i.test(r.stderr || "")) {
      r = git(repo, ["worktree", "add", wtPath, branch]);
    }
    if (r.code !== 0) {
      return { ok: false, error: `git worktree add failed:\n${r.stderr}` };
    }
  }

  // --- Link deps (junctions) so the worktree can build immediately with a SHARED
  //     node_modules — no per-worktree install, no re-download (Git #1372). ---
  let linked = false;
  let libsBuilt = null;
  if (link) {
    try {
      const created = linkDeps(repo, wtPath);
      linked = created.length;
    } catch (e) {
      // Linking is best-effort; the worktree itself is valid without it.
      linked = { error: e.message };
    }
    // --- Build lib/*/dist FROM THIS WORKTREE'S OWN src (Git #2117) — dist is no
    //     longer junctioned from the main checkout, so it has to be produced here,
    //     using the node_modules just linked above (no extra install/download). ---
    libsBuilt = buildLibDist(wtPath);
  }

  // --- Copy local env files (#1633): unconditional, NOT gated behind --link. A
  //     worktree checks out tracked files only, and .env/.env.local/.env.*.local are
  //     git-ignored, so without this step no worktree can ever reach the database.
  //     Best-effort like linkDeps -- a missing source file is logged, not fatal. ---
  // Git #1646 — see the matching comment on the reused-worktree branch above: no
  // console output here, envFiles rides on the returned result instead.
  const envResult = copyEnvFiles(repo, wtPath);

  // --- Register in the lifecycle tracker (the fix for the swept-live-worktree bug). ---
  const rec = registerWorktree(config, {
    name,
    path: wtPath,
    branch,
    baseRef: base,
    baseCommit,
    creatorPid,
  });

  return {
    ok: true,
    name,
    path: wtPath,
    branch,
    base,
    baseCommit,
    linked,
    reused: false,
    recordId: rec?.id || null,
    envFiles: envResult,
    storeHealth,
    libsBuilt,
  };
}

/** Git #1988 — loud, human-readable warning when the shared store the worktree
 *  junctions into is poisoned (foreign/dangling links or worktree-anchored shims). */
function logStoreHealth(storeHealth) {
  if (!storeHealth) return;
  if (storeHealth.error) {
    console.warn(`  ! shared-store check failed: ${storeHealth.error}`);
    return;
  }
  if (storeHealth.clean) return;
  console.warn(`  !!! SHARED STORE POISONED (Git #1988): foreign=${storeHealth.foreign}, dangling=${storeHealth.dangling}, poisonedBins=${storeHealth.poisonedBins}`);
  console.warn(`  !!! This worktree junctions into that store — tsc/vitest/builds may fail here through no fault of this session.`);
  console.warn(`  !!! Diagnose with: node scripts/dev-server/store-doctor.mjs   (repair is explicit: --repair)`);
}

/** Log (filenames only, never contents) which local env files were copied/skipped/missing. */
function logEnvCopy({ copied, skipped, missing }) {
  if (copied.length) console.log(`  env    : copied ${copied.join(", ")}`);
  if (skipped.length) console.log(`  env    : already present, skipped ${skipped.join(", ")}`);
  if (missing) console.warn(`  ! no .env/.env.local/.env.*.local found at main repo root -- worktree has no local secrets`);
}

function main() {
  const a = parse(process.argv.slice(2));
  const name = a._[0];
  if (!name) {
    const msg = "usage: node scripts/dev-server/provision-worktree.mjs <name> [--path <dir>] [--base <ref>] [--link] [--owner-pid <n>] [--json]";
    if (a.json) console.log(JSON.stringify({ ok: false, error: msg }));
    else console.error(msg);
    process.exit(1);
  }

  const res = provisionWorktree({
    name,
    path: a.path,
    base: a.base,
    link: a.link,
    ownerPid: a.ownerPid,
  });

  if (a.json) {
    console.log(JSON.stringify(res));
    process.exit(res.ok ? 0 : 1);
  }

  if (!res.ok) {
    console.error(`! ${res.error}`);
    process.exit(1);
  }

  // Git #1646 — moved out of provisionWorktree() itself (see comments there); only
  // the human-readable path prints this, so --json output stays pure JSON.
  if (res.envFiles) logEnvCopy(res.envFiles);
  logStoreHealth(res.storeHealth);

  console.log(res.reused ? `Reused existing worktree` : `Created worktree`);
  console.log(`  path   : ${res.path}`);
  console.log(`  branch : ${res.branch}`);
  console.log(`  base   : ${res.base} @ ${shortSha(res.baseCommit)}`);
  console.log(`  owner  : pid ${Number.isFinite(a.ownerPid) && a.ownerPid > 0 ? a.ownerPid : process.ppid}`);
  if (a.link) {
    if (typeof res.linked === "number") {
      console.log(`  linked ${res.linked} dependency dir(s) (junctions — shared, no re-download).`);
      console.log(`  NOTE cleanup order: rmdir the junctions BEFORE 'git worktree remove', or removal deletes THROUGH them into the real store.`);
    } else if (res.reused) {
      console.log(`  (reused worktree — dependency junctions left as-is)`);
    } else if (res.linked && res.linked.error) {
      console.log(`  ! dependency linking failed: ${res.linked.error}`);
    }
    if (res.libsBuilt) {
      if (res.libsBuilt.error) {
        console.log(`  ! lib/*/dist build failed (Git #2117): ${res.libsBuilt.error}`);
      } else if (res.libsBuilt.built.length) {
        console.log(`  built ${res.libsBuilt.built.length} lib/*/dist project(s) from this worktree's own src: ${res.libsBuilt.built.join(", ")}`);
      }
    }
  }
  console.log("");
  console.log(`Work in ${res.path}. When your build is committed there, publish it to the dev server with:`);
  console.log(`  cd ${res.path}`);
  console.log(`  node scripts/dev-server/request-restart.mjs --agent ${name}`);
  console.log(`And clean up when done:`);
  console.log(`  node scripts/dev-server/cleanup-worktree.mjs ${name}`);
}

// Only run when invoked directly (safe to import provisionWorktree from a launcher).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
