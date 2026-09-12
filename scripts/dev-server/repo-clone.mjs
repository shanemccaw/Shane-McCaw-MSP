// scripts/dev-server/repo-clone.mjs
//
// Git #3584 (Feature #3578, Multi-Repo Support) — resolve which real local git
// checkout a worktree for a given "owner/repo" should be provisioned FROM.
//
// Background: provision-worktree.mjs always ran `git worktree add` against
// `config.mainRepoRoot` — a real, hardcoded single repo. That is correct for
// every build queued against THIS repo (Shane-McCaw-MSP), but a worktree is a
// linked checkout of the SAME object database, so it cannot represent a
// genuinely different GitHub repository (a "Tinker" repo per #3581's Settings
// registry, e.g. a real second repo added there). Those need their OWN local
// clone, and worktrees for them must be added FROM that clone, not the main
// repo's .git.
//
// This module is the resolution step: default (no ownerRepo, or ownerRepo ==
// the main repo's own real owner/repo) returns the existing mainRepoRoot
// unchanged — zero behavior change for every build that doesn't pass --repo.
// Any other real configured repo gets a dedicated, persistent secondary clone
// (one clone per repo, reused and fetched — never re-cloned; same "shared
// checkout, no needless re-download" discipline #1372 already applies to
// node_modules, just for the repo itself here).

import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { git } from "./git.mjs";
import { isWindows } from "./config.mjs";
import { refuseIfMetered } from "./network-gate.mjs";

const OWNER_REPO_RE = /^[\w.-]+\/[\w.-]+$/;

/** Parse a real "owner/repo" out of a git remote URL (https or ssh), or null. */
export function parseOwnerRepoFromRemoteUrl(url) {
  if (!url) return null;
  const m = url.trim().match(/github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * The main repo's own real "owner/repo", read from its actual `origin` remote
 * (never hardcoded — stays correct if this repo is ever renamed/forked). Falls
 * back to the one real known default only if the remote genuinely can't be
 * read right now; matches BuildConsoleSettings' own seeded default so the two
 * never disagree.
 */
export function resolveMainOwnerRepo(mainRepoRoot) {
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: mainRepoRoot,
      encoding: "utf8",
    }).trim();
    const parsed = parseOwnerRepoFromRemoteUrl(url);
    if (parsed) return parsed;
  } catch {
    /* fall through to the real known default below */
  }
  return "shanemccaw/Shane-McCaw-MSP";
}

// Git #3630 — exported so worktree-lifecycle.mjs's sweep (and evict-repo-clones.mjs's
// registry-eviction pass) can enumerate every real secondary-repo clone directory
// without re-deriving this path independently and risking drift from the one actual
// clone location resolveRepoCheckout below uses.
export function secondaryReposRoot(mainRepoRoot) {
  return (
    process.env.DEV_SERVER_SECONDARY_REPOS_ROOT ||
    (isWindows() ? "C:\\repos" : path.join(path.dirname(mainRepoRoot), "repos"))
  );
}

/**
 * Resolve the real default branch ref to base a fresh worktree from, for a repo
 * whose default branch is not necessarily `main`. `git clone` sets
 * `refs/remotes/origin/HEAD` to the real default branch automatically; prefer
 * that, fall back to the literal `origin/main` (today's single-repo default).
 */
export function resolveDefaultBaseRef(repoRoot) {
  const r = git(repoRoot, ["rev-parse", "--abbrev-ref", "origin/HEAD"]);
  if (r.code === 0 && r.stdout.trim()) return r.stdout.trim(); // e.g. "origin/main"
  return "origin/main";
}

/**
 * Git #3584 — resolve which real local checkout a worktree for `ownerRepo`
 * should be provisioned from.
 *
 * @param {{mainRepoRoot: string}} config
 * @param {string|null|undefined} ownerRepo real "owner/repo", or falsy for the
 *   default (today's single-repo behavior, unchanged).
 * @param {{cloneUrl?: string}} [opts] `cloneUrl` overrides the derived
 *   `https://github.com/<ownerRepo>.git` — real callers never set this; it
 *   exists so the selftest can exercise the real clone/reuse/fetch path
 *   against a fully local bare repo instead of the real network.
 * @returns {{ repoRoot: string, ownerRepo: string, isMain: boolean, cloned: boolean }}
 */
export function resolveRepoCheckout(config, ownerRepo, opts = {}) {
  const mainOwnerRepo = resolveMainOwnerRepo(config.mainRepoRoot);
  const requested = (ownerRepo || "").trim();

  if (!requested || requested.toLowerCase() === mainOwnerRepo.toLowerCase()) {
    return { repoRoot: config.mainRepoRoot, ownerRepo: mainOwnerRepo, isMain: true, cloned: false };
  }

  if (!OWNER_REPO_RE.test(requested)) {
    throw new Error(`resolveRepoCheckout: not a real "owner/repo" string: ${JSON.stringify(ownerRepo)}`);
  }

  const root = secondaryReposRoot(config.mainRepoRoot);
  const cloneDir = path.join(root, requested.replace("/", "__"));
  let cloned = false;

  if (existsSync(cloneDir)) {
    // Reuse the existing clone — just refresh so the base ref resolves against
    // real current remote state. Best-effort: a failed fetch still leaves a
    // usable (if slightly stale) real checkout rather than hard-failing.
    const r = git(cloneDir, ["fetch", "origin", "--prune"]);
    if (r.code !== 0) {
      console.warn(`[repo-clone] fetch failed for existing clone of "${requested}" at ${cloneDir}: ${r.stderr || r.stdout}`);
    }
  } else {
    // Git #3006 — this first-time clone IS a real, unbounded, metered-class download (unlike
    // the reused-clone `fetch --prune` above, which is small/incremental) — hard-block it the
    // same way `.pnpmfile.cjs` hard-blocks `pnpm install` when BUILD_NETWORK=metered. Shane's
    // one-shot override (Location toggle in BuildConsole) is the only way past this; there is
    // no flag a build session can set itself.
    refuseIfMetered(
      `git clone of a full secondary repo ("${requested}")`,
      `Would clone to ${cloneDir} — this repo's own source once, for a repo Shane explicitly configured in Settings > Repos (#3581), but a real, unbounded download all the same.`
    );
    // Real, one-time, reused-forever clone of this repo's actual GitHub remote.
    // Not a "pnpm install"-class metered download (Git #1987) — this is the
    // repo's own source once, for a repo Shane explicitly configured in
    // Settings > Repos (#3581); every subsequent worktree of it reuses this
    // same clone.
    mkdirSync(root, { recursive: true });
    console.log(`[repo-clone] No local clone yet for "${requested}" — cloning once to ${cloneDir} (reused for every future worktree of this repo).`);
    const cloneUrl = opts.cloneUrl || `https://github.com/${requested}.git`;
    const r = git(root, ["clone", cloneUrl, cloneDir]);
    if (r.code !== 0) {
      throw new Error(`git clone ${cloneUrl} failed:\n${r.stderr || r.stdout}`);
    }
    cloned = true;
  }

  return { repoRoot: cloneDir, ownerRepo: requested, isMain: false, cloned };
}
