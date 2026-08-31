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
import { scanSharedStore } from "./store-doctor.mjs";

// markWorktreeStale() drops this untracked marker into a retained worktree; it is
// BuildConsole bookkeeping, never real work, so preservation must not count it as "dirty".
const STALE_MARKER_NAME = ".stale-worktree.json";

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
export function preserveWorktreeWork(config, wtPath, rec) {
  try {
    if (!existsSync(wtPath) || !isGitRepo(wtPath)) {
      return { preserved: false, reason: "path gone or not a git worktree" };
    }

    // Uncommitted changes (the stale-debug marker is BuildConsole bookkeeping, not real work).
    const status = git(wtPath, ["status", "--porcelain"]);
    const dirtyLines = (status.stdout || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .filter((l) => !l.endsWith(STALE_MARKER_NAME));
    const dirty = status.code === 0 && dirtyLines.length > 0;

    // Unpushed commits: the branch tip isn't yet an ancestor of the base ref (origin/main).
    // If the base can't be resolved, err toward preserving rather than discarding.
    const head = revParse(wtPath, "HEAD");
    const base =
      resolveCommit(config.mainRepoRoot, config.baseRef) ||
      revParse(config.mainRepoRoot, config.baseRef);
    const unpushed = head ? (base ? !isAncestor(wtPath, head, base) : true) : false;

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

    // 2. Stamp a durable rescue branch at the (post-WIP) tip so branch-delete can't orphan it.
    const tip = revParse(wtPath, "HEAD");
    let rescueBranch = null;
    if (tip) {
      const safe = sanitizeId(rec?.name || path.basename(wtPath));
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const ref = `refs/heads/rescued/${safe}-${ts}`;
      const u = git(config.mainRepoRoot, ["update-ref", ref, tip]);
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
export function removeWorktreeSafe(config, nameOrPath, { reason = "completed build", force = true, deleteBranch: shouldDeleteBranch = true } = {}) {
  const rec = getWorktreeRecord(config, nameOrPath);
  const wtPath = rec ? rec.path : path.resolve(nameOrPath);
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
  const preservation = preserveWorktreeWork(config, wtPath, rec);

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
    const r = removeWorktree(config.mainRepoRoot, wtPath, { force: true });
    gitRemoveOk = r.code === 0;
  } catch {}

  // Prune git worktrees
  try {
    pruneWorktrees(config.mainRepoRoot);
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
      const res = deleteBranch(config.mainRepoRoot, branchName, { force: true });
      if (res.code === 0) branchDeleted = branchName;
    } catch {}
  }

  // Remove tracking record
  removeWorktreeRecord(config, nameOrPath);

  // Git #1988 — canary: after every removal, verify the SHARED store still resolves
  // inside the main checkout (per #1964's post-cleanup verification suggestion). This
  // pins the timeline of any future poisoning to the removal that exposed it, in the
  // durable cleanups.log, instead of surfacing a session later. Detection only —
  // repair is exclusively the explicit `store-doctor.mjs --repair` operation.
  let storeAfterRemoval = null;
  try {
    const scan = scanSharedStore(config.mainRepoRoot);
    storeAfterRemoval = {
      clean: scan.clean,
      foreign: scan.foreignLinks.length,
      dangling: scan.danglingLinks.length,
      poisonedBins: scan.poisonedBins.length,
    };
    if (!scan.clean) {
      console.warn(
        `[worktree-cleanup] WARNING: shared store at ${config.mainRepoRoot} is POISONED after removing ${wtPath} ` +
          `(foreign=${scan.foreignLinks.length}, dangling=${scan.danglingLinks.length}, poisonedBins=${scan.poisonedBins.length}). ` +
          `Diagnose with: node scripts/dev-server/store-doctor.mjs (Git #1988)`
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
  };
}

/**
 * Periodic / manual sweep: finds and removes worktrees not tied to active or recently-completed builds.
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

  const allGitWorktrees = listWorktrees(config.mainRepoRoot);
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
    const lastTouch = Math.max(rec?.createdAt || 0, rec?.lastActiveAt || 0);
    if (rec && !rec.keepForDebug && (now - lastTouch < maxAgeMs) && !force) {
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

    candidates.push({
      path: wt.path,
      branch: wt.branch,
      detached: wt.detached,
      record: rec,
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
        });
        removed.push(res);
      } catch (e) {
        console.error(`[worktree-cleanup] Sweep failed for ${c.path}: ${e.message}`);
      }
    }
  }

  if (!dryRun) {
    try { pruneWorktrees(config.mainRepoRoot); } catch {}
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
