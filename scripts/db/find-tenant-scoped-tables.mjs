#!/usr/bin/env node
// scripts/db/find-tenant-scoped-tables.mjs
//
// Git #4313: the #4271 tenant-reset audit enumerated tenant/customer-scoped
// tables only by direct tenant_id/customer_id/customer_user_id columns or a
// direct FK to tenants(id)/msps(id). It missed tables scoped ONLY via an FK
// to users(id) (client_services, signup_exchange_tokens, ...) and missed
// CASCADE-child tables that empty automatically when a reset parent row is
// deleted (checkout_email_verifications, customer_user_roles,
// engine_score_signal_deltas, sales_offer_events, msp_user_roles, ...).
// #4272's live reset execution had to find both classes by hand.
//
// This script generalizes that discovery: starting from the three real
// tenancy roots (tenants, users, msps), it walks the REAL foreign-key graph
// in live information_schema outward, breadth-first, to find every table
// that is transitively reachable via an FK edge (direct or indirect, of any
// referenced column -- not just *_id-by-name guesses). For each such table it
// also reports whether the specific edge that reached it is ON DELETE
// CASCADE, since a CASCADE edge empties automatically when its parent is
// deleted and a non-CASCADE edge (NO ACTION/RESTRICT) will instead BLOCK that
// delete until the child rows are handled -- both are real audit-relevant
// facts, not just "is it in scope."
//
// This is tooling only -- it makes no schema or data change. A future
// tenant-reset audit should run this instead of hand-rolling a narrower query
// like #4271's.
//
// Usage:
//   node scripts/db/find-tenant-scoped-tables.mjs                 # human-readable report
//   node scripts/db/find-tenant-scoped-tables.mjs --json          # machine-readable, for diffing against a reset list
//   node scripts/db/find-tenant-scoped-tables.mjs --roots=tenants,users  # override the root table set (default: tenants,users,msps)
//
// Exit code is always 0 -- this is a discovery/report tool, not a pass/fail
// gate (unlike scripts/testbed-reset-audit.mjs, which diffs against a known
// migration and fails on an uncovered gap).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

import { pgCli, redactConnectionSecrets } from "./pg-cli.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

const DEFAULT_ROOTS = ["tenants", "users", "msps"];

function parseArgs(argv) {
  const args = { json: false, roots: DEFAULT_ROOTS };
  for (const arg of argv) {
    if (arg === "--json") args.json = true;
    else if (arg.startsWith("--roots=")) {
      args.roots = arg
        .slice("--roots=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return args;
}

export function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = readFileSync(path.join(repoRoot, ".env.local"), "utf8");
  const match = envFile.match(/^DATABASE_URL=(.+)$/m);
  if (!match) {
    throw new Error("DATABASE_URL not found in environment or .env.local");
  }
  return match[1].trim();
}

// All real FK edges in the public schema: child table/column -> parent
// table/column, plus the real delete rule for that constraint. This is the
// whole graph -- we walk it in memory rather than issuing one query per hop.
export function queryAllFkEdges(databaseUrl) {
  const sql = `
    SELECT
      tc.table_name || '|' ||
      kcu.column_name || '|' ||
      ccu.table_name || '|' ||
      ccu.column_name || '|' ||
      rc.delete_rule || '|' ||
      tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
     AND tc.table_schema = ccu.table_schema
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name
     AND tc.table_schema = rc.constraint_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
    ORDER BY ccu.table_name, tc.table_name;
  `;
  // #4436: password goes via PGPASSWORD, never argv.
  const { conninfo, env } = pgCli(databaseUrl);
  const out = execFileSync(
    "psql",
    [conninfo, "-t", "-A", "-F", "|", "-c", sql],
    { encoding: "utf8", env }
  );
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [
        childTable,
        childColumn,
        parentTable,
        parentColumn,
        deleteRule,
        constraintName,
      ] = line.split("|");
      return {
        childTable,
        childColumn,
        parentTable,
        parentColumn,
        deleteRule,
        constraintName,
      };
    });
}

// Breadth-first walk outward from the root tables, following every FK edge
// whose PARENT is a table already known to be in-scope. This is the
// "transitive descendant closure": a table one hop from users(id) is in
// scope, and anything one hop from THAT table is also in scope, and so on.
// Each discovered table records the *first* edge that reached it (the
// shortest path) for reporting -- a table can have multiple real parents in
// scope; we only need one to justify inclusion.
export function walkClosure(roots, edges) {
  const edgesByParent = new Map();
  for (const edge of edges) {
    if (!edgesByParent.has(edge.parentTable)) {
      edgesByParent.set(edge.parentTable, []);
    }
    edgesByParent.get(edge.parentTable).push(edge);
  }

  const inScope = new Map(); // table -> { viaEdge, depth }
  for (const root of roots) inScope.set(root, { viaEdge: null, depth: 0 });

  const queue = [...roots];
  while (queue.length > 0) {
    const current = queue.shift();
    const depth = inScope.get(current).depth;
    const outgoing = edgesByParent.get(current) || [];
    for (const edge of outgoing) {
      if (inScope.has(edge.childTable)) continue; // already reached via a shorter/earlier path
      inScope.set(edge.childTable, { viaEdge: edge, depth: depth + 1 });
      queue.push(edge.childTable);
    }
  }

  return inScope;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = loadDatabaseUrl();
  const edges = queryAllFkEdges(databaseUrl);
  const closure = walkClosure(args.roots, edges);

  const rows = [...closure.entries()]
    .filter(([table]) => !args.roots.includes(table))
    .map(([table, { viaEdge, depth }]) => ({
      table,
      depth,
      reachedVia: viaEdge
        ? `${viaEdge.childTable}.${viaEdge.childColumn} -> ${viaEdge.parentTable}.${viaEdge.parentColumn}`
        : null,
      cascade: viaEdge ? viaEdge.deleteRule === "CASCADE" : false,
      deleteRule: viaEdge ? viaEdge.deleteRule : null,
    }))
    .sort((a, b) => a.depth - b.depth || a.table.localeCompare(b.table));

  if (args.json) {
    console.log(JSON.stringify({ roots: args.roots, tables: rows }, null, 2));
    return;
  }

  console.log(
    `Roots: ${args.roots.join(", ")}\n` +
      `Scanned ${edges.length} real FK edge(s) in public schema.\n` +
      `Found ${rows.length} table(s) in the transitive descendant closure ` +
      `(excluding the roots themselves).\n`
  );

  const cascadeRows = rows.filter((r) => r.cascade);
  const blockingRows = rows.filter((r) => !r.cascade);

  console.log(
    `-- ${cascadeRows.length} table(s) reached via an ON DELETE CASCADE edge ` +
      `(auto-emptied when their parent row is deleted):\n`
  );
  for (const r of cascadeRows) {
    console.log(`  [depth ${r.depth}] ${r.table}  (${r.reachedVia})`);
  }

  console.log(
    `\n-- ${blockingRows.length} table(s) reached via a non-CASCADE edge ` +
      `(${blockingRows[0] ? blockingRows.map((r) => r.deleteRule).filter((v, i, a) => a.indexOf(v) === i).join("/") : "n/a"}` +
      ` -- will BLOCK a parent delete until handled explicitly):\n`
  );
  for (const r of blockingRows) {
    console.log(`  [depth ${r.depth}] ${r.table}  (${r.reachedVia}, ${r.deleteRule})`);
  }

  console.log(
    "\nThis is the full real-FK reachable set from the given roots -- diff it " +
      "against whatever table list a reset/audit plans to cover to find gaps, " +
      "the same class of gap #4272 found by hand (client_services, " +
      "signup_exchange_tokens) for non-CASCADE edges into users(id)."
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.error(redactConnectionSecrets(err?.message ?? err));
    process.exit(1);
  }
}
