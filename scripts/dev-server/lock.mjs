// scripts/dev-server/lock.mjs
//
// A real cross-process mutex, implemented with an atomic directory create.
// `fs.mkdirSync` is atomic on Windows and POSIX -- exactly one caller can win
// the create; everyone else gets EEXIST. The winner is the single "cycle
// runner" allowed to merge+restart+confirm at a time.
//
// Robustness: the holder writes owner.json with its pid and a heartbeat that a
// timer keeps fresh. If a would-be acquirer finds the lock held by a DEAD pid,
// or by a live pid whose heartbeat has gone stale (holder hung/crashed), it
// breaks the lock and recovers -- so a crashed agent can never wedge the whole
// fleet forever.

import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

function ownerPath(lockDir) {
  return path.join(lockDir, "owner.json");
}

function readOwnerRaw(lockDir) {
  try {
    return JSON.parse(readFileSync(ownerPath(lockDir), "utf8"));
  } catch {
    return null;
  }
}

export function readOwner(lockDir) {
  return readOwnerRaw(lockDir);
}

/** Is a pid alive on this machine? EPERM means "exists but not ours" => alive. */
export function pidAlive(pid) {
  if (!pid || typeof pid !== "number") return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

function isStale(owner, staleLockMs) {
  if (!owner) return true; // lock dir exists but no/garbage owner.json => stale
  // Different machine? We can't check its pid; fall back to heartbeat age only.
  const sameHost = owner.host === os.hostname();
  if (sameHost && owner.pid && !pidAlive(owner.pid)) return true;
  const age = Date.now() - (owner.heartbeatAt || owner.startedAt || 0);
  return age > staleLockMs;
}

/**
 * Try ONCE to acquire the lock (non-blocking).
 * Returns a handle { release, update, recovered, owner } on success, or null if
 * the lock is currently held by a live, non-stale holder.
 *
 * `onBreak(orphanedOwner)` (optional) is called synchronously right after a
 * stale lock is broken, before we re-create it -- the coordinator uses this to
 * recover orphaned in-flight requests.
 */
export function tryAcquire(config, { cycleId = null, onBreak } = {}) {
  const { lockDir, staleLockMs, heartbeatMs } = config;
  let recovered = false;

  const attemptCreate = () => {
    // Ensure the PARENT (state dir) exists, but create lockDir itself with
    // recursive:false so the atomic "exactly one winner / EEXIST" mutex semantics
    // are preserved. (Without this, a caller that takes the lock before anything
    // else has created the state dir -- e.g. the build-set path -- would ENOENT.)
    mkdirSync(path.dirname(lockDir), { recursive: true });
    mkdirSync(lockDir, { recursive: false });
  };

  try {
    attemptCreate();
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    // Held -- decide if it's stale.
    const owner = readOwnerRaw(lockDir);
    if (!isStale(owner, staleLockMs)) return null; // genuinely held
    // Break the stale lock and take it over.
    try {
      if (typeof onBreak === "function") onBreak(owner);
    } catch {
      /* recovery best-effort */
    }
    try {
      rmSync(lockDir, { recursive: true, force: true });
    } catch {
      /* someone else may be breaking it too */
    }
    try {
      attemptCreate();
    } catch (e2) {
      if (e2.code === "EEXIST") return null; // lost the break race
      throw e2;
    }
    recovered = true;
  }

  const startedAt = Date.now();
  const write = (extra = {}) =>
    writeFileSync(
      ownerPath(lockDir),
      JSON.stringify(
        {
          pid: process.pid,
          host: os.hostname(),
          cycleId,
          startedAt,
          heartbeatAt: Date.now(),
          ...extra,
        },
        null,
        2
      )
    );
  write();

  const timer = setInterval(() => {
    try {
      write();
    } catch {
      /* ignore transient write errors */
    }
  }, heartbeatMs);

  let released = false;
  return {
    recovered,
    lockDir,
    update: (extra) => {
      try {
        write(extra);
      } catch {
        /* ignore */
      }
    },
    release: () => {
      if (released) return;
      released = true;
      clearInterval(timer);
      try {
        rmSync(lockDir, { recursive: true, force: true });
      } catch {
        /* already gone */
      }
    },
  };
}

/** Is the lock currently held by a live, non-stale holder? */
export function isHeld(config) {
  if (!existsSync(config.lockDir)) return false;
  return !isStale(readOwnerRaw(config.lockDir), config.staleLockMs);
}
