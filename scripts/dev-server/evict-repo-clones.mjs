#!/usr/bin/env node
// scripts/dev-server/evict-repo-clones.mjs
//
// Git #3630 (Feature #3578, Multi-Repo Support) — piece 2 of #3584's explicit scope-cut.
//
// Real problem: repo-clone.mjs's `resolveRepoCheckout` creates a persistent local clone
// of a secondary/Tinker repo under `C:\repos\<owner>__<repo>` the first time any worktree
// is provisioned against it, and reuses it forever — correct while that repo stays
// configured, but if it is later removed from Settings > Repos (#3581's registry,
// `BuildConsoleSettings.ConfiguredRepos`), the clone lingers on disk indefinitely with no
// cleanup path (#3581's own issue body flagged this exact adjacent gap as a stated
// follow-up).
//
// This is that cleanup path: compare every real subdirectory of the secondary-repos root
// against whatever BuildConsole's OWN registry currently says is configured (read
// straight from its real %AppData%\BuildConsole[-<instance>]\settings.json — no
// duplicate registry invented here), and remove any clone whose owner/repo is no longer
// in that list. A clone is ONLY ever removed after confirming no live worktree tracking
// record still points at it (`listWorktreeRecords`) — a worktree mid-build against a
// repo Shane just removed from Settings must never be deleted out from under it; it is
// retained (reported, not silently skipped) until that worktree completes/is reclaimed by
// the sweep on its own.
//
// Fails closed: if the registry can't be read/parsed at all, nothing is evicted — an
// unreadable "still configured" list is never treated as "nothing is configured".
//
// Usage:
//   node scripts/dev-server/evict-repo-clones.mjs [--dry-run] [--json] [--instance <name>]

import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.mjs";
import { isGitRepo } from "./git.mjs";
import { secondaryReposRoot } from "./repo-clone.mjs";
import { listWorktreeRecords, normalizePath } from "./worktree-lifecycle.mjs";

/** Real path to BuildConsole's own settings.json for the given (or default) instance. */
export function settingsPathFor(instance) {
  const appData =
    process.env.DEV_SERVER_BUILDCONSOLE_APPDATA || // selftest-only override
    process.env.APPDATA ||
    path.join(os.homedir(), "AppData", "Roaming");
  const dir = instance ? `BuildConsole-${instance}` : "BuildConsole";
  return path.join(appData, dir, "settings.json");
}

/**
 * Read the CURRENTLY configured "owner/repo" set straight from BuildConsole's real
 * settings.json — the one actual source of truth for the #3581 registry. Returns
 * `ownerRepos: null` (not an empty set) when the file is missing/unparseable, so the
 * caller can fail closed rather than mistake "unreadable" for "nothing configured".
 */
export function readConfiguredOwnerRepos(instance) {
  const settingsPath = settingsPathFor(instance);
  if (!existsSync(settingsPath)) {
    return { ownerRepos: null, settingsPath, error: `settings.json not found at ${settingsPath}` };
  }
  try {
    const raw = JSON.parse(readFileSync(settingsPath, "utf8"));
    const list = Array.isArray(raw.ConfiguredRepos)
      ? raw.ConfiguredRepos
      : Array.isArray(raw.configuredRepos)
        ? raw.configuredRepos
        : [];
    const ownerRepos = new Set(
      list
        .map((r) => String(r?.OwnerRepo ?? r?.ownerRepo ?? "").trim().toLowerCase())
        .filter(Boolean)
    );
    return { ownerRepos, settingsPath, error: null };
  } catch (e) {
    return { ownerRepos: null, settingsPath, error: `failed to parse settings.json: ${e.message}` };
  }
}

/** Reverse repo-clone.mjs's `<owner>/<repo>` -> `<owner>__<repo>` clone-dir naming. */
function ownerRepoFromCloneDirName(dirName) {
  const idx = dirName.indexOf("__");
  return idx > 0 ? `${dirName.slice(0, idx)}/${dirName.slice(idx + 2)}` : dirName;
}

/**
 * Evict every secondary-repo clone whose repo is no longer in the #3581 registry, unless
 * a live worktree tracking record still points at it.
 *
 * @returns {{ ok: boolean, evicted: Array, retained: Array, inspected: number, settingsPath: string, error?: string }}
 */
export function evictRemovedRepoClones(config, opts = {}) {
  const dryRun = !!opts.dryRun;
  const { ownerRepos, settingsPath, error } = readConfiguredOwnerRepos(opts.instance);

  if (!ownerRepos) {
    // Fail closed — never guess "nothing configured" from an unreadable registry.
    return { ok: false, error, settingsPath, evicted: [], retained: [], inspected: 0 };
  }

  const root = secondaryReposRoot(config.mainRepoRoot);
  if (!existsSync(root)) {
    return { ok: true, evicted: [], retained: [], inspected: 0, settingsPath };
  }

  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (e) {
    return { ok: false, error: `could not read secondary-repos root ${root}: ${e.message}`, settingsPath, evicted: [], retained: [], inspected: 0 };
  }

  const records = listWorktreeRecords(config);
  const evicted = [];
  const retained = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const cloneDir = path.join(root, entry.name);
    if (!isGitRepo(cloneDir)) continue; // not a real clone — leave alone, not ours to touch

    const ownerRepo = ownerRepoFromCloneDirName(entry.name);

    if (ownerRepos.has(ownerRepo.toLowerCase())) {
      retained.push({ path: cloneDir, ownerRepo, reason: "still configured in Settings > Repos" });
      continue;
    }

    const normClone = normalizePath(cloneDir);
    const liveWorktree = records.find((r) => r.repoRoot && normalizePath(r.repoRoot) === normClone);
    if (liveWorktree) {
      retained.push({
        path: cloneDir,
        ownerRepo,
        reason: `removed from Settings > Repos, but a live worktree tracking record ('${liveWorktree.name}') still points at this clone — left alone`,
      });
      continue;
    }

    if (dryRun) {
      evicted.push({ path: cloneDir, ownerRepo, dryRun: true });
      continue;
    }

    try {
      rmSync(cloneDir, { recursive: true, force: true });
      evicted.push({ path: cloneDir, ownerRepo });
      console.log(`[repo-clone] EVICTED clone for repo removed from Settings > Repos ("${ownerRepo}"): ${cloneDir}`);
    } catch (e) {
      retained.push({ path: cloneDir, ownerRepo, reason: `removal failed: ${e.message}` });
    }
  }

  return { ok: true, evicted, retained, inspected: entries.length, settingsPath };
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--dry-run") a.dryRun = true;
    else if (t === "--json") a.json = true;
    else if (t === "--instance") a.instance = argv[++i];
  }
  return a;
}

export async function runEvictCli(args) {
  const config = loadConfig();
  const res = evictRemovedRepoClones(config, { dryRun: args.dryRun, instance: args.instance });

  if (args.json) {
    console.log(JSON.stringify(res, null, 2));
  } else if (!res.ok) {
    console.error(`[repo-clone] evict-repo-clones failed: ${res.error}`);
  } else {
    console.log(`Repo-clone eviction${args.dryRun ? " (DRY RUN)" : ""} (registry: ${res.settingsPath}):`);
    console.log(`  Inspected: ${res.inspected}`);
    console.log(`  Evicted  : ${res.evicted.length}`);
    console.log(`  Retained : ${res.retained.length}`);
    for (const e of res.evicted) console.log(`    - EVICTED ${e.path} (${e.ownerRepo})`);
    for (const r of res.retained) console.log(`    - retained ${r.path} (${r.reason})`);
  }

  if (!res.ok) process.exitCode = 1;
  return res;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  runEvictCli(args).catch((err) => {
    console.error(`[repo-clone] evict-repo-clones fatal error: ${err.stack || err}`);
    process.exit(2);
  });
}
