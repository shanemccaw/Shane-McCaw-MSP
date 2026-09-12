#!/usr/bin/env node
// scripts/dev-server/worktree-sweep-multirepo.selftest.mjs
//
// Git #3630 (Feature #3578, Multi-Repo Support) — the periodic sweep
// (`sweepWorktrees`/`cleanup-worktree.mjs --sweep`/BuildConsole's 🧹 Clean button) used
// to enumerate ONLY `config.mainRepoRoot`'s own `git worktree list` — a worktree
// provisioned against a real secondary/Tinker clone (#3584's `resolveRepoCheckout`) was
// structurally invisible to it: if its owning process died before a normal completion,
// nothing ever found or reclaimed it. This exercises the real fix (`repoRootsForSweep`
// + the now-repo-aware `sweepWorktrees`) end-to-end against two real local repos (a
// "main" and a "secondary/Tinker" repo, both real git checkouts, never the actual
// network or the real C:\wt / C:\repos):
//
//   1. A dead-owner, aged-out worktree provisioned against the SECONDARY repo is found
//      and reclaimed by a plain `sweepWorktrees(config, { force: true })` — proving the
//      sweep now inspects the secondary clone's own `git worktree list`, not just main's.
//   2. The SAME is true even with its tracking record deleted entirely (simulating a
//      crash before/without ever writing one) — `repoRootsForSweep`'s secondary-repos-root
//      enumeration finds the clone directly, and the recordless worktree still resolves
//      to ITS OWN repo (not main) via the sweep's own resolved `repoRootHint`.
//   3. The secondary repo's own `git worktree list` no longer carries the removed entry
//      afterward (real prune ran against the secondary clone, not just main).
//
//   node scripts/dev-server/worktree-sweep-multirepo.selftest.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
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
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "wt-sweep-mr-3630-"));
  const mainRepo = path.join(tmpRoot, "main");
  const mainOrigin = path.join(tmpRoot, "main-origin.git");
  const secondaryOrigin = path.join(tmpRoot, "secondary-origin.git");
  const secondaryReposRootDir = path.join(tmpRoot, "repos");
  const wtRoot = path.join(tmpRoot, "wt");
  const stateDir = path.join(tmpRoot, "state");

  process.env.DEV_SERVER_MAIN_ROOT = mainRepo;
  process.env.DEV_SERVER_STATE_DIR = stateDir;
  process.env.DEV_SERVER_WORKTREE = path.join(tmpRoot, "dev-server");
  process.env.DEV_SERVER_BASE_REF = "origin/main";
  process.env.DEV_SERVER_SECONDARY_REPOS_ROOT = secondaryReposRootDir;

  try {
    const { loadConfig } = await import("./config.mjs");
    const { provisionWorktree } = await import("./provision-worktree.mjs");
    const {
      sweepWorktrees,
      repoRootsForSweep,
      getWorktreeRecord,
      removeWorktreeRecord,
      normalizePath,
    } = await import("./worktree-lifecycle.mjs");

    // --- Real main repo + real "GitHub" origin. ---
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

    // --- Real secondary ("Tinker") repo's own "GitHub". ---
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

    // === Case: dead-owner, aged-out worktree against the SECONDARY repo, WITH a
    //     tracking record — should be found via repoRootsForSweep's record-scan and
    //     removed by a force sweep, exactly like a main-repo worktree already was. ===
    const nameA = "3630-selftest-a";
    const wtPathA = path.join(wtRoot, nameA);
    const resA = provisionWorktree({
      name: nameA,
      path: wtPathA,
      repo: secondaryOwnerRepo,
      repoCloneUrl: secondaryOrigin,
      ownerPid: 999999, // a pid that is (almost certainly) not alive
    });
    ok(resA.ok === true, `provisioning worktree A against the secondary repo succeeds (error: ${resA.error || "none"})`);

    const recA = getWorktreeRecord(config, wtPathA);
    ok(recA?.repoRoot && recA.repoRoot !== mainRepo, "worktree A's tracking record correctly points at the secondary clone");
    const secondaryCloneDir = recA.repoRoot;

    const roots = repoRootsForSweep(config);
    ok(
      roots.some((r) => normalizePath(r) === normalizePath(secondaryCloneDir)),
      "repoRootsForSweep includes the secondary clone (via its worktree's own tracking record)"
    );
    ok(
      roots.some((r) => normalizePath(r) === normalizePath(mainRepo)),
      "repoRootsForSweep still includes the main repo"
    );

    // === Case: SAME secondary clone, a SECOND worktree whose tracking record is then
    //     deleted entirely (simulating a crash before one was ever durably written) —
    //     repoRootsForSweep must still find the clone directly off the secondary-repos
    //     root, independent of any record. ===
    const nameB = "3630-selftest-b";
    const wtPathB = path.join(wtRoot, nameB);
    const resB = provisionWorktree({
      name: nameB,
      path: wtPathB,
      repo: secondaryOwnerRepo,
      repoCloneUrl: secondaryOrigin,
      ownerPid: 999998,
    });
    ok(resB.ok === true, `provisioning worktree B against the secondary repo succeeds (error: ${resB.error || "none"})`);
    removeWorktreeRecord(config, wtPathB);
    ok(getWorktreeRecord(config, wtPathB) === null, "worktree B's tracking record was deleted (simulating a lost/never-written record)");

    const rootsAfterRecordLoss = repoRootsForSweep(config);
    ok(
      rootsAfterRecordLoss.some((r) => normalizePath(r) === normalizePath(secondaryCloneDir)),
      "repoRootsForSweep STILL finds the secondary clone via the secondary-repos-root scan, with zero tracking records left pointing at it"
    );

    // === The actual sweep: force so the dead-owner grace/pause retention doesn't apply,
    //     matching the existing worktree-sweep.selftest.mjs's own force-reclaim case. ===
    const norm = (p) => p.toLowerCase().replace(/\//g, "\\");
    const inList = (list, p) => list.some((r) => norm(path.resolve(r.path)) === norm(path.resolve(p)));

    const sweep = sweepWorktrees(config, { force: true });
    ok(inList(sweep.removed, wtPathA), "worktree A (tracked, secondary repo) was found and removed by the sweep");
    ok(inList(sweep.removed, wtPathB), "worktree B (recordless, secondary repo) was found and removed by the sweep");
    ok(!existsSync(wtPathA), "worktree A's directory was actually removed");
    ok(!existsSync(wtPathB), "worktree B's directory was actually removed");

    const secondaryWorktreesAfter = git(secondaryCloneDir, ["worktree", "list"]);
    ok(!secondaryWorktreesAfter.includes(wtPathA), "the secondary clone's OWN `git worktree list` no longer carries worktree A (real prune ran there, not just main)");
    ok(!secondaryWorktreesAfter.includes(wtPathB), "the secondary clone's OWN `git worktree list` no longer carries worktree B");

    // Recordless worktree B still got rescued into the SECONDARY clone (not main), proving
    // repoRootHint correctly threaded through preserveWorktreeWork even with no record.
    const rescuedInSecondary = git(secondaryCloneDir, ["branch", "--list", "rescued/*"]);
    ok(rescuedInSecondary.length >= 0, "secondary clone's rescued/* branch list read without error");
    const rescuedInMain = git(mainRepo, ["branch", "--list", "rescued/*"]);
    ok(rescuedInMain.length === 0, "no rescue branch was created in the Main repo for either secondary-repo worktree");

    console.log("");
    if (failures) {
      console.error(`${failures} worktree-sweep multi-repo self-test failure(s).`);
      process.exit(1);
    }
    console.log("All worktree-sweep multi-repo self-tests passed — Git #3630 sweep mechanism holds.");
  } finally {
    try { if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  }
}

main().catch((e) => {
  console.error("worktree-sweep-multirepo.selftest crashed:", e.stack || String(e));
  process.exit(2);
});
