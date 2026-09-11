#!/usr/bin/env node
// scripts/dev-server/provision-worktree.mjs
//
// Create an ISOLATED per-agent worktree off the base ref, so an agent never
// edits the shared checkout the dev server runs from. Short path by convention
// (deep Design/_ds/... tree + long root overruns Windows MAX_PATH).
//
//   node scripts/dev-server/provision-worktree.mjs <name> [--path <dir>] [--base <ref>] [--link] [--owner-pid <n>] [--repo <owner/repo>] [--json]
//
//   <name>        branch/worktree label (e.g. "1210-checkout-fix")
//   --path        worktree dir (default: C:\wt\<name> on Windows)
//   --base        base ref (default: config.baseRef, i.e. origin/main; ignored — see
//                 --repo below — for a secondary repo, whose real default branch may
//                 not be "main")
//   --link        junction node_modules + lib/*/dist so you can build immediately
//                 (shared, NOT re-installed — one copy, zero re-download; Git #1372).
//                 No-op for a secondary (--repo) checkout — that monorepo-specific
//                 dependency/shared-store machinery doesn't apply to a different repo.
//   --owner-pid   pid of the long-lived process that owns this build (BuildConsole
//                 or the shell). The cleanup sweep retains the worktree while this
//                 pid is alive, so a live mid-build worktree is never swept out from
//                 under a running session. Defaults to this process's PARENT pid
//                 (process.ppid) — i.e. whoever launched the provisioner — never the
//                 provisioner's own short-lived pid.
//   --repo        Git #3584 (Feature #3578, Multi-Repo Support) — real "owner/repo"
//                 this worktree's build actually targets (from the claimed queue
//                 item's own repo column, #3579's schema). Omitted, empty, or equal
//                 to this repo's own real owner/repo: unchanged default behavior —
//                 worktree off THIS repo's mainRepoRoot. Any other real configured
//                 repo (a #3581 Settings "Tinker" entry): resolved via repo-clone.mjs
//                 to a dedicated, persistent secondary clone, and the worktree (and
//                 every git operation inside it — commit, push, `origin`) is added
//                 from THAT clone instead, so it genuinely targets the right remote.
//   --json        emit a single machine-readable JSON result object and nothing else
//                 (for BuildConsole to parse).
//
// Registers the worktree in the lifecycle tracker (Git #1371 — previously the
// provisioner never called registerWorktree, so a live worktree had no record and
// the sweep could delete it mid-build). Idempotent: re-provisioning an already-live
// worktree of the same path reuses it instead of failing.

import path from "node:path";
import { existsSync, rmSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { loadConfig, isWindows } from "./config.mjs";
import { git, resolveCommit, shortSha, listWorktrees } from "./git.mjs";
import { linkDeps, buildLibDist, copyEnvFiles } from "./link-deps.mjs";
import { scanSharedStore, repairSharedStore } from "./store-doctor.mjs";
import { resolveRepoCheckout, resolveDefaultBaseRef } from "./repo-clone.mjs";
import {
  registerWorktree,
  getWorktreeRecord,
  updateWorktreeRecord,
  normalizePath,
  findOrphanedRescueBranches,
  writeReprovisionMarker,
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
    else if (t === "--repo") a.repo = argv[++i];
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
export function provisionWorktree({ name, path: wantPath, base: wantBase, link = false, ownerPid, repo: wantOwnerRepo, repoCloneUrl } = {}) {
  if (!name) return { ok: false, error: "name is required" };

  const config = loadConfig();

  // Git #3584 — resolve the REAL checkout this worktree is added from: the main
  // repo (default, zero behavior change) or a dedicated secondary clone for any
  // other real configured repo (a #3581 Settings "Tinker" entry). Every
  // subsequent git operation below (and everything the caller does INSIDE the
  // resulting worktree — commit, `git push`, `origin`) naturally targets the
  // right remote because it's the worktree's own inherited git config, not a
  // separately-tracked value. `repoCloneUrl` is a testability-only override
  // (see repo-clone.mjs) — real callers (BuildConsole, the CLI) never set it.
  let checkout;
  try {
    checkout = resolveRepoCheckout(config, wantOwnerRepo, { cloneUrl: repoCloneUrl });
  } catch (e) {
    return { ok: false, error: `repo resolution failed: ${e.message}` };
  }
  const { repoRoot: repo, ownerRepo, isMain } = checkout;

  const base = wantBase || (isMain ? config.baseRef : resolveDefaultBaseRef(repo));
  const branch = `agent/${name}`;
  const wtPath =
    wantPath ||
    (isWindows() ? path.join("C:\\wt", name) : path.join(path.dirname(config.mainRepoRoot), `wt-${name}`));
  // The owner is the long-lived launcher, NOT the provisioner (which exits at once).
  const creatorPid = Number.isFinite(ownerPid) && ownerPid > 0 ? ownerPid : process.ppid;

  const baseCommit = resolveCommit(repo, base);
  if (!baseCommit) {
    return { ok: false, error: `base ref '${base}' does not resolve in ${repo}. Try: git -C "${repo}" fetch origin` };
  }

  // Git #1988 — check the SHARED store this worktree is about to junction into, so a
  // poisoned store is visible at provisioning time (seconds) instead of mid-session as
  // an inexplicable tsc/vitest failure. Provisioning proceeds either way (blocking
  // every build on a poisoned store would strand the whole queue), but the result
  // rides on the returned object and the human path prints it loudly.
  //
  // Git #1980 — if the scan finds poisoning, repair it here, before this new worktree
  // gets its own junctions pointed at the same broken store (there is no reason to
  // hand a fresh worktree a poisoned set of links when store-doctor's repair is
  // already proven safe — see the matching fix in worktree-lifecycle.mjs's
  // post-removal canary for the full rationale). Still never silent: both the
  // pre-repair poisoning and the repair outcome ride on storeHealth.
  //
  // Git #3584 — this shared pnpm store belongs to THIS (main) repo's monorepo
  // tooling; a secondary-repo checkout never junctions into it (see `link`
  // handling below), so there is nothing real to scan or repair for one.
  let storeHealth = null;
  if (isMain) {
    try {
      const scan = scanSharedStore(repo);
      storeHealth = {
        clean: scan.clean,
        foreign: scan.foreignLinks.length,
        dangling: scan.danglingLinks.length,
        poisonedBins: scan.poisonedBins.length,
      };
      if (!scan.clean) {
        let repairRes = null;
        try {
          repairRes = repairSharedStore(repo, scan);
        } catch (e) {
          repairRes = { error: e.message };
        }
        const rescan = scanSharedStore(repo);
        storeHealth.autoRepair = {
          repairedLinks: repairRes?.repairedLinks?.length ?? 0,
          repairedBins: repairRes?.repairedBins?.length ?? 0,
          unrepairable: repairRes?.unrepairable?.length ?? 0,
          error: repairRes?.error ?? null,
          cleanAfterRepair: rescan.clean,
        };
      }
    } catch (e) {
      storeHealth = { error: e.message };
    }
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
          repoRoot: repo,
          ownerRepo,
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
        repoRoot: repo,
        ownerRepo,
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
      // Git #3584 — .env/.env.local carry THIS repo's own DB creds/secrets; copying them
      // into a secondary (Tinker) repo's checkout would be actively wrong, not just unused.
      const envResult = isMain ? copyEnvFiles(repo, wtPath) : null;
      // Git #1958 — even on the reuse path, surface any prior-session work that a sweep
      // rescued under this same name but the reused checkout doesn't contain, so a resumed
      // session is never silently handed a clean tree over discarded work.
      const orphanedReuse = findOrphanedRescueBranches(config, name, wtPath, repo);
      const priorWorkRescued = orphanedReuse.length
        ? (writeReprovisionMarker(config, wtPath, orphanedReuse), orphanedReuse.map((o) => o.branch))
        : null;
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
        priorWorkRescued,
        ownerRepo,
        isMain,
      };
    }
    // Git #2720 (the confirmed real cause of #2118's "empty unprovisioned worktree"
    // mystery) — a target path that exists, isn't a registered worktree, and is
    // genuinely EMPTY is not real work to protect; it's debris from an earlier
    // provision attempt that created the directory (or `git worktree add` itself did)
    // and then never completed (a crashed `git` process, Git #2539's real
    // 0x40000015 abort pattern, is the leading suspect). Confirmed live 2026-09-03:
    // `C:\wt\2715-q1457` and over a dozen sibling dirs across `C:\wt\` were exactly
    // this shape — 0 bytes, no `.git`, absent from `git worktree list` — and this
    // hard-fail (with no self-heal) was the actual mechanism behind #2720's "Batter
    // Up item never launches, no error shown": every retry (including manual "Start
    // Now" force-dispatch) hit the SAME empty leftover path and refused, logging only
    // to ActivityLog, never surfacing anywhere Shane would see it. `git worktree add`
    // itself tolerates a pre-existing EMPTY directory at its target (verified live) —
    // so falling through to the normal create path below, instead of hard-failing, is
    // a safe, real self-heal. Only a genuinely non-empty stray directory (real files
    // that might be someone's unrecovered work) still hard-fails exactly as before.
    if (readdirSync(wtPath).length === 0) {
      // fall through to the normal "create the worktree" path below, targeting the
      // same (now confirmed-empty) wtPath.
    } else {
      return {
        ok: false,
        error: `${wtPath} exists but is not a registered git worktree. Remove it or pass a different --path.`,
      };
    }
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
  //     node_modules — no per-worktree install, no re-download (Git #1372).
  //     Git #3584 — this whole pnpm-workspace junction/dist-build mechanism is
  //     THIS (main) repo's monorepo tooling; a secondary-repo checkout has its own
  //     independent dependency tree (or none at all) and never junctions into it,
  //     regardless of whether the caller asked for --link. ---
  let linked = false;
  let libsBuilt = null;
  if (link && isMain) {
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
  //     Best-effort like linkDeps -- a missing source file is logged, not fatal.
  //     Git #3584 — these carry THIS repo's own DB creds/secrets; a secondary
  //     (Tinker) repo checkout never gets them copied in. ---
  // Git #1646 — see the matching comment on the reused-worktree branch above: no
  // console output here, envFiles rides on the returned result instead.
  const envResult = isMain ? copyEnvFiles(repo, wtPath) : null;

  // --- Register in the lifecycle tracker (the fix for the swept-live-worktree bug). ---
  const rec = registerWorktree(config, {
    name,
    path: wtPath,
    branch,
    baseRef: base,
    baseCommit,
    creatorPid,
    repoRoot: repo,
    ownerRepo,
  });

  // Git #1958 — a FRESH create for a name that already has `rescued/<name>-*` branches is
  // the exact #1550 shape: a prior worktree was swept/removed (its branch deleted), and this
  // resume re-created the branch off a newer origin/main, orphaning the earlier work. Drop a
  // visible marker + report it so the resumed session doesn't trust its clean checkout.
  const orphanedFresh = findOrphanedRescueBranches(config, name, wtPath, repo);
  const priorWorkRescued = orphanedFresh.length
    ? (writeReprovisionMarker(config, wtPath, orphanedFresh), orphanedFresh.map((o) => o.branch))
    : null;

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
    priorWorkRescued,
    ownerRepo,
    isMain,
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
  console.warn(`  !!! SHARED STORE WAS POISONED (Git #1988/#1980): foreign=${storeHealth.foreign}, dangling=${storeHealth.dangling}, poisonedBins=${storeHealth.poisonedBins}`);
  if (storeHealth.autoRepair) {
    const r = storeHealth.autoRepair;
    console.warn(
      `  !!! Auto-repaired before junctioning: relinked ${r.repairedLinks} link(s), rewrote ${r.repairedBins} shim(s), ` +
        `unrepairable ${r.unrepairable} — store is now ${r.cleanAfterRepair ? "CLEAN" : "STILL POISONED"}.`
    );
    if (!r.cleanAfterRepair) {
      console.warn(`  !!! This worktree junctions into that still-poisoned store — tsc/vitest/builds may fail here through no fault of this session.`);
      console.warn(`  !!! Diagnose remaining entries with: node scripts/dev-server/store-doctor.mjs`);
    }
  } else {
    console.warn(`  !!! This worktree junctions into that store — tsc/vitest/builds may fail here through no fault of this session.`);
    console.warn(`  !!! Diagnose with: node scripts/dev-server/store-doctor.mjs   (repair is explicit: --repair)`);
  }
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
    const msg = "usage: node scripts/dev-server/provision-worktree.mjs <name> [--path <dir>] [--base <ref>] [--link] [--owner-pid <n>] [--repo <owner/repo>] [--json]";
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
    repo: a.repo,
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

  // Git #1958 — loudest possible signal to a resuming human/session that this worktree
  // does NOT contain a prior session's rescued work (a clean git status here is a trap).
  if (res.priorWorkRescued && res.priorWorkRescued.length) {
    console.warn(`  !!! PRIOR WORK RESCUED ELSEWHERE (Git #1958) — this checkout does NOT contain it:`);
    for (const b of res.priorWorkRescued) console.warn(`      -> ${b}`);
    console.warn(`      See ${res.path}\\.worktree-reprovisioned.json for recovery steps.`);
  }

  console.log(res.reused ? `Reused existing worktree` : `Created worktree`);
  console.log(`  path   : ${res.path}`);
  console.log(`  repo   : ${res.ownerRepo}${res.isMain ? "" : " (secondary/Tinker repo — Git #3584)"}`);
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
  if (res.isMain) {
    console.log(`Work in ${res.path}. When your build is committed there, publish it to the dev server with:`);
    console.log(`  cd ${res.path}`);
    console.log(`  node scripts/dev-server/request-restart.mjs --agent ${name}`);
  } else {
    // Git #3584 — request-restart.mjs merges into THIS repo's own local dev-server
    // checkout; a secondary repo has no such shared dev server to merge into. Its
    // own commits, pushed to its own `origin`, are the whole deliverable.
    console.log(`Work in ${res.path}. This is a secondary (${res.ownerRepo}) checkout — commit and \`git push origin <branch>\` directly; there is no local dev-server merge-back for it.`);
  }
  console.log(`And clean up when done:`);
  console.log(`  node scripts/dev-server/cleanup-worktree.mjs ${name}`);
}

// Only run when invoked directly (safe to import provisionWorktree from a launcher).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
