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
// Git #3175: the ledger-orphan half of this file (assertNoOrphanLedgerRows, below) used to treat
// every ledger row without a file on disk as the same thing, and fail closed on all of them.
// That is wrong on this machine, because the ledger is ONE shared table and each build runs in
// its own worktree off origin/main -- so between "sibling applied its migration" and "sibling's
// commit reached origin/main and I merged it", every concurrent build's ledger is legitimately
// ahead of its own migrations/ directory. #3175 measured that window moving four times in ~20
// minutes across 5-10 live builds, each move a separate failed server boot, which took out
// `npm start` and therefore `npm run check` (the whole 192-check end-to-end suite) as well as
// `npm run migrate`. classifyOrphanLedgerFilenames now separates a row that is AHEAD of this
// checkout (harmless -- nothing here can re-run under it) from one that is genuinely MISSING
// (the rename hazard #3140 exists for, still fatal).
//
// Run standalone: node scripts/check-migration-numbers.mjs
// Also called from web/shanes-life/src/migrate.mjs before every real migration run.
// Self-test:     node scripts/check-migration-numbers.selftest.mjs

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
        `\nRename the newer file(s) to the next free number in that directory before proceeding ` +
        `(node bin/next-migration-number.mjs from web/shanes-life -- Git #3197 -- picks the real ` +
        `next-free number off the shared ledger, not just this worktree's own directories). ` +
        `TRAP (Git #3197): if BOTH colliding files are already applied and already have rows in ` +
        `schema_migrations, renaming one on disk turns it into an orphan ledger row and trips ` +
        `assertNoOrphanLedgerRows (#3140) instead -- rename the file AND update its row with ` +
        `\`node bin/reconcile-ledger.mjs rename <old> <new>\` in the same step, not just the file.`,
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
 * The highest leading migration number present on disk across `dirs`, or null if none of them
 * holds a numbered *.sql file at all. Used to tell a ledger row that is AHEAD of this checkout
 * from one that is genuinely MISSING from it -- see classifyOrphanLedgerFilenames.
 */
export function highestOnDiskMigrationNumber(dirs = MIGRATION_DIRS) {
  let highest = null;
  for (const dir of dirs) {
    for (const { number } of readNumberedSqlFiles(dir)) {
      const n = Number(number);
      if (Number.isNaN(n)) continue;
      if (highest === null || n > highest) highest = n;
    }
  }
  return highest;
}

/**
 * Splits the orphan rows (see findOrphanLedgerFilenames) into the two genuinely different
 * situations they conflate today (Git #3175).
 *
 * `ahead` -- no file ANYWHERE on disk currently occupies the row's leading number. It cannot be
 * a rename of anything this checkout has, because this checkout has no file at that number at
 * all under any name. It is a concurrent sibling build's brand-new migration: applied against
 * this shared local Postgres, not yet merged to origin/main, so not yet in this worktree.
 * Nothing on disk will re-run because of it and nothing is unsafe -- there is simply a migration
 * in the database this checkout doesn't have yet. Reported, not fatal.
 *
 * `missing` -- everything else: the row's number IS occupied on disk (by a file under a
 * different name), or the row has no numeric prefix at all. That is the shape #3140 exists to
 * catch -- an already-applied migration renamed, whose identical SQL then re-executes under the
 * new name on every environment that already ran the old one. Still fatal. It also correctly
 * catches the #3139 same-number-collision case, where a sibling took the same number my own
 * unlanded file is sitting on: that number IS occupied on disk (by my own file), so the row
 * classifies as missing/fatal exactly as it should.
 *
 * Git #3239: this used to compare each orphan's number against `highestOnDiskMigrationNumber`
 * (the single highest number across BOTH directories) and only call it `ahead` when strictly
 * greater. That broke the moment THIS checkout's own new, unmerged migration happened to land at
 * a number above an unrelated sibling's unmerged number -- e.g. this checkout's own new
 * `050_room_order.sql` pushed "highest on disk" to 50, so a sibling's real, harmless `049_...`
 * orphan failed the `> highest` test and was misclassified `missing` (fatal), blocking `npm run
 * migrate` and the app's own server boot over nothing. The fix: classify by whether the row's
 * NUMBER IS OCCUPIED on disk, not by comparison to a single global "highest" -- a checkout's own
 * unrelated new file at a higher number is irrelevant to whether a DIFFERENT number is safe.
 *
 * Why this split is the correct one, and what it deliberately does not cover:
 *
 *   Shane's Life builds all share ONE local `finances` database and its ONE schema_migrations
 *   ledger, but each runs in its own worktree off origin/main (CLAUDE.md's worktree-isolation
 *   section). So for the whole window between "sibling applied its migration" and "sibling's
 *   commit reached origin/main and I merged it", EVERY concurrent build's ledger is ahead of its
 *   own migrations/ directory -- through no fault of its own. #3175 measured that window moving
 *   four times in ~20 minutes with 5-10 builds live, each one a separate failed boot, which is
 *   why the practical outcome was Shane's Life work shipping module-verified instead of
 *   end-to-end. Treating "ahead" as fatal made the guard's precondition ("the ledger and my
 *   directory agree") false most of the time.
 *
 *   A rename always leaves its orphan row at the number the file used to have, and the renamed
 *   file itself sits on disk at its new number -- so the orphan's number is always occupied on
 *   disk by the renamed file, and stays fatal, regardless of what any OTHER checkout's file is
 *   doing elsewhere in the number space.
 *
 *   An empty checkout (no numbered files on disk at all -- `highestOnDisk === null`) never
 *   classifies anything as `ahead`, even though technically no number is "occupied": a checkout
 *   with nothing on disk is a broken/partial state, not a legitimate baseline to compare against.
 */
export function classifyOrphanLedgerFilenames(ledgerFilenames, dirs = MIGRATION_DIRS) {
  const orphans = findOrphanLedgerFilenames(ledgerFilenames, dirs);

  const onDiskNumbers = new Set();
  let highest = null;
  for (const dir of dirs) {
    for (const { number } of readNumberedSqlFiles(dir)) {
      const n = Number(number);
      if (Number.isNaN(n)) continue;
      onDiskNumbers.add(n);
      if (highest === null || n > highest) highest = n;
    }
  }

  const ahead = [];
  const missing = [];
  for (const filename of orphans) {
    const match = NUMBER_PREFIX.exec(filename);
    const number = match ? Number(match[1]) : NaN;
    if (!Number.isNaN(number) && highest !== null && !onDiskNumbers.has(number)) ahead.push(filename);
    else missing.push(filename);
  }
  return { ahead, missing, highestOnDisk: highest };
}

/**
 * Throws with a real, actionable message if the ledger holds a row for a filename that no longer
 * exists in either migrations directory AND is not simply ahead of this checkout (Git #3140,
 * narrowed by Git #3175) -- turning what used to be a silent re-run under the new name into a
 * loud, readable stop before anything is applied, without also stopping every build whose only
 * problem is that a sibling landed a migration first.
 *
 * Returns { ahead, missing: [], highestOnDisk } so the caller can report the ahead rows in its
 * own voice. `ahead` being non-empty is normal on this machine and is not a failure.
 */
export function assertNoOrphanLedgerRows(ledgerFilenames, dirs = MIGRATION_DIRS) {
  const { ahead, missing, highestOnDisk } = classifyOrphanLedgerFilenames(ledgerFilenames, dirs);
  if (missing.length === 0) return { ahead, missing, highestOnDisk };
  throw new Error(
    `schema_migrations holds ${missing.length === 1 ? "a row" : "rows"} for ` +
      `${missing.length === 1 ? "a file" : "files"} that no longer exist in either migrations ` +
      `directory, at ${missing.length === 1 ? "a number" : "numbers"} this checkout DOES have ` +
      `on disk under another name (Git #3140):\n` +
      missing.map((f) => `  ${f}`).join("\n") +
      (ahead.length > 0
        ? `\n(Separately, and harmlessly: ${ahead.join(", ")} ${ahead.length === 1 ? "is" : "are"} ` +
          `ahead of this checkout -- a concurrent build's migration, not a problem, not the ` +
          `reason for this failure.)`
        : "") +
      `\nTwo things produce this, and they have different fixes:\n` +
      `  1. An already-applied migration was RENAMED. Renaming re-runs the identical SQL under ` +
      `the new name on every environment that already ran it -- safe only if the migration is ` +
      `purely idempotent. Rename the file back, or reconcile the ledger (below).\n` +
      `  2. A concurrent sibling build TOOK THIS NUMBER FIRST and applied its own file at it, ` +
      `while your unlanded file sits at the same number on disk. That is the #3139 collision ` +
      `arriving early: rename YOUR file to the next number free across BOTH migrations ` +
      `directories, and this clears itself.\n` +
      `If the rename/duplicate is genuinely yours and safe:\n` +
      `  node bin/reconcile-ledger.mjs rename <old filename> <new filename>   (web/shanes-life only)\n` +
      `  node bin/reconcile-ledger.mjs delete <filename>                     (web/shanes-life only)\n` +
      `or fix up the ledger by hand:\n` +
      `  UPDATE schema_migrations SET filename = '<new filename>' WHERE filename = '<old filename>';`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    assertNoDuplicateMigrationNumbers();
    console.log("[check-migration-numbers] OK -- no cross-directory or same-directory number collisions");
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
