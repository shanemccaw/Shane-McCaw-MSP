#!/usr/bin/env node
// scripts/check-schema-drift.selftest.mjs
//
// Git #3177 -- self-test for extractExpectedSchema, the parser half of the live schema-drift
// audit. Every case builds a REAL temporary migrations directory with REAL .sql files and runs
// the REAL exported function against it; nothing is stubbed, no real database is touched.
//
//   node scripts/check-schema-drift.selftest.mjs

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractExpectedSchema } from "./check-schema-drift.mjs";

let failures = 0;
function ok(cond, msg) {
  if (cond) {
    console.log(`  ok  - ${msg}`);
  } else {
    failures++;
    console.error(`  FAIL - ${msg}`);
  }
}

function withMigrationsDir(files, fn) {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "check-schema-drift-3177-"));
  const dir = path.join(tmpRoot, "migrations");
  mkdirSync(dir, { recursive: true });
  try {
    for (const [name, contents] of Object.entries(files)) {
      writeFileSync(path.join(dir, name), contents);
    }
    fn(dir);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

function main() {
  // Case 1: plain CREATE TABLE, with the exact real trap that shipped broken initially --
  // an inline `--` comment containing its own comma ("category slug, if one was made"), which
  // must NOT be mistaken for a real column-list separator.
  withMigrationsDir(
    {
      "001_dates.sql": `
        CREATE TABLE IF NOT EXISTS dates (
            id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            kind     text NOT NULL,
            category text,  -- on-the-fly category slug, if one was made
            at_date  date NOT NULL
        );
      `,
    },
    (dir) => {
      const schema = extractExpectedSchema([dir]);
      const cols = schema.get("dates");
      ok(!!cols, "CREATE TABLE is recognized");
      ok(cols?.has("category"), "column after a comma-bearing comment is captured correctly");
      ok(!cols?.has("if"), "comment prose ('if one was made') is not mistaken for a column");
      ok(cols?.size === 4, `exactly 4 real columns extracted (got ${cols?.size})`);
    },
  );

  // Case 2: a type modifier with its own internal comma/parens (numeric(10,2)) must not
  // fool the top-level column splitter.
  withMigrationsDir(
    {
      "001_money.sql": `
        CREATE TABLE IF NOT EXISTS amounts (
            id     uuid PRIMARY KEY,
            amount numeric(10,2) NOT NULL,
            label  text
        );
      `,
    },
    (dir) => {
      const cols = extractExpectedSchema([dir]).get("amounts");
      ok(cols?.size === 3, `numeric(10,2) does not split into an extra column (got ${cols?.size})`);
      ok(cols?.has("amount") && cols?.has("label"), "both real columns present");
    },
  );

  // Case 3: multi-clause ALTER TABLE (`ADD COLUMN a, ADD COLUMN b`) in one statement -- the
  // real shape 020_barcode_scan.sql uses, and the second real bug this parser had to fix.
  withMigrationsDir(
    {
      "001_list_items.sql": `CREATE TABLE IF NOT EXISTS list_items (id uuid PRIMARY KEY);`,
      "002_pricing.sql": `
        ALTER TABLE list_items
            ADD COLUMN IF NOT EXISTS price_source text,
            ADD COLUMN IF NOT EXISTS priced_at    timestamptz;
      `,
    },
    (dir) => {
      const cols = extractExpectedSchema([dir]).get("list_items");
      ok(cols?.has("price_source"), "first clause of a multi-clause ALTER TABLE is captured");
      ok(cols?.has("priced_at"), "second clause of a multi-clause ALTER TABLE is captured too");
    },
  );

  // Case 4: DROP COLUMN and RENAME COLUMN actually mutate the expected set.
  withMigrationsDir(
    {
      "001_t.sql": `CREATE TABLE IF NOT EXISTS t (id uuid PRIMARY KEY, old_name text, gone text);`,
      "002_t.sql": `ALTER TABLE t RENAME COLUMN old_name TO new_name;`,
      "003_t.sql": `ALTER TABLE t DROP COLUMN IF EXISTS gone;`,
    },
    (dir) => {
      const cols = extractExpectedSchema([dir]).get("t");
      ok(cols?.has("new_name") && !cols?.has("old_name"), "RENAME COLUMN moves the column");
      ok(!cols?.has("gone"), "DROP COLUMN removes the column");
    },
  );

  // Case 5: the real, concrete regression this whole audit exists for -- a table/column that
  // is live but genuinely has no CREATE/ADD COLUMN anywhere is NOT in the expected set (i.e.
  // extraction doesn't invent coverage that isn't there).
  withMigrationsDir(
    { "001_t.sql": `CREATE TABLE IF NOT EXISTS t (id uuid PRIMARY KEY);` },
    (dir) => {
      const schema = extractExpectedSchema([dir]);
      ok(!schema.has("catches"), "a table no file mentions is absent from the expected set");
      ok(!schema.get("t")?.has("requested_by"), "a column no file mentions is absent too");
    },
  );

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exitCode = 1;
  } else {
    console.log("\nOK -- all check-schema-drift self-test cases passed");
  }
}

main();
