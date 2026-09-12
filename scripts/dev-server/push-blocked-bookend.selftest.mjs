#!/usr/bin/env node
// scripts/dev-server/push-blocked-bookend.selftest.mjs
//
// Git #3628 — focused self-test for push-blocked-bookend.mjs, the fix for a
// self-blocked build session's 🛑 BLOCKED bookend commit landing only on its own
// agent branch / the local dev-server checkout and never reaching origin/main
// (confirmed live for #3584/#3585). Stands up a throwaway bare "origin" repo plus a
// worktree-shaped clone, so it never touches the real repo or a real dev-server
// checkout.
//
//   node scripts/dev-server/push-blocked-bookend.selftest.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  extractEffectiveStatus,
  isBlockedStatus,
  readWorktreeBookendStatus,
  runPushBlockedBookend,
} from "./push-blocked-bookend.mjs";

let failures = 0;
function ok(cond, msg) {
  if (cond) {
    console.log(`  ok  - ${msg}`);
  } else {
    failures++;
    console.error(`  FAIL - ${msg}`);
  }
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function commitBookend(cwd, issue, body, message) {
  const dir = path.join(cwd, "build-journal");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${issue}.md`), body);
  git(cwd, ["add", "-A"]);
  git(cwd, ["commit", "-q", "-m", message]);
  return git(cwd, ["rev-parse", "HEAD"]);
}

async function main() {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "push-blocked-bookend-3628-"));
  try {
    // ── Unit checks: effective-status extraction ──────────────────────────────
    const twoStatusLines =
      "- **Status:** ⏳ IN FLIGHT 2026-09-10T20:00:00Z\n" +
      "- **Status:** 🛑 BLOCKED 2026-09-10T20:48:00Z\n";
    ok(
      extractEffectiveStatus(twoStatusLines).includes("BLOCKED"),
      "extractEffectiveStatus takes the LAST **Status:** line, not the first (IN FLIGHT -> BLOCKED)"
    );
    ok(isBlockedStatus(extractEffectiveStatus(twoStatusLines)), "isBlockedStatus is true for an effective BLOCKED status");
    ok(!isBlockedStatus(extractEffectiveStatus("- **Status:** ✅ DONE 2026-09-10T21:00:00Z\n")),
      "isBlockedStatus is false for an effective DONE status (never wrongly cancels real done work)");
    ok(extractEffectiveStatus("no status field here at all") === null, "extractEffectiveStatus returns null when there is no **Status:** field");

    // ── Scenario A: bare "origin" + a worktree-shaped clone, no divergence ────
    const originA = path.join(tmpRoot, "origin-a.git");
    mkdirSync(originA, { recursive: true });
    git(originA, ["init", "-q", "--bare", "-b", "main"]);

    const seedA = path.join(tmpRoot, "seed-a");
    git(tmpRoot, ["clone", "-q", originA, seedA]);
    git(seedA, ["config", "user.email", "t@t"]);
    git(seedA, ["config", "user.name", "t"]);
    writeFileSync(path.join(seedA, "README.md"), "seed\n");
    git(seedA, ["add", "-A"]);
    git(seedA, ["commit", "-q", "-m", "seed"]);
    git(seedA, ["push", "-q", "origin", "main"]);

    const wtA = path.join(tmpRoot, "wt-a");
    git(tmpRoot, ["clone", "-q", originA, wtA]);
    git(wtA, ["config", "user.email", "t@t"]);
    git(wtA, ["config", "user.name", "t"]);

    // No bookend at all yet -> nothing to push, not blocked, ok:true.
    const noneRes = runPushBlockedBookend({ worktree: wtA, issue: 4001 });
    ok(noneRes.ok === true && noneRes.blocked === false, "no committed bookend -> ok:true, blocked:false (nothing to check)");

    // A DONE bookend must never be treated as blocked/pushed by this tool.
    commitBookend(wtA, 4001, "- **Status:** ✅ DONE 2026-09-10T21:00:00Z\n", "Bookend: #4001 DONE");
    const doneRes = runPushBlockedBookend({ worktree: wtA, issue: 4001 });
    ok(doneRes.ok === true && doneRes.blocked === false, "a DONE bookend is left alone -- blocked:false, nothing pushed");

    // Now a genuine self-block: IN FLIGHT then BLOCKED, exactly the real #3585 shape.
    commitBookend(
      wtA,
      4001,
      twoStatusLines,
      "Bookend: #4001 BLOCKED (waiting on #9999)"
    );
    const blockedHeadA = git(wtA, ["rev-parse", "HEAD"]);
    const blockedRes = runPushBlockedBookend({ worktree: wtA, issue: 4001, json: true });
    ok(blockedRes.ok === true, "a genuine BLOCKED bookend with a clean origin push -> ok:true");
    ok(blockedRes.blocked === true, "a genuine BLOCKED bookend is detected as blocked:true");
    ok(blockedRes.pushed === true, "the BLOCKED bookend commit was actually pushed");
    const originAHead = git(originA, ["rev-parse", "main"]);
    ok(originAHead === blockedHeadA, "origin/main's real HEAD now IS the pushed BLOCKED bookend commit -- the #3628 core fix");

    // ── Scenario B: origin moved out from under the worktree (the real race) ──
    const originB = path.join(tmpRoot, "origin-b.git");
    mkdirSync(originB, { recursive: true });
    git(originB, ["init", "-q", "--bare", "-b", "main"]);

    const seedB = path.join(tmpRoot, "seed-b");
    git(tmpRoot, ["clone", "-q", originB, seedB]);
    git(seedB, ["config", "user.email", "t@t"]);
    git(seedB, ["config", "user.name", "t"]);
    writeFileSync(path.join(seedB, "README.md"), "seed\n");
    git(seedB, ["add", "-A"]);
    git(seedB, ["commit", "-q", "-m", "seed"]);
    git(seedB, ["push", "-q", "origin", "main"]);

    const wtB = path.join(tmpRoot, "wt-b");
    git(tmpRoot, ["clone", "-q", originB, wtB]);
    git(wtB, ["config", "user.email", "t@t"]);
    git(wtB, ["config", "user.name", "t"]);
    commitBookend(wtB, 4002, twoStatusLines, "Bookend: #4002 BLOCKED (waiting on #9998)");

    // Meanwhile a DIFFERENT, unrelated commit lands on origin/main first (a peer's
    // build finished while this one ran) -- the ordinary "main moved" race.
    writeFileSync(path.join(seedB, "unrelated.txt"), "peer landed first\n");
    git(seedB, ["add", "-A"]);
    git(seedB, ["commit", "-q", "-m", "unrelated peer commit"]);
    git(seedB, ["push", "-q", "origin", "main"]);

    const raceRes = runPushBlockedBookend({ worktree: wtB, issue: 4002 });
    ok(raceRes.ok === true, "a rejected push (main moved) recovers via fetch+rebase+retry -> ok:true");
    ok(raceRes.pushed === true, "the retry actually landed the push after rebase");
    const bookendOnMainB = git(originB, ["show", "main:build-journal/4002.md"]);
    ok(bookendOnMainB.includes("BLOCKED"), "origin/main now carries the #4002 BLOCKED bookend after the rebase+retry");
    const unrelatedStillOnMainB = git(originB, ["show", "main:unrelated.txt"]);
    ok(unrelatedStillOnMainB.includes("peer landed first"), "the peer's unrelated commit is still on main -- rebase preserved it, did not clobber it");

    // ── readWorktreeBookendStatus direct unit check (used for the C# call path) ─
    const direct = readWorktreeBookendStatus(wtA, 4001);
    ok(direct.found === true && direct.blocked === true, "readWorktreeBookendStatus reads the worktree's own HEAD (not origin), independent of push outcome");

    console.log(failures === 0 ? "\nAll push-blocked-bookend self-tests passed." : `\n${failures} assertion(s) FAILED.`);
  } finally {
    try { rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  }

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e.stack || String(e));
  process.exit(2);
});
