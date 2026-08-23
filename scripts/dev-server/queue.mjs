// scripts/dev-server/queue.mjs
//
// The request queue is a directory of small JSON files, one per pending
// restart request. This lets any agent enqueue WITHOUT taking the mutex: each
// writes its own uniquely-named file (write-temp-then-rename is atomic), so
// there is never a read-modify-write race on a shared queue.json.
//
// Lifecycle of one request file:
//   queue/<id>.json                 -- pending, written by the requesting agent
//   claimed/<id>.json               -- a cycle runner has taken it into a batch
//   claimed/<id>.done.json          -- the cycle finished; carries the outcome
//
// Waiters poll for claimed/<id>.done.json to learn their outcome without having
// to run a cycle themselves (this is the "join a batch, don't trigger a second
// restart" path).

import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  renameSync,
  existsSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";

function ensureDirs(config) {
  mkdirSync(config.queueDir, { recursive: true });
  mkdirSync(config.claimedDir, { recursive: true });
}

function writeAtomic(file, obj) {
  const tmp = `${file}.tmp-${process.pid}-${Math.floor(Math.random() * 1e9)}`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2));
  renameSync(tmp, file); // atomic on same volume
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Enqueue a restart request. Returns its id. */
export function enqueue(config, req) {
  ensureDirs(config);
  const id =
    req.id ||
    `${Date.now()}-${process.pid}-${Math.floor(Math.random() * 1e6)
      .toString(36)
      .padStart(4, "0")}`;
  const record = { id, enqueuedAt: Date.now(), ...req };
  writeAtomic(path.join(config.queueDir, `${id}.json`), record);
  return id;
}

/** All pending (unclaimed) requests, oldest first. */
export function listPending(config) {
  ensureDirs(config);
  return readdirSync(config.queueDir)
    .filter((f) => f.endsWith(".json") && !f.includes(".tmp-"))
    .map((f) => readJson(path.join(config.queueDir, f)))
    .filter(Boolean)
    .sort((a, b) => (a.enqueuedAt || 0) - (b.enqueuedAt || 0));
}

/**
 * Claim EVERY currently-pending request into the current batch by moving its
 * file queue/ -> claimed/. Atomic rename means a request that a concurrent
 * recovery already moved is simply skipped. Returns the reqs actually claimed.
 */
export function claimAllPending(config) {
  ensureDirs(config);
  const claimed = [];
  for (const req of listPending(config)) {
    const from = path.join(config.queueDir, `${req.id}.json`);
    const to = path.join(config.claimedDir, `${req.id}.json`);
    try {
      renameSync(from, to);
      claimed.push(req);
    } catch {
      // already moved (claimed elsewhere / recovered) -- skip
    }
  }
  return claimed;
}

/** Record a request's final outcome so waiters can pick it up. */
export function finalize(config, id, outcome) {
  writeAtomic(path.join(config.claimedDir, `${id}.done.json`), {
    id,
    finishedAt: Date.now(),
    ...outcome,
  });
}

/** Read a request's outcome if its cycle has finished, else null. */
export function outcomeFor(config, id) {
  const f = path.join(config.claimedDir, `${id}.done.json`);
  return existsSync(f) ? readJson(f) : null;
}

/**
 * After a stale lock is broken, move any claimed-but-not-done requests back to
 * the pending queue so the next cycle re-processes them. Guards against a
 * crashed runner permanently swallowing requests.
 */
export function recoverOrphans(config) {
  ensureDirs(config);
  let recovered = 0;
  for (const f of readdirSync(config.claimedDir)) {
    if (!f.endsWith(".json") || f.endsWith(".done.json")) continue;
    const id = f.slice(0, -".json".length);
    if (existsSync(path.join(config.claimedDir, `${id}.done.json`))) continue;
    try {
      renameSync(
        path.join(config.claimedDir, f),
        path.join(config.queueDir, f)
      );
      recovered++;
    } catch {
      /* raced -- fine */
    }
  }
  return recovered;
}

/** Delete .done markers older than maxAgeMs to keep claimed/ from growing. */
export function cleanup(config, maxAgeMs = 60 * 60 * 1000) {
  ensureDirs(config);
  const now = Date.now();
  for (const f of readdirSync(config.claimedDir)) {
    const full = path.join(config.claimedDir, f);
    try {
      if (now - statSync(full).mtimeMs > maxAgeMs) rmSync(full, { force: true });
    } catch {
      /* ignore */
    }
  }
}
