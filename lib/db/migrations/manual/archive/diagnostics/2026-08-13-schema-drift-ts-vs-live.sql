-- ============================================================================
-- Schema drift diagnostic: Drizzle TypeScript schema  vs.  live Postgres schema
-- Epic #803. Companion to the two automated manifests:
--   test-manifests/observability/dlq-schema-error-scan.json   (reactive)
--   test-manifests/observability/schema-drift-guard.json      (proactive, bounded)
--
-- PURPOSE
--   Flag any column the Drizzle TS schema (lib/db/src/schema/*.ts) defines that
--   does NOT exist in the live database. Such a column is the fingerprint of a
--   migration that was written but never run — it will eventually surface as a
--   Postgres "column \"x\" does not exist" error in msp_dlq_store, which is what
--   the reactive manifest scans for after the fact. This runs BEFORE that.
--
-- READ-ONLY / DIAGNOSTIC-ONLY
--   Pure SELECT, no DDL/DML. Per CLAUDE.md this file lives under
--   archive/diagnostics/ and is EXEMPT from the trailing self-marking
--   simulator_migration_runs INSERT (that marker is only for files that change
--   data/schema). Do NOT run drizzle-kit push for this.
--
-- WHY THIS IS A HAND-RUN DIAGNOSTIC AND NOT FULLY AUTOMATED FOR ALL 259 TABLES
--   SQL cannot read the TS files. To compare against TS, the expected column set
--   must be embedded here as a snapshot. The full schema is 259 pgTable()
--   definitions / ~2000 columns; hand-embedding all of them would (a) rot on
--   every schema change and (b) risk transcription-error FALSE POSITIVES that
--   erode trust. So:
--     * The automated manifest guards only the accurately-transcribed operational
--       error spine (Query A below), which is green in CI.
--     * This file is what Shane (or a future session) runs periodically for the
--       WHOLE schema, using Query B — which needs NO TS transcription at all — plus
--       the regeneration recipe to rebuild the expected set from TS when desired.
--   This is an honest scope split, not faked coverage.
--
--   NOTE ON THE ENDPOINT: #896's POST /admin/deploy/sql-test only accepts a single
--   statement that BEGINS WITH SELECT (it rejects a leading WITH/CTE). Query A is
--   written SELECT-first so it can run through that endpoint as well as in Shane's
--   own SQL console. Run these ONE AT A TIME (the endpoint rejects multi-statement).
--
-- Snapshot authored against the schema at the 2026-08-13 PLATFORM_BUILD.md row's
-- commit. Regenerate the expected set (Query A / the offline TS inventory) whenever
-- lib/db/src/schema/*.ts changes.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- QUERY A — Spine watch-list drift check (self-contained, runnable as-is).
--   Same 44-column operational spine as schema-drift-guard.json. Returns one row
--   per expected column that is MISSING live. Expected result: 0 rows.
--   To extend to more tables: add ('<table>','<db_column>') pairs to the VALUES
--   list (use the DB column name — the string literal inside the Drizzle column
--   helper, e.g. text("error_message") -> 'error_message', NOT the TS property).
-- ----------------------------------------------------------------------------
SELECT e.table_name, e.column_name
FROM (VALUES
  ('msp_dlq_store','id'),('msp_dlq_store','dlq_id'),('msp_dlq_store','source_event_id'),
  ('msp_dlq_store','event_type'),('msp_dlq_store','payload'),('msp_dlq_store','error_message'),
  ('msp_dlq_store','error_stack'),('msp_dlq_store','attempt_count'),('msp_dlq_store','last_attempt_at'),
  ('msp_dlq_store','resolved_at'),('msp_dlq_store','resolution'),('msp_dlq_store','msp_id'),
  ('msp_dlq_store','customer_id'),('msp_dlq_store','created_at'),
  ('msp_job_queue','id'),('msp_job_queue','job_id'),('msp_job_queue','job_type'),
  ('msp_job_queue','status'),('msp_job_queue','msp_id'),('msp_job_queue','customer_id'),
  ('msp_job_queue','payload'),('msp_job_queue','result'),('msp_job_queue','error_message'),
  ('msp_job_queue','error_stack'),('msp_job_queue','attempt_count'),('msp_job_queue','max_attempts'),
  ('msp_job_queue','scheduled_at'),('msp_job_queue','started_at'),('msp_job_queue','completed_at'),
  ('msp_job_queue','correlation_id'),('msp_job_queue','created_at'),
  ('outbound_webhooks','id'),('outbound_webhooks','webhook_id'),('outbound_webhooks','owner_type'),
  ('outbound_webhooks','msp_id'),('outbound_webhooks','customer_id'),('outbound_webhooks','label'),
  ('outbound_webhooks','url'),('outbound_webhooks','secret'),('outbound_webhooks','secret_prefix'),
  ('outbound_webhooks','event_types'),('outbound_webhooks','is_active'),('outbound_webhooks','created_at'),
  ('outbound_webhooks','updated_at')
) AS e(table_name, column_name)
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name  = e.table_name
 AND c.column_name = e.column_name
WHERE c.column_name IS NULL
ORDER BY e.table_name, e.column_name;


-- ----------------------------------------------------------------------------
-- QUERY B — Full live column inventory (needs NO TS transcription; never rots).
--   Dumps every column of every application table in the public schema, ordered
--   stably so it diffs cleanly against a TS-side inventory generated offline.
--   This is the honest "full-schema" path: DB side is this query, TS side is
--   generated by the recipe below, and the cross-reference is a plain text diff.
-- ----------------------------------------------------------------------------
SELECT c.table_name, c.column_name, c.data_type, c.is_nullable
FROM information_schema.columns c
JOIN information_schema.tables t
  ON t.table_schema = c.table_schema
 AND t.table_name  = c.table_name
 AND t.table_type  = 'BASE TABLE'
WHERE c.table_schema = 'public'
ORDER BY c.table_name, c.column_name;

-- ----------------------------------------------------------------------------
-- REGENERATION / FULL CROSS-REFERENCE RECIPE (offline, run from repo root)
--
--   1. Generate the TS-side expected inventory (table_name<TAB>db_column_name),
--      reading the DB names from the Drizzle column helpers' string-literal args.
--      A rough starting extractor (refine per column-helper set actually in use):
--
--        node -e '
--          const fs=require("fs");
--          const files=require("child_process").execSync(
--            "git ls-files lib/db/src/schema/*.ts").toString().trim().split(/\r?\n/);
--          const tableRe=/pgTable\(\s*"([^"]+)"\s*,\s*\{([\s\S]*?)\n\}\)/g;
--          const colRe=/\b(?:text|varchar|integer|serial|bigint|boolean|timestamp|jsonb|uuid|numeric|real|doublePrecision|date|time|smallint|bigserial|json|char|inet|customType)\s*\(\s*"([^"]+)"/g;
--          for (const f of files){const s=fs.readFileSync(f,"utf8");let m;
--            while((m=tableRe.exec(s))){const t=m[1];let cm;
--              while((cm=colRe.exec(m[2]))) console.log(t+"\t"+cm[1]); }}
--        ' | sort -u > /tmp/ts-columns.tsv
--
--      (This is a heuristic — verify against the real files; some tables span the
--       naive block regex. It is a STARTING point, honestly noted, not a guarantee.)
--
--   2. Run QUERY B through #896's sql-test endpoint (or Shane's console), take the
--      returned rows' (table_name, column_name), and format identically:
--        ... | sort -u > /tmp/live-columns.tsv
--
--   3. Columns in TS but NOT live (= migration written but never run):
--        comm -23 /tmp/ts-columns.tsv /tmp/live-columns.tsv
--
--      Columns live but NOT in TS (drift the other way / stale columns):
--        comm -13 /tmp/ts-columns.tsv /tmp/live-columns.tsv
--
--   Anything printed by the first comm is a column the TS schema defines that the
--   live DB is missing — find and run the corresponding migration under
--   lib/db/migrations/manual/.
-- ----------------------------------------------------------------------------
