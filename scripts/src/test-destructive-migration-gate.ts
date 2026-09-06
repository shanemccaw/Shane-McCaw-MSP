/**
 * test-destructive-migration-gate.ts
 *
 * Test harness for the destructive-migration gate (Git #2930).
 *
 * Two layers, because the gate has to be right at both:
 *
 *   PART A — classifier, in-process, no database.
 *     Asserts the boundary itself: what counts as destructive, what does not,
 *     how each header disposition is honoured, and that the gate fails closed on
 *     a malformed header. Includes a pass over the REAL lib/db/drizzle corpus,
 *     so a future migration that quietly trips the detector shows up here.
 *
 *   PART B — the real runner, against the real dev database.
 *     Spawns the actual `migrate-dev` (via DRIZZLE_MIGRATIONS_DIR) against a
 *     throwaway directory holding three synthetic migrations, and then asks
 *     Postgres what actually happened:
 *       - an ordinary additive migration IS applied and IS recorded;
 *       - a migration marked `@migration-gate: manual` is NOT applied and NOT
 *         recorded;
 *       - an UNMARKED migration containing a DROP COLUMN is NOT applied and NOT
 *         recorded (the fail-closed safety net);
 *       - the runner exits with GATE_HELD_EXIT_CODE.
 *     Everything it creates is torn down afterwards, pass or fail.
 *
 * Run:
 *   pnpm --filter @workspace/scripts run test-gate
 *
 * Exit codes:
 *   0 — all assertions passed
 *   1 — an assertion failed
 *   2 — DATABASE_URL is not set (Part B cannot run)
 */

import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import {
  GATE_HELD_EXIT_CODE,
  detectDestructive,
  evaluateMigrationGate,
  maskSqlNoise,
  parseGateHeader,
} from "./lib/destructive-migration-gate";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRIPTS_PKG_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(__dirname, "../..");
const REAL_DRIZZLE_DIR = path.join(REPO_ROOT, "lib/db/drizzle");

/** Table the Part B synthetic migrations create and drop. */
const HARNESS_TABLE = "gate_harness_probe";
const HARNESS_TAGS = [
  "9001_gate_harness_additive",
  "9002_gate_harness_marked_manual",
  "9003_gate_harness_unmarked_destructive",
];

let failures = 0;
let checks = 0;

function check(label: string, condition: boolean, detail?: string): void {
  checks++;
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`);
  }
}

// ===========================================================================
// PART A — classifier
// ===========================================================================

function partA(): void {
  console.log("\n=== Part A: gate classifier (no database) ===\n");

  console.log("-- destructive statements are detected --");
  const destructiveCases: Array<[string, string]> = [
    ["DROP TABLE", "DROP TABLE foo;"],
    ["DROP TABLE IF EXISTS", "DROP TABLE IF EXISTS foo;"],
    ["DROP COLUMN", 'ALTER TABLE "foo" DROP COLUMN "bar";'],
    ["DROP COLUMN IF EXISTS", "ALTER TABLE foo DROP COLUMN IF EXISTS bar;"],
    ["DROP SCHEMA", "DROP SCHEMA public CASCADE;"],
    ["DROP TYPE", "DROP TYPE my_enum;"],
    ["DROP SEQUENCE", "DROP SEQUENCE foo_id_seq;"],
    ["DROP MATERIALIZED VIEW", "DROP MATERIALIZED VIEW foo_mv;"],
    ["TRUNCATE", "TRUNCATE TABLE foo;"],
    ["DELETE without WHERE", "DELETE FROM foo;"],
    ["UPDATE without WHERE", "UPDATE foo SET bar = 1;"],
    [
      "DROP COLUMN inside a DO block",
      "DO $$\nBEGIN\n  ALTER TABLE foo DROP COLUMN bar;\nEND $$;",
    ],
  ];
  for (const [label, sql] of destructiveCases) {
    const findings = detectDestructive(sql);
    check(`${label} → destructive`, findings.length > 0, `got ${JSON.stringify(findings)}`);
  }

  console.log("\n-- reversible statements are NOT flagged --");
  const safeCases: Array<[string, string]> = [
    ["ADD COLUMN", 'ALTER TABLE "foo" ADD COLUMN IF NOT EXISTS "bar" text;'],
    ["CREATE TABLE", "CREATE TABLE IF NOT EXISTS foo (id serial PRIMARY KEY);"],
    ["DROP CONSTRAINT", 'ALTER TABLE "foo" DROP CONSTRAINT IF EXISTS "foo_bar_fk";'],
    ["DROP INDEX", "DROP INDEX IF EXISTS foo_bar_idx;"],
    ["DROP NOT NULL", 'ALTER TABLE "foo" ALTER COLUMN "bar" DROP NOT NULL;'],
    ["DROP DEFAULT", 'ALTER TABLE "foo" ALTER COLUMN "bar" DROP DEFAULT;'],
    ["DROP TRIGGER", "DROP TRIGGER IF EXISTS foo_trg ON foo;"],
    ["DROP FUNCTION", "DROP FUNCTION IF EXISTS foo_fn();"],
    ["DROP POLICY", "DROP POLICY IF EXISTS foo_pol ON foo;"],
    ["plain DROP VIEW", "DROP VIEW IF EXISTS foo_v;"],
    ["RENAME COLUMN", 'ALTER TABLE "foo" RENAME COLUMN "a" TO "b";'],
    ["DELETE with WHERE", "DELETE FROM foo WHERE id = 1;"],
    ["UPDATE with WHERE", "UPDATE foo SET bar = 1 WHERE id = 1;"],
    ["ADD VALUE to enum", "ALTER TYPE my_enum ADD VALUE IF NOT EXISTS 'x';"],
  ];
  for (const [label, sql] of safeCases) {
    const findings = detectDestructive(sql);
    check(`${label} → not destructive`, findings.length === 0, `got ${JSON.stringify(findings)}`);
  }

  console.log("\n-- comments and string literals cannot trip the detector --");
  check(
    "a comment mentioning DROP TABLE is ignored",
    detectDestructive("-- this migration replaces the old DROP TABLE foo approach\nSELECT 1;")
      .length === 0
  );
  check(
    "a gate-reason mentioning DROP TABLE is ignored",
    detectDestructive(
      "-- @migration-gate: auto-approved\n-- @gate-reason: supersedes the DROP TABLE in 0087\nSELECT 1;"
    ).length === 0
  );
  check(
    "a string literal containing TRUNCATE is ignored",
    detectDestructive("INSERT INTO audit (msg) VALUES ('TRUNCATE was considered') ;").length === 0
  );
  check(
    "masking preserves length and newlines",
    (() => {
      const src = "-- hello\nSELECT 1;\n";
      const masked = maskSqlNoise(src);
      return masked.length === src.length && masked.split("\n").length === src.split("\n").length;
    })()
  );
  check(
    "line numbers point at the real line",
    detectDestructive("SELECT 1;\n\n\nDROP TABLE foo;\n")[0]?.line === 4,
    `got ${JSON.stringify(detectDestructive("SELECT 1;\n\n\nDROP TABLE foo;\n"))}`
  );
  check(
    "the reported statement text excludes the file's own comment header",
    (() => {
      const [finding] = detectDestructive(
        "-- @migration-gate: manual\n-- @gate-reason: a dead table, run by hand\n\nDROP TABLE foo;"
      );
      return finding?.line === 4 && finding.statement === "DROP TABLE foo";
    })(),
    JSON.stringify(
      detectDestructive(
        "-- @migration-gate: manual\n-- @gate-reason: a dead table, run by hand\n\nDROP TABLE foo;"
      )
    )
  );

  console.log("\n-- header parsing --");
  const good = parseGateHeader(
    "-- @migration-gate: manual\n-- @gate-reason: drops a dead table (#2930)\n\nDROP TABLE foo;"
  );
  check("manual + reason parses", good.disposition === "manual" && good.error === null);
  check(
    "auto-approved parses",
    parseGateHeader(
      "-- @migration-gate: auto-approved\n-- @gate-reason: reviewed, already applied\nSELECT 1;"
    ).disposition === "auto-approved"
  );
  check(
    "unknown disposition is an error",
    parseGateHeader("-- @migration-gate: maybe\n-- @gate-reason: whatever it is\nSELECT 1;")
      .error !== null
  );
  check(
    "missing reason is an error",
    parseGateHeader("-- @migration-gate: manual\nDROP TABLE foo;").error !== null
  );
  check(
    "reason without a gate line is an error",
    parseGateHeader("-- @gate-reason: this is orphaned\nSELECT 1;").error !== null
  );
  check(
    "a header below the first SQL line is NOT read",
    parseGateHeader("SELECT 1;\n-- @migration-gate: manual\n-- @gate-reason: too late here")
      .disposition === null
  );

  console.log("\n-- end-to-end verdicts --");
  check(
    "additive, no header → apply",
    evaluateMigrationGate("t", "ALTER TABLE foo ADD COLUMN bar text;").action === "apply"
  );
  check(
    "destructive, no header → hold (fail closed)",
    (() => {
      const v = evaluateMigrationGate("t", "DROP TABLE foo;");
      return v.action === "hold" && v.holdCause === "unmarked-destructive";
    })()
  );
  check(
    "destructive, marked manual → hold",
    (() => {
      const v = evaluateMigrationGate(
        "t",
        "-- @migration-gate: manual\n-- @gate-reason: dead table, run by hand\nDROP TABLE foo;"
      );
      return v.action === "hold" && v.holdCause === "marked-manual";
    })()
  );
  check(
    "destructive, marked auto-approved → apply",
    evaluateMigrationGate(
      "t",
      "-- @migration-gate: auto-approved\n-- @gate-reason: reviewed and already applied\nDROP TABLE foo;"
    ).action === "apply"
  );
  check(
    "additive, marked manual → still hold (the marker is authoritative)",
    evaluateMigrationGate(
      "t",
      "-- @migration-gate: manual\n-- @gate-reason: needs a maintenance window\nALTER TABLE foo ADD COLUMN bar text;"
    ).action === "hold"
  );
  check(
    "malformed header → hold, not apply",
    (() => {
      const v = evaluateMigrationGate("t", "-- @migration-gate: nonsense\nSELECT 1;");
      return v.action === "hold" && v.holdCause === "malformed-header";
    })()
  );

  console.log("\n-- the real lib/db/drizzle corpus --");
  const realFiles = fs.readdirSync(REAL_DRIZZLE_DIR).filter((f) => f.endsWith(".sql"));
  const realVerdicts = realFiles.map((f) =>
    evaluateMigrationGate(f.replace(/\.sql$/, ""), fs.readFileSync(path.join(REAL_DRIZZLE_DIR, f), "utf-8"))
  );
  const ungated = realVerdicts.filter(
    (v) => v.holdCause === "unmarked-destructive" || v.holdCause === "malformed-header"
  );
  check(
    `every destructive migration in lib/db/drizzle carries a gate header (${realFiles.length} files scanned)`,
    ungated.length === 0,
    ungated.map((v) => v.tag).join(", ")
  );
  const orphanVerdict = realVerdicts.find((v) => v.tag === "0201_drop_service_page_trigger_keys");
  check(
    "0201_drop_service_page_trigger_keys is held as manual",
    orphanVerdict?.holdCause === "marked-manual",
    `got ${orphanVerdict?.holdCause}`
  );
  const additiveSample = realVerdicts.find((v) => v.tag === "0200_add_test_suites");
  check(
    "0200_add_test_suites (ordinary additive) is applied, not held",
    additiveSample?.action === "apply",
    `got ${additiveSample?.action}`
  );
}

// ===========================================================================
// PART B — the real runner, against the real dev database
// ===========================================================================

function writeSyntheticMigrations(dir: string): void {
  fs.mkdirSync(path.join(dir, "meta"), { recursive: true });

  fs.writeFileSync(
    path.join(dir, `${HARNESS_TAGS[0]}.sql`),
    `CREATE TABLE IF NOT EXISTS ${HARNESS_TABLE} (\n` +
      `  id serial PRIMARY KEY,\n` +
      `  keep_me text,\n` +
      `  drop_me text\n` +
      `);\n`
  );

  fs.writeFileSync(
    path.join(dir, `${HARNESS_TAGS[1]}.sql`),
    `-- @migration-gate: manual\n` +
      `-- @gate-reason: harness fixture — must never be executed by the runner\n\n` +
      `DROP TABLE IF EXISTS ${HARNESS_TABLE};\n`
  );

  // Deliberately NO header: this is the fail-closed safety net under test.
  fs.writeFileSync(
    path.join(dir, `${HARNESS_TAGS[2]}.sql`),
    `ALTER TABLE ${HARNESS_TABLE} DROP COLUMN IF EXISTS drop_me;\n`
  );

  fs.writeFileSync(
    path.join(dir, "meta/_journal.json"),
    JSON.stringify(
      {
        version: "7",
        dialect: "postgresql",
        entries: HARNESS_TAGS.map((tag, i) => ({
          idx: i,
          version: "7",
          when: Date.now() + i,
          tag,
          breakpoints: true,
        })),
      },
      null,
      2
    ) + "\n"
  );
}

async function partB(databaseUrl: string): Promise<void> {
  console.log("\n=== Part B: real migrate-dev run against the real dev database ===\n");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-harness-"));
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    // Pre-flight: never run against a database that already has these objects.
    const client = await pool.connect();
    try {
      const pre = await client.query(`SELECT to_regclass($1) AS t`, [HARNESS_TABLE]);
      if (pre.rows[0]?.t !== null) {
        throw new Error(
          `${HARNESS_TABLE} already exists in the target database — refusing to run. ` +
            `Drop it by hand and re-run the harness.`
        );
      }
    } finally {
      client.release();
    }

    writeSyntheticMigrations(dir);

    // Spawn the REAL runner as a real child process, so its real exit code is
    // what gets asserted — not a re-implementation of it.
    const tsxCli = path.join(SCRIPTS_PKG_ROOT, "node_modules/tsx/dist/cli.mjs");
    if (!fs.existsSync(tsxCli)) {
      throw new Error(`tsx CLI not found at ${tsxCli}`);
    }
    const result = spawnSync(
      process.execPath,
      [tsxCli, path.join(__dirname, "migrate-dev.ts")],
      {
        cwd: SCRIPTS_PKG_ROOT,
        env: { ...process.env, DRIZZLE_MIGRATIONS_DIR: dir },
        encoding: "utf-8",
      }
    );

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    console.log(
      output
        .split("\n")
        .map((l) => `    | ${l}`)
        .join("\n")
    );

    check(
      `migrate-dev exits ${GATE_HELD_EXIT_CODE} (migrations were held)`,
      result.status === GATE_HELD_EXIT_CODE,
      `got exit ${result.status}${result.error ? ` (${result.error.message})` : ""}`
    );
    check("the hold banner is printed", output.includes("DESTRUCTIVE MIGRATION GATE"));

    const verify = await pool.connect();
    try {
      const table = await verify.query(`SELECT to_regclass($1) AS t`, [HARNESS_TABLE]);
      check(
        "the ordinary additive migration WAS applied (table exists)",
        table.rows[0]?.t !== null,
        `to_regclass returned ${table.rows[0]?.t}`
      );

      const col = await verify.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'drop_me'`,
        [HARNESS_TABLE]
      );
      check(
        "the UNMARKED destructive migration was HELD (drop_me column survives)",
        (col.rowCount ?? 0) === 1,
        `drop_me present: ${(col.rowCount ?? 0) === 1}`
      );

      const tracked = await verify.query<{ tag: string }>(
        `SELECT tag FROM __drizzle_migrations WHERE tag = ANY($1::text[]) ORDER BY tag`,
        [HARNESS_TAGS]
      );
      const trackedTags = tracked.rows.map((r) => r.tag);
      check(
        "the additive migration is recorded in __drizzle_migrations",
        trackedTags.includes(HARNESS_TAGS[0]!),
        `tracked: ${JSON.stringify(trackedTags)}`
      );
      check(
        "the manual-marked migration is NOT recorded (still pending)",
        !trackedTags.includes(HARNESS_TAGS[1]!),
        `tracked: ${JSON.stringify(trackedTags)}`
      );
      check(
        "the unmarked destructive migration is NOT recorded (still pending)",
        !trackedTags.includes(HARNESS_TAGS[2]!),
        `tracked: ${JSON.stringify(trackedTags)}`
      );
    } finally {
      verify.release();
    }
  } finally {
    // Teardown — always, pass or fail.
    const cleanup = await pool.connect();
    try {
      await cleanup.query(`DROP TABLE IF EXISTS ${HARNESS_TABLE}`);
      await cleanup.query(`DELETE FROM __drizzle_migrations WHERE tag = ANY($1::text[])`, [
        HARNESS_TAGS,
      ]);
      console.log(`\n  (torn down ${HARNESS_TABLE} and its __drizzle_migrations rows)`);
    } finally {
      cleanup.release();
    }
    await pool.end();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ===========================================================================

async function main(): Promise<void> {
  console.log("=== Destructive migration gate — test harness (Git #2930) ===");

  partA();

  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    console.error(
      "\nERROR: DATABASE_URL is not set — Part B (the real runner) cannot run.\n" +
        "       Part A results above are still valid."
    );
    process.exit(2);
  }
  await partB(databaseUrl);

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} FAILED.`);
    process.exit(1);
  }
  console.log("Destructive migration gate: OK.");
}

main().catch((err) => {
  console.error("test-gate failed:", err);
  process.exit(1);
});
