-- =============================================================================
-- ⛔ DO NOT RUN until File A's straggler count is ZERO.
--
--    File A: 2026-07-28-igd-msp-customer-id-A-add-and-backfill.sql
--
--    Run File A first. Its last statement is:
--
--      SELECT COUNT(*) AS total_stragglers_must_be_zero_before_file_b
--      FROM insights_generated_documents
--      WHERE msp_customer_id IS NULL;
--
--    If that count is NOT 0, this file's ALTER ... SET NOT NULL will fail
--    outright (Postgres validates the whole table). Nothing will be corrupted,
--    but the migration stops. Resolve or delete those rows by hand FIRST —
--    deliberately, as a separate decision. No migration file deletes documents.
-- =============================================================================
--
-- FILE B of 2 — insights_generated_documents.msp_customer_id
--
-- Locks the column in as required and adds the tenant-scoped read index.
--
-- ⚠️ ONE-WAY DOOR FOR WRITERS: once this runs, ANY insert into
-- insights_generated_documents without an msp_customer_id fails at the DB.
-- All five real writers already populate it and refuse to insert without it
-- (document-engine.ts, document-engine-sow.ts, workflow-executor.ts,
-- dashboard-export.ts, document-generator.ts), so the application side is
-- already ready. Confirm that code is DEPLOYED before running this.
--
-- ⚠️ ALSO BEFORE RUNNING: the three legacy insert sites in
-- routes/admin-insights.ts cannot satisfy this constraint — the automation
-- runner's insert uses `automation.customerId ?? null`, which is nullable by
-- design. Those three routes are gated off (410 Gone) in the same commit as
-- this file. Confirm that gate is deployed too.
-- =============================================================================

-- ── Step 1: require the tenant ───────────────────────────────────────────────
ALTER TABLE insights_generated_documents
  ALTER COLUMN msp_customer_id SET NOT NULL;


-- ── Step 2: the tenant-scoped read index ─────────────────────────────────────
-- "this tenant's documents of this type, newest first".
-- Named explicitly rather than letting Postgres autogenerate, so it matches the
-- Drizzle schema definition (lib/db/src/schema/index.ts) and is re-runnable.
CREATE INDEX IF NOT EXISTS igd_msp_customer_doc_type_created_idx
  ON insights_generated_documents (msp_customer_id, doc_type, created_at);


-- ── Step 3: confirm ──────────────────────────────────────────────────────────
-- is_nullable should be 'NO'.
SELECT column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_name = 'insights_generated_documents'
  AND column_name = 'msp_customer_id';

-- The new index should be listed.
SELECT indexname
FROM pg_indexes
WHERE tablename = 'insights_generated_documents'
  AND indexname = 'igd_msp_customer_doc_type_created_idx';


-- =============================================================================
-- AFTER THIS FILE HAS ACTUALLY BEEN RUN:
-- add `.notNull()` to `mspCustomerId` in lib/db/src/schema/index.ts. It is
-- deliberately typed nullable until then so reads don't claim a non-null value
-- that real rows may not have yet.
-- =============================================================================

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-07-28-igd-msp-customer-id-B-not-null-and-index.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
