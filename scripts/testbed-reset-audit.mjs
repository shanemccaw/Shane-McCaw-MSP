#!/usr/bin/env node
// scripts/testbed-reset-audit.mjs
//
// Git #1396: #1329's original reset only searched for tenant_id (text) /
// customer_id (integer) columns BY NAME. projects.client_user_id references
// users.id under a different FK shape that naming-based search never
// caught, leaving 14 real child tables unreset until a live bug report
// forced a manual patch (2026-08-27-testbed-reset-patch-projects-1396.sql).
//
// This script generalizes the discovery step so the next FK-shape gap gets
// caught by a repeatable check instead of another live bug report: it reads
// REAL foreign-key constraints out of information_schema (not column-name
// guesses) for every table that references tenants(id), users(id) or
// projects(id), and diffs that against the table lists the reset migration
// (lib/db/migrations/manual/2026-08-27-testbed-reset-patch-projects-1396.sql)
// actually covers. Anything it finds that isn't covered AND isn't on the
// deliberate-exclusion list is a real gap -- print it, don't silently patch
// it (some exclusions, e.g. client_services, are Shane's own product
// decision, not something this script should assume).
//
// Usage: node scripts/testbed-reset-audit.mjs
// Exit code 0 = no new gaps found. Exit code 1 = gap(s) found (see stdout).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const RESET_FILE = path.join(
  repoRoot,
  "lib/db/migrations/manual/2026-08-27-testbed-reset-patch-projects-1396.sql"
);

// Tables this reset intentionally does NOT wipe, confirmed as real product
// decisions in the migration file's own header comments -- not gaps.
const DELIBERATE_EXCLUSIONS = new Set([
  "tenants",
  "users",
  "azure_tenant_credentials",
  "client_app_registrations",
  "consent_invite_tokens",
  "client_services",
  "tenant_add_on_entitlements",
  "msp_sharepoint_connectors",
  "msp_mailbox_connectors",
  "simulator_migration_runs",
  // #2946: auth/session/identity tables that belong to the user's own
  // account, not per-tenant test data. Wiping these on a tenant reset could
  // log the test account out or break its MFA/passkey enrollment -- a real
  // open product decision the migration file's own header explicitly defers
  // to Shane rather than assumes. Filed and flagged, not fixed here.
  "mfa_challenges",
  "mfa_enrollments",
  "password_reset_tokens",
  "user_sessions",
  "webauthn_challenges",
  "webauthn_credentials",
  "push_subscriptions",
]);

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = readFileSync(path.join(repoRoot, ".env.local"), "utf8");
  const match = envFile.match(/^DATABASE_URL=(.+)$/m);
  if (!match) {
    throw new Error("DATABASE_URL not found in environment or .env.local");
  }
  return match[1].trim();
}

function queryRealFkEdges(databaseUrl) {
  // Real FK constraints, not column-name guesses: every child table with a
  // FOREIGN KEY column that references tenants(id), users(id) or
  // projects(id) -- the three shapes this reset needs to reach.
  const sql = `
    SELECT tc.table_name || '|' || kcu.column_name || '|' || ccu.table_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
     AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND ccu.table_name IN ('tenants', 'users', 'projects')
    ORDER BY ccu.table_name, tc.table_name;
  `;
  const out = execFileSync(
    "psql",
    [databaseUrl, "-t", "-A", "-F", "|", "-c", sql],
    { encoding: "utf8" }
  );
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [childTable, fkColumn, parentTable] = line.split("|");
      return { childTable, fkColumn, parentTable };
    });
}

function coveredTables(resetFileSql) {
  // Every quoted table identifier inside the file's ARRAY[...] DELETE lists
  // -- #2946 added "table:column" pairs for loops that delete by a
  // non-uniform column name across tables, so take the part before the
  // colon, if any -- plus the standalone 'projects' DELETE the file also
  // runs directly, plus any literal `DELETE FROM <table>` statement outside
  // an ARRAY[]-driven loop (e.g. config_diffs's own two-column special case).
  const covered = new Set();
  const arrayBlocks = resetFileSql.match(/ARRAY\[[^\]]*\]/gs) || [];
  for (const block of arrayBlocks) {
    const names = block.match(/'([a-z0-9_]+(?::[a-z0-9_]+)?)'/g) || [];
    for (const n of names) covered.add(n.slice(1, -1).split(":")[0]);
  }
  covered.add("projects");
  const literalDeletes = resetFileSql.match(/DELETE FROM ([a-z0-9_]+)\b/g) || [];
  for (const stmt of literalDeletes) covered.add(stmt.replace("DELETE FROM ", ""));
  return covered;
}

function main() {
  const databaseUrl = loadDatabaseUrl();
  const resetFileSql = readFileSync(RESET_FILE, "utf8");
  const covered = coveredTables(resetFileSql);
  const edges = queryRealFkEdges(databaseUrl);

  const gaps = edges.filter(
    ({ childTable }) =>
      !covered.has(childTable) && !DELIBERATE_EXCLUSIONS.has(childTable)
  );

  console.log(
    `Checked ${edges.length} real FK edge(s) into tenants(id)/users(id)/projects(id); ` +
      `${covered.size} table(s) already covered by the reset migration.`
  );

  if (gaps.length === 0) {
    console.log("No new FK-shape gaps found. Reset coverage is current.");
    return;
  }

  console.log(`\nFound ${gaps.length} table(s) with a real FK into ` +
    `tenants/users/projects that the reset migration does NOT cover:\n`);
  for (const g of gaps) {
    console.log(`  ${g.childTable}.${g.fkColumn} -> ${g.parentTable}.id`);
  }
  console.log(
    "\nEach of these is a real gap or needs adding to DELIBERATE_EXCLUSIONS " +
      "in this script (with the same reasoning discipline as the migration " +
      "file's own header) if it's a deliberate product decision, not an oversight."
  );
  process.exitCode = 1;
}

main();
