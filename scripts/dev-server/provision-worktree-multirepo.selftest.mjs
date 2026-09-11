#!/usr/bin/env node
// scripts/dev-server/provision-worktree-multirepo.selftest.mjs
//
// Git #3584 (Feature #3578, Multi-Repo Support) — end-to-end self-test of the
// real fix: provisioning, committing, and pushing against a genuinely
// different real repo than the one hardcoded main checkout, and cleaning it
// up afterward, without touching or confusing the main repo's own worktrees.
//
// Real verification bar from #3584's own issue body: "with a real second repo
// configured, dispatch and successfully land a real build against it end-to-
// end (worktree provisioned against the correct remote, real commit pushed to
// the correct repo, real bookend written) without touching or confusing
// anything in the Main repo's own concurrent builds." This exercises exactly
// that mechanism (provision -> commit -> push -> cleanup), fully OFFLINE
// against two real local bare repos standing in for "GitHub" — never the
// actual network, never the real C:\wt or C:\repos.
//
//   node scripts/dev-server/provision-worktree-multirepo.selftest.mjs

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
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "provision-mr-3584-"));
  const mainRepo = path.join(tmpRoot, "main");
  const mainOrigin = path.join(tmpRoot, "main-origin.git");
  const secondaryOrigin = path.join(tmpRoot, "secondary-origin.git");
  const secondaryReposRoot = path.join(tmpRoot, "repos");
  const wtRoot = path.join(tmpRoot, "wt");

  process.env.DEV_SERVER_MAIN_ROOT = mainRepo;
  process.env.DEV_SERVER_STATE_DIR = path.join(tmpRoot, "state");
  process.env.DEV_SERVER_WORKTREE = path.join(tmpRoot, "dev-server");
  process.env.DEV_SERVER_BASE_REF = "origin/main";
  process.env.DEV_SERVER_SECONDARY_REPOS_ROOT = secondaryReposRoot;

  const { loadConfig } = await import("./config.mjs");
  const { provisionWorktree } = await import("./provision-worktree.mjs");
  const { removeWorktreeSafe, getWorktreeRecord } = await import("./worktree-lifecycle.mjs");

  // --- Real main repo, with a real (local, non-github.com) origin. ---
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

  // --- Real secondary ("Tinker") repo's own "GitHub", default branch "trunk". ---
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

  const config = loadConfig({ cwd: mainRepo });
  const secondaryOwnerRepo = "shanemccaw/some-tinker-repo";
  const name = "3584-selftest-secondary";
  const wtPath = path.join(wtRoot, name);

  // === Provision a worktree against the SECONDARY repo ===
  const res = provisionWorktree({
    name,
    path: wtPath,
    link: true, // asked for, but must be a no-op for a secondary repo
    repo: secondaryOwnerRepo,
    repoCloneUrl: secondaryOrigin,
  });

  ok(res.ok === true, `provisioning against a secondary repo succeeds (error: ${res.error || "none"})`);
  ok(res.isMain === false, "result correctly reports isMain=false for the secondary repo");
  ok(res.linked === false, "dependency linking (monorepo-specific) is skipped for a secondary repo even though --link was requested");
  ok(res.envFiles === null, ".env copying (this repo's own secrets) is skipped for a secondary repo");
  ok(res.base === "origin/trunk", `base ref resolved to the secondary repo's OWN real default branch, not "main" (got ${res.base})`);

  const realOrigin = git(wtPath, ["remote", "get-url", "origin"]);
  ok(
    path.resolve(realOrigin) === path.resolve(secondaryOrigin),
    `the provisioned worktree's real \`origin\` remote is the secondary repo's own (got ${realOrigin})`
  );

  // === Commit + push from inside the worktree — must land in the secondary repo ===
  git(wtPath, ["config", "user.email", "t@t"]);
  git(wtPath, ["config", "user.name", "t"]);
  writeFileSync(path.join(wtPath, "work.txt"), "real work\n");
  git(wtPath, ["add", "-A"]);
  git(wtPath, ["commit", "-q", "-m", "real commit from the secondary-repo worktree"]);
  git(wtPath, ["push", "-q", "origin", `agent/${name}`]);

  const secondaryBranches = git(secondaryOrigin, ["branch", "--list", `agent/${name}`]);
  ok(secondaryBranches.includes(`agent/${name}`), "the real push landed the branch in the SECONDARY repo's own remote");

  const mainBranchesAfter = git(mainOrigin, ["branch", "--list"]);
  ok(!mainBranchesAfter.includes(`agent/${name}`), "the Main repo's own remote was NOT touched by the secondary-repo build (no cross-repo confusion)");

  const mainWorktrees = git(mainRepo, ["worktree", "list"]);
  ok(!mainWorktrees.includes(wtPath), "the secondary-repo worktree is not registered as a worktree of the Main repo's own .git");

  // === Cleanup must target the SECONDARY clone, not the main repo ===
  const rec = getWorktreeRecord(config, wtPath);
  ok(rec?.repoRoot && rec.repoRoot !== mainRepo, "the tracking record's repoRoot correctly points at the secondary clone, not the main repo");
  ok(rec?.ownerRepo === secondaryOwnerRepo, "the tracking record carries the real secondary ownerRepo");

  removeWorktreeSafe(config, wtPath, { reason: "selftest cleanup" });
  ok(!existsSync(wtPath), "the secondary-repo worktree directory was actually removed");
  ok(getWorktreeRecord(config, wtPath) === null, "the tracking record was removed");

  const rescuedInSecondary = git(rec.repoRoot, ["branch", "--list", "rescued/*"]);
  ok(rescuedInSecondary.length > 0, "the unmerged commit was rescued to a branch IN THE SECONDARY CLONE (not lost)");
  const rescuedInMain = git(mainRepo, ["branch", "--list", "rescued/*"]);
  ok(rescuedInMain.length === 0, "no rescue branch was created in the Main repo for a secondary-repo worktree's work");

  console.log("");
  if (failures) {
    console.error(`${failures} provision-worktree multi-repo self-test failure(s).`);
    process.exit(1);
  }
  console.log("All provision-worktree multi-repo self-tests passed — Git #3584 end-to-end mechanism holds.");
}

main().catch((e) => {
  console.error("provision-worktree-multirepo.selftest crashed:", e);
  process.exit(1);
});
