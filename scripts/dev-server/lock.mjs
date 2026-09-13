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

import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// Git #3020: the winner of the atomic `mkdirSync(lockDir)` race writes owner.json
// as a SEPARATE, non-atomic follow-up syscall (see tryAcquire's `write()`). Between
// those two syscalls there is a real window -- wider than it sounds under real
// cross-process contention plus Windows filesystem/AV latency -- where lockDir
// exists but owner.json does not yet. A second process's tryAcquire landing in that
// window read `owner === null` and (before this fix) treated that as unconditionally
// stale, breaking the winner's brand-new lock and creating its own -- leaving TWO
// processes believing they hold the mutex, which is exactly the concurrent
// index.lock / update_ref races selftest.mjs Scenarios 3 and 9 hit. This grace
// window is what closes it: a missing owner.json is only "stale" once the lock DIR
// itself is older than the grace period, not the instant it's observed empty.
const NEW_LOCK_GRACE_MS = 2000;

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

function isStale(owner, staleLockMs, lockDir) {
  if (!owner) {
    // lock dir exists but no/garbage owner.json. This is either a genuinely
    // orphaned lock (a holder that crashed between mkdirSync and its owner.json
    // write) or -- far more commonly under real contention -- we're simply
    // observing another live process a few milliseconds into that same window,
    // still on its way to writing owner.json. Use the lock DIRECTORY's own age
    // (not the missing file's) to tell them apart: only treat it as stale once
    // the dir has existed longer than a short grace period. Within the grace
    // period, report "held" so the caller backs off and retries instead of
    // breaking a lock someone else just won (Git #3020).
    let dirAgeMs = Infinity;
    try {
      dirAgeMs = Date.now() - statSync(lockDir).birthtimeMs;
      // Some filesystems don't populate birthtime; fall back to mtime.
      if (!Number.isFinite(dirAgeMs) || dirAgeMs < 0) {
        dirAgeMs = Date.now() - statSync(lockDir).mtimeMs;
      }
    } catch {
      return true; // lockDir itself vanished mid-check -> nothing to protect
    }
    return dirAgeMs > NEW_LOCK_GRACE_MS;
  }
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
    if (!isStale(owner, staleLockMs, lockDir)) return null; // genuinely held
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
  return !isStale(readOwnerRaw(config.lockDir), config.staleLockMs, config.lockDir);
}
