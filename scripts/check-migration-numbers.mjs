#!/usr/bin/env node
// Guards the shared migration number space across ShanesSurvival's and Shane's Life's
// separate migrations directories (Git #3118), AND the number space WITHIN
// web/shanes-life/migrations itself (Git #3139). One Postgres database is migrated by two
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
// Git #3139: web/shanes-life/migrations/ now has MANY concurrent build sessions (it did not
// when the header above was written), and they collide on numbers routinely -- three separate
// builds all picked 026 the same day (026_meal_plan.sql, 026_medications.sql, and a third
// renamed to 027 by hand at merge time), and 023 collided the same way earlier. A same-directory
// collision is exactly as real a fresh-database ordering hazard as a cross-directory one
// (`readdirSync(...).sort()` picks the alphabetical tiebreak, not necessarily the order the
// files were written/tested in), so this now flags BOTH kinds -- except for the one directory
// that genuinely has a historical, already-applied, harmless pair: 010_debt_is_critical.sql /
// 010_expected_events.sql, both in desktop/ShanesSurvival/migrations, predating this guard
// entirely. That pair (and any future genuinely-historical pair) is allowlisted explicitly below
// so the check fails only on NEW collisions, not on landed history.
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

// Genuinely historical same-directory number pairs, already applied, predating this guard --
// allowlisted by exact filename set so the check fails only on NEW same-directory collisions.
const ALLOWLISTED_SAME_DIR_DUPLICATES = [
  {
    dir: resolve(REPO_ROOT, "desktop/ShanesSurvival/migrations"),
    files: new Set(["010_debt_is_critical.sql", "010_expected_events.sql"]),
  },
];

function isAllowlistedSameDir(dir, files) {
  const fileSet = new Set(files);
  return ALLOWLISTED_SAME_DIR_DUPLICATES.some(
    (entry) =>
      entry.dir === dir &&
      entry.files.size === fileSet.size &&
      [...entry.files].every((f) => fileSet.has(f)),
  );
}

function readNumberedSqlFiles(dir) {
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
  } catch {
    return []; // directory absent in this checkout (e.g. a partial worktree) -- not flagged here
  }
  const numbered = [];
  for (const file of files) {
    const match = NUMBER_PREFIX.exec(file);
    if (!match) continue; // unnumbered file -- not this check's concern
    numbered.push({ file, number: match[1] });
  }
  return numbered;
}

/**
 * Reads every *.sql filename out of each directory, extracts its leading number, and returns
 * any number used by files in more than one DISTINCT directory.
 */
export function findDuplicateMigrationNumbers(dirs = MIGRATION_DIRS) {
  const byNumber = new Map(); // number -> [{ file, dir }]

  for (const dir of dirs) {
    for (const { file, number } of readNumberedSqlFiles(dir)) {
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

/**
 * Reads every *.sql filename within EACH directory individually and returns any number reused
 * by more than one file in that SAME directory (Git #3139), excluding allowlisted historical
 * pairs.
 */
export function findSameDirectoryDuplicateMigrationNumbers(dirs = MIGRATION_DIRS) {
  const duplicates = [];

  for (const dir of dirs) {
    const byNumber = new Map(); // number -> [file]
    for (const { file, number } of readNumberedSqlFiles(dir)) {
      if (!byNumber.has(number)) byNumber.set(number, []);
      byNumber.get(number).push(file);
    }
    for (const [number, files] of byNumber) {
      if (files.length < 2) continue;
      if (isAllowlistedSameDir(dir, files)) continue;
      duplicates.push({ number, dir, files });
    }
  }

  return duplicates.sort((a, b) => a.number.localeCompare(b.number) || a.dir.localeCompare(b.dir));
}

function formatDuplicates(duplicates) {
  return duplicates
    .map(({ number, entries }) => `  ${number}: ${entries.map((e) => `${e.file} (${e.dir})`).join(" AND ")}`)
    .join("\n");
}

function formatSameDirDuplicates(duplicates) {
  return duplicates
    .map(({ number, dir, files }) => `  ${number} in ${dir}: ${files.join(" AND ")}`)
    .join("\n");
}

/**
 * Throws with a real, actionable message if any cross-directory OR same-directory (non-
 * allowlisted) number collision exists.
 */
export function assertNoDuplicateMigrationNumbers(dirs = MIGRATION_DIRS) {
  const duplicates = findDuplicateMigrationNumbers(dirs);
  if (duplicates.length > 0) {
    throw new Error(
      `Migration number collision across desktop/ShanesSurvival/migrations and ` +
        `web/shanes-life/migrations -- the same leading number was used in both directories, ` +
        `which makes apply order ambiguous on a fresh database (Git #3118):\n` +
        formatDuplicates(duplicates) +
        `\nRename the newer file to the next free number across BOTH directories before proceeding.`,
    );
  }

  const sameDirDuplicates = findSameDirectoryDuplicateMigrationNumbers(dirs);
  if (sameDirDuplicates.length > 0) {
    throw new Error(
      `Migration number collision WITHIN one migrations directory -- the same leading number ` +
        `was picked by more than one file in the same directory, which makes apply order ` +
        `ambiguous on a fresh database (readdirSync(...).sort() alphabetical tiebreak is not ` +
        `necessarily write/test order) (Git #3139):\n` +
        formatSameDirDuplicates(sameDirDuplicates) +
        `\nRename the newer file(s) to the next free number in that directory before proceeding.`,
    );
  }
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
      `only if the migration is purely idempotent. It can also be another, unrelated session's ` +
      `own in-flight rename on this shared local database -- migrate.mjs retries a few times ` +
      `before surfacing this (Git #3166), so if you are seeing this, that retry already gave up. ` +
      `Either rename the file back, or if the rename/duplicate is genuinely yours and safe:\n` +
      `  node bin/reconcile-ledger.mjs rename <old filename> <new filename>   (web/shanes-life only)\n` +
      `  node bin/reconcile-ledger.mjs delete <filename>                     (web/shanes-life only)\n` +
      `or fix up the ledger by hand:\n` +
      `  UPDATE schema_migrations SET filename = '<new filename>' WHERE filename = '<old filename>';`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    assertNoDuplicateMigrationNumbers();
    console.log("[check-migration-numbers] OK -- no cross-directory or same-directory number collisions");
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
