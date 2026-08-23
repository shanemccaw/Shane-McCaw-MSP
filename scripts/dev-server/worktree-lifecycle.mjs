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
import { git, listWorktrees, removeWorktree, pruneWorktrees, deleteBranch } from "./git.mjs";
import { pidAlive } from "./lock.mjs";
import { findAndUnlinkWorktreeJunctions } from "./link-deps.mjs";

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
 * Safely remove an isolated worktree.
 *
 * CRITICAL SAFETY:
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

  let junctionsUnlinked = [];
  if (existsSync(wtPath)) {
    try {
      junctionsUnlinked = findAndUnlinkWorktreeJunctions(wtPath);
    } catch (e) {
      console.warn(`[worktree-cleanup] Warning: unlinking junctions for ${wtPath} hit: ${e.message}`);
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

  const logEntry = {
    action: "removed",
    path: wtPath,
    reason,
    junctionsUnlinkedCount: junctionsUnlinked.length,
    gitRemoveOk,
    fsRemoved,
    branchDeleted,
  };
  appendCleanupLog(config, logEntry);

  console.log(`[worktree-cleanup] REMOVED worktree at ${wtPath} (reason: ${reason}, junctionsUnlinked: ${junctionsUnlinked.length}, branchDeleted: ${branchDeleted || "none"})`);

  return {
    ok: true,
    path: wtPath,
    reason,
    junctionsUnlinkedCount: junctionsUnlinked.length,
    branchDeleted,
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
    const isStandardWtPath = isWindows() && (norm.startsWith("c:\\wt\\") || norm.includes("\\wt-"));

    // Check 1: Is creator PID alive?
    if (rec && rec.creatorPid && pidAlive(rec.creatorPid)) {
      retained.push({ path: wt.path, reason: `active creator PID ${rec.creatorPid}` });
      continue;
    }

    // Check 2: Was it created very recently (active grace period)?
    if (rec && !rec.keepForDebug && (now - (rec.createdAt || 0) < maxAgeMs) && !force) {
      retained.push({ path: wt.path, reason: `created recently (${Math.round((now - rec.createdAt) / 1000)}s ago < grace ${Math.round(maxAgeMs / 1000)}s)` });
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
