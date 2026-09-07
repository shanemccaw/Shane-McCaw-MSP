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

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    assertNoDuplicateMigrationNumbers();
    console.log("[check-migration-numbers] OK -- no cross-directory number collisions");
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
