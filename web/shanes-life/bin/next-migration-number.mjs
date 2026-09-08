#!/usr/bin/env node
// Real fix for Git #3197: picking a migration number by reading ONLY the two local migrations
// directories is exactly what let two concurrent builds both land on 044 the same night --
// `044_income_rules.sql` (#3168) and `044_money_home_tab_decision_tools.sql` (#3171). Neither
// session's worktree had the other's file on disk, and `origin/main` didn't either until one of
// them merged, so nothing in either local checkout could see the collision coming. #3139 only
// ever detected a collision after the fact.
//
// The one place both claims WERE already visible, live, the whole time: the shared
// `schema_migrations` ledger both migrate.mjs and MigrationRunner.cs write to as soon as a
// migration runs locally (Git #3166's own header: this ledger is shared, live, across every
// concurrent worktree on this machine). A build that runs its own new migration locally before
// merging -- which is already required, real work -- has already claimed its number in the one
// place a peer session can see it.
//
// This prints the next free migration number by taking the ledger AND both on-disk directories
// as the combined set of taken numbers, so a peer's already-applied-locally-but-not-yet-merged
// migration is visible even though its file isn't in your worktree and isn't on origin/main yet.
//
// This is advisory, not a new gate -- assertNoDuplicateMigrationNumbers (#3118/#3139) and
// assertNoOrphanLedgerRows (#3140) in scripts/check-migration-numbers.mjs remain the real
// enforcement, unchanged. This just gives a session picking a number something better than
// "read my own worktree's two directories and guess."
//
// Run: node bin/next-migration-number.mjs

import { readdirSync } from "node:fs";
import { pool, closePool } from "../src/db.mjs";
import { MIGRATION_DIRS } from "../../../scripts/check-migration-numbers.mjs";

const NUMBER_PREFIX = /^(\d+)_/;

function onDiskNumbers() {
  const numbers = new Set();
  for (const dir of MIGRATION_DIRS) {
    let files;
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
    } catch {
      continue; // directory absent in this checkout -- not this script's concern
    }
    for (const file of files) {
      const match = NUMBER_PREFIX.exec(file);
      if (match) numbers.add(Number(match[1]));
    }
  }
  return numbers;
}

async function ledgerNumbers() {
  const { rows } = await pool.query("SELECT filename FROM schema_migrations");
  const numbers = new Set();
  for (const { filename } of rows) {
    const match = NUMBER_PREFIX.exec(filename);
    if (match) numbers.add(Number(match[1]));
  }
  return numbers;
}

async function main() {
  const disk = onDiskNumbers();
  let ledger;
  try {
    ledger = await ledgerNumbers();
  } catch (err) {
    console.error(
      `[next-migration-number] could not reach the shared schema_migrations ledger ` +
        `(${err.message}) -- falling back to on-disk directories only. The number below may ` +
        `already be claimed by a peer session's in-flight, not-yet-merged migration; re-run ` +
        `once the database is reachable to be sure.`,
    );
    ledger = new Set();
  }

  const peerOnly = [...ledger].filter((n) => !disk.has(n)).sort((a, b) => a - b);
  if (peerOnly.length > 0) {
    console.error(
      `[next-migration-number] ledger holds ${peerOnly.length === 1 ? "a number" : "numbers"} ` +
        `not yet on disk in this worktree (likely a peer session's in-flight migration, run ` +
        `locally but not yet merged to main): ${peerOnly.join(", ")}`,
    );
  }

  const taken = new Set([...disk, ...ledger]);
  const highest = taken.size > 0 ? Math.max(...taken) : 0;
  const next = String(highest + 1).padStart(3, "0");

  console.log(next);
}

main()
  .catch((err) => {
    console.error(`next-migration-number failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
