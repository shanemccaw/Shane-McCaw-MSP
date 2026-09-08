#!/usr/bin/env node
// Guards the shared migration number space across ShanesSurvival's and Shane's Life's
// separate migrations directories (Git #3118). One Postgres database is migrated by two
// runners reading two different directories, sharing one schema_migrations(filename,
// applied_at) ledger:
//
//   desktop/ShanesSurvival/migrations/  -- 001-012, run by MigrationRunner.cs
//   web/shanes-life/migrations/         -- 013+,    run by web/shanes-life/src/migrate.mjs
//
// Each runner only ever executes files from its own directory, so neither can run the
// other's -- that part is safe. What was NOT safe is the number space: nothing enforced that
// the same leading number couldn't be reused across the two directories, which makes apply
// order on a fresh database ambiguous (whichever runner goes first wins) and lies to anyone
// reading the ledger about which migration actually came first.
//
// This does NOT flag two files sharing a number within the SAME directory (e.g.
// 010_debt_is_critical.sql / 010_expected_events.sql both in desktop/ShanesSurvival/migrations)
// -- that's an existing, already-applied, single-runner ordering quirk (alphabetical tiebreak
// within one directory), not the cross-directory ambiguity this check exists to catch.
//
// Run standalone: node scripts/check-migration-numbers.mjs
// Also called from web/shanes-life/src/migrate.mjs before every real migration run.

import { readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

export const MIGRATION_DIRS = [
  resolve(REPO_ROOT, "desktop/ShanesSurvival/migrations"),
  resolve(REPO_ROOT, "web/shanes-life/migrations"),
];

const NUMBER_PREFIX = /^(\d+)_/;

/**
 * Reads every *.sql filename out of each directory, extracts its leading number, and returns
 * any number used by files in more than one DISTINCT directory. Duplicates within a single
 * directory are not this check's concern (see header).
 */
export function findDuplicateMigrationNumbers(dirs = MIGRATION_DIRS) {
  const byNumber = new Map(); // number -> [{ file, dir }]

  for (const dir of dirs) {
    let files;
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
    } catch {
      continue; // directory absent in this checkout (e.g. a partial worktree) -- not flagged here
    }
    for (const file of files) {
      const match = NUMBER_PREFIX.exec(file);
      if (!match) continue; // unnumbered file -- not this check's concern
      const number = match[1];
      if (!byNumber.has(number)) byNumber.set(number, []);
      byNumber.get(number).push({ file, dir });
    }
  }

  const duplicates = [];
  for (const [number, entries] of byNumber) {
    const distinctDirs = new Set(entries.map((e) => e.dir));
    if (distinctDirs.size > 1) duplicates.push({ number, entries });
  }
  return duplicates.sort((a, b) => a.number.localeCompare(b.number));
}

function formatDuplicates(duplicates) {
  return duplicates
    .map(({ number, entries }) => `  ${number}: ${entries.map((e) => `${e.file} (${e.dir})`).join(" AND ")}`)
    .join("\n");
}

/** Throws with a real, actionable message if any cross-directory number collision exists. */
export function assertNoDuplicateMigrationNumbers(dirs = MIGRATION_DIRS) {
  const duplicates = findDuplicateMigrationNumbers(dirs);
  if (duplicates.length === 0) return;
  throw new Error(
    `Migration number collision across desktop/ShanesSurvival/migrations and ` +
      `web/shanes-life/migrations -- the same leading number was used in both directories, ` +
      `which makes apply order ambiguous on a fresh database (Git #3118):\n` +
      formatDuplicates(duplicates) +
      `\nRename the newer file to the next free number across BOTH directories before proceeding.`,
  );
}

/**
 * Returns every filename the shared schema_migrations ledger holds a row for that no longer
 * exists in EITHER migrations directory (Git #3140). The ledger is keyed on filename; renaming
 * an already-applied file (as #3140's own repro did, dodging the #3118 collision guard above)
 * leaves an orphan row pointing at a name nothing on disk has anymore, and the file re-executes
 * under its new name on every environment that already ran the old one -- silently, and
 * potentially unsafely for any migration that isn't purely idempotent.
 */
export function findOrphanLedgerFilenames(ledgerFilenames, dirs = MIGRATION_DIRS) {
  const onDisk = new Set();
  for (const dir of dirs) {
    let files;
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
    } catch {
      continue; // directory absent in this checkout -- not this check's concern
    }
    for (const file of files) onDisk.add(file);
  }
  return ledgerFilenames.filter((f) => !onDisk.has(f)).sort();
}

/**
 * Throws with a real, actionable message if the ledger holds any row for a filename that no
 * longer exists in either migrations directory (Git #3140) -- turning what used to be a silent
 * re-run under the new name into a loud, readable stop before anything is applied.
 */
export function assertNoOrphanLedgerRows(ledgerFilenames, dirs = MIGRATION_DIRS) {
  const orphans = findOrphanLedgerFilenames(ledgerFilenames, dirs);
  if (orphans.length === 0) return;
  throw new Error(
    `schema_migrations holds ${orphans.length === 1 ? "a row" : "rows"} for ` +
      `${orphans.length === 1 ? "a file" : "files"} that no longer exist in either migrations ` +
      `directory (Git #3140):\n` +
      orphans.map((f) => `  ${f}`).join("\n") +
      `\nThis almost always means an already-applied migration was renamed. Renaming re-runs ` +
      `the identical SQL under the new name on every environment that already ran it -- safe ` +
      `only if the migration is purely idempotent. Either rename it back, or if the rename is ` +
      `intentional, fix up the ledger by hand first:\n` +
      `  UPDATE schema_migrations SET filename = '<new filename>' WHERE filename = '<old filename>';`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    assertNoDuplicateMigrationNumbers();
    console.log("[check-migration-numbers] OK -- no cross-directory number collisions");
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
