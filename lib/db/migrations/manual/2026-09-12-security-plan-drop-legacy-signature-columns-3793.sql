-- #3793 — legacy single-signer columns, superseded by the dual-signature slots
-- added in 2026-09-12-security-plan-dual-signature-3793.sql
-- (customer_signed_by/customer_signed_at, msp_signed_by/msp_signed_at).
--
-- DESTRUCTIVE — per CLAUDE.md's Database section this is Shane's to run
-- himself, not self-executed by an agent. NOT run as part of #3793.
--
-- Prerequisite: 2026-09-12-security-plan-dual-signature-3793.sql must already
-- be applied to this database (its backfill copies any historical
-- signed/signed_by/signed_at row into customer_signed_by/customer_signed_at
-- first) — run this only after confirming that backfill actually ran here.
--
-- Application code (lib/db/src/schema/msp.ts, security-plan-versioning.ts, and
-- both sign routes) no longer reads or writes these three columns as of #3793;
-- they are dead weight on the table, not a live compatibility path.

ALTER TABLE msp_security_plan_versions
  DROP COLUMN IF EXISTS signed,
  DROP COLUMN IF EXISTS signed_by,
  DROP COLUMN IF EXISTS signed_at;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-12-security-plan-drop-legacy-signature-columns-3793.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
