#!/usr/bin/env node
// Live schema-drift audit for the shared Shane's Life / ShanesSurvival `finances` database
// (Git #3177).
//
// #3153's own build session found a real `catches` table and a real `list_items.requested_by`
// column already living in this shared local database with NO matching migration file anywhere
// in git history, and no `schema_migrations` ledger row either -- both had bypassed the real
// migration runner entirely (`web/shanes-life/src/migrate.mjs`). The likeliest explanation: an
// earlier, uncommitted attempt at that work ran a manual `ALTER`/`CREATE` against this shared
// database from inside a worktree, then that worktree was cleaned up before the migration file
// or the code referencing it was ever committed. `cleanup-worktree.mjs` removes the git checkout;
// it does not, and cannot, undo a real database mutation a session already made from inside it --
// see scripts/dev-server/README.md's "Database is NOT worktree-isolated" note (added by this
// same build). #3177 was filed to close the visibility gap that let that go unnoticed: this file
// is "at minimum a live audit that flags a table/column with no matching migration file",
// exactly as #3177's own body asked for.
//
// What this does NOT do (deliberately, to avoid re-fighting #3175's false-positive storm): a
// migration applied by a concurrent sibling build against this same shared database, but not yet
// merged to this checkout's `migrations/` directory, is real, tracked, LEGITIMATE drift from this
// checkout's point of view -- it has a `schema_migrations` ledger row, it is simply "ahead"
// (see `classifyOrphanLedgerFilenames` in check-migration-numbers.mjs, same shared-database
// reality). This audit cross-references that same ledger and reports an "ahead" migration's
// tables/columns as a separate, non-alarming bucket rather than conflating it with the
// genuinely-untracked case (no ledger row at all) that #3153/#3177 actually hit.
//
// Run standalone (from web/shanes-life, where DATABASE_URL is configured):
//   node bin/check-schema-drift.mjs
// Also called (non-fatal, log-only) from web/shanes-life/src/migrate.mjs after every real
// migration run, so drift becomes visible on the very next boot instead of waiting for someone
// to think to run this by hand.

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { MIGRATION_DIRS, classifyOrphanLedgerFilenames } from "./check-migration-numbers.mjs";

// Real infrastructure the migration runner itself creates inline (`CREATE TABLE IF NOT EXISTS
// schema_migrations ...` in migrate.mjs), not via a numbered migration file -- it can never have
// a matching migration file by design, so it is not drift.
const KNOWN_INFRA_TABLES = new Set(["schema_migrations"]);

const IDENT = String.raw`"?([a-zA-Z_][a-zA-Z0-9_]*)"?`;

/** Finds the substring between a `(` at `openIndex` and its matching `)`, honoring nesting
 * (needed because column type modifiers like `numeric(10,2)` or `varchar(50)` contain their own
 * parens). Returns the substring WITHOUT the enclosing parens, and the index just after the
 * closing paren. */
function scanBalancedParens(text, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) return { body: text.slice(openIndex + 1, i), end: i + 1 };
    }
  }
  return { body: text.slice(openIndex + 1), end: text.length }; // unbalanced -- best effort
}

/** Splits a CREATE TABLE body on top-level commas (depth 0), so a type's own internal comma
 * (`numeric(10,2)`) doesn't split a column definition in half. */
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "(") depth++;
    else if (body[i] === ")") depth--;
    else if (body[i] === "," && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

const TABLE_LEVEL_KEYWORDS = new Set(["constraint", "primary", "foreign", "unique", "check", "exclude"]);

/** Strips `-- line comments` before any parsing. This repo's migration files are heavily
 * commented, including inline explanatory prose that itself contains real commas and parens
 * (e.g. "category slug, if one was made") -- left in place, those would be mistaken for real
 * column-list punctuation and corrupt the column split below. Block comments are not used in
 * this repo's migrations, so that form isn't handled here. */
function stripLineComments(sql) {
  return sql.replace(/--[^\r\n]*/g, "");
}

/**
 * Best-effort regex/paren-scan extraction of the tables and columns a set of migration files
 * DECLARE, via `CREATE TABLE` and `ALTER TABLE ... ADD/DROP COLUMN` / `RENAME`. This is not a
 * real SQL parser -- it does not evaluate DO blocks, doesn't resolve `LIKE other_table`, and
 * assumes this repo's own consistent formatting (one statement's parens balance within the file).
 * That is enough to catch the real, concrete shape #3153/#3177 hit: a table or column present in
 * the live database that no migration file, however loosely parsed, mentions creating at all.
 */
export function extractExpectedSchema(dirs = MIGRATION_DIRS) {
  const tables = new Map(); // tableName -> Set<columnName>

  const ensureTable = (name) => {
    if (!tables.has(name)) tables.set(name, new Set());
    return tables.get(name);
  };

  for (const dir of dirs) {
    let files;
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    } catch {
      continue; // directory absent in this checkout -- not this check's concern
    }

    for (const file of files) {
      const sql = stripLineComments(readFileSync(resolve(dir, file), "utf8"));

      // CREATE TABLE [IF NOT EXISTS] name (...)
      const createRe = new RegExp(String.raw`CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${IDENT}\s*\(`, "gi");
      let m;
      while ((m = createRe.exec(sql))) {
        const tableName = m[1].toLowerCase();
        const openIndex = createRe.lastIndex - 1;
        const { body } = scanBalancedParens(sql, openIndex);
        const cols = ensureTable(tableName);
        for (const rawPart of splitTopLevel(body)) {
          const part = rawPart.trim();
          if (!part) continue;
          const firstWord = part.split(/\s+/)[0].replace(/^"|"$/g, "").toLowerCase();
          if (TABLE_LEVEL_KEYWORDS.has(firstWord)) continue; // table-level constraint, not a column
          const colMatch = new RegExp(`^${IDENT}\\s`).exec(part) || new RegExp(`^${IDENT}$`).exec(part);
          if (colMatch) cols.add(colMatch[1].toLowerCase());
        }
      }

      // Every ALTER TABLE statement, table name captured once, body running to its closing `;`
      // -- Postgres allows several comma-separated clauses (`ADD COLUMN a, ADD COLUMN b`) in one
      // statement, and this repo uses that form (see 020_barcode_scan.sql), so each clause has
      // to be found WITHIN the statement rather than requiring "ALTER TABLE x" immediately
      // before every individual clause.
      const alterTableRe = new RegExp(String.raw`ALTER\s+TABLE\s+(?:ONLY\s+)?${IDENT}([\s\S]*?);`, "gi");
      while ((m = alterTableRe.exec(sql))) {
        const tableName = m[1].toLowerCase();
        const stmtBody = m[2];
        const cols = ensureTable(tableName);

        const addColRe = new RegExp(String.raw`ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?${IDENT}`, "gi");
        let addMatch;
        while ((addMatch = addColRe.exec(stmtBody))) cols.add(addMatch[1].toLowerCase());

        const dropColRe = new RegExp(String.raw`DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?${IDENT}`, "gi");
        let dropMatch;
        while ((dropMatch = dropColRe.exec(stmtBody))) cols.delete(dropMatch[1].toLowerCase());

        const renameColRe = new RegExp(String.raw`RENAME\s+COLUMN\s+${IDENT}\s+TO\s+${IDENT}`, "gi");
        let renameMatch;
        while ((renameMatch = renameColRe.exec(stmtBody))) {
          cols.delete(renameMatch[1].toLowerCase());
          cols.add(renameMatch[2].toLowerCase());
        }

        const renameTableMatch = new RegExp(String.raw`RENAME\s+TO\s+${IDENT}`, "i").exec(stmtBody);
        if (renameTableMatch) {
          const newName = renameTableMatch[1].toLowerCase();
          tables.set(newName, new Set([...(tables.get(newName) ?? []), ...cols]));
          tables.delete(tableName);
        }
      }

      // DROP TABLE [IF EXISTS] name
      const dropTableRe = new RegExp(String.raw`DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?${IDENT}`, "gi");
      while ((m = dropTableRe.exec(sql))) {
        tables.delete(m[1].toLowerCase());
      }
    }
  }

  return tables;
}

/** Live `public` schema tables/columns, straight from information_schema. */
async function readLiveSchema(client) {
  const { rows: tableRows } = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  );
  const { rows: colRows } = await client.query(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
  );
  const tables = new Map(); // tableName -> Set<columnName>
  for (const { table_name } of tableRows) tables.set(table_name, new Set());
  for (const { table_name, column_name } of colRows) {
    if (!tables.has(table_name)) tables.set(table_name, new Set());
    tables.get(table_name).add(column_name);
  }
  return tables;
}

/**
 * Diffs the live schema against what the on-disk migration files declare, and (best-effort)
 * separates genuinely-untracked drift from drift explained by a concurrent sibling build's
 * ledger-recorded-but-not-yet-merged ("ahead") migration.
 *
 * Returns `{ untrackedTables, untrackedColumns, aheadFilenames }` where `untrackedColumns` is
 * `[{ table, column }]`. Both untracked arrays are empty on a clean audit.
 */
export async function auditSchemaDrift(client, { dirs = MIGRATION_DIRS } = {}) {
  const expected = extractExpectedSchema(dirs);
  const live = await readLiveSchema(client);

  let ledgerFilenames = [];
  try {
    const { rows } = await client.query("SELECT filename FROM schema_migrations");
    ledgerFilenames = rows.map((r) => r.filename);
  } catch {
    // schema_migrations doesn't exist yet (fresh database, before the first migration run) --
    // nothing to be ahead of, and no live app tables either.
  }
  const { ahead } = classifyOrphanLedgerFilenames(ledgerFilenames, dirs);

  const untrackedTables = [];
  const untrackedColumns = [];

  for (const [table, liveCols] of live) {
    if (KNOWN_INFRA_TABLES.has(table)) continue;
    if (!expected.has(table)) {
      untrackedTables.push(table);
      continue;
    }
    const expectedCols = expected.get(table);
    for (const col of liveCols) {
      if (!expectedCols.has(col)) untrackedColumns.push({ table, column: col });
    }
  }

  return { untrackedTables, untrackedColumns, aheadFilenames: ahead };
}

/** One-line-per-finding text report, safe to log or print. Empty string when clean. */
export function formatDriftReport({ untrackedTables, untrackedColumns, aheadFilenames }) {
  if (untrackedTables.length === 0 && untrackedColumns.length === 0) return "";
  const lines = [
    `[schema-drift] ${untrackedTables.length} untracked table(s), ${untrackedColumns.length} ` +
      `untracked column(s) live in the database with no matching CREATE/ADD COLUMN in ANY ` +
      `migrations/*.sql file (Git #3177) -- this is exactly the shape a manual/ad-hoc mutation ` +
      `from an aborted, never-committed session leaves behind:`,
  ];
  for (const table of untrackedTables) lines.push(`  table  ${table}`);
  for (const { table, column } of untrackedColumns) lines.push(`  column ${table}.${column}`);
  if (aheadFilenames.length > 0) {
    lines.push(
      `(${aheadFilenames.length} ledger row(s) are ahead of this checkout -- ${aheadFilenames.join(", ")} -- ` +
        `possibly a concurrent sibling build's real, tracked migration not yet merged here; the ` +
        `items above could not be attributed to those files' content since they aren't on disk ` +
        `in this checkout yet.)`,
    );
  }
  lines.push(
    `Write a migration file that adopts this real shape (see 034_catches.sql for the pattern), ` +
      `or if it's genuinely dead, confirm with Shane before dropping anything live.`,
  );
  return lines.join("\n");
}
