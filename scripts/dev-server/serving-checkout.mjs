#!/usr/bin/env node
// scripts/dev-server/serving-checkout.mjs
//
// LOCAL Dev tier ONLY. Git #4033.
//
// "Which checkout is ACTUALLY serving the port?" -- answered with a real check
// against the live process, never assumed from config.
//
// Background: the coordinator merges a build's commit into the C:\dev-server
// MIRROR (config.serverWorktree), then -- since #1395 -- refreshes the SERVING
// checkout (config.servingRoot, the main checkout BuildConsole launches dev-all
// from) by ff-pulling it to origin/main and rebuilding the api-server. Two things
// let that report success while the port kept serving old code:
//
//   1. The ff-pull was skipped (the serving checkout had local-only commits), but
//      the api-server was still "rebuilt" -- from the stale tree -- and reported
//      `ready:true`, because `ready` only meant "something accepts TCP on :8080".
//   2. That readiness poll started the instant the rebuild was spawned, so the
//      OLD process (not yet killed by kill-port) already satisfied it.
//
// Nothing ever asked whether the process bound to the port came from the checkout
// that was just updated, or whether that checkout even contained the commit. This
// module asks exactly that:
//
//   * the commits being verified are ancestors of the serving checkout's HEAD;
//   * the pid LISTENING on each service port is attributed to a checkout by
//     walking its real process ancestry to the `<root>\scripts\dev-all.mjs` that
//     launched it, and that root must be the serving checkout;
//   * the api-server (a built, non-watch service) was started from a HEAD with no
//     api-affecting changes since -- read from the serving checkout's own reflog at
//     the process's real creation time, classified with service-targeting's rules;
//   * when a rebuild was just spawned, the listener must be a process created
//     after that spawn, not the survivor of the old one.
//
// Vite front-ends HMR from disk, so for them only the root attribution matters.
//
// CLI (preflight before claiming anything is "verified via live curl"):
//   node scripts/dev-server/serving-checkout.mjs [--commit <sha>]... [--json]
// exits 0 when verified, 3 when not (problems printed), 2 on error.

import { execFileSync } from "node:child_process";
import { readFileSync, readlinkSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { git, revParse, isAncestor, shortSha, diffNameOnly, resolveCommit } from "./git.mjs";
import { classifyChangedFiles, ALWAYS_ON } from "./service-targeting.mjs";

const isWin = process.platform === "win32";

// Process creation times and reflog stamps come from the same machine clock, but
// the rebuild spawn time is taken in this process a moment before the child
// exists. A small tolerance keeps that ordering check from flapping.
const CLOCK_SKEW_MS = 2000;

/** The port-based services, from the same services.json dev-all.mjs spawns from. */
export function loadServices() {
  try {
    const file = new URL("./services.json", import.meta.url);
    return JSON.parse(readFileSync(file, "utf8")).services || [];
  } catch {
    return [{ name: ALWAYS_ON, port: 8080, title: "API Server" }];
  }
}

/** Case/separator-insensitive (on Windows) comparison of two checkout roots. */
export function samePath(a, b) {
  if (!a || !b) return false;
  const n = (p) => {
    let r = path.resolve(p).replace(/[\\/]+$/, "");
    return isWin ? r.toLowerCase() : r;
  };
  return n(a) === n(b);
}

/** `netstat -ano` text -> Map<port, pid[]> of TCP LISTENING sockets. */
export function parseNetstatListeners(text) {
  const byPort = new Map();
  for (const line of String(text || "").split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5 || !/^TCP/i.test(parts[0]) || parts[3] !== "LISTENING") continue;
    const m = /:(\d+)$/.exec(parts[1]);
    const pid = Number(parts[4]);
    if (!m || !Number.isInteger(pid) || pid <= 0) continue;
    const port = Number(m[1]);
    if (!byPort.has(port)) byPort.set(port, []);
    if (!byPort.get(port).includes(pid)) byPort.get(port).push(pid);
  }
  return byPort;
}

/** Pids currently LISTENING on `port` (empty when none, or when it can't be read). */
export function findListeningPids(port) {
  try {
    if (isWin) {
      const out = execFileSync("netstat", ["-ano"], { encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
      return parseNetstatListeners(out).get(Number(port)) || [];
    }
    const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
    return [...new Set(out.split(/\r?\n/).map((s) => Number(s.trim())).filter((n) => n > 0))];
  } catch {
    return []; // lsof exits 1 when nothing listens
  }
}

/** Every listener, keyed by port (one netstat call on Windows). */
function readListeners(ports) {
  if (isWin) {
    try {
      const out = execFileSync("netstat", ["-ano"], { encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
      return parseNetstatListeners(out);
    } catch {
      return new Map();
    }
  }
  return new Map(ports.map((p) => [p, findListeningPids(p)]));
}

/** `ps -eo pid=,ppid=,lstart=,args=` text -> Map<pid, {pid,ppid,created,cmd}>. */
export function parsePsOutput(text) {
  const table = new Map();
  for (const line of String(text || "").split(/\r?\n/)) {
    const t = line.trim().split(/\s+/);
    if (t.length < 7) continue;
    const pid = Number(t[0]);
    const ppid = Number(t[1]);
    if (!Number.isInteger(pid)) continue;
    const created = Date.parse(t.slice(2, 7).join(" "));
    table.set(pid, { pid, ppid, created: Number.isFinite(created) ? created : 0, cmd: t.slice(7).join(" ") });
  }
  return table;
}

/**
 * The live process table: Map<pid, {pid, ppid, created(ms), cmd}>. On Windows this
 * is one CIM query (~3s, a PowerShell start-up) -- run once per verification, not
 * per port. Returns { table: null, error } when it can't be read.
 */
export function readProcessTable() {
  try {
    if (isWin) {
      const ps =
        "Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid=[int]$_.ProcessId; ppid=[int]$_.ParentProcessId; " +
        "created=$(if ($_.CreationDate) { ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } else { 0 }); cmd=[string]$_.CommandLine } } | ConvertTo-Json -Compress";
      const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
        encoding: "utf8",
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
      });
      const rows = JSON.parse(out);
      const table = new Map();
      for (const r of Array.isArray(rows) ? rows : [rows]) {
        table.set(Number(r.pid), { pid: Number(r.pid), ppid: Number(r.ppid), created: Number(r.created) || 0, cmd: r.cmd || "" });
      }
      return { table, error: null };
    }
    const out = execFileSync("ps", ["-eo", "pid=,ppid=,lstart=,args="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return { table: parsePsOutput(out), error: null };
  } catch (err) {
    return { table: null, error: String(err?.message || err).split(/\r?\n/)[0] };
  }
}

// `node "C:\repo\scripts\dev-all.mjs" --start api-server` -> C:\repo. This is how
// both BuildConsole's DevServicesManager and refresh-main-server launch services,
// and dev-all resolves its repoRoot from its own location, so it is authoritative.
const DEV_ALL_PATTERNS = [
  /"([^"]+?)[\\/]scripts[\\/]dev-all\.mjs"/i,
  /(?:^|\s)((?:[A-Za-z]:)?[\\/][^\s"]*?)[\\/]scripts[\\/]dev-all\.mjs(?=\s|$)/i,
];
// `node C:\repo\artifacts\api-server\dist\index.mjs` launched by hand -> C:\repo.
const ARTIFACT_ENTRY_PATTERNS = [
  /"([^"]+?)[\\/]artifacts[\\/][^\\/"]+[\\/]dist[\\/]index\.mjs"/i,
  /(?:^|\s)((?:[A-Za-z]:)?[\\/][^\s"]*?)[\\/]artifacts[\\/][^\\/\s"]+[\\/]dist[\\/]index\.mjs(?=\s|$)/i,
];

function firstMatch(patterns, cmd) {
  for (const re of patterns) {
    const m = re.exec(cmd || "");
    if (m) return m[1];
  }
  return null;
}

/** Checkout root named by a single command line, or null (e.g. `./dist/index.mjs`). */
export function rootFromCommandLine(cmd) {
  return firstMatch(DEV_ALL_PATTERNS, cmd) || firstMatch(ARTIFACT_ENTRY_PATTERNS, cmd);
}

/**
 * Attribute a pid to the checkout that launched it: walk the real parent chain
 * (nearest first) for a dev-all.mjs launcher, then for an absolute artifact entry
 * point. Windows recycles pids, so a "parent" created after its child is treated
 * as unrelated and ends the walk.
 */
export function attributeRoot(pid, table, { maxDepth = 12 } = {}) {
  const chain = [];
  const seen = new Set();
  let cur = table.get(pid);
  while (cur && chain.length < maxDepth && !seen.has(cur.pid)) {
    seen.add(cur.pid);
    chain.push(cur);
    const parent = table.get(cur.ppid);
    if (!parent || (parent.created && cur.created && parent.created > cur.created)) break;
    cur = parent;
  }
  for (const [kind, patterns] of [["dev-all", DEV_ALL_PATTERNS], ["artifact-entry", ARTIFACT_ENTRY_PATTERNS]]) {
    for (const p of chain) {
      const r = firstMatch(patterns, p.cmd);
      if (r) return { root: path.resolve(r), kind, viaPid: p.pid, chain: chain.map((c) => c.pid) };
    }
  }
  // Linux: a relative `./dist/index.mjs` still has a real cwd to read.
  if (!isWin) {
    try {
      const cwd = readlinkSync(`/proc/${pid}/cwd`);
      const m = /^(.*)[\\/]artifacts[\\/][^\\/]+$/.exec(cwd);
      if (m) return { root: path.resolve(m[1]), kind: "cwd", viaPid: pid, chain: chain.map((c) => c.pid) };
    } catch {
      /* not Linux, or not permitted */
    }
  }
  return { root: null, kind: null, viaPid: null, chain: chain.map((c) => c.pid) };
}

/**
 * The commit `root`'s HEAD pointed at just before `ms`, from its own reflog.
 * Reflog stamps are whole seconds, so an entry in the same second as `ms` is not
 * counted as "before" -- this errs toward reporting stale, never toward live.
 */
export function headAtTime(root, ms) {
  const r = git(root, ["log", "-g", "--format=%H %gd", "--date=unix", "-n", "5000", "HEAD"]);
  if (r.code !== 0) return null;
  const sec = Math.floor(ms / 1000);
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = /^([0-9a-f]{40}) \S*@\{(\d+)\}/.exec(line.trim());
    if (m && Number(m[2]) < sec) return { sha: m[1], at: Number(m[2]) * 1000 };
  }
  return null;
}

const iso = (ms) => (ms ? new Date(ms).toISOString() : "?");

/**
 * Verify the serving checkout is what is actually serving. Never throws.
 *
 * @param opts.commits       commits that must be live (ancestors of the serving HEAD)
 * @param opts.apiSpawnedAt  ms timestamp a rebuild of the api-server was just
 *                           spawned, if one was -- the listener must be newer
 * @param opts.root          checkout to verify against (default config.servingRoot)
 * @param opts.probe         { readProcessTable, readListeners } -- selftest injection
 */
export function verifyServingCheckout(config, { commits = [], apiSpawnedAt = null, root, probe = {} } = {}) {
  const servingRoot = root || config.servingRoot || config.mainRepoRoot;
  const problems = [];
  const head = revParse(servingRoot, "HEAD");
  const res = {
    checked: true,
    verified: false,
    servingRoot,
    mirrorWorktree: config.serverWorktree,
    head,
    commits: [],
    api: null,
    frontends: [],
    problems,
  };

  for (const c of commits.filter(Boolean)) {
    const full = resolveCommit(servingRoot, c) || c;
    const inServingHead = !!head && isAncestor(servingRoot, full, head);
    res.commits.push({ commit: full, inServingHead });
    if (!inServingHead) {
      problems.push(
        `commit ${shortSha(full)} is not in the serving checkout ${servingRoot} (HEAD ${shortSha(head)}). ` +
          `Merging into the ${config.serverWorktree} mirror does not put it there -- the serving checkout only advances to origin/main, ` +
          `so the commit must be pushed to origin/main AND the fast-forward must not have been skipped (see the restart's ff reason).`
      );
    }
  }

  const { table, error } = (probe.readProcessTable || readProcessTable)();
  if (!table) {
    res.checked = false;
    problems.push(`could not read the live process table, so the port holders cannot be attributed to a checkout: ${error}`);
    return res;
  }

  const services = loadServices();
  const listeners = (probe.readListeners || readListeners)(services.map((s) => s.port));

  for (const svc of services) {
    const isApi = svc.name === ALWAYS_ON;
    const pids = listeners.get(Number(svc.port)) || [];
    if (!pids.length) {
      if (isApi) {
        res.api = { name: svc.name, port: svc.port, listening: false };
        problems.push(`nothing is listening on :${svc.port} (${svc.title || svc.name}) -- the api-server is not up`);
      }
      continue;
    }
    const pid = pids[0];
    const proc = table.get(pid) || null;
    const attr = attributeRoot(pid, table);
    const rootMatches = attr.root ? samePath(attr.root, servingRoot) : null;
    const entry = {
      name: svc.name,
      port: svc.port,
      listening: true,
      pid,
      createdAt: proc?.created ? iso(proc.created) : null,
      attributedRoot: attr.root,
      attributedVia: attr.kind,
      rootMatches,
    };

    if (attr.root && !rootMatches) {
      problems.push(
        `:${svc.port} (${svc.title || svc.name}) is served by pid ${pid} launched from ${attr.root}, ` +
          `NOT from the serving checkout ${servingRoot} -- a different checkout than the one the restart updated`
      );
    }

    if (!isApi) {
      res.frontends.push(entry);
      continue;
    }

    if (!attr.root) {
      problems.push(
        `could not attribute the :${svc.port} api-server (pid ${pid}, process chain ${attr.chain.join(" <- ") || "?"}) to any checkout -- ` +
          `no dev-all.mjs launcher or absolute artifact entry point in its ancestry`
      );
    }

    const created = proc?.created || 0;
    const freshSpawn = !!(apiSpawnedAt && created && created >= apiSpawnedAt - CLOCK_SKEW_MS);
    if (apiSpawnedAt) {
      entry.freshSinceRestart = freshSpawn;
      if (!freshSpawn) {
        problems.push(
          `:${svc.port} is still held by pid ${pid} (started ${iso(created)}), which predates the rebuild spawned at ${iso(apiSpawnedAt)} -- ` +
            `the rebuilt api-server never took over the port`
        );
      }
    }

    if (rootMatches) {
      const start = created ? headAtTime(servingRoot, created) : null;
      entry.headAtStart = start?.sha || null;
      if (!start) {
        if (!freshSpawn) {
          problems.push(
            `cannot tell which commit the api-server (pid ${pid}, started ${iso(created)}) was built from: ` +
              `no reflog entry for ${servingRoot} before that time`
          );
        }
      } else if (head && start.sha !== head) {
        const cls = classifyChangedFiles(diffNameOnly(servingRoot, start.sha, head));
        const apiFiles = cls.shared ? cls.sharedFiles : cls.byService.get(ALWAYS_ON) || [];
        entry.apiChangesSinceStart = apiFiles.length;
        if (apiFiles.length) {
          problems.push(
            `the api-server (pid ${pid}) was built from ${shortSha(start.sha)} at ${iso(created)}, but the serving checkout is now at ${shortSha(head)} ` +
              `with ${apiFiles.length} api-affecting file(s) changed since (e.g. ${apiFiles[0]}) -- it is serving stale code until rebuilt`
          );
        }
      }
    }
    res.api = entry;
  }

  res.verified = problems.length === 0;
  return res;
}

/**
 * Git #4390 -- retry wrapper around verifyServingCheckout for the window right
 * after an api-server rebuild was spawned.
 *
 * The bug this closes: refreshMainServer used to call verifyServingCheckout
 * exactly ONCE, immediately after waitForFreshApiListener resolved. But
 * waitForFreshApiListener only proves "some pid other than the old ones is on
 * the port" -- a weak, early signal (it can fire on a transient/orphaned
 * handle, or on the split second between the new process binding the socket
 * and node finishing enough startup work for a real snapshot to see it
 * stably). The real cycle behind Git #4390 (c-1789574065319-10396) rebuilt the
 * api-server fine and bound :8080 about 4s after the ONE verify call ran --
 * that single snapshot landed in the gap and reported permanent NOT LIVE
 * (exit 3) for a restart that had already succeeded.
 *
 * This retries the SAME real check on a short interval until it verifies or
 * `deadline` passes -- but only while the failure is one a few more seconds
 * could plausibly fix (nothing listening yet / the listener predates the
 * rebuild / it can't yet be attributed to a checkout). Any other problem
 * (a commit genuinely absent from the serving checkout, the port held by a
 * DIFFERENT checkout entirely) is structural, not a timing race -- retrying
 * for the full window would just delay an honest failure, so those return
 * immediately on the first attempt.
 */
export async function verifyServingCheckoutUntil(config, opts = {}, deadline = Date.now(), { intervalMs = 2000, sleep } = {}) {
  const doSleep = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let attempts = 0;
  let res;
  for (;;) {
    res = verifyServingCheckout(config, opts);
    attempts++;
    if (res.verified) break;
    if (!opts.apiSpawnedAt) break; // no rebuild in flight to wait out -- one-shot check
    const retryable =
      res.problems.length > 0 &&
      res.problems.every(
        (p) => p.includes("nothing is listening") || p.includes("predates the rebuild") || p.includes("could not attribute")
      );
    if (!retryable) break;
    if (Date.now() >= deadline) break;
    await doSleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
  }
  return { ...res, attempts };
}

/** One-line human summary of a verification. */
export function describeVerification(v) {
  if (!v) return "not verified";
  if (v.verified) {
    const api = v.api?.pid ? `:${v.api.port} pid ${v.api.pid}` : "api";
    return `verified live -- ${api} served from ${v.servingRoot} @ ${shortSha(v.head)}`;
  }
  return `NOT live -- ${v.problems.length} problem(s):\n  - ${v.problems.join("\n  - ")}`;
}

// --- CLI ---
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const argv = process.argv.slice(2);
  const commits = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === "--commit") commits.push(argv[++i]);
  const json = argv.includes("--json");
  import("./config.mjs")
    .then(({ loadConfig }) => {
      const v = verifyServingCheckout(loadConfig(), { commits });
      if (json) console.log(JSON.stringify(v, null, 2));
      else (v.verified ? console.log : console.error)(`[serving-checkout] ${describeVerification(v)}`);
      process.exit(v.verified ? 0 : 3);
    })
    .catch((err) => {
      console.error(`[serving-checkout] ERROR ${err.stack || err}`);
      process.exit(2);
    });
}
