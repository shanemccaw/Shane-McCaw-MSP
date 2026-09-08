#!/usr/bin/env node
// Self-service fix for a shared-ledger collision (Git #3166), scoped to Shane's Life's OWN
// migrations directory only.
//
// `schema_migrations` is one real table shared by two runners reading two different
// directories (desktop/ShanesSurvival/migrations 001-012, web/shanes-life/migrations 013+ --
// see src/migrate.mjs's header), and that table lives in local Postgres, which is itself shared
// across every concurrent worktree on this machine. `assertNoOrphanLedgerRows` (Git #3140)
// correctly refuses to run/boot when the ledger holds a row for a filename that no longer
// exists on disk -- but until now the only fix was hand-editing that shared table mid-collision,
// which the repo's own Bash permission classifier correctly refuses (the row could still be
// legitimately in use by another, unrelated, still-in-flight session).
//
// This gives a session that KNOWS its own rename or duplicate is safe a narrow, scoped way to
// reconcile ONLY its own row, without ever being able to touch a row that belongs to
// ShanesSurvival's 001-012 range or to a file that still genuinely exists on disk.
//
// Modelled on the main monorepo's scripts/src/migrate-mark-applied.ts (CLAUDE.md's
// destructive-migration-gate section) -- same idea, scoped to this app's own single directory
// and ledger instead of Drizzle's `__drizzle_migrations`.
//
// Run:
//   node bin/reconcile-ledger.mjs rename <old filename> <new filename>
//   node bin/reconcile-ledger.mjs delete <filename>
//
// Exit codes:
//   0 -- reconciled (or already reconciled, nothing to do)
//   1 -- bad arguments, or the guard below refused the operation

import { pool, closePool } from "../src/db.mjs";
import {
  MIGRATION_DIRS,
  findOrphanLedgerFilenames,
} from "../../../scripts/check-migration-numbers.mjs";
import { readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHANES_LIFE_MIGRATIONS_DIR = resolve(__dirname, "../migrations");

// Shane's Life's own migrations start at 013 (see src/migrate.mjs's header). Refusing anything
// below that number means this tool can never touch a row that belongs to ShanesSurvival's
// 001-012 range, even if one somehow ended up looking orphaned -- that ledger range is
// MigrationRunner.cs's concern, not this app's.
const NUMBER_PREFIX = /^(\d+)_/;
const SHANES_LIFE_MIN_NUMBER = 13;

function usage() {
  console.error("Usage:");
  console.error("  node bin/reconcile-ledger.mjs rename <old filename> <new filename>");
  console.error("  node bin/reconcile-ledger.mjs delete <filename>");
  console.error("");
  console.error("Scoped to web/shanes-life/migrations (013+) only -- refuses anything else.");
  process.exit(1);
}

function requireShanesLifeNumber(filename, label) {
  const match = NUMBER_PREFIX.exec(filename);
  const number = match ? Number(match[1]) : NaN;
  if (!match || Number.isNaN(number) || number < SHANES_LIFE_MIN_NUMBER) {
    throw new Error(
      `${label} "${filename}" does not look like a web/shanes-life/migrations file (013+). ` +
        `Refusing -- this tool never touches ShanesSurvival's 001-012 range.`,
    );
  }
}

async function assertOrphan(filename, label) {
  const orphans = findOrphanLedgerFilenames([filename], MIGRATION_DIRS);
  if (orphans.length === 0) {
    throw new Error(
      `${label} "${filename}" still exists on disk in one of the migrations directories. ` +
        `Refusing -- this tool only reconciles a row that is genuinely orphaned (Git #3140), ` +
        `never a row that could still be legitimately in use.`,
    );
  }
}

async function ledgerHasRow(client, filename) {
  const { rows } = await client.query(
    "SELECT 1 FROM schema_migrations WHERE filename = $1",
    [filename],
  );
  return rows.length > 0;
}

async function rename(oldFilename, newFilename) {
  requireShanesLifeNumber(oldFilename, "old filename");
  requireShanesLifeNumber(newFilename, "new filename");
  await assertOrphan(oldFilename, "old filename");

  const onDisk = readdirSync(SHANES_LIFE_MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  if (!onDisk.includes(newFilename)) {
    throw new Error(
      `new filename "${newFilename}" does not exist in ${SHANES_LIFE_MIGRATIONS_DIR}. ` +
        `Refusing -- a rename must point at a real file in THIS session's own directory.`,
    );
  }

  const client = await pool.connect();
  try {
    if (!(await ledgerHasRow(client, oldFilename))) {
      console.log(`[reconcile-ledger] no row for "${oldFilename}" -- nothing to do.`);
      return;
    }
    if (await ledgerHasRow(client, newFilename)) {
      throw new Error(
        `a row for "${newFilename}" already exists in schema_migrations -- renaming would ` +
          `collide with it. Resolve that by hand before retrying.`,
      );
    }
    await client.query(
      "UPDATE schema_migrations SET filename = $1 WHERE filename = $2",
      [newFilename, oldFilename],
    );
    console.log(`[reconcile-ledger] renamed "${oldFilename}" -> "${newFilename}" in schema_migrations.`);
  } finally {
    client.release();
  }
}

async function del(filename) {
  requireShanesLifeNumber(filename, "filename");
  await assertOrphan(filename, "filename");

  const client = await pool.connect();
  try {
    if (!(await ledgerHasRow(client, filename))) {
      console.log(`[reconcile-ledger] no row for "${filename}" -- nothing to do.`);
      return;
    }
    await client.query("DELETE FROM schema_migrations WHERE filename = $1", [filename]);
    console.log(
      `[reconcile-ledger] deleted the row for "${filename}" from schema_migrations. ` +
        `Only do this for a genuinely duplicate/idempotent re-run -- deleting a row for a ` +
        `migration that is NOT safe to re-run will re-apply it on the next migrate.`,
    );
  } finally {
    client.release();
  }
}

async function main() {
  const [action, ...args] = process.argv.slice(2);
  if (action === "rename") {
    if (args.length !== 2) usage();
    await rename(args[0], args[1]);
  } else if (action === "delete") {
    if (args.length !== 1) usage();
    await del(args[0]);
  } else {
    usage();
  }
}

main()
  .catch((err) => {
    console.error(`reconcile-ledger failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
