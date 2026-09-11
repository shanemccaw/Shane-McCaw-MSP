#!/usr/bin/env node
// scripts/dev-server/migrate-buildconsole-db.mjs
//
// Git #3651 — copies BuildConsole's tables out of the shared product database
// (DATABASE_URL) into BuildConsole's own dedicated local database (BUILD_DATABASE_URL).
// Never writes to the source database and never drops anything from it — removing the
// old copies from the product database is a separate, later step.
//
// Usage:
//   node scripts/dev-server/migrate-buildconsole-db.mjs [--resync] [--snapshot-dir <dir>]
//
// 1. Opens a REPEATABLE READ transaction on the source, exports its snapshot, counts every
//    table inside it, then runs pg_dump --snapshot against that same snapshot — so the
//    per-table counts and the dump see byte-identical data even while a live BuildConsole
//    keeps writing.
// 2. Keeps the dump in --snapshot-dir (default ~/BuildConsole-db-snapshots) as the
//    recoverable safety copy. Operational data, never committed to git.
// 3. Target has none of the tables -> full restore (schema, data, constraints, sequences).
//    Target has all of them -> refuses unless --resync, which TRUNCATEs them in the target
//    and reloads data only. --resync also refuses if the target already holds ids the
//    source never had (BuildConsole has gone live against it), since that would destroy
//    real rows. Target has some but not all -> refuses; that partial state needs a human.
// 4. Verifies every table's target row count equals the snapshot count exactly, and that
//    every nextval()-backed column's sequence sits at or above that column's max. Exit 1
//    on any mismatch.
//
// Re-run with --resync right before relaunching BuildConsole on the BUILD_DATABASE_URL
// build: anything the old binary wrote to the product database since the first copy
// (queue completions, new chats) is otherwise left behind.

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { resolveBuildDatabaseUrl, resolveDatabaseUrl } from "../config-state/db.mjs";

// The 11 bt_ tables plus the two BuildConsole-owned tables that hold foreign keys into
// them (build_dispatch_log -> bt_build_queue, chat_pinned_questions -> bt_chats) and are
// queried through the same BuildQueuePostgresClient connection.
const TABLES = [
  "bt_build_queue",
  "bt_chat_issues",
  "bt_chat_mentioned_issues",
  "bt_chats",
  "bt_dispatch_claims",
  "bt_epics",
  "bt_issue_mirror",
  "bt_issue_mirror_sync_state",
  "bt_issues",
  "bt_milestone_mirror",
  "bt_test_pad_notes",
  "build_dispatch_log",
  "chat_pinned_questions",
];

function parseArgs(argv) {
  const a = { resync: false, snapshotDir: path.join(os.homedir(), "BuildConsole-db-snapshots") };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--resync") a.resync = true;
    else if (argv[i] === "--snapshot-dir") a.snapshotDir = path.resolve(argv[++i]);
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return a;
}

function pgBin(name) {
  return process.env.PG_BIN ? path.join(process.env.PG_BIN, name) : name;
}

function run(name, args) {
  const r = spawnSync(pgBin(name), args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`${name} could not start: ${r.error.message} (set PG_BIN to PostgreSQL's bin directory)`);
  if (r.status !== 0) throw new Error(`${name} exited ${r.status}: ${r.stderr.trim()}`);
  return r.stdout;
}

async function countAll(client) {
  const counts = {};
  for (const t of TABLES) {
    const { rows } = await client.query(`SELECT count(*)::bigint AS n FROM public.${t}`);
    counts[t] = Number(rows[0].n);
  }
  return counts;
}

/** Every nextval()-backed column in TABLES, with its sequence and the column's current max. */
async function serialColumns(client) {
  const { rows } = await client.query(
    `SELECT table_name, column_name,
            substring(column_default FROM 'nextval\\(''([^'']+)''') AS seq
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1) AND column_default LIKE 'nextval(%'`,
    [TABLES]
  );
  const out = [];
  for (const r of rows) {
    const max = await client.query(`SELECT max(${r.column_name})::bigint AS m FROM public.${r.table_name}`);
    out.push({ table: r.table_name, column: r.column_name, seq: r.seq, max: max.rows[0].m == null ? null : Number(max.rows[0].m) });
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceUrl = await resolveDatabaseUrl();
  const targetUrl = await resolveBuildDatabaseUrl();
  if (sourceUrl === targetUrl) throw new Error("DATABASE_URL and BUILD_DATABASE_URL are the same database — nothing to migrate.");

  const source = new pg.Client({ connectionString: sourceUrl });
  const target = new pg.Client({ connectionString: targetUrl });
  await source.connect();
  await target.connect();
  try {
    const src = await source.query("SELECT current_database() AS db");
    const tgt = await target.query("SELECT current_database() AS db");
    console.log(`Source: ${src.rows[0].db}  ->  Target: ${tgt.rows[0].db}`);

    const present = await target.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)",
      [TABLES]
    );
    const mode = present.rowCount === 0 ? "full" : present.rowCount === TABLES.length ? "resync" : "partial";
    if (mode === "partial") {
      throw new Error(`Target has ${present.rowCount} of ${TABLES.length} tables (${present.rows.map((r) => r.table_name).join(", ")}) — refusing to guess. Fix the target by hand.`);
    }
    if (mode === "resync" && !args.resync) {
      throw new Error("Target already has the tables. Re-run with --resync to replace their data with the source's current rows.");
    }

    // 1. One consistent snapshot for both the counts and the dump.
    await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const snap = (await source.query("SELECT pg_export_snapshot() AS id")).rows[0].id;
    const expected = await countAll(source);
    const sourceSerials = await serialColumns(source);

    if (mode === "resync") {
      const targetSerials = await serialColumns(target);
      for (const t of targetSerials) {
        const s = sourceSerials.find((x) => x.table === t.table && x.column === t.column);
        if (t.max != null && (s?.max == null || t.max > s.max)) {
          throw new Error(`Target ${t.table}.${t.column} max ${t.max} exceeds the source's ${s?.max ?? "(empty)"} — BuildConsole has already written rows here. Refusing --resync; it would destroy them.`);
        }
      }
    }

    // 2. Safety copy of the source tables.
    mkdirSync(args.snapshotDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const dumpFile = path.join(args.snapshotDir, `buildconsole-tables-${stamp}.dump`);
    run("pg_dump", [`--dbname=${sourceUrl}`, `--snapshot=${snap}`, "-Fc", ...TABLES.flatMap((t) => ["-t", `public.${t}`]), "-f", dumpFile]);
    await source.query("COMMIT");
    console.log(`Snapshot saved: ${dumpFile}`);

    // 3. Load the target.
    if (mode === "full") {
      run("pg_restore", [`--dbname=${targetUrl}`, "--no-owner", "--no-privileges", "--exit-on-error", dumpFile]);
    } else {
      await target.query(`TRUNCATE ${TABLES.map((t) => `public.${t}`).join(", ")} RESTART IDENTITY`);
      run("pg_restore", [`--dbname=${targetUrl}`, "--data-only", "--disable-triggers", "--no-owner", "--no-privileges", "--exit-on-error", dumpFile]);
    }

    // 4. Verify.
    const actual = await countAll(target);
    let ok = true;
    console.log("\ntable                          source   target");
    for (const t of TABLES) {
      const match = expected[t] === actual[t];
      if (!match) ok = false;
      console.log(`${t.padEnd(30)} ${String(expected[t]).padStart(6)}   ${String(actual[t]).padStart(6)}  ${match ? "OK" : "MISMATCH"}`);
    }
    for (const c of await serialColumns(target)) {
      const seq = (await target.query(`SELECT last_value::bigint AS v, is_called FROM ${c.seq}`)).rows[0];
      const next = seq.is_called ? Number(seq.v) + 1 : Number(seq.v);
      const good = c.max == null || next > c.max;
      if (!good) ok = false;
      console.log(`sequence ${c.seq} next=${next} vs ${c.table}.${c.column} max=${c.max ?? "(empty)"}  ${good ? "OK" : "BEHIND"}`);
    }
    if (!ok) {
      console.error("\nVerification FAILED — target does not match the source snapshot.");
      process.exitCode = 1;
      return;
    }
    console.log(`\nVerified: all ${TABLES.length} tables match the source snapshot exactly.`);
  } finally {
    await source.end().catch(() => {});
    await target.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(`migrate-buildconsole-db failed: ${err.message}`);
  process.exit(2);
});
