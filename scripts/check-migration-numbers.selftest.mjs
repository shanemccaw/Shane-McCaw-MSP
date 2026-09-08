#!/usr/bin/env node
// scripts/check-migration-numbers.selftest.mjs
//
// Git #3175 -- focused self-test for the ledger-orphan classifier in
// scripts/check-migration-numbers.mjs.
//
// The bug this covers: assertNoOrphanLedgerRows treated every ledger row without a matching
// file on disk as the #3140 rename hazard and failed closed. On this machine that is wrong
// most of the time -- one shared `finances` schema_migrations ledger, one worktree per
// concurrent build off origin/main, so a sibling's freshly-applied migration is a ledger row
// this checkout legitimately does not have yet. Failing on it blocked server boot, and with it
// `npm start`, `npm run migrate` and the whole `npm run check` suite.
//
// Every case below builds REAL temporary migrations directories with REAL .sql files and runs
// the REAL exported functions against them. Nothing is stubbed and no real migrations
// directory, database or ledger is touched.
//
//   node scripts/check-migration-numbers.selftest.mjs

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  classifyOrphanLedgerFilenames,
  assertNoOrphanLedgerRows,
  findOrphanLedgerFilenames,
  highestOnDiskMigrationNumber,
} from "./check-migration-numbers.mjs";

let failures = 0;
function ok(cond, msg) {
  if (cond) {
    console.log(`  ok  - ${msg}`);
  } else {
    failures++;
    console.error(`  FAIL - ${msg}`);
  }
}

function throws(fn, msg) {
  try {
    fn();
    failures++;
    console.error(`  FAIL - ${msg} (expected a throw, got none)`);
    return null;
  } catch (err) {
    console.log(`  ok  - ${msg}`);
    return err;
  }
}

/** Creates two real temp directories mirroring the repo's real two-directory layout. */
function makeDirs(root, survivalFiles, lifeFiles) {
  const survival = path.join(root, "survival-migrations");
  const life = path.join(root, "life-migrations");
  mkdirSync(survival, { recursive: true });
  mkdirSync(life, { recursive: true });
  for (const f of survivalFiles) writeFileSync(path.join(survival, f), "-- test\n");
  for (const f of lifeFiles) writeFileSync(path.join(life, f), "-- test\n");
  return [survival, life];
}

function main() {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "check-migration-numbers-3175-"));
  try {
    // The real shape of the two directories, trimmed: ShanesSurvival owns 001-012, Shane's
    // Life owns 013+.
    const survival = ["001_init.sql", "002_plaid_sync.sql"];
    const life = ["013_foundation.sql", "014_dates.sql", "015_pets.sql"];

    // -------------------------------------------------------------------------------
    console.log("1. a ledger that exactly matches disk is clean");
    {
      const dirs = makeDirs(path.join(tmpRoot, "case1"), survival, life);
      const ledger = [...survival, ...life];
      ok(findOrphanLedgerFilenames(ledger, dirs).length === 0, "no orphans at all");
      const r = assertNoOrphanLedgerRows(ledger, dirs);
      ok(r.ahead.length === 0 && r.missing.length === 0, "assert returns empty ahead/missing");
      ok(highestOnDiskMigrationNumber(dirs) === 15, "highest on-disk number is 15");
    }

    // -------------------------------------------------------------------------------
    console.log("2. #3175's real case: a sibling's higher-numbered migration is AHEAD, not fatal");
    {
      const dirs = makeDirs(path.join(tmpRoot, "case2"), survival, life);
      // The shape of every head that blocked #3150, one after another: applied to the shared
      // database by a sibling build, not yet merged to origin/main, so absent from this
      // worktree entirely.
      const ledger = [...survival, ...life, "016_catches.sql"];
      const c = classifyOrphanLedgerFilenames(ledger, dirs);
      ok(c.ahead.length === 1 && c.ahead[0] === "016_catches.sql", "016_catches.sql classified ahead");
      ok(c.missing.length === 0, "nothing classified missing");
      const r = assertNoOrphanLedgerRows(ledger, dirs);
      ok(r.ahead.length === 1, "assert does NOT throw, and reports the ahead row");
    }

    // -------------------------------------------------------------------------------
    console.log("3. several siblings ahead at once are all tolerated");
    {
      const dirs = makeDirs(path.join(tmpRoot, "case3"), survival, life);
      const ledger = [...survival, ...life, "016_a.sql", "017_b.sql", "018_c.sql"];
      const r = assertNoOrphanLedgerRows(ledger, dirs);
      ok(r.ahead.length === 3, "all three ahead rows reported, none fatal");
    }

    // -------------------------------------------------------------------------------
    console.log("4. the #3140 rename hazard is STILL fatal");
    {
      // 015_pets.sql on disk was applied as 015_animals.sql and renamed -- its SQL would
      // re-run here under the new name. The orphan sits at a number disk already occupies.
      const dirs = makeDirs(path.join(tmpRoot, "case4"), survival, life);
      const ledger = [...survival, "013_foundation.sql", "014_dates.sql", "015_animals.sql"];
      const c = classifyOrphanLedgerFilenames(ledger, dirs);
      ok(c.missing.length === 1 && c.missing[0] === "015_animals.sql", "rename orphan classified missing");
      ok(c.ahead.length === 0, "rename orphan is not mistaken for a sibling");
      const err = throws(() => assertNoOrphanLedgerRows(ledger, dirs), "assert throws on the rename");
      ok(err && err.message.includes("015_animals.sql"), "the failure names the real orphan file");
    }

    // -------------------------------------------------------------------------------
    console.log("5. a rename UPWARD (the shape actually observed: 031 -> 032) is still fatal");
    {
      // The applied file was renamed to a HIGHER number, which now sits on disk. The orphan
      // stays at the OLD, lower number, so it can never look 'ahead' of this checkout.
      const dirs = makeDirs(path.join(tmpRoot, "case5"), survival, [
        ...life,
        "016_vehicle_maintenance_log.sql",
      ]);
      const ledger = [...survival, ...life, "015_vehicle_maintenance_log.sql"];
      const c = classifyOrphanLedgerFilenames(ledger, dirs);
      ok(
        c.missing.length === 1 && c.missing[0] === "015_vehicle_maintenance_log.sql",
        "the pre-rename name is still fatal",
      );
    }

    // -------------------------------------------------------------------------------
    console.log("6. a sibling that TOOK MY NUMBER first is fatal, and says so actionably");
    {
      // Sibling applied 016_theirs.sql; my own unlanded 016_mine.sql sits on disk at the same
      // number. That is the #3139 collision arriving early -- it needs me to renumber, so it
      // must not be waved through as 'ahead'.
      const dirs = makeDirs(path.join(tmpRoot, "case6"), survival, [...life, "016_mine.sql"]);
      const ledger = [...survival, ...life, "016_theirs.sql"];
      const c = classifyOrphanLedgerFilenames(ledger, dirs);
      ok(c.missing.length === 1 && c.missing[0] === "016_theirs.sql", "same-number sibling is fatal");
      const err = throws(() => assertNoOrphanLedgerRows(ledger, dirs), "assert throws on the collision");
      ok(
        err && err.message.includes("TOOK THIS NUMBER FIRST"),
        "the failure explains the renumber fix, not just the rename one",
      );
    }

    // -------------------------------------------------------------------------------
    console.log("7. ahead and fatal rows at once: it fails, but reports both honestly");
    {
      const dirs = makeDirs(path.join(tmpRoot, "case7"), survival, life);
      const ledger = [
        ...survival,
        "013_foundation.sql",
        "014_dates.sql",
        "015_animals.sql",
        "019_sibling.sql",
      ];
      const c = classifyOrphanLedgerFilenames(ledger, dirs);
      ok(c.missing.length === 1 && c.ahead.length === 1, "classified one of each");
      const err = throws(() => assertNoOrphanLedgerRows(ledger, dirs), "assert still throws");
      ok(
        err &&
          err.message.includes("015_animals.sql") &&
          err.message.includes("019_sibling.sql") &&
          err.message.includes("not the "),
        "the failure names the real cause and disclaims the ahead row as harmless",
      );
    }

    // -------------------------------------------------------------------------------
    console.log("8. a ledger row with no numeric prefix can never be classified ahead");
    {
      const dirs = makeDirs(path.join(tmpRoot, "case8"), survival, life);
      const ledger = [...survival, ...life, "hotfix_by_hand.sql"];
      const c = classifyOrphanLedgerFilenames(ledger, dirs);
      ok(c.missing.length === 1 && c.ahead.length === 0, "unnumbered orphan stays fatal");
    }

    // -------------------------------------------------------------------------------
    console.log("9. an empty checkout (no numbered files at all) never waves anything through");
    {
      const dirs = makeDirs(path.join(tmpRoot, "case9"), [], []);
      ok(highestOnDiskMigrationNumber(dirs) === null, "highest on-disk number is null");
      const c = classifyOrphanLedgerFilenames(["013_foundation.sql"], dirs);
      ok(c.ahead.length === 0 && c.missing.length === 1, "with nothing on disk, nothing is ahead");
    }

    // -------------------------------------------------------------------------------
    console.log("10. findOrphanLedgerFilenames keeps its original meaning for reconcile-ledger.mjs");
    {
      // bin/reconcile-ledger.mjs uses this to refuse touching a row whose file still exists.
      // Narrowing the ASSERT must not narrow this.
      const dirs = makeDirs(path.join(tmpRoot, "case10"), survival, life);
      ok(
        findOrphanLedgerFilenames(["015_pets.sql"], dirs).length === 0,
        "a file still on disk is not orphaned",
      );
      ok(
        findOrphanLedgerFilenames(["016_gone.sql"], dirs).length === 1,
        "an ahead row is still reported as orphaned",
      );
    }

    // -------------------------------------------------------------------------------
    console.log(
      "11a. Git #3239: my own new unmerged file at a HIGHER number must not hide a sibling's " +
        "lower ahead row",
    );
    {
      // Real repro: sibling applied 049_bill_cycle_snapshots.sql (ledger row, not yet merged,
      // so not on disk here). This checkout's own new, unmerged file has no number conflict, so
      // it landed at 050_room_order.sql -- one number ABOVE the sibling's. The old
      // `> highestOnDiskMigrationNumber` test made highest=50 (from MY OWN file) and failed the
      // sibling's 49 as "not ahead", misclassifying it missing/fatal.
      const dirs = makeDirs(path.join(tmpRoot, "case11a"), survival, [
        ...life,
        "050_room_order.sql",
      ]);
      const ledger = [...survival, ...life, "049_bill_cycle_snapshots.sql"];
      const c = classifyOrphanLedgerFilenames(ledger, dirs);
      ok(
        c.ahead.length === 1 && c.ahead[0] === "049_bill_cycle_snapshots.sql",
        "sibling's 049 is classified ahead, not hidden by my own higher 050",
      );
      ok(c.missing.length === 0, "nothing classified missing");
      const r = assertNoOrphanLedgerRows(ledger, dirs);
      ok(r.ahead.length === 1, "assert does NOT throw -- server boot is not blocked");
    }

    // -------------------------------------------------------------------------------
    console.log("11. the numeric compare is real, not lexical (099 vs 100)");
    {
      const dirs = makeDirs(path.join(tmpRoot, "case11"), survival, ["099_ninety_nine.sql"]);
      ok(highestOnDiskMigrationNumber(dirs) === 99, "highest on-disk number is 99, not '099'");
      const c = classifyOrphanLedgerFilenames([...survival, "099_ninety_nine.sql", "100_hundred.sql"], dirs);
      ok(c.ahead.length === 1 && c.ahead[0] === "100_hundred.sql", "100 is ahead of 099");
    }
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log("");
  if (failures > 0) {
    console.error(`check-migration-numbers.selftest: ${failures} FAILURE(S)`);
    process.exitCode = 1;
  } else {
    console.log("check-migration-numbers.selftest: all checks passed");
  }
}

main();
