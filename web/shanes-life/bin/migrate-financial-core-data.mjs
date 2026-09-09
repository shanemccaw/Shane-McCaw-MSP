#!/usr/bin/env node
// Real, one-time financial-core DATA migration (Git #3295, Phase 2 of #3293's Option C).
//
// Phase 1 (#3294) confirmed the SCHEMA side is already fine: shanes-life's own 52 migrations
// only ever ADD to ShanesSurvival's financial-core tables (plaid_items, accounts, transactions,
// debts, survival_snapshots, pay_period_plans, pay_period_plan_allocations, income_sources,
// income_entries, expected_one_time_events, transaction_tags) -- never rename/drop/retype one.
// What's still missing is the DATA: production (shanes-life.replit.app) got a fresh, empty
// Postgres from Replit's own provisioning, and none of ShanesSurvival's real rows were ever
// copied into it. Locally the two apps already share ONE database (`finances`) -- there is
// nothing to migrate there. This script's only real use is the one-time SOURCE (local
// ShanesSurvival) -> TARGET (shanes-life production) data copy.
//
// Real, explicit safety gates (per #3295's own issue body + Shane's own simplification comment):
//   1. Defaults to dry-run. Nothing is written to TARGET unless --execute is passed.
//   2. If TARGET does not look like a local database, --execute additionally requires
//      I_UNDERSTAND_THIS_TOUCHES_SHANES_REAL_PRODUCTION_DATA=yes in the environment. This is
//      the one place in this repo an issue's own "do not run without my explicit go-ahead"
//      gate is enforced in the tool itself, not just as a comment someone has to remember.
//   3. Before writing anything, takes a real `pg_dump` backup of TARGET's own current state
//      for the tables this script touches (Shane's own 2026-09-09 correction: a plain pg_dump
//      is adequate here -- mostly re-syncable Plaid data and notes, not the elaborate
//      checksum/verification ceremony #3295 was originally scoped with). Skippable with
//      --no-backup for a dry-run or a disposable local test target.
//   4. Idempotent: every INSERT is `ON CONFLICT (id) DO NOTHING`, so re-running this script
//      against the same TARGET after a partial or full prior run never duplicates a row.
//   5. Column set per table is the *intersection* of SOURCE's and TARGET's real
//      information_schema.columns at run time, not a hardcoded list -- correct regardless of
//      exactly which of ShanesSurvival's own 001-012 columns happen to already exist on
//      TARGET. Refuses (whole run, before touching anything) if a table's intersection is
//      missing `id`, or is missing a NOT NULL TARGET column that has no default -- both would
//      make the insert either meaningless (no conflict key) or guaranteed to fail partway
//      through, and this fails closed before writing a single row rather than partway.
//
// Usage:
//   SOURCE_DATABASE_URL=postgresql://postgres:***@localhost:5432/finances \
//   TARGET_DATABASE_URL=<shanes-life production DATABASE_URL> \
//   node bin/migrate-financial-core-data.mjs [--execute] [--no-backup] [--backup-dir <path>]
//
// Exit codes: 0 clean run (dry-run or executed), 1 bad usage / safety gate refused, 2 a
// table's row-count verification did not match after an --execute run.

import pg from "pg";
import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BACKUP_DIR = resolve(__dirname, "../backups");

// Dependency order matters: a table must appear after every table it has a NOT NULL FK into,
// so inserts never violate a foreign key on TARGET. (income_entries.transaction_id and
// pay_period_plan_allocations' FKs are why transactions/accounts/pay_period_plans all come
// before the tables that reference them.)
const TABLES_IN_ORDER = [
  "plaid_items",
  "accounts",
  "debts",
  "survival_snapshots",
  "pay_period_plans",
  "income_sources",
  "expected_one_time_events",
  "transaction_tags",
  "transactions",
  "pay_period_plan_allocations",
  "income_entries",
];

function parseArgs(argv) {
  const opts = { execute: false, backup: true, backupDir: DEFAULT_BACKUP_DIR };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--execute") opts.execute = true;
    else if (a === "--no-backup") opts.backup = false;
    else if (a === "--backup-dir") opts.backupDir = argv[++i];
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(1);
    }
  }
  return opts;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set. See this file's own header for usage.`);
    process.exit(1);
  }
  return value;
}

function isLocalUrl(connectionString) {
  try {
    const u = new URL(connectionString);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function useSsl(connectionString) {
  return /[?&]sslmode=require/.test(connectionString) || !isLocalUrl(connectionString);
}

async function getColumns(client, table) {
  const { rows } = await client.query(
    `SELECT column_name, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [table],
  );
  return rows;
}

/** Real pg_dump backup of TARGET's current state for the tables this script touches. */
function backupTarget(targetUrl, backupDir) {
  if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = resolve(backupDir, `pre-migration-target-${stamp}.sql`);
  const args = [
    targetUrl,
    "--data-only",
    "--no-owner",
    ...TABLES_IN_ORDER.flatMap((t) => ["--table", t]),
    "--file",
    outFile,
  ];
  console.log(`[backup] running: pg_dump --data-only (11 tables) -> ${outFile}`);
  const result = spawnSync("pg_dump", args, { encoding: "utf8" });
  if (result.status !== 0) {
    console.error(`[backup] pg_dump failed (exit ${result.status}):`);
    console.error(result.stderr || result.stdout);
    return null;
  }
  console.log(`[backup] real backup written to ${outFile}`);
  return outFile;
}

async function migrateTable(sourceClient, targetClient, table, { execute }) {
  const sourceCols = await getColumns(sourceClient, table);
  const targetCols = await getColumns(targetClient, table);
  const targetColNames = new Set(targetCols.map((c) => c.column_name));
  const intersection = sourceCols
    .map((c) => c.column_name)
    .filter((name) => targetColNames.has(name));

  if (!intersection.includes("id")) {
    throw new Error(
      `${table}: TARGET has no "id" column in common with SOURCE -- refusing, there would be ` +
        `no conflict key to make this idempotent.`,
    );
  }

  const requiredTargetOnly = targetCols.filter(
    (c) => c.is_nullable === "NO" && c.column_default === null && !intersection.includes(c.column_name),
  );
  if (requiredTargetOnly.length > 0) {
    throw new Error(
      `${table}: TARGET has NOT NULL column(s) with no default that SOURCE can't supply: ` +
        `${requiredTargetOnly.map((c) => c.column_name).join(", ")}. Refusing -- every insert ` +
        `into this table would fail partway through.`,
    );
  }

  const { rows: sourceRows } = await sourceClient.query(
    `SELECT ${intersection.map((c) => `"${c}"`).join(", ")} FROM "${table}"`,
  );
  const { rows: targetCountRows } = await targetClient.query(`SELECT count(*)::int AS n FROM "${table}"`);
  const targetCountBefore = targetCountRows[0].n;

  if (!execute) {
    console.log(
      `[dry-run] ${table}: SOURCE has ${sourceRows.length} row(s), TARGET currently has ` +
        `${targetCountBefore} row(s). Columns to copy: ${intersection.join(", ")}.`,
    );
    return { table, sourceCount: sourceRows.length, inserted: 0, skipped: 0 };
  }

  const colList = intersection.map((c) => `"${c}"`).join(", ");
  const placeholders = intersection.map((_, i) => `$${i + 1}`).join(", ");
  const insertSql = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`;

  let inserted = 0;
  let skipped = 0;
  for (const row of sourceRows) {
    const values = intersection.map((c) => row[c]);
    const { rowCount } = await targetClient.query(insertSql, values);
    if (rowCount === 1) inserted++;
    else skipped++;
  }

  console.log(
    `[execute] ${table}: inserted ${inserted}, already present (skipped) ${skipped} of ` +
      `${sourceRows.length} SOURCE row(s).`,
  );
  return { table, sourceCount: sourceRows.length, inserted, skipped };
}

async function verifyRowCounts(sourceClient, targetClient) {
  let allMatch = true;
  console.log("\n[verify] SOURCE vs TARGET row counts, per table:");
  for (const table of TABLES_IN_ORDER) {
    const src = (await sourceClient.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n;
    const tgt = (await targetClient.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n;
    const ok = tgt >= src; // TARGET may already have had rows before this run; must be a superset
    if (!ok) allMatch = false;
    console.log(`  ${table.padEnd(30)} source=${src}  target=${tgt}  ${ok ? "ok" : "MISMATCH"}`);
  }
  return allMatch;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const sourceUrl = requireEnv("SOURCE_DATABASE_URL");
  const targetUrl = requireEnv("TARGET_DATABASE_URL");

  if (sourceUrl === targetUrl) {
    console.error("SOURCE_DATABASE_URL and TARGET_DATABASE_URL are identical -- refusing (no-op).");
    process.exit(1);
  }

  if (opts.execute && !isLocalUrl(targetUrl)) {
    if (process.env.I_UNDERSTAND_THIS_TOUCHES_SHANES_REAL_PRODUCTION_DATA !== "yes") {
      console.error(
        "TARGET_DATABASE_URL is not a local database. This is Shane's own real, live " +
          "financial data (issue #3295's own hard gate: 'Do NOT execute the actual real data " +
          "migration without Shane's own explicit, real confirmation in this issue or in " +
          "chat.'). Refusing --execute. Re-run with " +
          "I_UNDERSTAND_THIS_TOUCHES_SHANES_REAL_PRODUCTION_DATA=yes only once that real " +
          "confirmation has actually been given.",
      );
      process.exit(1);
    }
  }

  const sourcePool = new pg.Pool({ connectionString: sourceUrl, ssl: useSsl(sourceUrl) ? { rejectUnauthorized: false } : undefined });
  const targetPool = new pg.Pool({ connectionString: targetUrl, ssl: useSsl(targetUrl) ? { rejectUnauthorized: false } : undefined });
  const sourceClient = await sourcePool.connect();
  const targetClient = await targetPool.connect();

  try {
    if (opts.execute && opts.backup) {
      const backupFile = backupTarget(targetUrl, opts.backupDir);
      if (!backupFile) {
        console.error("Backup failed -- refusing to proceed with --execute. Use --no-backup to override (not recommended).");
        process.exit(1);
      }
    } else if (opts.execute && !opts.backup) {
      console.warn("[backup] --no-backup passed -- proceeding WITHOUT a fresh TARGET backup.");
    }

    await targetClient.query("BEGIN");
    const results = [];
    try {
      for (const table of TABLES_IN_ORDER) {
        results.push(await migrateTable(sourceClient, targetClient, table, opts));
      }
      if (opts.execute) {
        await targetClient.query("COMMIT");
      } else {
        await targetClient.query("ROLLBACK"); // dry-run never writes, even though nothing was queued
      }
    } catch (err) {
      await targetClient.query("ROLLBACK");
      throw err;
    }

    const totalSource = results.reduce((s, r) => s + r.sourceCount, 0);
    const totalInserted = results.reduce((s, r) => s + r.inserted, 0);
    console.log(
      `\n[${opts.execute ? "execute" : "dry-run"}] done. ${totalSource} SOURCE row(s) across ` +
        `${TABLES_IN_ORDER.length} tables, ${totalInserted} newly inserted into TARGET.`,
    );

    if (opts.execute) {
      const allMatch = await verifyRowCounts(sourceClient, targetClient);
      if (!allMatch) {
        console.error("\n[verify] at least one table's TARGET count is LESS than SOURCE after this run.");
        process.exitCode = 2;
      }
    }
  } finally {
    sourceClient.release();
    targetClient.release();
    await sourcePool.end();
    await targetPool.end();
  }
}

main().catch((err) => {
  console.error(`migrate-financial-core-data failed: ${err.message}`);
  process.exitCode = 1;
});
