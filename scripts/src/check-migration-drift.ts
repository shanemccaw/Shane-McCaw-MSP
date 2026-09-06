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
 *   4. DESTRUCTIVE MIGRATION GATE (Git #2930): does every .sql file containing
 *      an irreversible statement carry an explicit `-- @migration-gate:` header?
 *      This is the merge-time half of the gate — it catches a missing header
 *      while the author is still here, rather than at 3am on a post-merge run.
 *
 * Exit codes:
 *   0 — clean (no errors; warnings are printed but don't fail CI)
 *   1 — schema drift detected, journal broken, or a destructive migration is
 *       missing its gate header
 *
 * How to fix each issue:
 *   Schema drift  → pnpm --filter @workspace/db run generate
 *   Broken journal → pnpm --filter @workspace/db run generate (or restore file)
 *   Orphaned SQL  → remove the file or incorporate it into a proper migration
 *   Missing gate header → add `-- @migration-gate:` + `-- @gate-reason:` to the file
 *
 * Run:
 *   pnpm --filter @workspace/scripts run check-drift
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  evaluateMigrationGate,
  type MigrationGateVerdict,
} from "./lib/destructive-migration-gate";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** DRIZZLE_MIGRATIONS_DIR is the same test seam migrate-dev uses (see #2930). */
const DRIZZLE_DIR = process.env["DRIZZLE_MIGRATIONS_DIR"]
  ? path.resolve(process.env["DRIZZLE_MIGRATIONS_DIR"])
  : path.resolve(__dirname, "../../lib/db/drizzle");
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
      console.error(
        red(bold(`   ERROR: ${orphanedFiles.length} SQL file(s) not tracked in the journal:`))
      );
      for (const tag of orphanedFiles) {
        console.error(red(`     ✗ ${tag}.sql`));
      }
      console.error(
        red(
          `     These files will NOT be applied by migrate-dev or migrate-prod — they are invisible to both runners.`
        )
      );
      console.error(
        red(`     Fix: run pnpm --filter @workspace/db run generate to register them, or remove them.\n`)
      );
      hasError = true;
    } else {
      console.log(
        dim(
          `\n   ${sqlFiles.length} SQL file(s) present — all tracked in journal, no orphans.`
        )
      );
    }
  }

  // =========================================================================
  // Check 4: Destructive migration gate headers (Git #2930)
  // =========================================================================
  console.log(bold("\n4. Destructive migration gate"));

  if (!fs.existsSync(DRIZZLE_DIR)) {
    console.error(red(`   ERROR: migrations directory not found: ${DRIZZLE_DIR}`));
    hasError = true;
  } else {
    const sqlFileNames = fs.readdirSync(DRIZZLE_DIR).filter((f) => f.endsWith(".sql")).sort();

    const unheadered: MigrationGateVerdict[] = [];
    const held: MigrationGateVerdict[] = [];
    const autoApproved: MigrationGateVerdict[] = [];

    for (const fileName of sqlFileNames) {
      const tag = fileName.replace(/\.sql$/, "");
      const sql = fs.readFileSync(path.join(DRIZZLE_DIR, fileName), "utf-8");
      const verdict = evaluateMigrationGate(tag, sql);

      if (verdict.holdCause === "unmarked-destructive" || verdict.holdCause === "malformed-header") {
        unheadered.push(verdict);
      } else if (verdict.holdCause === "marked-manual") {
        held.push(verdict);
      } else if (verdict.disposition === "auto-approved") {
        autoApproved.push(verdict);
      }
    }

    if (held.length > 0) {
      console.log(
        yellow(`   ${held.length} migration(s) marked @migration-gate: manual — never auto-applied:`)
      );
      for (const v of held) {
        console.log(yellow(`     ⏸ ${v.tag}.sql`));
        if (v.reason) console.log(dim(`        ${v.reason}`));
      }
      console.log(
        dim(
          `     Run these by hand against each real target, then record them with:\n` +
            `       pnpm --filter @workspace/scripts run migrate-mark-applied <tag> [--prod]`
        )
      );
    }

    if (autoApproved.length > 0) {
      console.log(
        dim(
          `   ${autoApproved.length} destructive migration(s) explicitly signed off as ` +
            `@migration-gate: auto-approved.`
        )
      );
    }

    if (unheadered.length > 0) {
      console.log("");
      console.error(
        red(bold(`   ERROR: ${unheadered.length} destructive migration(s) with no valid gate header:`))
      );
      for (const v of unheadered) {
        console.error(red(`     ✗ ${v.tag}.sql`));
        if (v.headerError) console.error(red(`        header: ${v.headerError}`));
        for (const f of v.findings) {
          console.error(red(`        line ${f.line}  [${f.kind}]  ${f.statement}`));
        }
      }
      console.error(
        red(
          `\n     These would be HELD (not applied) by migrate-dev/migrate-prod anyway — the gate\n` +
            `     fails closed. Declare the intent explicitly so the next reader knows why:\n` +
            `       -- @migration-gate: manual          (hold it — the default for anything irreversible)\n` +
            `       -- @gate-reason: <why this change is needed, with evidence>\n` +
            `     ...or, for a reviewed change genuinely safe to run unattended:\n` +
            `       -- @migration-gate: auto-approved\n` +
            `       -- @gate-reason: <why unattended execution is safe here>\n`
        )
      );
      hasError = true;
    } else if (held.length === 0 && autoApproved.length === 0) {
      console.log(
        dim(`   ✓ No destructive statements found in any migration — nothing to gate.`)
      );
    } else {
      console.log(green(`   ✓ Every destructive migration carries an explicit gate header.`));
    }
  }

  // =========================================================================
  // Auto-apply reminder
  // =========================================================================
  console.log(bold("\n5. Auto-apply coverage"));
  console.log(dim(`   Dev  (DATABASE_URL):      pnpm --filter @workspace/scripts run migrate-dev`));
  console.log(dim(`   Prod (PROD_DATABASE_URL): pnpm --filter @workspace/scripts run migrate-prod`));
  console.log(dim(`   Both runners read _journal.json and track applied entries in`));
  console.log(dim(`   __drizzle_migrations — no manual editing needed when the schema`));
  console.log(dim(`   grows. post-merge.sh calls migrate-dev automatically on every merge.`));
  console.log(dim(`   New changes: edit schema → run generate → run migrate-dev (dev) / migrate-prod (prod).`));

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
