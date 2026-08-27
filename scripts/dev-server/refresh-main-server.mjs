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
//   * only the built api-server is process-restarted (it's `node dist/index.mjs`,
//     no watch mode -> must rebuild). The vite front-ends run `vite dev` and
//     HMR-reload themselves once their source advances on disk, so they need no
//     restart.
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
import { git, revParse, isAncestor, shortSha } from "./git.mjs";
import { pidAlive } from "./lock.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The one built (non-watch) service: it must be rebuilt+restarted to reflect new
// code. Everything else dev-all launches is `vite dev` (HMR) and self-reloads.
const BUILT_SERVICE = "api-server";

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

/** Best-effort readiness: can we open a TCP connection to the api port? */
async function waitForApiReady(config) {
  const deadline = Date.now() + config.readyTimeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const sock = net.connect(config.apiPort, "127.0.0.1");
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
  };
}

/** Dry-run preview of the ff decision without mutating the checkout (fetch only). */
export function previewFastForward(config) {
  const root = config.mainRepoRoot;
  const before = revParse(root, "HEAD");
  const fetch = git(root, ["fetch", "origin", "main"]);
  const target = revParse(root, "origin/main");
  if (!target) return { wouldPull: false, reason: "could not resolve origin/main", before, target: null, fetchOk: fetch.code === 0 };
  if (before === target) return { wouldPull: false, reason: "already at origin/main", before, target, alreadyCurrent: true, fetchOk: fetch.code === 0 };
  if (!isAncestor(root, before, target))
    return { wouldPull: false, reason: "diverged/ahead -- would SKIP (never reset a shared checkout)", before, target, fetchOk: fetch.code === 0 };
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
      console.error(
        `[refresh-main] ${dryRun ? "DRY-RUN " : ""}main checkout ${config.mainRepoRoot}: ${f.reason || f.wouldPull ? "" : ""}${arrow ? " " + arrow : ""}` +
          (res.restartedApi ? ` | api-server restarted (pid ${res.newPid}, ready=${res.ready})` : ` | api restart: ${res.apiReason || "skipped"}`)
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error(`[refresh-main] ERROR ${err.stack || err}`);
      process.exit(2);
    });
}
