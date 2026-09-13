// scripts/dev-server/worktree-lifecycle.mjs
//
// Explicit lifecycle management and cleanup for isolated agent git worktrees.
//
// Real problem: each agent works in its own isolated worktree per #92's design.
// If an agent crashes or finishes without self-cleaning, worktrees accumulate,
// wasting disk space and leaving stale state.
//
// Safety guarantees:
//   1. Protected paths: main repo root and serverWorktree are NEVER removed.
//   2. Windows junctions: all node_modules / lib/*/dist junctions are safely
//      unlinked (rmdir) BEFORE git worktree remove, preventing accidental
//      deletion into the real shared repository files.
//   3. Debug retention: crashed/failed worktrees can be marked "stale" with
//      a .stale-worktree.json marker and debug reason instead of silently
//      accumulating.
//   4. Periodic / manual sweep: finds and cleans any worktree not tied to an
//      active PID or recently-completed build.
//   5. Durably logged: every cleanup action is logged to cleanups.log and stdout.

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { loadConfig, isWindows } from "./config.mjs";
import {
  git,
  listWorktrees,
  removeWorktree,
  pruneWorktrees,
  deleteBranch,
  revParse,
  isAncestor,
  resolveCommit,
  isGitRepo,
} from "./git.mjs";
import { pidAlive } from "./lock.mjs";
import { findAndUnlinkWorktreeJunctions } from "./link-deps.mjs";
import { scanSharedStore, repairSharedStore } from "./store-doctor.mjs";
import { secondaryReposRoot } from "./repo-clone.mjs";

// markWorktreeStale() drops this untracked marker into a retained worktree; it is
// BuildConsole bookkeeping, never real work, so preservation must not count it as "dirty".
const STALE_MARKER_NAME = ".stale-worktree.json";

// Git #1958 — dropped into a freshly (re-)provisioned worktree when a prior session's
// work was rescued elsewhere (pause/resume or sweep), so a resumed session is never
// silently handed a clean `git status` over discarded work. Also BuildConsole
// bookkeeping, never real work — filtered from dirty detection exactly like the stale
// marker above.
export const REPROVISION_MARKER_NAME = ".worktree-reprovisioned.json";

export function normalizePath(p) {
  if (!p) return "";
  const resolved = path.resolve(p);
  return isWindows() ? resolved.toLowerCase().replace(/\//g, "\\") : path.normalize(resolved);
}

function ensureWorktreesDir(config) {
  mkdirSync(config.worktreesDir, { recursive: true });
}

function sanitizeId(str) {
  return String(str).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function recordPathFor(config, idOrPath) {
  ensureWorktreesDir(config);
  const normalized = normalizePath(idOrPath);
  const base = path.basename(normalized);
  return path.join(config.worktreesDir, `${sanitizeId(base)}.json`);
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeAtomic(file, obj) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Math.floor(Math.random() * 1e9)}`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2));
  try {
    // Windows rename can fail if target exists; remove target first if needed
    if (existsSync(file)) rmSync(file, { force: true });
    execFileSync("cmd", ["/c", "move", "/Y", tmp, file], { stdio: "ignore" });
  } catch {
    writeFileSync(file, JSON.stringify(obj, null, 2));
    try { rmSync(tmp, { force: true }); } catch {}
  }
}

/** Append an entry to cleanups.log */
export function appendCleanupLog(config, entry) {
  try {
    mkdirSync(path.dirname(config.cleanupsLog), { recursive: true });
    const record = {
      timestamp: Date.now(),
      iso: new Date().toISOString(),
      ...entry,
    };
    const line = JSON.stringify(record) + "\n";
    writeFileSync(config.cleanupsLog, line, { flag: "a" });
  } catch {
    /* best effort */
  }
}

/** Register a newly-created worktree in stateDir/worktrees/ */
export function registerWorktree(config, info) {
  ensureWorktreesDir(config);
  const wtPath = path.resolve(info.path);
  const name = info.name || path.basename(wtPath);
  const id = sanitizeId(name);
  const record = {
    id,
    name,
    path: wtPath,
    branch: info.branch || null,
    baseRef: info.baseRef || config.baseRef,
    baseCommit: info.baseCommit || null,
    creatorPid: info.creatorPid || process.pid,
    creatorHost: info.creatorHost || os.hostname(),
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    status: info.status || "active", // "active" | "completed" | "failed" | "abandoned" | "stale"
    keepForDebug: !!info.keepForDebug,
    debugReason: info.debugReason || null,
    // Git #3584 (Feature #3578, Multi-Repo Support) — the REAL local checkout this
    // worktree was added from (main repo, or a secondary/Tinker clone), and the real
    // "owner/repo" it targets. Absent/null on every record from before this field
    // existed — every removal/rescue call site below falls back to
    // config.mainRepoRoot in that case, exactly matching prior (single-repo) behavior.
    repoRoot: info.repoRoot || null,
    ownerRepo: info.ownerRepo || null,
  };
  const targetFile = path.join(config.worktreesDir, `${id}.json`);
  writeAtomic(targetFile, record);
  return record;
}

/** Get a worktree tracking record by name or path */
export function getWorktreeRecord(config, nameOrPath) {
  ensureWorktreesDir(config);
  const norm = normalizePath(nameOrPath);
  for (const f of readdirSync(config.worktreesDir)) {
    if (!f.endsWith(".json") || f.includes(".tmp-")) continue;
    const rec = readJson(path.join(config.worktreesDir, f));
    if (!rec) continue;
    if (rec.id === nameOrPath || rec.name === nameOrPath || normalizePath(rec.path) === norm) {
      return rec;
    }
  }
  return null;
}

/** List all worktree tracking records */
export function listWorktreeRecords(config) {
  ensureWorktreesDir(config);
  const records = [];
  for (const f of readdirSync(config.worktreesDir)) {
    if (!f.endsWith(".json") || f.includes(".tmp-")) continue;
    const rec = readJson(path.join(config.worktreesDir, f));
    if (rec) records.push(rec);
  }
  return records.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/** Update an existing worktree tracking record */
export function updateWorktreeRecord(config, nameOrPath, patch) {
  const rec = getWorktreeRecord(config, nameOrPath);
  if (!rec) return null;
  const updated = { ...rec, ...patch, lastActiveAt: Date.now() };
  const targetFile = path.join(config.worktreesDir, `${rec.id}.json`);
  writeAtomic(targetFile, updated);
  return updated;
}

/** Remove a worktree tracking record */
export function removeWorktreeRecord(config, nameOrPath) {
  const rec = getWorktreeRecord(config, nameOrPath);
  if (!rec) return false;
  const targetFile = path.join(config.worktreesDir, `${rec.id}.json`);
  try {
    rmSync(targetFile, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Mark a worktree as stale for debugging instead of silently leaving it ambiguous.
 * Drops a `.stale-worktree.json` marker file inside the worktree and updates tracking.
 */
export function markWorktreeStale(config, nameOrPath, { reason = "build error / crash", commit = null, error = null } = {}) {
  const rec = getWorktreeRecord(config, nameOrPath);
  const wtPath = rec ? rec.path : path.resolve(nameOrPath);

  if (existsSync(wtPath)) {
    const marker = {
      markedStaleAt: Date.now(),
      iso: new Date().toISOString(),
      reason,
      commit,
      error,
      creatorPid: rec?.creatorPid || null,
      instruction: "This worktree failed or errored and was retained for debugging. Run 'node scripts/dev-server/cleanup-worktree.mjs' to clean it up.",
    };
    try {
      writeFileSync(path.join(wtPath, ".stale-worktree.json"), JSON.stringify(marker, null, 2));
    } catch {
      /* ignore if permissions issue */
    }
  }

  if (rec) {
    updateWorktreeRecord(config, nameOrPath, {
      status: "stale",
      keepForDebug: true,
      debugReason: reason,
    });
  }

  appendCleanupLog(config, {
    action: "marked_stale",
    path: wtPath,
    reason,
    commit,
    error,
  });

  console.log(`[worktree-cleanup] MARKED STALE: ${wtPath} (reason: ${reason})`);
  return { ok: true, path: wtPath, status: "stale", reason };
}

/**
 * Git #1958 — find `rescued/<name>-*` branches whose tip is NOT already reachable from
 * the given worktree HEAD, i.e. a prior session's work that a re-provision left orphaned.
 * These are the branches preserveWorktreeWork() stamped when an earlier same-named worktree
 * was swept/removed. A resumed build that re-provisions a fresh worktree off a newer
 * origin/main needs to know they exist so it never silently trusts a clean `git status`.
 *
 * Git #3584 — `repoRoot` is the REAL checkout this worktree actually belongs to
 * (the main repo, or a secondary/Tinker clone per repo-clone.mjs); rescue
 * branches for a secondary-repo worktree live in ITS OWN clone, never in the
 * main repo. Defaults to `config.mainRepoRoot` for back-compat with every
 * existing call site/record that predates the multi-repo dimension.
 *
 * @returns {Array<{ branch: string, tip: string }>}
 */
export function findOrphanedRescueBranches(config, name, wtPath, repoRoot = config.mainRepoRoot) {
  try {
    const safe = sanitizeId(name);
    const prefix = `rescued/${safe}-`;
    const r = git(repoRoot, [
      "for-each-ref",
      "--format=%(refname:short) %(objectname)",
      `refs/heads/${prefix}*`,
    ]);
    if (r.code !== 0) return [];
    const head = wtPath && existsSync(wtPath) && isGitRepo(wtPath) ? revParse(wtPath, "HEAD") : null;
    const out = [];
    for (const line of (r.stdout || "").split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      const sp = t.lastIndexOf(" ");
      if (sp < 0) continue;
      const branch = t.slice(0, sp).trim();
      const tip = t.slice(sp + 1).trim();
      if (!branch.startsWith(prefix) || !tip) continue;
      // Orphaned only if the new worktree HEAD does not already contain the rescued tip
      // (a resumed session that already cherry-picked/merged it shouldn't be re-warned).
      const reachable = head ? isAncestor(repoRoot, tip, head) : false;
      if (!reachable) out.push({ branch, tip });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Git #1958 — drop a visible, untracked marker into a freshly (re-)provisioned worktree
 * telling a resumed session its prior work was rescued to another branch and is NOT in
 * this checkout. This is the "at minimum, tell the resumed session" the issue asks for:
 * a silently-clean `git status` over discarded work is the exact failure #1958 filed.
 * Returns the marker object (or null if nothing to warn about / write failed).
 */
export function writeReprovisionMarker(config, wtPath, orphaned) {
  if (!wtPath || !existsSync(wtPath) || !Array.isArray(orphaned) || orphaned.length === 0) return null;
  const marker = {
    reprovisionedAt: Date.now(),
    iso: new Date().toISOString(),
    reason:
      "This worktree was (re-)provisioned fresh — likely after a pause/resume or a cleanup sweep. " +
      "A prior session's uncommitted/unpushed work was RESCUED to the branch(es) listed below (Git #1971) " +
      "and is NOT present in this checkout. Do not trust a clean `git status` as proof no prior work existed.",
    rescuedBranches: orphaned.map((o) => o.branch),
    howToRecover:
      "Inspect: git log <branch> --stat   |   Restore files: git checkout <branch> -- <path>   |   " +
      "Replay a commit: git cherry-pick <branch>. See Git #1958.",
  };
  try {
    writeFileSync(path.join(wtPath, REPROVISION_MARKER_NAME), JSON.stringify(marker, null, 2));
    appendCleanupLog(config, {
      action: "reprovision_marker_written",
      path: wtPath,
      rescuedBranches: marker.rescuedBranches,
    });
    console.warn(
      `[worktree-provision] !!! RE-PROVISION over prior work (Git #1958): ${wtPath}\n` +
        `    Prior session work was rescued to: ${marker.rescuedBranches.join(", ")}\n` +
        `    A '${REPROVISION_MARKER_NAME}' marker was written here so the resumed session sees it.`
    );
    return marker;
  } catch {
    return null;
  }
}

/**
 * Git #1971 — PRESERVE a worktree's unpublished work before it is destroyed.
 *
 * The single silent-data-loss hazard this whole file exists to prevent came back from the
 * REMOVE side: `removeWorktreeSafe` force-removed the directory AND force-deleted the `agent/*`
 * branch, so any uncommitted edits and any commits not yet on origin/main (e.g. a committed
 * bookend) were discarded — recoverable only via `git fsck` dangling objects, twice observed
 * (build-journal/1882.md, build-journal/1548.md). This function is the choke point that makes
 * that impossible: EVERY removal path (the periodic sweep and explicit cleanup both route through
 * removeWorktreeSafe) preserves first.
 *
 * It is best-effort and never throws — a preservation failure must not block cleanup, but the
 * common case leaves a durable, named, recoverable ref instead of a dangling object:
 *   1. Any uncommitted changes are WIP-committed onto the worktree's own branch (identity is
 *      forced so it works even if the worktree has no user.name/email), turning working-tree
 *      state into reachable objects.
 *   2. A durable branch `rescued/<name>-<ts>` is stamped at the (post-WIP) branch tip, so the
 *      subsequent force-delete of the ephemeral `agent/*` branch can never orphan the commits —
 *      they stay reachable and discoverable via `git branch --list 'rescued/*'`, no fsck needed.
 *
 * Skips entirely when there is genuinely nothing to save (clean tree AND the branch tip is
 * already an ancestor of origin/main), so a normal completed+merged build leaves no noise.
 *
 * @returns {{ preserved: boolean, reason: string, wip?: string|null, rescueBranch?: string|null }}
 */
/**
 * Git #1958 — the single source of truth for "does this worktree still hold real work?"
 * (uncommitted changes and/or commits not yet on the base ref). Used both by the removal
 * rescue (preserveWorktreeWork below) and by the sweep's retain-in-place decision, so the
 * two can never disagree about what counts as work. BuildConsole's own untracked markers
 * (stale / re-provision) are bookkeeping, never real work, and are filtered out.
 *
 * Git #3584 — `repoRoot` is the worktree's OWN real checkout (main repo, or a
 * secondary/Tinker clone); the base ref this compares "unpushed" against must
 * resolve there, not always the main repo. Defaults to `config.mainRepoRoot`
 * for back-compat.
 *
 * @returns {{ dirty: boolean, unpushed: boolean, hasWork: boolean, head: string|null }}
 */
export function detectWorktreeWork(config, wtPath, repoRoot = config.mainRepoRoot) {
  if (!existsSync(wtPath) || !isGitRepo(wtPath)) {
    return { dirty: false, unpushed: false, hasWork: false, head: null };
  }
  // Uncommitted changes (the stale-debug / re-provision markers are bookkeeping, not real work).
  const status = git(wtPath, ["status", "--porcelain"]);
  const dirtyLines = (status.stdout || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => !l.endsWith(STALE_MARKER_NAME) && !l.endsWith(REPROVISION_MARKER_NAME));
  const dirty = status.code === 0 && dirtyLines.length > 0;

  // Unpushed commits: the branch tip isn't yet an ancestor of the base ref (origin/main
  // of the worktree's OWN real repo). If the base can't be resolved, err toward "has
  // work" rather than discarding.
  const head = revParse(wtPath, "HEAD");
  const base = resolveCommit(repoRoot, config.baseRef) || revParse(repoRoot, config.baseRef);
  const unpushed = head ? (base ? !isAncestor(wtPath, head, base) : true) : false;

  return { dirty, unpushed, hasWork: dirty || unpushed, head };
}

export function preserveWorktreeWork(config, wtPath, rec, repoRootHint = null) {
  try {
    if (!existsSync(wtPath) || !isGitRepo(wtPath)) {
      return { preserved: false, reason: "path gone or not a git worktree" };
    }

    // Git #3584 — resolve against the worktree's OWN real repo (main, or its
    // secondary/Tinker clone), not always the main repo.
    // Git #3630 — `repoRootHint` (the sweep's own resolved repo root for this exact
    // worktree) is the fallback before config.mainRepoRoot, for a recordless
    // secondary-clone worktree the sweep is rescuing.
    const repoRoot = rec?.repoRoot || repoRootHint || config.mainRepoRoot;
    const { dirty, unpushed } = detectWorktreeWork(config, wtPath, repoRoot);

    if (!dirty && !unpushed) {
      return { preserved: false, reason: "nothing to preserve (clean tree, branch already on origin/main)" };
    }

    // 1. WIP-commit any uncommitted changes onto the branch so they become reachable objects.
    const idFlags = ["-c", "user.name=BuildConsole Rescue", "-c", "user.email=rescue@localhost"];
    let wip = null;
    if (dirty) {
      git(wtPath, ["add", "-A"]);
      const msg = `WIP: rescued uncommitted work before worktree removal (${new Date().toISOString()})`;
      const c = git(wtPath, [...idFlags, "commit", "--no-verify", "-m", msg]);
      if (c.code === 0) wip = revParse(wtPath, "HEAD");
    }

    // 2. Stamp a durable rescue branch at the (post-WIP) tip so branch-delete can't orphan
    //    it — in the worktree's OWN repo (Git #3584), never the main repo for a
    //    secondary/Tinker worktree's rescued commits.
    const tip = revParse(wtPath, "HEAD");
    let rescueBranch = null;
    if (tip) {
      const safe = sanitizeId(rec?.name || path.basename(wtPath));
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const ref = `refs/heads/rescued/${safe}-${ts}`;
      const u = git(repoRoot, ["update-ref", ref, tip]);
      if (u.code === 0) rescueBranch = ref.replace("refs/heads/", "");
    }

    if (wip || rescueBranch) {
      appendCleanupLog(config, {
        action: "preserved_before_removal",
        path: wtPath,
        wip,
        rescueBranch,
        dirty,
        unpushed,
      });
      console.log(
        `[worktree-cleanup] PRESERVED work before removing ${wtPath}` +
          (rescueBranch ? ` -> branch '${rescueBranch}'` : "") +
          (wip ? ` (WIP commit ${wip.slice(0, 8)})` : "")
      );
      return { preserved: true, reason: "work rescued", wip, rescueBranch };
    }
    return { preserved: false, reason: "had work but could not create a rescue ref (logged)" };
  } catch (e) {
    // Best effort — never block cleanup on a preservation failure, but make it visible.
    try { appendCleanupLog(config, { action: "preserve_failed", path: wtPath, error: e.message }); } catch {}
    console.warn(`[worktree-cleanup] Warning: could not preserve work in ${wtPath}: ${e.message}`);
    return { preserved: false, reason: `preserve error: ${e.message}` };
  }
}

/**
 * Safely remove an isolated worktree.
 *
 * CRITICAL SAFETY:
 *   0. PRESERVES any uncommitted / unpushed work to a durable `rescued/*` branch first
 *      (Git #1971) — a removal can never silently discard in-progress work.
 *   1. Verifies path is not main repo root or dev-server checkout.
 *   2. Unlinks all directory junctions (node_modules, dist) so git worktree remove
 *      or rmdir NEVER follows junctions into the main repo.
 *   3. Removes git worktree registration via `git worktree remove --force`.
 *   4. Prunes stale worktrees via `git worktree prune`.
 *   5. Purges any remaining directory content.
 *   6. Deletes the ephemeral agent branch if requested (e.g. `agent/*`).
 *   7. Logs the action durably.
 */
export function removeWorktreeSafe(config, nameOrPath, { reason = "completed build", force = true, deleteBranch: shouldDeleteBranch = true, repoRootHint = null } = {}) {
  const rec = getWorktreeRecord(config, nameOrPath);
  const wtPath = rec ? rec.path : path.resolve(nameOrPath);
  // Git #3584 — the worktree's OWN real checkout (main repo, or its secondary/Tinker
  // clone); every git operation below (worktree remove, prune, branch delete) must run
  // there, not always against the main repo. Falls back to config.mainRepoRoot for a
  // record that predates this field — exactly today's (single-repo) behavior.
  //
  // Git #3630 — `repoRootHint` (the sweep's own `git worktree list <repoRoot>` result
  // that found this exact path) is the fallback BEFORE config.mainRepoRoot, so a
  // recordless secondary-clone worktree still resolves to its real repo instead of
  // silently misresolving to the main repo.
  const repoRoot = rec?.repoRoot || repoRootHint || config.mainRepoRoot;
  const normTarget = normalizePath(wtPath);
  const normMain = normalizePath(config.mainRepoRoot);
  const normServer = normalizePath(config.serverWorktree);

  // Safety boundaries: NEVER remove main repo or server worktree
  if (normTarget === normMain) {
    throw new Error(`Refusing to remove main repository root: ${wtPath}`);
  }
  if (normTarget === normServer) {
    throw new Error(`Refusing to remove dedicated dev-server worktree: ${wtPath}`);
  }

  // Git #1971 — preserve unpublished work BEFORE any destructive step (junction unlink, worktree
  // remove, branch delete). Best-effort; never blocks removal.
  const preservation = preserveWorktreeWork(config, wtPath, rec, repoRootHint);

  // Git #1988 — junctions MUST all be gone before anything destructive runs; removal
  // tooling that follows reparse points deletes THROUGH them into the shared store
  // (link-deps.mjs header warning). If any junction survives the unlink attempt
  // (e.g. a process holds a handle on it), removal is REFUSED: the worktree is
  // marked stale and retained instead of gambling the shared store on it.
  let junctionsUnlinked = [];
  if (existsSync(wtPath)) {
    let remaining = [];
    try {
      const r = findAndUnlinkWorktreeJunctions(wtPath);
      junctionsUnlinked = r.unlinked;
      remaining = r.remaining;
    } catch (e) {
      console.warn(`[worktree-cleanup] Warning: unlinking junctions for ${wtPath} hit: ${e.message}`);
      remaining = [`(junction enumeration failed: ${e.message})`];
    }
    if (remaining.length > 0) {
      const detail = remaining.join(", ");
      markWorktreeStale(config, wtPath, {
        reason: `removal refused: ${remaining.length} junction(s) could not be unlinked (${detail}) — removing now could delete through into the shared store (Git #1988)`,
      });
      throw new Error(
        `Refusing to remove ${wtPath}: ${remaining.length} live junction(s) could not be unlinked (${detail}). ` +
          `Close whatever holds them open and re-run cleanup.`
      );
    }
  }

  // Git worktree remove
  let gitRemoveOk = false;
  try {
    const r = removeWorktree(repoRoot, wtPath, { force: true });
    gitRemoveOk = r.code === 0;
  } catch {}

  // Prune git worktrees
  try {
    pruneWorktrees(repoRoot);
  } catch {}

  // Filesystem cleanup if directory remains
  let fsRemoved = false;
  if (existsSync(wtPath)) {
    try {
      rmSync(wtPath, { recursive: true, force: true });
      fsRemoved = true;
    } catch {
      // On Windows sometimes a process holds a handle momentarily; retry with cmd /c rmdir /s /q
      if (isWindows()) {
        try {
          execFileSync("cmd", ["/c", "rmdir", "/S", "/Q", wtPath], { stdio: "ignore" });
          fsRemoved = !existsSync(wtPath);
        } catch {}
      }
    }
  }

  // Branch deletion
  let branchDeleted = null;
  const branchName = rec?.branch;
  if (shouldDeleteBranch && branchName && branchName !== "main" && branchName !== "master" && branchName !== config.serverBranch) {
    try {
      const res = deleteBranch(repoRoot, branchName, { force: true });
      if (res.code === 0) branchDeleted = branchName;
    } catch {}
  }

  // Remove tracking record
  removeWorktreeRecord(config, nameOrPath);

  // Git #1988 — canary: after every removal, verify the SHARED store still resolves
  // inside the main checkout (per #1964's post-cleanup verification suggestion). This
  // pins the timeline of any future poisoning to the removal that exposed it, in the
  // durable cleanups.log, instead of surfacing a session later.
  //
  // Git #1980 — a poisoned store used to sit here as a logged `console.warn` only,
  // with repair left to whichever session happened to notice: real evidence showed
  // the shared store still POISONED (670 foreign links) across nine further sweep
  // removals spanning 30+ minutes (2026-09-06T14:36Z -> 15:07Z, cleanups.log), because
  // nothing ever acted on the warning. store-doctor's repair is already safe to run
  // unattended — it only re-points a reparse point at a store-relative path it has
  // VERIFIED exists and is non-empty under this root (see repairSharedStore); it never
  // fetches anything and never touches a target it cannot confirm. So the moment this
  // canary finds poisoning, repair it immediately, right here — and log the
  // before/after of that repair (never silently), so the recurrence stays fully
  // visible in cleanups.log instead of being hidden by going quiet.
  let storeAfterRemoval = null;
  try {
    const scan = scanSharedStore(config.mainRepoRoot);
    storeAfterRemoval = {
      clean: scan.clean,
      foreign: scan.foreignLinks.length,
      dangling: scan.danglingLinks.length,
      poisonedBins: scan.poisonedBins.length,
      missingTrees: scan.missingTrees.length,
    };
    if (!scan.clean) {
      console.warn(
        `[worktree-cleanup] WARNING: shared store at ${config.mainRepoRoot} is POISONED after removing ${wtPath} ` +
          `(foreign=${scan.foreignLinks.length}, dangling=${scan.danglingLinks.length}, poisonedBins=${scan.poisonedBins.length}, missingTrees=${scan.missingTrees.length}). ` +
          `Auto-repairing now (Git #1980) — see storeAutoRepair in this log entry.`
      );
      let repairRes = null;
      try {
        repairRes = repairSharedStore(config.mainRepoRoot, scan);
      } catch (e) {
        repairRes = { error: e.message };
      }
      const rescan = scanSharedStore(config.mainRepoRoot);
      storeAfterRemoval.autoRepair = {
        repairedLinks: repairRes?.repairedLinks?.length ?? 0,
        repairedBins: repairRes?.repairedBins?.length ?? 0,
        unrepairable: repairRes?.unrepairable?.length ?? 0,
        error: repairRes?.error ?? null,
        cleanAfterRepair: rescan.clean,
      };
      console.warn(
        `[worktree-cleanup] store-doctor auto-repair: relinked ${storeAfterRemoval.autoRepair.repairedLinks} link(s), ` +
          `rewrote ${storeAfterRemoval.autoRepair.repairedBins} shim(s), unrepairable ${storeAfterRemoval.autoRepair.unrepairable} — ` +
          `store is now ${rescan.clean ? "CLEAN" : "STILL POISONED"}.` +
          (rescan.clean ? "" : " Diagnose remaining entries with: node scripts/dev-server/store-doctor.mjs")
      );
    }
  } catch (e) {
    storeAfterRemoval = { error: e.message };
  }

  const logEntry = {
    action: "removed",
    path: wtPath,
    reason,
    junctionsUnlinkedCount: junctionsUnlinked.length,
    gitRemoveOk,
    fsRemoved,
    branchDeleted,
    rescuedBranch: preservation.rescueBranch || null,
    rescuedWip: preservation.wip || null,
    storeAfterRemoval,
  };
  appendCleanupLog(config, logEntry);

  console.log(`[worktree-cleanup] REMOVED worktree at ${wtPath} (reason: ${reason}, junctionsUnlinked: ${junctionsUnlinked.length}, branchDeleted: ${branchDeleted || "none"}${preservation.rescueBranch ? `, rescued -> ${preservation.rescueBranch}` : ""})`);

  return {
    ok: true,
    path: wtPath,
    reason,
    junctionsUnlinkedCount: junctionsUnlinked.length,
    branchDeleted,
    rescuedBranch: preservation.rescueBranch || null,
    rescuedWip: preservation.wip || null,
    storeAfterRemoval,
  };
}

/** stat mtime in ms, best-effort — a missing/unreadable path contributes 0. */
function safeMtimeMs(p) {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Git #2537 — best-effort "most recent on-disk activity" for a worktree, used by the sweep
 * as a liveness signal INDEPENDENT of the tracking record and the stored owner pid.
 *
 * The single-pid retention the sweep relied on has multiple realistic ways to fail while a
 * session is genuinely live: the pid we stamp is `launched.Process.Id` (claude.exe), which
 * can be a short-lived launcher distinct from the real long-lived worker (the process that
 * sets CLAUDE_PID), so the stored pid dies while the session keeps running; and the record
 * itself can be lost/mismatched, after which a recordless `agent/*` worktree falls through
 * every record-gated check straight to removal. Both were live data-loss paths (#2537).
 *
 * A live session continuously writes to its worktree — the working tree, and git's own
 * per-worktree HEAD/index/logs (a session runs git constantly) — so recent mtimes are
 * positive evidence the worktree is live regardless of what the record/pid say. A genuinely
 * completed or abandoned worktree stops being written to, so its activity ages past the
 * grace and it is still reclaimed exactly as before. Never throws; returns 0 when nothing
 * can be stat'd (an empty/gone dir contributes no false liveness).
 *
 * Deliberately shallow: a full recursive walk of a complete checkout every sweep would be
 * far too expensive. The working-tree root plus its immediate entries catch top-level churn,
 * and the per-worktree git dir's hot files catch the staging/commit activity a session leaves
 * even without top-level file changes.
 */
export function worktreeLastActivityMs(wtPath) {
  let newest = 0;
  const bump = (p) => {
    const m = safeMtimeMs(p);
    if (m > newest) newest = m;
  };
  try {
    if (!existsSync(wtPath)) return 0;
    bump(wtPath);
    let entries = [];
    try {
      entries = readdirSync(wtPath, { withFileTypes: true });
    } catch {}
    for (const e of entries) {
      // node_modules / dist are junctioned shared dirs (Git #1372) — their mtimes reflect
      // link creation or ANOTHER worktree's build, not this session's activity. Skip them.
      if (e.name === "node_modules") continue;
      bump(path.join(wtPath, e.name));
    }
    // A linked worktree's `.git` is a file `gitdir: <abs path>` pointing at
    // <git-common-dir>/worktrees/<id>/, where git writes HEAD/index/logs on every
    // status/add/commit/checkout — the signal a committing or staging session leaves
    // even when no top-level working-tree entry changed.
    const gitPointer = path.join(wtPath, ".git");
    bump(gitPointer);
    let gitDir = null;
    try {
      const raw = readFileSync(gitPointer, "utf8").trim();
      const m = /^gitdir:\s*(.+)$/m.exec(raw);
      if (m) gitDir = path.resolve(wtPath, m[1].trim());
    } catch {}
    if (gitDir) {
      bump(gitDir);
      for (const f of ["HEAD", "index", "ORIG_HEAD", "COMMIT_EDITMSG", "FETCH_HEAD", path.join("logs", "HEAD")]) {
        bump(path.join(gitDir, f));
      }
    }
  } catch {
    /* best effort — a stat/readdir failure must never make a live worktree look dead */
  }
  return newest;
}

/**
 * Git #3630 (Feature #3578, Multi-Repo Support) — every real local git checkout the
 * periodic sweep must inspect, not just `config.mainRepoRoot`. #3584 made the explicit,
 * by-name removal path (`removeWorktreeSafe` et al) resolve each worktree's OWN real
 * `repoRoot` (main repo, or a secondary/Tinker clone under the secondary-repos root),
 * but left the sweep's enumeration hardcoded to the main repo alone — a worktree
 * provisioned against a secondary clone was structurally invisible to it (found, not
 * fixed, by #3584; this closes it).
 *
 * Sources, deduped:
 *   1. `config.mainRepoRoot` — always swept, unconditionally (today's only root).
 *   2. every distinct `repoRoot` recorded on a tracked worktree (`listWorktreeRecords`)
 *      — covers any secondary clone with at least one live tracking record.
 *   3. every real git checkout directly under the secondary-repos root
 *      (`secondaryReposRoot`) — covers the case #3630's own issue body calls out: a
 *      worktree whose owning process died before ever writing/keeping a tracking
 *      record, so its clone has zero records pointing at it and (2) alone would still
 *      miss it entirely.
 *
 * Best-effort: an unreadable secondary-repos root contributes nothing (never throws),
 * since the main repo and every recorded repoRoot are already covered independently.
 */
export function repoRootsForSweep(config) {
  const roots = new Map(); // normalized path -> real path
  roots.set(normalizePath(config.mainRepoRoot), config.mainRepoRoot);

  for (const rec of listWorktreeRecords(config)) {
    if (rec.repoRoot) roots.set(normalizePath(rec.repoRoot), rec.repoRoot);
  }

  try {
    const secRoot = secondaryReposRoot(config.mainRepoRoot);
    if (existsSync(secRoot)) {
      for (const entry of readdirSync(secRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(secRoot, entry.name);
        if (isGitRepo(candidate)) roots.set(normalizePath(candidate), candidate);
      }
    }
  } catch {
    /* best effort — the main repo + recorded repoRoots above are still swept */
  }

  return [...roots.values()];
}

/**
 * Periodic / manual sweep: finds and removes worktrees not tied to active or recently-completed builds.
 *
 * Git #3630 — multi-repo-aware: inspects every real repo root from `repoRootsForSweep`
 * (the main repo, every recorded secondary/Tinker `repoRoot`, and every real clone under
 * the secondary-repos root), not just `config.mainRepoRoot`. Single-repo installs (no
 * secondary repo ever configured/provisioned) see `repoRootsForSweep` return exactly
 * `[config.mainRepoRoot]` — identical behavior to before this change.
 *
 * @param config      loadConfig() result
 * @param opts        { dryRun, maxAgeMs, force, all }
 */
export function sweepWorktrees(config, opts = {}) {
  const dryRun = !!opts.dryRun;
  const force = !!opts.force || !!opts.all;
  const maxAgeMs = opts.maxAgeMs ?? (30 * 60 * 1000); // 30 min active grace period by default
  const debugMaxAgeMs = opts.debugMaxAgeMs ?? (24 * 60 * 60 * 1000); // 24h debug grace period
  const now = Date.now();

  const repoRoots = repoRootsForSweep(config);
  // Each entry tagged with the real repoRoot `git worktree list` was run against, so an
  // untracked worktree (no tracking record) still resolves its OWN repo below instead of
  // silently falling back to the main repo.
  const allGitWorktrees = repoRoots.flatMap((repoRoot) =>
    listWorktrees(repoRoot).map((wt) => ({ ...wt, __repoRoot: repoRoot }))
  );
  const records = listWorktreeRecords(config);
  const recordByPath = new Map();
  for (const r of records) recordByPath.set(normalizePath(r.path), r);

  const normMain = normalizePath(config.mainRepoRoot);
  const normServer = normalizePath(config.serverWorktree);

  const candidates = [];
  const retained = [];
  const removed = [];

  for (const wt of allGitWorktrees) {
    const norm = normalizePath(wt.path);
    if (norm === normMain) continue; // Protected main repo
    if (norm === normServer) continue; // Protected dev-server

    const rec = recordByPath.get(norm);
    // Git #3630 — the worktree's OWN real repo: its tracking record's repoRoot if one
    // exists, else the repo root `git worktree list` actually found it under (never
    // always config.mainRepoRoot, which would misresolve a secondary-clone worktree
    // that lost its tracking record).
    const wtRepoRoot = rec?.repoRoot || wt.__repoRoot || config.mainRepoRoot;
    const isExplicitAgentBranch = wt.branch && wt.branch.startsWith("agent/");

    // Ownership gate (Git #1371): only worktrees THIS coordinator owns are ever
    // eligible for removal — one we tracked (has a record), or one on an `agent/*`
    // branch (created by provision-worktree.mjs). Anything else — a detached
    // harness worktree, a hand-made `git worktree add`, another tool's worktree — is
    // left strictly alone. Without this gate an untracked worktree fell straight
    // through to the removal-candidate list and could be deleted out from under a
    // live session that this sweep has no knowledge of.
    if (!rec && !isExplicitAgentBranch) {
      retained.push({ path: wt.path, reason: "not owned by dev-server (no tracking record, not an agent/* branch) — left alone" });
      continue;
    }

    // Check 1: Is creator PID alive?
    if (rec && rec.creatorPid && pidAlive(rec.creatorPid)) {
      retained.push({ path: wt.path, reason: `active creator PID ${rec.creatorPid}` });
      continue;
    }

    // Check 2: Is it inside the active grace period? Git #1971 — key this off the MOST RECENT
    // of createdAt / lastActiveAt, not createdAt alone. A long build whose owner pid has just
    // died (crash, or a session-limit park about to be resumed in place) is well past a
    // created-at grace, but its record was re-stamped (updateWorktreeRecord bumps lastActiveAt)
    // when it was provisioned/resumed — honouring that keeps a freshly-active worktree out of
    // the candidate list during the brief window before its resume re-attaches.
    //
    // Git #2537 — ALSO fold in real on-disk activity, and drop the `rec &&` requirement, so this
    // grace no longer depends on the tracking record existing or its stored owner-pid being the
    // live process. A live session continuously writes to its worktree; that on-disk evidence
    // retains it even when the record was lost/mismatched or the stamped pid is stale (the pid we
    // stamp is claude.exe's launcher, which can die while the real session keeps running under
    // another pid). This is the exact guarantee #2537 found violated — a live mid-build worktree
    // swept out from under a running session. A genuinely completed/abandoned worktree stops
    // being written to, so it still ages past the grace and is reclaimed exactly as before.
    const lastTouch = Math.max(
      rec?.createdAt || 0,
      rec?.lastActiveAt || 0,
      worktreeLastActivityMs(wt.path)
    );
    const keepForDebug = !!(rec && rec.keepForDebug);
    if (!keepForDebug && lastTouch > 0 && (now - lastTouch < maxAgeMs) && !force) {
      retained.push({ path: wt.path, reason: `active recently (${Math.round((now - lastTouch) / 1000)}s ago < grace ${Math.round(maxAgeMs / 1000)}s)` });
      continue;
    }

    // Check 3: Is it marked keepForDebug / stale?
    if (rec && rec.keepForDebug && !force) {
      if (now - (rec.lastActiveAt || rec.createdAt || 0) < debugMaxAgeMs) {
        retained.push({ path: wt.path, reason: `retained for debug: ${rec.debugReason || "stale"} (${Math.round((now - rec.createdAt) / 60000)}m old)` });
        continue;
      }
    }

    // Check if .stale-worktree.json exists on disk without record
    if (!force && existsSync(path.join(wt.path, ".stale-worktree.json"))) {
      try {
        const marker = JSON.parse(readFileSync(path.join(wt.path, ".stale-worktree.json"), "utf8"));
        if (now - (marker.markedStaleAt || 0) < debugMaxAgeMs) {
          retained.push({ path: wt.path, reason: `stale marker present: ${marker.reason || "debug"}` });
          continue;
        }
      } catch {}
    }

    // Check 4 (Git #1958): does this worktree still hold genuine uncommitted or unpushed
    // work? A worktree that reaches this point has a dead/inactive owner and no active-grace
    // retention — the exact profile of a PAUSED, resumable build whose owner pid died during
    // the pause. Removing it here (even with the #1971 rescue-to-branch that runs on removal)
    // tears down the precise tree a resumed build would reuse and hands the resumed session a
    // silently-clean checkout — which is the data-loss #1958 filed.
    //
    // So grant such a worktree ONE bounded debug window for resume: the first time we see it
    // holding work we mark it stale (starting the 24h debugMaxAgeMs clock Check 3 / the on-disk
    // marker check honour) and retain it. Reaching Check 4 while it is ALREADY parked (record
    // keepForDebug, or an on-disk stale marker) means that window has now expired — so we do
    // NOT re-mark (re-marking would reset lastActiveAt / markedStaleAt every sweep and leak the
    // worktree forever on the non-force path, defeating #2537). We let it fall through to
    // removal, which rescues the work to rescued/* first. `--force`/`--all` still reclaims
    // immediately, rescuing first, exactly as before.
    if (!force) {
      const alreadyParked =
        !!(rec && rec.keepForDebug) || existsSync(path.join(wt.path, ".stale-worktree.json"));
      if (!alreadyParked) {
        const work = detectWorktreeWork(config, wt.path, wtRepoRoot);
        if (work.hasWork) {
          const kind = work.dirty && work.unpushed ? "uncommitted+unpushed" : work.dirty ? "uncommitted" : "unpushed";
          if (!dryRun) {
            try {
              markWorktreeStale(config, rec ? rec.id : wt.path, {
                reason: `paused/resumable: still holds ${kind} work — retained for resume (Git #1958)`,
              });
            } catch {}
          }
          retained.push({ path: wt.path, reason: `holds ${kind} work — retained in place for resume (Git #1958)` });
          continue;
        }
      }
    }

    candidates.push({
      path: wt.path,
      branch: wt.branch,
      detached: wt.detached,
      record: rec,
      // Git #3630 — carried through even when there is no tracking record, so removal
      // below still targets the worktree's OWN real repo (main, or its secondary/Tinker
      // clone) instead of misresolving to config.mainRepoRoot for a recordless entry.
      repoRoot: wtRepoRoot,
    });
  }

  // Also check tracking records whose worktrees were deleted on disk but lingering in metadata
  for (const rec of records) {
    const norm = normalizePath(rec.path);
    if (!allGitWorktrees.some((w) => normalizePath(w.path) === norm)) {
      if (!dryRun) {
        removeWorktreeRecord(config, rec.id);
      }
    }
  }

  for (const c of candidates) {
    const reason = c.record?.debugReason
      ? `sweep: expired stale debug worktree (${c.record.debugReason})`
      : `sweep: orphaned agent worktree (PID dead or inactive)`;

    if (dryRun) {
      removed.push({ path: c.path, reason, dryRun: true });
    } else {
      try {
        const res = removeWorktreeSafe(config, c.path, {
          reason,
          force: true,
          deleteBranch: !!c.branch,
          // Git #3630 — only used as a fallback when c.record is absent (a recordless
          // agent/* worktree); removeWorktreeSafe still prefers the tracking record's
          // own repoRoot when one exists, unchanged from before this option existed.
          repoRootHint: c.repoRoot,
        });
        removed.push(res);
      } catch (e) {
        console.error(`[worktree-cleanup] Sweep failed for ${c.path}: ${e.message}`);
      }
    }
  }

  if (!dryRun) {
    // Git #3630 — prune every real repo root actually swept, not just the main repo, so
    // a secondary clone's own stale worktree-admin entries are cleared too.
    for (const repoRoot of repoRoots) {
      try { pruneWorktrees(repoRoot); } catch {}
    }
  }

  return {
    inspectedCount: allGitWorktrees.length,
    candidatesCount: candidates.length,
    removedCount: removed.length,
    retainedCount: retained.length,
    removed,
    retained,
    dryRun,
  };
}
