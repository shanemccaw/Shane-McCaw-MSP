#!/usr/bin/env node
// scripts/dev-server/evict-repo-clones.selftest.mjs
//
// Git #3630 (Feature #3578, Multi-Repo Support) — real end-to-end self-test of the
// second piece #3584 explicitly left out of scope: a secondary repo's persistent clone
// under `C:\repos\<owner>__<repo>` is never evicted when that repo is later removed from
// Settings > Repos (#3581's registry). Exercises the real fix against:
//   - a real throwaway "registry" (a real settings.json, isolated via
//     DEV_SERVER_BUILDCONSOLE_APPDATA so this never touches the real
//     %AppData%\BuildConsole\settings.json)
//   - real git clones under an isolated secondary-repos root
//   - real worktree tracking records
//
//   node scripts/dev-server/evict-repo-clones.selftest.mjs

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

function writeSettings(appDataDir, configuredRepos) {
  const dir = path.join(appDataDir, "BuildConsole");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "settings.json"),
    JSON.stringify({ ConfiguredRepos: configuredRepos }, null, 2)
  );
}

async function main() {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "evict-repo-clones-3630-"));
  const mainRepo = path.join(tmpRoot, "main");
  const secondaryReposRootDir = path.join(tmpRoot, "repos");
  const appDataDir = path.join(tmpRoot, "appdata");
  const wtRoot = path.join(tmpRoot, "wt");

  process.env.DEV_SERVER_MAIN_ROOT = mainRepo;
  process.env.DEV_SERVER_STATE_DIR = path.join(tmpRoot, "state");
  process.env.DEV_SERVER_WORKTREE = path.join(tmpRoot, "dev-server");
  process.env.DEV_SERVER_BASE_REF = "HEAD";
  process.env.DEV_SERVER_SECONDARY_REPOS_ROOT = secondaryReposRootDir;
  process.env.DEV_SERVER_BUILDCONSOLE_APPDATA = appDataDir;

  try {
    const { loadConfig } = await import("./config.mjs");
    const { evictRemovedRepoClones, settingsPathFor } = await import("./evict-repo-clones.mjs");
    const { registerWorktree, removeWorktreeRecord } = await import("./worktree-lifecycle.mjs");

    mkdirSync(mainRepo, { recursive: true });
    git(mainRepo, ["init", "-q", "-b", "main"]);
    git(mainRepo, ["config", "user.email", "t@t"]);
    git(mainRepo, ["config", "user.name", "t"]);
    writeFileSync(path.join(mainRepo, "README.md"), "main\n");
    git(mainRepo, ["add", "-A"]);
    git(mainRepo, ["commit", "-q", "-m", "init"]);

    const config = loadConfig({ cwd: mainRepo });

    // Two real "clones" (bare-minimum real git repos, standing in for real
    // resolveRepoCheckout output) under the isolated secondary-repos root.
    mkdirSync(secondaryReposRootDir, { recursive: true });
    const stillConfiguredDir = path.join(secondaryReposRootDir, "shanemccaw__still-configured");
    const removedDir = path.join(secondaryReposRootDir, "shanemccaw__removed-repo");
    const removedButLiveDir = path.join(secondaryReposRootDir, "shanemccaw__removed-but-live");
    for (const d of [stillConfiguredDir, removedDir, removedButLiveDir]) {
      mkdirSync(d, { recursive: true });
      git(d, ["init", "-q", "-b", "trunk"]);
    }
    // A non-git directory under the same root must never be touched.
    const notAClone = path.join(secondaryReposRootDir, "not-a-real-clone");
    mkdirSync(notAClone, { recursive: true });
    writeFileSync(path.join(notAClone, "junk.txt"), "not a repo\n");

    // === Registry says only "shanemccaw/still-configured" remains configured. ===
    writeSettings(appDataDir, [{ OwnerRepo: "shanemccaw/still-configured", Tier: "Tinker" }]);

    // A live tracking record still points at "removed-but-live" (a build genuinely
    // in progress against a repo Shane just removed from Settings).
    registerWorktree(config, {
      path: path.join(wtRoot, "in-flight"),
      name: "in-flight",
      repoRoot: removedButLiveDir,
      ownerRepo: "shanemccaw/removed-but-live",
    });

    // --- Dry run first: must report what it WOULD evict without touching disk. ---
    const dry = evictRemovedRepoClones(config, { dryRun: true });
    ok(dry.ok === true, `dry-run eviction succeeds (error: ${dry.error || "none"})`);
    ok(dry.evicted.some((e) => e.ownerRepo === "shanemccaw/removed-repo"), "dry-run reports the truly-removed repo's clone as an eviction candidate");
    ok(!dry.evicted.some((e) => e.ownerRepo === "shanemccaw/still-configured"), "dry-run does NOT flag the still-configured repo's clone");
    ok(!dry.evicted.some((e) => e.ownerRepo === "shanemccaw/removed-but-live"), "dry-run does NOT flag the removed-but-live-worktree repo's clone for eviction");
    ok(existsSync(removedDir), "dry-run never actually deletes anything");

    // --- Real run. ---
    const res = evictRemovedRepoClones(config);
    ok(res.ok === true, `real eviction succeeds (error: ${res.error || "none"})`);
    ok(!existsSync(removedDir), "the truly-removed repo's clone was actually deleted");
    ok(existsSync(stillConfiguredDir), "the still-configured repo's clone was left alone");
    ok(existsSync(removedButLiveDir), "the removed-but-LIVE-worktree repo's clone was left alone (never delete out from under a live build)");
    ok(existsSync(notAClone), "a non-git directory under the secondary-repos root was never touched");
    ok(
      res.retained.some((r) => r.ownerRepo === "shanemccaw/removed-but-live" && /live worktree/.test(r.reason)),
      "the retained reason names the real live worktree, not a silent skip"
    );

    // --- Once the in-flight worktree completes (record removed), a follow-up eviction
    //     pass actually reclaims it. ---
    removeWorktreeRecord(config, path.join(wtRoot, "in-flight"));
    const res2 = evictRemovedRepoClones(config);
    ok(res2.ok === true, "second eviction pass succeeds");
    ok(!existsSync(removedButLiveDir), "once the live worktree's record is gone, its clone is reclaimed on the next pass");

    // --- Fail-closed: an unreadable/missing registry must never be read as "nothing
    //     configured" (which would evict EVERYTHING, including still-configured repos). ---
    process.env.DEV_SERVER_BUILDCONSOLE_APPDATA = path.join(tmpRoot, "appdata-nonexistent");
    const failClosed = evictRemovedRepoClones(config);
    ok(failClosed.ok === false, "an unreadable registry fails CLOSED (ok:false), never silently treated as empty");
    ok(existsSync(stillConfiguredDir), "still-configured clone survives even when the registry becomes unreadable");

    console.log("");
    if (failures) {
      console.error(`${failures} evict-repo-clones self-test failure(s).`);
      process.exit(1);
    }
    console.log("All evict-repo-clones self-tests passed — Git #3630 clone-eviction mechanism holds.");
  } finally {
    try { if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  }
}

main().catch((e) => {
  console.error("evict-repo-clones.selftest crashed:", e.stack || String(e));
  process.exit(2);
});
