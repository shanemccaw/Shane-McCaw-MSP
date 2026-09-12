#!/usr/bin/env node
// scripts/dev-server/restart-hold.mjs
//
// ADVISORY, BOUNDED restart holds -- Git #1855.
//
// Evidence this exists to fix: #1793's app-only PowerShell capability survey ran
// for over an hour against the local api-server. A concurrent build finished
// part-way through and the coordinator restarted the server underneath it --
// `.logs/dev-all/dev-all.log` showed a 510-second window where the api-server was
// simply gone. Every request in that window failed with a raw
// `TypeError: fetch failed`, and the survey's first run recorded 36 of those
// transport failures as if they were real per-cmdlet results. The driver has
// since grown its own bespoke retry loop (`ps-capability-survey.ts`,
// `ApiServerUnreachableError`) -- this module is the GENERAL version of that so
// every other agent calling the local api-server doesn't have to rediscover it.
//
// A long-running agent task can register that it is mid-flight, so the
// coordinator's restart step (coordinator.mjs, right before it fires
// deps.restart()) waits -- BOUNDED, never indefinitely -- for the hold to clear
// before tearing the server down. This is the ad-hoc-task counterpart to
// buildset.mjs's --buildSet deferral: a build set is a KNOWN, declared group of
// builds; a restart hold is any agent process announcing "I'm mid-flight, please
// don't restart out from under me right now" without needing to be part of a set.
//
// Bounded by design (never wedge the fleet -- same discipline as lock.mjs's
// stale-lock recovery, and the same reason config.restartHoldMaxWaitMs exists in
// coordinator.mjs): every hold carries a TTL. A hold whose heartbeat has gone
// older than its own TTL is treated as abandoned/expired and is ignored by the
// coordinator (and swept on the next read) -- a crashed or forgotten hold can
// never block a restart forever. Multiple independent holds can be active at
// once (unlike lock.mjs's single mutex); ANY unexpired hold defers the wait.
//
//   node scripts/dev-server/restart-hold.mjs acquire <name> [--ttl-ms N] [--holder H]
//   node scripts/dev-server/restart-hold.mjs renew   <name>
//   node scripts/dev-server/restart-hold.mjs release <name>
//   node scripts/dev-server/restart-hold.mjs status  [<name>] [--json]
//
// A one-shot CLI call is enough for short work; a long-running process should
// re-acquire (renew) on its own cadence -- e.g. #1793's survey calls the
// api-server every few seconds, so renewing once per call comfortably beats the
// default 10-minute TTL.

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, renameSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.mjs";

function safeHoldName(name) {
  return String(name).trim().replace(/[^\w.-]+/g, "_").slice(0, 200) || "_";
}

function ensureDir(config) {
  mkdirSync(config.restartHoldsDir, { recursive: true });
}

export function holdPath(config, name) {
  return path.join(config.restartHoldsDir, `${safeHoldName(name)}.json`);
}

export function readHold(config, name) {
  const f = holdPath(config, name);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return null;
  }
}

// Atomic write (temp-file + rename), same pattern as queue.mjs/buildset.mjs/lock.mjs
// (Git #3068 class). A plain truncate-then-write leaves a window where a reader can
// see a torn/partial file; JSON.parse on that fails, and isExpired(null) treats a
// parse failure as "no hold => expired," making an active hold look expired (#1855).
function writeHold(config, name, hold) {
  ensureDir(config);
  const file = holdPath(config, name);
  const tmp = `${file}.tmp-${process.pid}-${Math.floor(Math.random() * 1e9)}`;
  writeFileSync(tmp, JSON.stringify(hold, null, 2));
  renameSync(tmp, file); // atomic on same volume
  return hold;
}

/** Is this hold's heartbeat older than its own TTL? (No hold => expired.) */
export function isExpired(hold, now = Date.now()) {
  if (!hold) return true;
  const age = now - (hold.heartbeatAt || hold.acquiredAt || 0);
  return age > (hold.ttlMs || 0);
}

/**
 * Register (or renew) a hold. Idempotent by name -- acquiring an existing hold
 * just refreshes its heartbeat/TTL/holder, the same heartbeat discipline
 * lock.mjs uses for the mutex owner. Returns a plain record, not a live handle:
 * the CLI is one-shot, and a long-running caller renews by acquiring/renewing
 * again on its own cadence rather than holding a timer open.
 */
export function acquireHold(config, name, { ttlMs, holder } = {}) {
  const now = Date.now();
  const existing = readHold(config, name);
  const hold = {
    name: String(name),
    holder: holder || existing?.holder || `${os.hostname()}#${process.pid}`,
    pid: process.pid,
    acquiredAt: existing?.acquiredAt || now,
    heartbeatAt: now,
    ttlMs: ttlMs != null ? Number(ttlMs) : existing?.ttlMs || config.restartHoldDefaultTtlMs,
  };
  return writeHold(config, name, hold);
}

/** Refresh an EXISTING hold's heartbeat (keeping its holder/ttl). Returns null
 * if there is nothing to renew -- callers should acquire() first. */
export function renewHold(config, name) {
  const existing = readHold(config, name);
  if (!existing) return null;
  return acquireHold(config, name, { ttlMs: existing.ttlMs, holder: existing.holder });
}

export function releaseHold(config, name) {
  try {
    rmSync(holdPath(config, name), { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Every UNEXPIRED hold right now. Best-effort sweeps expired hold files it
 * encounters along the way so stale JSON doesn't accumulate forever -- mirrors
 * lock.mjs's stale-lock breaking, just for a directory of many holds instead of
 * one mutex.
 */
export function activeHolds(config) {
  if (!existsSync(config.restartHoldsDir)) return [];
  const now = Date.now();
  const out = [];
  for (const f of readdirSync(config.restartHoldsDir)) {
    if (!f.endsWith(".json")) continue;
    const full = path.join(config.restartHoldsDir, f);
    let hold;
    try {
      hold = JSON.parse(readFileSync(full, "utf8"));
    } catch {
      continue;
    }
    if (isExpired(hold, now)) {
      try {
        rmSync(full, { force: true });
      } catch {
        /* best effort */
      }
      continue;
    }
    out.push(hold);
  }
  return out;
}

// --------------------------------------------------------------------------- CLI
function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--json") a.json = true;
    else if (t === "--ttl-ms") a.ttlMs = Number(argv[++i]);
    else if (t === "--holder") a.holder = argv[++i];
    else a._.push(t);
  }
  return a;
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const a = parseArgs(argv.slice(1));
  const config = loadConfig({ cwd: process.cwd() });
  const name = a._[0];

  switch (cmd) {
    case "acquire": {
      if (!name) throw new Error("usage: restart-hold.mjs acquire <name> [--ttl-ms N] [--holder H]");
      const hold = acquireHold(config, name, { ttlMs: a.ttlMs, holder: a.holder });
      console.log(`[restart-hold] acquired '${hold.name}' ttlMs=${hold.ttlMs} holder=${hold.holder}`);
      if (a.json) console.log(JSON.stringify(hold, null, 2));
      break;
    }
    case "renew": {
      if (!name) throw new Error("usage: restart-hold.mjs renew <name>");
      const hold = renewHold(config, name);
      if (!hold) {
        console.error(`[restart-hold] '${name}' not found (expired or never acquired) -- nothing to renew`);
        process.exit(1);
      }
      console.log(`[restart-hold] renewed '${hold.name}' heartbeatAt=${new Date(hold.heartbeatAt).toISOString()}`);
      break;
    }
    case "release": {
      if (!name) throw new Error("usage: restart-hold.mjs release <name>");
      const released = releaseHold(config, name);
      console.log(`[restart-hold] ${released ? "released" : "was not held"} '${name}'`);
      break;
    }
    case "status": {
      const holds = activeHolds(config).filter((h) => !name || h.name === name);
      if (a.json) {
        console.log(JSON.stringify(holds, null, 2));
      } else if (holds.length === 0) {
        console.log("(no active restart holds)");
      } else {
        for (const h of holds) {
          const expiresIn = Math.max(0, h.heartbeatAt + h.ttlMs - Date.now());
          console.log(`[restart-hold] ${h.name} holder=${h.holder} expires in ${Math.round(expiresIn / 1000)}s`);
        }
      }
      break;
    }
    default:
      console.log("usage: restart-hold.mjs <acquire|renew|release|status> <name> [flags]");
      process.exit(cmd ? 1 : 0);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(`[restart-hold] ERROR ${err.stack || err}`);
    process.exit(2);
  });
}
