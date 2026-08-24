#!/usr/bin/env node
// scripts/dev-server/buildset.mjs
//
// BUILD SETS -- an explicit, PROACTIVE grouping of stacked builds into a single
// deferred restart.
//
// Why this exists (Shane's own words): "The constant tear down and rebuild of ALL
// services, Marketing, Portal, Admin Panel, API Server is causing memory resource
// management problems on my development box... We need to group builds into a build
// set... and when that build set is done, ALL the builds in it, then a one-time
// restart/compile happens and all build tests get ran against that."
//
// The base coordinator (coordinator.mjs `runCycle`) already COALESCES restarts that
// happen to land while a cycle is running -- but that reacts to TIMING. A build set
// is different: it is declared UP FRONT (a name shared by 10-20 stacked builds,
// properly blocked by their parents) and the restart is deferred ENTIRELY until
// every member has genuinely completed (merged into the shared server checkout),
// no matter how the completions are spread out in time. Each member's commit is
// merged the moment it finishes -- exactly per the coordinator's existing merge
// mechanics -- but NO restart fires for an individual member. When the whole set is
// complete, exactly ONE restart/rebuild of all four services fires, covering the
// combined changes, and the caller that fired it is signalled to run the combined
// test pass once.
//
// This module owns only the SET STATE (a small JSON manifest per set + a JSONL
// event log). The actual merge-without-restart and the single restart trigger live
// in coordinator.mjs (`runSetMemberCycle` / `maybeFireSetRestart`), which imports
// the pure helpers here. Firing a restart requires the coordinator's mutex + a real
// restart action, so the CLI's `drop`/`close` commands (which can complete a set)
// lazily import coordinator.mjs to do that safely.
//
// Ungrouped builds NEVER touch any of this -- they keep going through the existing
// enqueue -> runCycle -> restart path unchanged.

import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  renameSync,
  existsSync,
  appendFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.mjs";

// A member's terminal statuses -- states from which it will contribute nothing
// further to the set. `merged`/`already-live` advanced the tree; `conflict`/
// `dropped` did not, but the member is still "done" (it will never merge), so it
// must count toward completion or a single failed/dropped member would wedge the
// whole set forever.
const TERMINAL = new Set(["merged", "already-live", "conflict", "dropped"]);
const ADVANCING = new Set(["merged", "already-live"]);

/** Filesystem-safe manifest name; the human name is preserved inside the file. */
function safeSetName(name) {
  return String(name).trim().replace(/[^\w.-]+/g, "_").slice(0, 200) || "_";
}

export function setManifestPath(config, name) {
  return path.join(config.buildSetsDir, `${safeSetName(name)}.json`);
}

function ensureDir(config) {
  mkdirSync(config.buildSetsDir, { recursive: true });
}

function writeAtomic(file, obj) {
  const tmp = `${file}.tmp-${process.pid}-${Math.floor(Math.random() * 1e9)}`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2));
  renameSync(tmp, file); // atomic on same volume
}

export function readSet(config, name) {
  const f = setManifestPath(config, name);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return null;
  }
}

export function writeSet(config, name, set) {
  ensureDir(config);
  writeAtomic(setManifestPath(config, name), set);
  return set;
}

/** Append one line to the shared build-sets event log (best-effort observability). */
export function logSetEvent(config, event) {
  try {
    ensureDir(config);
    appendFileSync(
      config.buildSetsLog,
      JSON.stringify({ at: Date.now(), pid: process.pid, ...event }) + "\n"
    );
  } catch {
    /* observability is best-effort */
  }
}

function blankSet(name, openedBy) {
  return {
    name: String(name),
    openedAt: Date.now(),
    openedBy: openedBy || "unknown",
    // Expected member COUNT. null => open-ended: the set can only complete via an
    // explicit `close` (never by guessing, never by timing).
    expected: null,
    closed: false,
    members: {}, // key -> { key, commit, agentId, status, error, at }
    restart: {
      fired: false,
      cycleId: null,
      at: null,
      byAgent: null,
      serverHead: null,
      reason: null,
      restarted: null,
    },
    completedAt: null,
  };
}

/**
 * Declare / update a build set. Idempotent: creating an existing set just updates
 * its expected count (monotonic MAX so late-queued members can only raise it, never
 * silently shrink a set that already has more members recorded).
 */
export function openSet(config, name, { expected = null, openedBy = "cli" } = {}) {
  ensureDir(config);
  let set = readSet(config, name);
  let created = false;
  if (!set) {
    set = blankSet(name, openedBy);
    created = true;
  }
  if (expected != null && Number.isFinite(Number(expected))) {
    const exp = Math.max(0, Math.floor(Number(expected)));
    set.expected = set.expected == null ? exp : Math.max(set.expected, exp);
  }
  writeSet(config, name, set);
  if (created) {
    logSetEvent(config, {
      kind: "open",
      setName: set.name,
      expected: set.expected,
      openedBy,
    });
  }
  return set;
}

/**
 * Record a member's terminal outcome into the set (auto-opens the set if needed).
 * Read-modify-write; callers that also decide/fire a restart must hold the
 * coordinator mutex so this whole sequence is serialized cross-process.
 */
export function recordMember(config, name, { key, commit, agentId, status, error }) {
  ensureDir(config);
  const set = readSet(config, name) || blankSet(name, agentId ? "agent" : "cli");
  const k = String(key);
  set.members[k] = {
    key: k,
    commit: commit || null,
    agentId: agentId || null,
    status,
    error: error || null,
    at: Date.now(),
  };
  writeSet(config, name, set);
  return set;
}

/** Explicitly mark a member dropped (a build that failed / was abandoned and will
 * never merge) so the set can still complete on its remaining members. */
export function dropMember(config, name, key, reason) {
  const set = readSet(config, name) || blankSet(name, "cli");
  const k = String(key);
  const existing = set.members[k];
  // Never downgrade a member that already merged.
  if (existing && ADVANCING.has(existing.status)) return set;
  set.members[k] = {
    key: k,
    commit: existing?.commit || null,
    agentId: existing?.agentId || null,
    status: "dropped",
    error: reason || existing?.error || null,
    at: Date.now(),
  };
  writeSet(config, name, set);
  logSetEvent(config, { kind: "drop", setName: set.name, key: k, reason: reason || null });
  return set;
}

/** Explicitly close a set: no more members will join. Lets an open-ended (unknown
 * expected count) set complete on exactly the members recorded so far. */
export function closeSet(config, name) {
  const set = readSet(config, name) || blankSet(name, "cli");
  set.closed = true;
  writeSet(config, name, set);
  logSetEvent(config, { kind: "close", setName: set.name });
  return set;
}

export function terminalCount(set) {
  return Object.values(set.members).filter((m) => TERMINAL.has(m.status)).length;
}

export function mergedCount(set) {
  return Object.values(set.members).filter((m) => ADVANCING.has(m.status)).length;
}

/** Has every member of the set reached a terminal state? -- the completion gate.
 * Explicit and proactive, never timing-based:
 *   • known expected count  -> complete once terminalCount >= expected
 *   • no expected count     -> complete only after an explicit `close`
 */
export function isComplete(set) {
  if (!set) return false;
  const terminal = terminalCount(set);
  if (set.expected != null) return terminal >= set.expected && terminal > 0;
  if (set.closed) return terminal > 0 || Object.keys(set.members).length > 0;
  return false;
}

/** Did any member actually advance the server tree? (If not, completing the set is
 * a no-op -- there is nothing new to restart into.) */
export function treeAdvanced(set) {
  return mergedCount(set) > 0;
}

export function markRestartFired(config, name, { cycleId, serverHead, byAgent, reason, restarted }) {
  const set = readSet(config, name);
  if (!set) return null;
  set.restart = {
    fired: true,
    cycleId: cycleId || null,
    at: Date.now(),
    byAgent: byAgent || null,
    serverHead: serverHead || null,
    reason: reason || null,
    restarted: !!restarted,
  };
  set.completedAt = Date.now();
  writeSet(config, name, set);
  return set;
}

/** Concise progress snapshot for logs / return values. */
export function progress(set) {
  return {
    name: set.name,
    expected: set.expected,
    closed: set.closed,
    terminal: terminalCount(set),
    merged: mergedCount(set),
    total: Object.keys(set.members).length,
    complete: isComplete(set),
    restartFired: !!set.restart?.fired,
  };
}

/** List all known sets (for status / sweep). */
export function listSets(config) {
  if (!existsSync(config.buildSetsDir)) return [];
  return readdirSync(config.buildSetsDir)
    .filter((f) => f.endsWith(".json") && !f.includes(".tmp-"))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(path.join(config.buildSetsDir, f), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function isStale(set, staleMs) {
  if (!set || !staleMs) return false;
  if (set.restart?.fired) return false;
  return Date.now() - (set.openedAt || 0) > staleMs;
}

// --------------------------------------------------------------------------- CLI
function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--json") a.json = true;
    else if (t === "--expected") a.expected = Number(argv[++i]);
    else if (t === "--key") a.key = argv[++i];
    else if (t === "--commit") a.commit = argv[++i];
    else if (t === "--agent") a.agent = argv[++i];
    else if (t === "--status") a.status = argv[++i];
    else if (t === "--reason") a.reason = argv[++i];
    else if (t === "--by") a.by = argv[++i];
    else a._.push(t);
  }
  return a;
}

function printStatus(config, name, asJson) {
  const sets = name ? [readSet(config, name)].filter(Boolean) : listSets(config);
  if (asJson) {
    console.log(JSON.stringify(sets.map(progress), null, 2));
    return;
  }
  if (sets.length === 0) {
    console.log("(no build sets)");
    return;
  }
  for (const set of sets) {
    const p = progress(set);
    const exp = p.expected == null ? (p.closed ? "closed" : "open-ended") : p.expected;
    const state = p.restartFired ? "DONE (restart fired)" : p.complete ? "COMPLETE (restart pending)" : "in progress";
    console.log(
      `[build set] ${p.name}: ${p.terminal}/${exp} terminal (${p.merged} merged, ${p.total} recorded) -- ${state}`
    );
    if (isStale(set, config.buildSetStaleMs)) {
      console.log(`             ⚠ STALE (open > ${(config.buildSetStaleMs / 3.6e6).toFixed(1)}h, no restart) -- consider: buildset.mjs close ${p.name}`);
    }
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const a = parseArgs(argv.slice(1));
  const config = loadConfig({ cwd: process.cwd() });
  const name = a._[0];

  switch (cmd) {
    case "open": {
      if (!name) throw new Error("usage: buildset.mjs open <name> [--expected N] [--by who]");
      const set = openSet(config, name, { expected: a.expected, openedBy: a.by || "cli" });
      console.log(`[build set] opened '${set.name}' expected=${set.expected ?? "open-ended"}`);
      break;
    }
    case "member": {
      if (!name || !a.key) throw new Error("usage: buildset.mjs member <name> --key K [--commit SHA] [--agent A] [--status merged]");
      const set = recordMember(config, name, { key: a.key, commit: a.commit, agentId: a.agent, status: a.status || "merged" });
      logSetEvent(config, { kind: "member", setName: set.name, key: a.key, status: a.status || "merged", via: "cli" });
      printStatus(config, name, a.json);
      break;
    }
    case "drop": {
      if (!name || !a.key) throw new Error("usage: buildset.mjs drop <name> --key K [--reason R]");
      dropMember(config, name, a.key, a.reason);
      // A drop can complete the set -> fire the single restart under the mutex.
      const { finishSetFromCli } = await import("./coordinator.mjs");
      const res = await finishSetFromCli(config, name, { byAgent: `cli-drop:${a.key}` });
      printStatus(config, name, a.json);
      if (res?.restarted) console.log(`[build set] '${name}' completed on drop -> ONE restart fired.`);
      break;
    }
    case "close": {
      if (!name) throw new Error("usage: buildset.mjs close <name>");
      closeSet(config, name);
      const { finishSetFromCli } = await import("./coordinator.mjs");
      const res = await finishSetFromCli(config, name, { byAgent: "cli-close" });
      printStatus(config, name, a.json);
      if (res?.restarted) console.log(`[build set] '${name}' completed on close -> ONE restart fired.`);
      break;
    }
    case "status":
      printStatus(config, name, a.json);
      break;
    case "sweep": {
      const stale = listSets(config).filter((s) => isStale(s, config.buildSetStaleMs));
      if (stale.length === 0) console.log("no stale build sets");
      else for (const s of stale) console.log(`STALE build set '${s.name}' (opened ${new Date(s.openedAt).toISOString()}) -- close it with: buildset.mjs close ${s.name}`);
      break;
    }
    case "reset": {
      if (!name) throw new Error("usage: buildset.mjs reset <name>");
      const f = setManifestPath(config, name);
      if (existsSync(f)) rmSync(f, { force: true });
      console.log(`[build set] reset '${name}'`);
      break;
    }
    default:
      console.log("usage: buildset.mjs <open|member|drop|close|status|sweep|reset> <name> [flags]");
      process.exit(cmd ? 1 : 0);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(`[build set] ERROR ${err.stack || err}`);
    process.exit(2);
  });
}
