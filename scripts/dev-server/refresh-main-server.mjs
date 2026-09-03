#!/usr/bin/env node
// scripts/dev-server/refresh-main-server.mjs
//
// LOCAL Dev tier ONLY. Git #1395.
//
// Background: #1371 moved concurrent BUILDS into isolated worktrees and merges
// their commits into a dedicated C:\dev-server checkout. But the dev servers
// Shane actually verifies against (:8080 api-server, :5175 portal, ...) are
// launched by BuildConsole's DevServicesManager from the MAIN checkout, NOT from
// C:\dev-server. So a build's code -- even once merged into C:\dev-server -- never
// surfaced on the server Shane watches: it "restarted" but served stale fixtures.
//
// Per Shane's call (#1395): after a build lands on origin/main, bring the MAIN
// checkout up to origin/main and reload the services that run from it, so the
// server he watches reflects the new code.
//
// SAFETY -- the main checkout is SHARED (non-isolated sessions may hold
// uncommitted work there). So this NEVER discards or force-resets:
//   * it only fast-forwards (`git merge --ff-only origin/main`);
//   * if the checkout can't fast-forward (local commits ahead, or a dirty file
//     would be overwritten by the ff) it reports and SKIPS the pull -- it does
//     not stash, reset --hard, or overwrite anyone's work;
//   * only the built api-server is process-*restarted* on every refresh (it's
//     `node dist/index.mjs`, no watch mode -> must rebuild). The vite front-ends
//     run `vite dev` and HMR-reload themselves once their source advances on
//     disk *if they're already running* -- but Git #1205: one that's genuinely
//     down (never started, or was stopped) has no process to HMR-reload, so it
//     is explicitly started too (same `dev-all.mjs --start <service>` call
//     DevServicesManager.StartServiceAsync uses), confirmed via a real port
//     check rather than assumed.
//
// Invoked as the coordinator's restart action (see request-restart.mjs /
// coordinator.mjs), so it fires exactly where the C:\dev-server restart used to --
// coalesced once per ungrouped cycle and once per completed build set, honoring
// the same selective-targeting `only` list.

import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.mjs";
import { git, revParse, isAncestor, shortSha, diffNameOnly } from "./git.mjs";
import { pidAlive } from "./lock.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The one built (non-watch) service: it must be rebuilt+restarted to reflect new
// code. Everything else dev-all launches is `vite dev` (HMR) and self-reloads --
// but ONLY if it's already running. Git #1205: a front-end selective targeting
// says must be running (plan.neededRunning, passed in as `only`) that is
// genuinely DOWN never gets an HMR reload (there's no process to reload), so it
// has to be started explicitly, the same way DevServicesManager.StartServiceAsync
// does for the WPF UI's manual Start buttons -- both call this same launcher.
const BUILT_SERVICE = "api-server";
const FRONTEND_SERVICES = [
  { name: "shane-mccaw-consulting", port: 5173, title: "Marketing" },
  { name: "admin-panel", port: 5174, title: "Admin" },
  { name: "portal", port: 5175, title: "Portal" },
  { name: "msp-website", port: 5176, title: "Website" },
  { name: "msp-console", port: 5177, title: "MSP Console" },
];

/**
 * Fast-forward the MAIN checkout to origin/main. Fetch is best-effort. Returns a
 * structured result; never throws, never force-resets, never discards local work.
 */
export function fastForwardMainCheckout(config) {
  const root = config.mainRepoRoot;
  const branch = "main";
  const before = revParse(root, "HEAD");

  // Best-effort fetch so origin/main reflects just-pushed build commits.
  const fetch = git(root, ["fetch", "origin", branch]);
  const originRef = `origin/${branch}`;
  const target = revParse(root, originRef);

  if (!target) {
    return { pulled: false, reason: `could not resolve ${originRef}`, before, after: before, fetchOk: fetch.code === 0 };
  }
  if (before === target) {
    return { pulled: false, reason: "main checkout already at origin/main", before, after: before, alreadyCurrent: true, fetchOk: fetch.code === 0 };
  }
  // Only fast-forward: origin/main must be strictly ahead of the checkout's HEAD.
  if (!isAncestor(root, before, target)) {
    return {
      pulled: false,
      reason: "main checkout has local commits ahead of / diverged from origin/main -- refusing to reset a shared checkout; skipped (fetch only)",
      before,
      after: before,
      fetchOk: fetch.code === 0,
    };
  }
  // ff-only merge. If a dirty tracked file would be overwritten, git refuses and
  // we honestly report skipped -- we do NOT stash/discard a shared checkout.
  const m = git(root, ["merge", "--ff-only", originRef]);
  const after = revParse(root, "HEAD");
  if (m.code !== 0) {
    return {
      pulled: false,
      reason: `ff merge blocked (likely local uncommitted changes) -- skipped: ${(m.stdout + " " + m.stderr).trim().slice(0, 300)}`,
      before,
      after,
      fetchOk: fetch.code === 0,
    };
  }
  return { pulled: after !== before, reason: "fast-forwarded main checkout to origin/main", before, after, fetchOk: fetch.code === 0 };
}

/** Read a dev-all per-service meta ({pid,status,...}) from the shared log dir. */
function readServiceMeta(config, name) {
  try {
    const p = path.join(config.devAllLogDir, `${name}.meta.json`);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/** Best-effort readiness: can we open a TCP connection to the given port?
 * Mirrors DevServicesManager.IsPortOpenAsync -- same "is it actually listening"
 * proof, generalized from just the api port so front-end starts can use it too. */
async function waitForPortReady(config, port) {
  const deadline = Date.now() + config.readyTimeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const sock = net.connect(port, "127.0.0.1");
      const done = (v) => { sock.destroy(); resolve(v); };
      sock.once("connect", () => done(true));
      sock.once("error", () => done(false));
      sock.setTimeout(1500, () => done(false));
    });
    if (ok) return true;
    await sleep(500);
  }
  return false;
}

/** Best-effort readiness: can we open a TCP connection to the api port? */
async function waitForApiReady(config) {
  return waitForPortReady(config, config.apiPort);
}

/** Is this service's tracked process genuinely alive right now? Mirrors
 * server-process.mjs's readRunningServices: meta says "running" AND the
 * recorded pid is actually alive, so a stale meta left behind by a crash
 * doesn't masquerade as up. */
function isServiceRunning(config, name) {
  const meta = readServiceMeta(config, name);
  return !!(meta?.status === "running" && meta.pid && pidAlive(meta.pid));
}

/**
 * Start a front-end that's genuinely down -- the actual missing capability
 * (Git #1205). Mirrors DevServicesManager.StartServiceAsync exactly: same
 * `dev-all.mjs --start <service>` invocation, then confirms with a real port
 * check (mirrors IsPortOpenAsync) rather than assuming it worked. A no-op,
 * honestly reported, if the service is already running (nothing to start).
 */
async function startFrontendIfDown(config, svc) {
  if (isServiceRunning(config, svc.name)) {
    return { name: svc.name, started: false, alreadyRunning: true, ready: true };
  }
  const root = config.mainRepoRoot;
  const devAll = path.join(root, "scripts", "dev-all.mjs");
  if (!existsSync(devAll)) {
    return { name: svc.name, started: false, alreadyRunning: false, ready: false, reason: `dev-all.mjs not found at ${devAll}` };
  }
  const child = spawn(process.execPath, [devAll, "--start", svc.name], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, DEV_ALL_LOG_DIR: config.devAllLogDir, APP_ENV: "dev", NODE_ENV: "development" },
  });
  child.unref();
  const ready = await waitForPortReady(config, svc.port);
  return { name: svc.name, started: true, alreadyRunning: false, newPid: child.pid, ready };
}

/**
 * Ensure every front-end this restart needs running is actually running,
 * starting whichever ones are genuinely down. `onlyList` is selective
 * targeting's `plan.neededRunning` (front-ends the set's own code changed, or
 * that were already running and still should be); `null` means the footprint
 * couldn't be resolved and this is the documented safe-fallback FULL restart,
 * so every configured front-end is checked/started (never silently
 * under-restart). Front-ends outside `onlyList` are left alone entirely --
 * this only starts what's needed, never tears anything down (that's toStop's
 * job, handled by the caller when DEV_SET_STOP_UNNEEDED is on).
 */
async function ensureFrontendsRunning(config, onlyList, { dryRun = false } = {}) {
  const targets = onlyList
    ? FRONTEND_SERVICES.filter((s) => onlyList.includes(s.name))
    : FRONTEND_SERVICES;
  const results = [];
  for (const svc of targets) {
    if (dryRun) {
      const alreadyRunning = isServiceRunning(config, svc.name);
      results.push({ name: svc.name, dryRun: true, alreadyRunning, wouldStart: !alreadyRunning });
    } else {
      results.push(await startFrontendIfDown(config, svc));
    }
  }
  return results;
}

/**
 * Rebuild + restart the built api-server that runs from the MAIN checkout, the
 * same way BuildConsole's DevServicesManager does: `dev-all.mjs --start api-server`
 * from the main repo root (its startApiServer runs kill-port -> build.mjs ->
 * node dist/index.mjs, so this is a self-contained rebuild+restart). Returns the
 * old/new pids and readiness.
 */
async function restartMainApiServer(config) {
  const root = config.mainRepoRoot;
  const devAll = path.join(root, "scripts", "dev-all.mjs");
  const oldMeta = readServiceMeta(config, BUILT_SERVICE);
  const oldPid = oldMeta?.pid && pidAlive(oldMeta.pid) ? oldMeta.pid : null;

  if (!existsSync(devAll)) {
    return { restartedApi: false, reason: `dev-all.mjs not found at ${devAll}`, oldPid, newPid: null, ready: false };
  }

  // Detached so it outlives this short-lived coordinator process; its own
  // kill-port frees :8080 from the old holder before rebuilding.
  const child = spawn(process.execPath, [devAll, "--start", BUILT_SERVICE], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, DEV_ALL_LOG_DIR: config.devAllLogDir, APP_ENV: "dev", NODE_ENV: "development" },
  });
  child.unref();
  const ready = await waitForApiReady(config);
  return { restartedApi: true, oldPid, newPid: child.pid, ready };
}

/**
 * The coordinator's restart action under #1395's model: (1) fast-forward the main
 * checkout to origin/main, (2) restart the built api-server if its code could have
 * changed (front-ends HMR themselves). Honors selective targeting: `only` is the
 * set of services a completed build set actually needs (see service-targeting).
 * When `only` is given and does NOT include api-server (front-end-only change),
 * the ff-pull is enough -- vite reloads the fronts, no api restart.
 *
 * Signature matches the old restartServer(config, {only}) so it drops into the
 * coordinator's deps.restart slot unchanged.
 */
export async function refreshMainServer(config, { only, dryRun = false } = {}) {
  const ff = dryRun ? previewFastForward(config) : fastForwardMainCheckout(config);

  const onlyList = Array.isArray(only) ? only.filter(Boolean) : null;
  const apiCouldHaveChanged = !onlyList || onlyList.includes(BUILT_SERVICE);

  let api = { restartedApi: false, reason: onlyList ? "api-server not in the set's changed services -- ff-pull only; vite fronts HMR-reload" : null, oldPid: null, newPid: null, ready: null };
  if (apiCouldHaveChanged && !dryRun) {
    api = await restartMainApiServer(config);
  } else if (apiCouldHaveChanged && dryRun) {
    api = { restartedApi: false, dryRun: true, wouldRestartApi: true, oldPid: readServiceMeta(config, BUILT_SERVICE)?.pid || null };
  }

  // Git #1205 -- start whichever needed front-ends are genuinely down. `only`
  // (== plan.neededRunning when selective targeting resolved) already told us
  // exactly which front-ends must be running; this was previously read only to
  // decide the api-server question above and silently dropped for every other
  // service, which is the real false limitation this fixes.
  const frontends = await ensureFrontendsRunning(config, onlyList, { dryRun });

  // Return a shape compatible with the coordinator's restart record (oldPid/newPid/
  // ready) plus the extra main-checkout detail for observability.
  return {
    oldPid: api.oldPid ?? null,
    newPid: api.newPid ?? null,
    ready: api.ready ?? null,
    target: "main-checkout",
    mainRoot: config.mainRepoRoot,
    ff,
    only: onlyList && onlyList.length ? onlyList : null,
    restartedApi: !!api.restartedApi,
    apiReason: api.reason || null,
    frontends,
  };
}

/**
 * Tracked files with uncommitted modifications (staged or unstaged) right now --
 * `git status --porcelain`, filtered to drop untracked ("??") entries, since those
 * can never conflict with a ff-only merge (the merge only ever touches tracked
 * paths). Rename lines ("R  old -> new") report the new path, matching what
 * `diff --name-only` names on the incoming side. Read-only; never mutates.
 */
function dirtyTrackedFiles(root) {
  const r = git(root, ["status", "--porcelain"]);
  if (r.code !== 0) return [];
  return r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => line[0] !== "?" && line[1] !== "?")
    .map((line) => {
      const p = line.slice(3).trim();
      return p.includes(" -> ") ? p.split(" -> ")[1].trim() : p;
    });
}

/**
 * Dry-run preview of the ff decision without mutating the checkout (fetch only).
 *
 * Git #1780: this used to stop at `isAncestor` and report `wouldPull: true`
 * whenever origin/main was a real ff target -- but a ff-only merge also fails
 * whenever a tracked file the incoming range touches is dirty in the working
 * tree (`fastForwardMainCheckout`'s real `git merge --ff-only` call aborts with
 * "local changes ... would be overwritten"). The preview never caught that, so
 * `--dry-run` could report `wouldPull: true` in exactly the situation the real
 * merge would refuse.
 *
 * Fix: compute the same answer git's own ff-only would, without running it.
 * Intersect `git status --porcelain`'s dirty tracked files against
 * `git diff --name-only before..target` (the files the incoming ff would
 * actually touch) -- both read-only, non-mutating. If any tracked file is both
 * locally dirty AND changes between `before` and `target`, the real merge would
 * abort on exactly that file, so the preview reports `wouldPull: false` with an
 * honest reason instead. (Chose this over actually invoking
 * `git merge --ff-only --no-commit` as a probe: that mutates the index/working
 * tree and risks leaving a shared checkout half-merged if the probe itself were
 * ever interrupted -- status+diff intersection gets the identical answer with
 * zero risk of that.)
 */
export function previewFastForward(config) {
  const root = config.mainRepoRoot;
  const before = revParse(root, "HEAD");
  const fetch = git(root, ["fetch", "origin", "main"]);
  const target = revParse(root, "origin/main");
  if (!target) return { wouldPull: false, reason: "could not resolve origin/main", before, target: null, fetchOk: fetch.code === 0 };
  if (before === target) return { wouldPull: false, reason: "already at origin/main", before, target, alreadyCurrent: true, fetchOk: fetch.code === 0 };
  if (!isAncestor(root, before, target))
    return { wouldPull: false, reason: "diverged/ahead -- would SKIP (never reset a shared checkout)", before, target, fetchOk: fetch.code === 0 };

  const dirty = dirtyTrackedFiles(root);
  if (dirty.length) {
    const incoming = diffNameOnly(root, before, target);
    const blocking = dirty.filter((f) => incoming.includes(f));
    if (blocking.length) {
      return {
        wouldPull: false,
        reason: `dirty tracked file(s) would block the real ff-only merge -- skipped: ${blocking.join(", ")}`,
        before,
        target,
        blockingFiles: blocking,
        fetchOk: fetch.code === 0,
      };
    }
  }

  return { wouldPull: true, reason: "would fast-forward", before, target, behindBy: countBetween(root, before, target), fetchOk: fetch.code === 0 };
}

function countBetween(root, a, b) {
  const r = git(root, ["rev-list", "--count", `${a}..${b}`]);
  return r.code === 0 ? Number(r.stdout.trim()) : null;
}

// --- CLI (manual / diagnostic; the coordinator calls refreshMainServer directly) ---
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const onlyIdx = argv.indexOf("--only");
  const only = onlyIdx !== -1 ? (argv[onlyIdx + 1] || "").split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  const config = loadConfig();
  refreshMainServer(config, { only, dryRun })
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
      const f = res.ff || {};
      const arrow = f.before && f.after ? `${shortSha(f.before)} -> ${shortSha(f.after)}` : "";
      const fe = (res.frontends || [])
        .map((f2) => `${f2.name}:${f2.started ? `started(ready=${f2.ready})` : f2.alreadyRunning ? "already-up" : f2.wouldStart ? "would-start" : f2.reason || "skipped"}`)
        .join(", ");
      console.error(
        `[refresh-main] ${dryRun ? "DRY-RUN " : ""}main checkout ${config.mainRepoRoot}: ${f.reason || f.wouldPull ? "" : ""}${arrow ? " " + arrow : ""}` +
          (res.restartedApi ? ` | api-server restarted (pid ${res.newPid}, ready=${res.ready})` : ` | api restart: ${res.apiReason || "skipped"}`) +
          (fe ? ` | frontends: ${fe}` : "")
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error(`[refresh-main] ERROR ${err.stack || err}`);
      process.exit(2);
    });
}
