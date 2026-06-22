/**
 * check-migration-drift.ts
 *
 * CI-safe static check — requires no database connection.
 *
 * Checks three things:
 *
 *   1. SCHEMA DRIFT: Has lib/db/src/schema/index.ts changed since the last
 *      `drizzle-kit generate` run?  Detected by comparing the current file's
 *      SHA-256 hash against lib/db/drizzle/meta/schema-hash.txt (written
 *      automatically by `pnpm --filter @workspace/db run generate`).
 *
 *   2. BROKEN JOURNAL: Does every journal entry in _journal.json have a
 *      corresponding .sql file on disk?  Missing files mean generate was
 *      interrupted or the file was accidentally deleted.
 *
 *   3. ORPHANED SQL FILES: Are there .sql files in lib/db/drizzle/ that are
 *      NOT tracked in the journal?  These will NOT be auto-applied by
 *      migrate-prod and may cause confusion.
 *
 * Exit codes:
 *   0 — clean (no errors; warnings are printed but don't fail CI)
 *   1 — schema drift detected or journal broken
 *
 * How to fix each issue:
 *   Schema drift  → pnpm --filter @workspace/db run generate
 *   Broken journal → pnpm --filter @workspace/db run generate (or restore file)
 *   Orphaned SQL  → remove the file or incorporate it into a proper migration
 *
 * Run:
 *   pnpm --filter @workspace/scripts run check-drift
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DRIZZLE_DIR = path.resolve(__dirname, "../../lib/db/drizzle");
const JOURNAL_PATH = path.join(DRIZZLE_DIR, "meta/_journal.json");
const SCHEMA_HASH_PATH = path.join(DRIZZLE_DIR, "schema-hash.txt");
const SCHEMA_PATH = path.resolve(__dirname, "../../lib/db/src/schema/index.ts");

// ---------------------------------------------------------------------------
// Terminal colours (gracefully degrade when not a TTY)
// ---------------------------------------------------------------------------
const isTTY = process.stdout.isTTY;
const bold = (s: string) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s);
const red = (s: string) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s);
const yellow = (s: string) => (isTTY ? `\x1b[33m${s}\x1b[0m` : s);
const green = (s: string) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s);
const dim = (s: string) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

interface Journal {
  entries: JournalEntry[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function computeSchemaHash(): string {
  const content = fs.readFileSync(SCHEMA_PATH);
  return crypto.createHash("sha256").update(content).digest("hex");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main(): void {
  console.log(bold("\n=== Migration Drift Check ===\n"));

  let hasError = false;

  // =========================================================================
  // Check 1: Schema file hash vs stored hash
  // =========================================================================
  console.log(bold("1. Schema drift (schema/index.ts vs last generate)"));

  if (!fs.existsSync(SCHEMA_PATH)) {
    console.error(red(`   ERROR: Schema file not found: ${SCHEMA_PATH}`));
    hasError = true;
  } else if (!fs.existsSync(SCHEMA_HASH_PATH)) {
    console.warn(
      yellow(`   WARNING: ${dim("lib/db/drizzle/meta/schema-hash.txt")} does not exist.`)
    );
    console.warn(yellow(`   Run: pnpm --filter @workspace/db run generate`));
    console.warn(yellow(`   Then commit the updated hash file alongside your migration.\n`));
    hasError = true;
  } else {
    const storedHash = fs.readFileSync(SCHEMA_HASH_PATH, "utf-8").trim();
    const currentHash = computeSchemaHash();

    if (currentHash === storedHash) {
      console.log(green(`   ✓ Schema is in sync with the journal (hash matches).`));
    } else {
      console.error(red(`   ✗ Schema has changed since the last migration was generated!`));
      console.error(red(`     Stored : ${storedHash}`));
      console.error(red(`     Current: ${currentHash}`));
      console.error(red(`     Fix: pnpm --filter @workspace/db run generate`));
      console.error(red(`     Then commit schema-hash.txt alongside the new .sql file.\n`));
      hasError = true;
    }
  }

  // =========================================================================
  // Check 2: Journal entries vs SQL files on disk
  // =========================================================================
  console.log(bold("\n2. Journal entries vs SQL files on disk"));

  if (!fs.existsSync(JOURNAL_PATH)) {
    console.error(red(`   ERROR: Drizzle journal not found at:`));
    console.error(`          ${JOURNAL_PATH}`);
    console.error(red(`   Run: pnpm --filter @workspace/db run generate\n`));
    hasError = true;
  } else {
    const journal: Journal = JSON.parse(fs.readFileSync(JOURNAL_PATH, "utf-8"));
    const journalEntries = journal.entries ?? [];
    const journalTags = new Set(journalEntries.map((e) => e.tag));

    const sqlFiles = fs
      .readdirSync(DRIZZLE_DIR)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.replace(/\.sql$/, ""))
      .sort();
    const sqlFileSet = new Set(sqlFiles);

    const missingFiles = journalEntries.filter((e) => !sqlFileSet.has(e.tag));
    const orphanedFiles = sqlFiles.filter((tag) => !journalTags.has(tag));

    // Journal entries
    if (journalEntries.length === 0) {
      console.log("   (journal is empty)");
    }
    for (const entry of journalEntries) {
      const hasSql = sqlFileSet.has(entry.tag);
      const mark = hasSql ? green("✓") : red("✗");
      const suffix = hasSql ? "" : red(" ← SQL FILE MISSING");
      console.log(`   ${mark} ${entry.tag}${suffix}`);
    }

    if (missingFiles.length > 0) {
      console.error(
        red(`\n   ERROR: ${missingFiles.length} journal entry/entries missing their SQL file(s):`)
      );
      for (const e of missingFiles) {
        console.error(red(`     - ${e.tag}.sql`));
      }
      console.error(red(`     Run: pnpm --filter @workspace/db run generate\n`));
      hasError = true;
    }

    // =========================================================================
    // Check 3: Orphaned SQL files
    // =========================================================================
    if (orphanedFiles.length > 0) {
      console.log("");
      console.warn(
        yellow(bold(`   WARNING: ${orphanedFiles.length} SQL file(s) not tracked in the journal:`))
      );
      for (const tag of orphanedFiles) {
        console.warn(yellow(`     ! ${tag}.sql`));
      }
      console.warn(
        yellow(
          `     These were created manually and will NOT be auto-applied by migrate-prod.`
        )
      );
      console.warn(
        yellow(`     Either remove them or incorporate them via a proper migration.\n`)
      );
    } else {
      console.log(
        dim(
          `\n   ${sqlFiles.length} SQL file(s) present — all tracked in journal, no orphans.`
        )
      );
    }
  }

  // =========================================================================
  // Auto-apply reminder
  // =========================================================================
  console.log(bold("\n3. Auto-apply coverage"));
  console.log(
    dim(`   migrate-prod Phase 2 reads _journal.json and applies each entry's SQL file`)
  );
  console.log(
    dim(`   via the __drizzle_migrations tracking table. No manual editing of migrate-prod.ts`)
  );
  console.log(dim(`   is needed when the schema changes — just run generate and migrate-prod.`)
  );

  // =========================================================================
  // Summary
  // =========================================================================
  console.log("");
  if (hasError) {
    console.error(
      red(bold("❌  Drift detected — see errors above. Fix before running migrate-prod.\n"))
    );
    process.exit(1);
  } else {
    console.log(green(bold("✅  No drift — schema, journal, and SQL files are all in sync.")));
    console.log(
      green(
        "    New changes: edit schema → run generate → run migrate-prod.\n"
      )
    );
    process.exit(0);
  }
}

main();
