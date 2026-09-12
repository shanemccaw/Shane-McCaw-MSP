#!/usr/bin/env node
// scripts/dev-server/repo-clone.selftest.mjs
//
// Git #3584 (Feature #3578, Multi-Repo Support) — focused self-test for
// resolveRepoCheckout()/resolveMainOwnerRepo()/resolveDefaultBaseRef(): the
// resolution step that lets a worktree be provisioned against a genuinely
// different real repo (a #3581 Settings "Tinker" entry) instead of always the
// one hardcoded main repo.
//
// Fully OFFLINE — the "secondary repo" is a real local bare git repo, never
// the actual network/GitHub, so this never touches real bandwidth (Git #1987's
// bandwidth-is-a-real-constraint discipline applies here too even though a
// one-time repo clone isn't the pnpm-install class of cost this exists to
// guard). Stands up throwaway repos under a temp dir; never touches the real
// checkout or C:\repos.
//
//   node scripts/dev-server/repo-clone.selftest.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let failures = 0;
function ok(cond, msg) {
  if (cond) console.log(`  ok  - ${msg}`);
  else { failures++; console.error(`  FAIL - ${msg}`); }
}
function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

async function main() {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "repo-clone-3584-"));
  const mainRepo = path.join(tmpRoot, "main");
  const mainOrigin = path.join(tmpRoot, "main-origin.git");
  const secondaryOrigin = path.join(tmpRoot, "secondary-origin.git");
  const secondaryReposRoot = path.join(tmpRoot, "repos");

  process.env.DEV_SERVER_SECONDARY_REPOS_ROOT = secondaryReposRoot;

  const {
    parseOwnerRepoFromRemoteUrl,
    resolveMainOwnerRepo,
    resolveRepoCheckout,
    resolveDefaultBaseRef,
  } = await import("./repo-clone.mjs");

  // === parseOwnerRepoFromRemoteUrl — pure string parsing, both real URL shapes ===
  ok(
    parseOwnerRepoFromRemoteUrl("https://github.com/shanemccaw/Shane-McCaw-MSP.git") === "shanemccaw/Shane-McCaw-MSP",
    "parses a real https github.com remote URL"
  );
  ok(
    parseOwnerRepoFromRemoteUrl("git@github.com:shanemccaw/Test.git") === "shanemccaw/Test",
    "parses a real ssh github.com remote URL"
  );
  ok(
    parseOwnerRepoFromRemoteUrl("https://github.com/shanemccaw/Shane-McCaw-MSP") === "shanemccaw/Shane-McCaw-MSP",
    "parses a real https URL with no trailing .git"
  );
  ok(parseOwnerRepoFromRemoteUrl(null) === null, "null URL -> null, no throw");
  ok(parseOwnerRepoFromRemoteUrl("/some/local/bare/path.git") === null, "a non-github.com (local) remote does not falsely parse an owner/repo");

  // --- Real main-repo checkout with a real (local, non-github.com) origin remote. ---
  mkdirSync(mainOrigin, { recursive: true });
  git(mainOrigin, ["init", "-q", "--bare", "-b", "main"]);
  mkdirSync(mainRepo, { recursive: true });
  git(mainRepo, ["init", "-q", "-b", "main"]);
  git(mainRepo, ["config", "user.email", "t@t"]);
  git(mainRepo, ["config", "user.name", "t"]);
  writeFileSync(path.join(mainRepo, "README.md"), "main\n");
  git(mainRepo, ["add", "-A"]);
  git(mainRepo, ["commit", "-q", "-m", "init"]);
  git(mainRepo, ["remote", "add", "origin", mainOrigin]);
  git(mainRepo, ["push", "-q", "origin", "main"]);

  const config = { mainRepoRoot: mainRepo };

  // === resolveMainOwnerRepo — real fallback when the real remote isn't github.com ===
  const mainOwnerRepo = resolveMainOwnerRepo(mainRepo);
  ok(
    mainOwnerRepo === "shanemccaw/Shane-McCaw-MSP",
    `a non-github.com origin (this test's local bare repo) falls back to the real known default (got ${mainOwnerRepo})`
  );

  // === resolveRepoCheckout — default/main-repo path, zero behavior change ===
  let r = resolveRepoCheckout(config, null);
  ok(r.isMain === true && r.repoRoot === mainRepo, "no ownerRepo -> resolves to the main repo, unchanged");

  r = resolveRepoCheckout(config, "");
  ok(r.isMain === true && r.repoRoot === mainRepo, "empty ownerRepo -> resolves to the main repo, unchanged");

  r = resolveRepoCheckout(config, mainOwnerRepo.toUpperCase());
  ok(r.isMain === true && r.repoRoot === mainRepo, "ownerRepo matching the main repo (case-insensitive) -> resolves to the main repo");

  // === resolveRepoCheckout — invalid owner/repo string is rejected, never silently misused ===
  let threw = false;
  try { resolveRepoCheckout(config, "not-a-repo-string"); } catch { threw = true; }
  ok(threw, "a string that isn't real \"owner/repo\" shape throws instead of being silently treated as a repo");

  // --- Real secondary repo's own "GitHub" — a bare repo whose default branch is
  //     NOT "main" (proves resolveDefaultBaseRef genuinely detects it, not just
  //     coincidentally matching a hardcoded "main"). ---
  mkdirSync(secondaryOrigin, { recursive: true });
  git(secondaryOrigin, ["init", "-q", "--bare", "-b", "trunk"]);
  const seedRepo = path.join(tmpRoot, "secondary-seed");
  mkdirSync(seedRepo, { recursive: true });
  git(seedRepo, ["init", "-q", "-b", "trunk"]);
  git(seedRepo, ["config", "user.email", "t@t"]);
  git(seedRepo, ["config", "user.name", "t"]);
  writeFileSync(path.join(seedRepo, "README.md"), "secondary\n");
  git(seedRepo, ["add", "-A"]);
  git(seedRepo, ["commit", "-q", "-m", "init"]);
  git(seedRepo, ["remote", "add", "origin", secondaryOrigin]);
  git(seedRepo, ["push", "-q", "origin", "trunk"]);

  // === resolveRepoCheckout — a genuinely different repo triggers a real (local,
  //     offline) clone into the secondary-repos root, reused on a second call ===
  const secondaryOwnerRepo = "shanemccaw/some-tinker-repo";
  r = resolveRepoCheckout(config, secondaryOwnerRepo, { cloneUrl: secondaryOrigin });
  ok(r.isMain === false, "a different real ownerRepo is NOT resolved as the main repo");
  ok(r.cloned === true, "first resolution actually clones (no pre-existing local checkout)");
  ok(existsSync(path.join(r.repoRoot, "README.md")), "the cloned checkout has the secondary repo's real content");
  ok(
    path.resolve(r.repoRoot).toLowerCase().startsWith(path.resolve(secondaryReposRoot).toLowerCase()),
    "the secondary clone lives under the configured secondary-repos root, not under C:\\wt or the main repo"
  );

  const r2 = resolveRepoCheckout(config, secondaryOwnerRepo, { cloneUrl: secondaryOrigin });
  ok(r2.cloned === false && r2.repoRoot === r.repoRoot, "a second resolution of the SAME repo REUSES the existing clone (fetch, not re-clone)");

  // === resolveDefaultBaseRef — real default-branch detection, not hardcoded "main" ===
  const defaultRef = resolveDefaultBaseRef(r.repoRoot);
  ok(defaultRef === "origin/trunk", `secondary repo's real default branch ("trunk") is detected, not assumed to be main (got ${defaultRef})`);
  ok(resolveDefaultBaseRef(mainRepo) === "origin/main", "main repo's real default branch (\"main\") is detected the same way");

  // === Git #3006 — a genuinely NEW secondary repo's first-time clone is hard-blocked on
  //     Shane's metered connection, the same way .pnpmfile.cjs blocks pnpm install ===
  const meteredOwnerRepo = "shanemccaw/another-tinker-repo";
  const meteredCloneDir = path.join(secondaryReposRoot, meteredOwnerRepo.replace("/", "__"));
  process.env.BUILD_NETWORK = "metered";
  let meteredThrew = false;
  try {
    resolveRepoCheckout(config, meteredOwnerRepo, { cloneUrl: secondaryOrigin });
  } catch (e) {
    meteredThrew = /BUILD_NETWORK=metered/.test(e.message);
  }
  ok(meteredThrew, "BUILD_NETWORK=metered refuses a first-time secondary-repo clone with a real BLOCKED error");
  ok(!existsSync(meteredCloneDir), "the refused clone never touched disk (no partial clone directory)");

  // === Reusing an ALREADY-cloned repo is unaffected by metered — that path is a small
  //     incremental `fetch --prune`, not the unbounded first-time clone ===
  let reuseThrew = false;
  let r3;
  try {
    r3 = resolveRepoCheckout(config, secondaryOwnerRepo, { cloneUrl: secondaryOrigin });
  } catch {
    reuseThrew = true;
  }
  ok(!reuseThrew && r3.cloned === false, "reusing an already-cloned secondary repo is NOT blocked by BUILD_NETWORK=metered (incremental fetch only)");
  delete process.env.BUILD_NETWORK;

  console.log("");
  if (failures) {
    console.error(`${failures} repo-clone self-test failure(s).`);
    process.exit(1);
  }
  console.log("All repo-clone self-tests passed — Git #3584 repo resolution holds.");
}

main().catch((e) => {
  console.error("repo-clone.selftest crashed:", e);
  process.exit(1);
});
