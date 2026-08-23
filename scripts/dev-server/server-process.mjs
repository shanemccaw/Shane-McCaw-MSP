// scripts/dev-server/server-process.mjs
//
// Owns the real local dev server PROCESS: launching scripts/dev-all.mjs from the
// dedicated server worktree, stopping it, and restarting it. The launcher pid is
// tracked in server.json so restarts kill exactly THAT process tree by pid --
// never a blanket kill-by-name, which would take out other agents' node/vite
// processes (same discipline as "never blanket-kill BuildConsole.exe by name").

import { spawn, execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { pidAlive } from "./lock.mjs";
import { isWindows } from "./config.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function readServerMeta(config) {
  try {
    return JSON.parse(readFileSync(config.serverMetaFile, "utf8"));
  } catch {
    return null;
  }
}

function writeServerMeta(config, meta) {
  mkdirSync(path.dirname(config.serverMetaFile), { recursive: true });
  writeFileSync(config.serverMetaFile, JSON.stringify(meta, null, 2));
}

/** Kill a whole process tree by pid, cross-platform. */
function killTree(pid) {
  if (!pidAlive(pid)) return;
  try {
    if (isWindows()) {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } else {
      try {
        process.kill(-pid, "SIGTERM"); // process group
      } catch {
        process.kill(pid, "SIGTERM");
      }
    }
  } catch {
    /* already gone / partial -- verified by pidAlive polling below */
  }
}

/** Stop the tracked dev-all process (if any). Returns the pid it stopped, or null. */
export async function stopServer(config) {
  const meta = readServerMeta(config);
  const pid = meta?.pid;
  if (!pid || !pidAlive(pid)) return null;
  killTree(pid);
  const deadline = Date.now() + config.restartStopTimeoutMs;
  while (pidAlive(pid) && Date.now() < deadline) await sleep(200);
  if (pidAlive(pid)) killTree(pid); // second, forceful attempt
  return pid;
}

/**
 * scripts/dev-all.mjs is git-excluded on this machine (.git/info/exclude), so a
 * freshly-created server worktree does NOT contain it. Copy the main checkout's
 * launcher into the server worktree before launching (and on every restart, so
 * the server always runs the current launcher). dev-all.mjs resolves its
 * repoRoot from its own location, so a copy inside the worktree makes it launch
 * the SERVER checkout -- exactly the isolation we want.
 */
export function ensureLauncher(config) {
  const src = path.join(config.mainRepoRoot, "scripts", "dev-all.mjs");
  const dest = config.devAllPath;
  if (existsSync(dest) && !existsSync(src)) return; // already present, nothing to copy from
  if (!existsSync(src)) {
    throw new Error(
      `dev-all launcher not found at ${src} (and not in the server worktree). Cannot start the dev server.`
    );
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}

/**
 * Launch scripts/dev-all.mjs from the server worktree, detached, with its
 * output going to the shared log dir (dev-all.mjs writes files itself; we also
 * point DEV_ALL_LOG_DIR at the stable machine-wide location). Records pid +
 * log paths in server.json. Returns the new pid.
 */
export function startServer(config) {
  ensureLauncher(config);
  mkdirSync(config.devAllLogDir, { recursive: true });
  const child = spawn(process.execPath, [config.devAllPath], {
    cwd: config.serverWorktree,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      DEV_ALL_LOG_DIR: config.devAllLogDir,
      // Dev tier only -- make the tier explicit to anything that reads it.
      APP_ENV: "dev",
      NODE_ENV: "development",
    },
  });
  child.unref();
  const meta = {
    pid: child.pid,
    startedAt: Date.now(),
    serverWorktree: config.serverWorktree,
    serverBranch: config.serverBranch,
    devAllPath: config.devAllPath,
    logDir: config.devAllLogDir,
    logFile: path.join(config.devAllLogDir, "dev-all.log"),
    apiPort: config.apiPort,
  };
  writeServerMeta(config, meta);
  return child.pid;
}

/**
 * Perform a real health check on the dev api-server:
 *   1. Check process liveness (PID alive).
 *   2. Attempt HTTP GET /api/health or HTTP GET / with a short timeout.
 *   3. Fallback to TCP port connection check.
 */
export async function checkServerHealth(config, pid) {
  if (pid && !pidAlive(pid)) {
    return { ok: false, error: `Dev server process ${pid} died / crashed on startup` };
  }

  // 1. HTTP GET check (health endpoint or root)
  try {
    const url = `http://127.0.0.1:${config.apiPort}/api/health`;
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    if (res.status < 500) {
      return { ok: true, status: res.status, url };
    }
    return { ok: false, error: `HTTP health check at ${url} returned status ${res.status}` };
  } catch (httpErr) {
    // 2. Secondary fallback: check TCP port connectivity
    const tcpOk = await new Promise((resolve) => {
      const sock = net.connect(config.apiPort, "127.0.0.1");
      const done = (v) => {
        sock.destroy();
        resolve(v);
      };
      sock.once("connect", () => done(true));
      sock.once("error", () => done(false));
      sock.setTimeout(1500, () => done(false));
    });

    if (tcpOk) {
      return { ok: true, note: "TCP connect ok" };
    }

    if (pid && !pidAlive(pid)) {
      return { ok: false, error: `Dev server process ${pid} exited during health check` };
    }

    return { ok: false, error: `Connection refused on port ${config.apiPort}: ${httpErr.message}` };
  }
}

/**
 * Wait for dev server readiness with fast-fail detection if the spawned PID dies.
 * Returns { ready: boolean, elapsedMs: number, error?: string }
 */
export async function waitForReady(config, pid = null) {
  const start = Date.now();
  const deadline = start + config.readyTimeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    const targetPid = pid || readServerMeta(config)?.pid;
    if (targetPid && !pidAlive(targetPid)) {
      return {
        ready: false,
        elapsedMs: Date.now() - start,
        error: `Dev server process ${targetPid} crashed or exited during startup`,
      };
    }

    const health = await checkServerHealth(config, targetPid);
    if (health.ok) {
      return { ready: true, elapsedMs: Date.now() - start };
    }
    lastError = health.error;
    await sleep(500);
  }

  return {
    ready: false,
    elapsedMs: Date.now() - start,
    error: lastError || `Readiness check timed out after ${config.readyTimeoutMs}ms`,
  };
}

/**
 * The real restart action injected into the coordinator: stop the tracked
 * process, start a fresh one, wait for readiness. Returns a summary.
 */
export async function restartServer(config) {
  const oldPid = await stopServer(config);
  const newPid = startServer(config);
  const readyRes = await waitForReady(config, newPid);
  return {
    oldPid: oldPid || null,
    newPid,
    ready: readyRes.ready,
    elapsedMs: readyRes.elapsedMs,
    error: readyRes.ready ? null : readyRes.error,
  };
}
