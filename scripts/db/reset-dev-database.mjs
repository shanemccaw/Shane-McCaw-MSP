#!/usr/bin/env node
// scripts/db/reset-dev-database.mjs
//
// Git #4393: a real, reusable self-service version of the reset #4272 already
// executed once by hand (Phase 2 of #4270's tenant-reset chain). Resets the
// real direct MSP (msp.is_direct_business = true -- "Shane McCaw Consulting")
// back to a clean-slate, freshly-purchased state: its tenants/customers gone,
// its MSP-staff logins intact, every other MSP (including vitest/test
// fixtures) completely untouched.
//
// Unlike #4272's one-off manual run, this script does not hardcode a table
// list or a set of vitest fixture ids. It:
//   1. Derives the target MSP live (`is_direct_business = true`), not a
//      hardcoded id -- whichever row is flagged as Shane's real business.
//   2. Reuses #4313's find-tenant-scoped-tables.mjs (imported, not
//      reimplemented) to discover -- live, from real information_schema FK
//      edges -- every table transitively reachable from tenants/users/msps.
//      That is the reset candidate population; nothing here hardcodes #4271's
//      one-time snapshot of that list.
//   3. Computes a real per-table SQL scope via a fixpoint over ALL real FK
//      edges from each table into an already-scoped parent (not just the
//      first/shortest edge #4313 reports for display) -- so a table with more
//      than one FK into scope (e.g. both a tenant_id column and a
//      resolved_by_user_id column) is scoped by the OR of every real edge,
//      not just one.
//   4. Deletes each in-scope table's rows in reverse-resolution order
//      (children before the parents their own scope query reads from) inside
//      a BEGIN...ROLLBACK dry run first, then the real transaction -- the
//      same FK-safe children-first discipline #4272 proved live.
//   5. Leaves two curated exception sets untouched, both real product/audit
//      decisions from #4271 (not re-derivable from FK shape alone):
//        - PRESERVE_TABLES: the 26 MSP-authored-config tables #4271 §4 found
//          in the FK-reachable set but categorized as config, not per-tenant
//          operational data (e.g. policy_rules, msp_sops).
//        - ORPHAN_FULL_WIPE_TABLES: the 11 execution-history tables #4271 §6
//          found to carry NO FK path to tenants/users/msps at all (so
//          find-tenant-scoped-tables.mjs structurally cannot discover them --
//          they are genuinely unscoped, global workflow/comms execution
//          history) that #4272 proved safe to wipe unconditionally.
//   Every other MSP's rows -- vitest fixtures included -- are protected
//   automatically because they never match the live target-MSP scope, not
//   because of a hardcoded id list that could go stale.
//
// Usage:
//   node scripts/db/reset-dev-database.mjs --dry-run        # BEGIN...ROLLBACK only, prints the plan + counts
//   node scripts/db/reset-dev-database.mjs --yes             # real reset, skips the interactive confirmation prompt
//   node scripts/db/reset-dev-database.mjs                   # real reset, prompts for confirmation first
//
// Both modes always refuse to run against anything that doesn't look like
// local dev and run the BEGIN...ROLLBACK dry run first. --dry-run stops there
// (no backup taken -- it only reports where a real run's backup would go).
// A real run then takes a fresh timestamped pg_dump backup, prints full
// before/after row counts, and confirms the platform boots and MSP-staff
// login still works afterward.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  loadDatabaseUrl,
  queryAllFkEdges,
  walkClosure,
} from "./find-tenant-scoped-tables.mjs";
import { pgCli, redactConnectionSecrets } from "./pg-cli.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

const ROOTS = ["tenants", "users", "msps"];

// #4271 §4 -- MSP-authored config tables that ARE in the FK-reachable
// population (they carry an msp_id FK) but are a product decision to
// preserve, not per-tenant operational output. Not re-derivable from FK
// shape alone -- this is the real audited categorization, reused as-is.
const PRESERVE_TABLES = new Set([
  "signal_derivation_rules",
  "policy_rules",
  "signal_rule_groups",
  "msp_sops",
  "dashboard_templates",
  "msp_feature_role_mapping",
  "msp_roles",
  "compliance_frameworks",
  "scope_creep_policies",
  "sla_policies",
  "engagement_offer_rules",
  "msp_sales_bundles",
  "msp_sla_weights",
  "change_catalog_items",
  "lead_offer_inference_rules",
  "lead_offer_pricing_config",
  "lead_scoring_config",
  "lead_scoring_rules",
  "lead_scoring_tracked_pages",
  "msp_email_templates",
  "msp_report_canvases",
  "msp_report_schedules",
  "sales_offer_config",
  "simulation_profiles",
  "sla_signal_policy_map",
  "standing_policies",
]);

// #4271 §6 -- carry no FK to tenants/users/msps at all (verified live at
// build time against the real schema -- see build-journal/4393.md), so
// find-tenant-scoped-tables.mjs structurally cannot discover them. #4272
// proved these safe to wipe unconditionally (global workflow-execution
// history, not per-tenant data worth preserving across a reset).
//
// NOTE: #4271 §6 originally also listed emails, msp_status_report_comments,
// and msp_refresh_tokens/user_sessions/impersonation_tokens as "orphan-risk
// unscoped" -- but a live check at build time found all of those DO carry a
// real FK to users(id) (linked_user_id / author_user_id / user_id) and are
// therefore reachable via the normal closure path below, which scopes them
// correctly instead of a blanket wipe. Only the tables below were confirmed
// to have genuinely no FK path to any root.
const ORPHAN_FULL_WIPE_TABLES = [
  "wf_run_node_logs",
  "wf_run_node_outputs",
  "wf_trigger_events",
  "wf_runs",
  "wf_triggers",
  "ps_capability_survey_results",
  "email_events",
  "exception_groups",
  "simulator_run_history",
];

// #4399: msp_refresh_tokens.user_id and sla_breaches/sla_compliance_records/
// sla_timers' msp_id + customer_id used to be shaped like real FKs (NOT NULL
// where applicable, holding real ids) with no enforced FOREIGN KEY in the
// live schema, so information_schema-driven FK discovery (the whole basis
// of #4313's closure tool) structurally couldn't see them -- this file used
// to inject a synthetic UNCONSTRAINED_FK_SHAPED_EDGES workaround for exactly
// that gap. #4399's migration
// (lib/db/migrations/manual/2026-09-16-missing-fk-constraints-4399.sql) added
// the real constraints, so queryAllFkEdges() now discovers all 7 edges
// itself and the workaround was removed as dead code (live-verified:
// find-tenant-scoped-tables.mjs resolves all four tables via the real FK
// edge post-migration).

const BACKUP_DIR = "C:\\Source\\ShaneMcCawConsulting\\db-backups";

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run"),
    yes: argv.includes("--yes"),
    json: argv.includes("--json"),
  };
}

function isLocalDevUrl(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const isLocalHost = host === "localhost" || host === "127.0.0.1";
  const looksRemote = /neon\.tech|replit|amazonaws|azure|rds\.|supabase|render\.com/i.test(
    databaseUrl
  );
  return isLocalHost && !looksRemote;
}

// #4436: every psql/pg_dump call below passes pgCli()'s password-free conninfo
// in argv and the password as PGPASSWORD in the child env -- never the raw
// DATABASE_URL, which would put the password into any "Command failed: ..." error.
function psqlValue(databaseUrl, sql) {
  const { conninfo, env } = pgCli(databaseUrl);
  return execFileSync("psql", [conninfo, "-t", "-A", "-c", sql], {
    encoding: "utf8",
    env,
  }).trim();
}

function psqlRun(databaseUrl, sql) {
  const { conninfo, env } = pgCli(databaseUrl);
  return execFileSync("psql", [conninfo, "-t", "-A", "-c", sql], {
    encoding: "utf8",
    env,
  });
}

function quoteIdent(name) {
  return `"${name.replace(/"/g, '""')}"`;
}

// Git #4423 — the same live-consented mccawsoft2 tenant row (a real M365 admin
// consent + real Stripe signup, walked through by hand) was deleted six times in
// one day by this script's own real `--yes` runs, every time as a build session's
// "live verify the script/gate I just wrote" step against the shared local dev DB
// -- never a scheduled job, never a test teardown. Nothing distinguished "scratch
// data safe to nuke" from "a walkthrough that must survive," because both live at
// the exact same msp_id scope this script targets.
//
// A tenant flagged reset_protected blocks the ENTIRE run -- dry run included, so
// the BuildConsole Command Center gate never arms the confirm phrase either --
// regardless of whether the script is invoked directly, through that gate, or
// through an agent's own verification harness. This check lives here, in the
// script's own shared logic, precisely so no caller can route around it.
function loadProtectedTenants(databaseUrl, targetMspId) {
  const rows = psqlValue(
    databaseUrl,
    `SELECT id || '|' || customer_name FROM tenants WHERE msp_id = ${targetMspId} AND reset_protected = true ORDER BY id;`
  );
  return rows
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [id, name] = line.split("|");
      return { id: Number(id), name };
    });
}

function loadTargetMspId(databaseUrl) {
  const rows = psqlValue(
    databaseUrl,
    `SELECT id || '|' || name FROM msps WHERE is_direct_business = true;`
  );
  const lines = rows.split("\n").filter(Boolean);
  if (lines.length !== 1) {
    throw new Error(
      `Expected exactly one msps row with is_direct_business = true, found ${lines.length}. ` +
        `Refusing to guess the target MSP -- this needs a real product decision, not this script.`
    );
  }
  const [id, name] = lines[0].split("|");
  return { id: Number(id), name };
}

// Discover the reset candidate population live via #4313's closure tool
// (imported, not reimplemented), then compute a real per-table scope
// condition via a fixpoint over ALL real FK edges (not just the shortest
// edge the closure tool reports for display).
function buildResetPlan(databaseUrl, targetMspId) {
  const edges = queryAllFkEdges(databaseUrl);
  const closure = walkClosure(ROOTS, edges);
  const closureTables = [...closure.keys()].filter((t) => !ROOTS.includes(t));

  const scope = new Map();
  scope.set("tenants", `msp_id = ${targetMspId}`);
  scope.set("users", `msp_id = ${targetMspId} AND tenant_id IS NOT NULL`);
  // msps itself is never deleted (its rows survive a reset), but its scope
  // condition exists so direct msp_id children can resolve against it.
  const resolved = new Set(["tenants", "users", "msps"]);
  const resolutionOrder = []; // parents-first order in which scopes were resolved

  const remaining = new Set(
    closureTables.filter(
      (t) => !PRESERVE_TABLES.has(t) && !ORPHAN_FULL_WIPE_TABLES.includes(t)
    )
  );

  let changed = true;
  while (changed) {
    changed = false;
    for (const table of [...remaining]) {
      const edgesFromTable = edges.filter(
        (e) =>
          e.childTable === table &&
          resolved.has(e.parentTable) &&
          !PRESERVE_TABLES.has(e.parentTable)
      );
      if (edgesFromTable.length === 0) continue;

      const conditions = edgesFromTable.map((e) => {
        if (e.parentTable === "msps") {
          return `${quoteIdent(e.childColumn)} = ${targetMspId}`;
        }
        return `${quoteIdent(e.childColumn)} IN (SELECT ${quoteIdent(
          e.parentColumn
        )} FROM ${quoteIdent(e.parentTable)} WHERE ${scope.get(e.parentTable)})`;
      });
      scope.set(table, conditions.join(" OR "));
      resolved.add(table);
      resolutionOrder.push(table);
      remaining.delete(table);
      changed = true;
    }
  }

  const unresolved = [...remaining];

  // Execution order: reverse of resolution order, so a table's own DELETE
  // always runs while every table its scope query reads from still has its
  // pre-reset rows intact, AND children are always deleted before the
  // parents any blocking (non-CASCADE) FK would otherwise refuse to let go.
  const executionOrder = [...resolutionOrder].reverse();

  return {
    scopedTables: executionOrder.map((table) => ({
      table,
      whereClause: scope.get(table),
    })),
    tenantsWhereClause: scope.get("tenants"),
    usersWhereClause: scope.get("users"),
    unresolved,
    closureSize: closureTables.length,
  };
}

function tableExists(databaseUrl, table) {
  const out = psqlValue(
    databaseUrl,
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name = '${table.replace(
      /'/g,
      "''"
    )}';`
  );
  return out === "1";
}

function rowCount(databaseUrl, table) {
  return Number(psqlValue(databaseUrl, `SELECT count(*) FROM ${quoteIdent(table)};`));
}

function takeBackup(databaseUrl) {
  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true });
  }
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "")
    .replace("T", "T")
    .replace("Z", "Z");
  const file = path.join(BACKUP_DIR, `shanemccawmsp_pre-dev-reset_${stamp}.dump`);
  console.log(`\nTaking backup: ${file}`);
  const { conninfo, env } = pgCli(databaseUrl);
  execFileSync("pg_dump", [conninfo, "-Fc", "-f", file], { stdio: "inherit", env });
  const list = spawnSync("pg_restore", ["--list", file], { encoding: "utf8" });
  if (list.status !== 0) {
    throw new Error(`Backup verification failed: pg_restore --list exited ${list.status}`);
  }
  const tocEntries = list.stdout.split("\n").filter(Boolean).length;
  console.log(`Backup verified: pg_restore --list exit 0, ${tocEntries} TOC entries.`);
  return file;
}

function runResetSql(databaseUrl, plan, targetMspId, rollback) {
  const statements = [];
  statements.push("BEGIN;");
  for (const { table, whereClause } of plan.scopedTables) {
    statements.push(`DELETE FROM ${quoteIdent(table)} WHERE ${whereClause};`);
  }
  for (const table of ORPHAN_FULL_WIPE_TABLES) {
    statements.push(`DELETE FROM ${quoteIdent(table)};`);
  }
  // users, then tenants -- children (above) must go first so nothing still
  // references a row we're about to delete via a blocking (non-CASCADE) FK.
  statements.push(`DELETE FROM users WHERE ${plan.usersWhereClause};`);
  statements.push(`DELETE FROM tenants WHERE ${plan.tenantsWhereClause};`);
  statements.push(rollback ? "ROLLBACK;" : "COMMIT;");

  const sql = statements.join("\n");
  const tmpDir = mkdtempSync(path.join(tmpdir(), "reset-dev-db-"));
  const sqlFile = path.join(tmpDir, "reset.sql");
  writeFileSync(sqlFile, sql, "utf8");
  const { conninfo, env } = pgCli(databaseUrl);
  const result = spawnSync("psql", [conninfo, "-v", "ON_ERROR_STOP=1", "-f", sqlFile], {
    encoding: "utf8",
    env,
  });
  rmSync(tmpDir, { recursive: true, force: true });
  return { sql, result };
}

async function confirm(promptText) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(promptText, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

// Same real verification #4272 proved live: hit the real auth path with a
// deliberately wrong password. 401 means the platform booted and the auth
// path ran cleanly against the reset DB (not a 500, not a connection
// failure) -- a real functional check, not a generic health ping.
function checkAuthPathRunsCleanly() {
  const result = spawnSync(
    "curl",
    [
      "-s",
      "-X",
      "POST",
      "http://localhost:8080/api/auth/login",
      "-H",
      "Content-Type: application/json",
      "-d",
      '{"email":"shane@shanemccaw.com","password":"__reset-verify-deliberately-wrong__"}',
      "-w",
      "\n%{http_code}",
    ],
    { encoding: "utf8" }
  );
  if (result.error) return { httpCode: "no response", body: String(result.error) };
  const out = result.stdout || "";
  const lastNewline = out.lastIndexOf("\n");
  return {
    body: out.slice(0, lastNewline).trim(),
    httpCode: out.slice(lastNewline + 1).trim(),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = loadDatabaseUrl();

  if (!isLocalDevUrl(databaseUrl)) {
    console.error(
      `Refusing to run: DATABASE_URL does not look like the real local dev database ` +
        `(expected host localhost/127.0.0.1, no remote-hosting hostnames). This script never ` +
        `runs against anything else.`
    );
    process.exit(1);
  }

  const { id: targetMspId, name: targetMspName } = loadTargetMspId(databaseUrl);
  console.log(`Target MSP (live-derived, is_direct_business=true): #${targetMspId} "${targetMspName}"`);

  const protectedTenants = loadProtectedTenants(databaseUrl, targetMspId);
  if (protectedTenants.length > 0) {
    console.error(
      `\nREFUSING TO RUN (dry run included): ${protectedTenants.length} tenant(s) in msp #${targetMspId}'s ` +
        `scope are marked reset_protected -- a real, live-consented walkthrough this script must not delete (Git #4423):`
    );
    for (const t of protectedTenants) {
      console.error(`  tenants.id=${t.id} "${t.name}"`);
    }
    console.error(
      `\nThis is a whole-run refusal, not a per-tenant skip -- nothing was changed. To reset anyway, first clear ` +
        `the flag yourself with a deliberate manual UPDATE once the protected walkthrough is genuinely done with:\n` +
        `  UPDATE tenants SET reset_protected = false WHERE id IN (${protectedTenants.map((t) => t.id).join(", ")});`
    );
    process.exit(1);
  }

  const plan = buildResetPlan(databaseUrl, targetMspId);
  console.log(
    `\nDiscovered ${plan.closureSize} table(s) in the live FK-reachable population from roots ${ROOTS.join(", ")}.\n` +
      `  - ${plan.scopedTables.length} scoped-delete tables (resolved via a real FK chain back to the target MSP)\n` +
      `  - ${ORPHAN_FULL_WIPE_TABLES.length} orphan full-wipe tables (#4271 §6, no FK path to any root)\n` +
      `  - ${PRESERVE_TABLES.size} preserved MSP-config tables (#4271 §4, excluded)\n` +
      `  - users/tenants roots (scoped delete, MSP-staff logins preserved)\n` +
      `  - msps table itself: never touched`
  );
  if (plan.unresolved.length > 0) {
    console.warn(
      `\nWARNING: ${plan.unresolved.length} closure table(s) had no resolvable FK path back to a ` +
        `scoped root/table and were SKIPPED (left untouched), not guessed at: ${plan.unresolved.join(", ")}`
    );
  }

  if (args.json) {
    console.log(JSON.stringify(plan, null, 2));
  }

  console.log("\n--- Dry run (BEGIN...ROLLBACK) ---");
  const dryRunOutcome = runResetSql(databaseUrl, plan, targetMspId, /* rollback */ true);
  if (dryRunOutcome.result.status !== 0) {
    console.error("Dry run FAILED -- refusing to proceed to a real reset.");
    console.error(`exit status: ${dryRunOutcome.result.status}`);
    console.error(redactConnectionSecrets(dryRunOutcome.result.stdout));
    console.error(redactConnectionSecrets(dryRunOutcome.result.stderr));
    if (dryRunOutcome.result.error) {
      console.error(redactConnectionSecrets(dryRunOutcome.result.error.stack ?? dryRunOutcome.result.error));
    }
    process.exit(1);
  }
  console.log("Dry run succeeded: no FK violations, transaction rolled back cleanly.");

  if (args.dryRun) {
    console.log(
      `\nA real run would first take a fresh pg_dump -Fc backup into ${BACKUP_DIR} ` +
        `(verified with pg_restore --list) before changing anything.`
    );
    console.log("\n--dry-run requested: stopping here. No data was changed.");
    return;
  }

  if (!args.yes) {
    const answer = await confirm(
      `\nThis will DELETE msp #${targetMspId} "${targetMspName}"'s tenants/customers and all ` +
        `their downstream data from ${redactConnectionSecrets(databaseUrl)}. A backup will be taken first. Type "yes" to proceed: `
    );
    if (answer !== "yes") {
      console.log("Aborted -- no data was changed.");
      return;
    }
  }

  const backupFile = takeBackup(databaseUrl);

  const beforeCounts = {};
  for (const { table } of plan.scopedTables) {
    if (tableExists(databaseUrl, table)) beforeCounts[table] = rowCount(databaseUrl, table);
  }
  for (const table of ORPHAN_FULL_WIPE_TABLES) {
    if (tableExists(databaseUrl, table)) beforeCounts[table] = rowCount(databaseUrl, table);
  }
  beforeCounts.tenants = rowCount(databaseUrl, "tenants");
  beforeCounts.users = rowCount(databaseUrl, "users");

  console.log("\n--- Executing real reset ---");
  const realOutcome = runResetSql(databaseUrl, plan, targetMspId, /* rollback */ false);
  if (realOutcome.result.status !== 0) {
    console.error("Real reset FAILED after a successful dry run -- this should not happen.");
    console.error(redactConnectionSecrets(realOutcome.result.stderr));
    console.error(`Backup is available at: ${backupFile}`);
    process.exit(1);
  }
  console.log("Reset committed.");

  console.log("\n--- Before / after row counts ---");
  let changedTables = 0;
  for (const table of Object.keys(beforeCounts).sort()) {
    if (!tableExists(databaseUrl, table)) continue;
    const after = rowCount(databaseUrl, table);
    if (after !== beforeCounts[table]) {
      changedTables++;
      console.log(`  ${table}: ${beforeCounts[table]} -> ${after}`);
    }
  }
  console.log(`${changedTables} table(s) changed.`);

  console.log("\n--- Post-reset verification ---");
  const auth = checkAuthPathRunsCleanly();
  const authOk = auth.httpCode === "401";
  console.log(
    `POST /api/auth/login (deliberately wrong password) -> ${auth.httpCode} ` +
      `${authOk ? "(platform booted, auth path ran cleanly against the reset DB)" : "(UNEXPECTED -- investigate)"}`
  );
  const staffCount = psqlValue(
    databaseUrl,
    `SELECT count(*) FROM users WHERE msp_id = ${targetMspId} AND tenant_id IS NULL;`
  );
  console.log(`MSP-staff logins preserved (msp_id=${targetMspId}, tenant_id IS NULL): ${staffCount}`);
  const remainingTenants = psqlValue(
    databaseUrl,
    `SELECT count(*) FROM tenants WHERE msp_id = ${targetMspId};`
  );
  console.log(`Tenants remaining for msp #${targetMspId}: ${remainingTenants}`);

  console.log(`\nBackup: ${backupFile}`);
  console.log("Done.");
}

main().catch((err) => {
  // #4436: defense in depth -- argv no longer carries the password, but never
  // print an error without stripping connection credentials first.
  console.error(redactConnectionSecrets(err?.message || err));
  process.exit(1);
});
