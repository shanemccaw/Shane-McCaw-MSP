// scripts/dev-server/config.mjs
//
// Central configuration for the LOCAL Dev-tier server-restart coordinator.
//
// This subsystem exists because up to ~8 concurrent Claude Code agents now
// write against a LOCAL dev server. If two agents wrote into the SAME shared
// working directory the dev server runs from, one agent's mid-edit,
// half-written change could be picked up by another agent's restart trigger,
// crashing the server or running genuinely corrupted code. A remote git push
// is atomic (no one sees it mid-edit); direct filesystem writes into a shared
// dir are not. So:
//
//   1. Every agent works in its OWN isolated git worktree.
//   2. The dev server runs from its OWN dedicated worktree/branch, launched
//      via scripts/dev-all.mjs.
//   3. On build-complete, an agent's committed worktree changes are MERGED
//      into the server's dedicated checkout, the server PROCESS is restarted,
//      and the merge is CONFIRMED with real git commands.
//   4. A mutex serializes merge+restart+confirm. Requests that arrive while a
//      cycle is running coalesce (CI-style batching) into a single restart.
//
// This mechanism is Dev (local) ONLY. Staging (Replit) / Production use their
// own separate mechanisms and are never touched here.
//
// All coordination STATE is anchored to the git *common dir* so that every
// agent worktree of this repo resolves to the exact same shared location --
// `git rev-parse --git-common-dir` returns the same absolute .git for the main
// checkout and every linked worktree. That is what makes cross-worktree
// coordination actually work: an agent in C:\bw and an agent in C:\bc-wt both
// read/write the same lock, queue and cycle log.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";

function gitCommonDirAbs(cwd) {
  try {
    const out = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd,
      encoding: "utf8",
    }).trim();
    // For the main worktree git returns a relative ".git"; for linked
    // worktrees it returns the main repo's absolute .git path. Resolve both to
    // an absolute path against the invoking cwd.
    return path.resolve(cwd, out);
  } catch {
    return null;
  }
}

/**
 * Resolve the full coordinator configuration.
 *
 * Every field can be overridden by an environment variable so the exact same
 * code path can be exercised against a throwaway temp repo by selftest.mjs
 * without ever touching the real dev server or the real checkout.
 */
export function loadConfig({ cwd = process.cwd() } = {}) {
  // --- Main repo root (the checkout that owns the shared .git) ---
  let mainRepoRoot = process.env.DEV_SERVER_MAIN_ROOT || null;
  if (!mainRepoRoot) {
    const commonDir = gitCommonDirAbs(cwd);
    if (commonDir) {
      mainRepoRoot =
        path.basename(commonDir) === ".git" ? path.dirname(commonDir) : commonDir;
    }
  }
  if (!mainRepoRoot) mainRepoRoot = cwd;

  // --- Shared coordination state (git-ignored via .logs/) ---
  const stateDir =
    process.env.DEV_SERVER_STATE_DIR ||
    path.join(mainRepoRoot, ".logs", "dev-server");

  // --- The dedicated checkout the local dev server actually runs from ---
  // Short path by convention on this machine (deep Design/_ds/... tree blows
  // past Windows MAX_PATH from a long root -- see memory notes).
  const serverWorktree =
    process.env.DEV_SERVER_WORKTREE ||
    (process.platform === "win32"
      ? "C:\\dev-server"
      : path.join(path.dirname(mainRepoRoot), "dev-server"));

  const serverBranch = process.env.DEV_SERVER_BRANCH || "dev-server";

  // Base ref new work is expected to branch from / the server tracks.
  const baseRef = process.env.DEV_SERVER_BASE_REF || "origin/main";

  // Where dev-all.mjs writes its server logs. A stable, machine-wide path so
  // ANY agent (in any worktree) can read live server output.
  const devAllLogDir =
    process.env.DEV_ALL_LOG_DIR || path.join(mainRepoRoot, ".logs", "dev-all");

  // The dev-all.mjs launched for the server -- the copy inside the server
  // worktree (worktrees carry all tracked files, so it exists there).
  const devAllPath =
    process.env.DEV_ALL_PATH ||
    path.join(serverWorktree, "scripts", "dev-all.mjs");

  return {
    mainRepoRoot,
    stateDir,
    // state sub-paths
    lockDir: path.join(stateDir, "lock"),
    queueDir: path.join(stateDir, "queue"),
    claimedDir: path.join(stateDir, "claimed"),
    worktreesDir: path.join(stateDir, "worktrees"),
    needsAttentionDir: path.join(stateDir, "needs-attention"),
    cyclesLog: path.join(stateDir, "cycles.log"),
    cleanupsLog: path.join(stateDir, "cleanups.log"),
    rollbacksLog: path.join(stateDir, "rollbacks.log"),
    currentCycleFile: path.join(stateDir, "current-cycle.json"),
    serverMetaFile: path.join(stateDir, "server.json"),
    restartsLog: path.join(stateDir, "restarts.log"), // used by fake-restart selftest

    // server checkout
    serverWorktree,
    serverBranch,
    baseRef,
    devAllPath,
    devAllLogDir,
    apiPort: Number(process.env.DEV_API_PORT || 8080),

    // lock / timing knobs (ms)
    heartbeatMs: Number(process.env.DEV_SERVER_HEARTBEAT_MS || 1500),
    staleLockMs: Number(process.env.DEV_SERVER_STALE_LOCK_MS || 90_000),
    acquireBackoffMs: Number(process.env.DEV_SERVER_ACQUIRE_BACKOFF_MS || 400),
    maxWaitMs: Number(process.env.DEV_SERVER_MAX_WAIT_MS || 600_000),
    restartStopTimeoutMs: Number(process.env.DEV_SERVER_STOP_TIMEOUT_MS || 20_000),
    readyTimeoutMs: Number(process.env.DEV_SERVER_READY_TIMEOUT_MS || 45_000),

    // when set, the coordinator records restarts to restartsLog instead of
    // killing/relaunching a real server process (selftest / dry safety).
    fakeRestart: process.env.DEV_SERVER_FAKE_RESTART === "1",

    // whether an actual server checkout exists on disk right now
    serverWorktreeExists: existsSync(serverWorktree),
  };
}

export function isWindows() {
  return process.platform === "win32";
}
