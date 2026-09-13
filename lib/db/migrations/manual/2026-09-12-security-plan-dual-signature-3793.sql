-- #3793 (parented under #1689, Feature: Security Plan (MSP Console)) — dual
-- signature. Product decision (#1689, 2026-09-12): a Security Plan version is
-- signed by BOTH the customer and the MSP, independently — not whichever party
-- gets there first. The original `signed`/`signed_by`/`signed_at` triple had
-- room for exactly one signer; whichever party signed first filled the only
-- slot and blocked the other's signature outright.
--
-- Additive only: adds four new nullable columns, one independent slot per
-- party. Run by the agent itself (additive DDL, per CLAUDE.md's Database
-- section) against local Postgres.
--
-- The old `signed`/`signed_by`/`signed_at` columns are NOT dropped here —
-- dropping them is destructive DDL and stays Shane's to run himself (see the
-- companion file `2026-09-12-security-plan-drop-legacy-signature-columns-3793.sql`).
-- Confirmed via direct psql at authoring time: 0 rows exist in
-- msp_security_plan_versions locally, so the backfill below is a no-op today —
-- it is kept so this file behaves correctly if it is ever replayed against a
-- database that already has signed rows (e.g. Staging/Replit, once deployed).

ALTER TABLE msp_security_plan_versions
  ADD COLUMN IF NOT EXISTS customer_signed_by jsonb,
  ADD COLUMN IF NOT EXISTS customer_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS msp_signed_by jsonb,
  ADD COLUMN IF NOT EXISTS msp_signed_at timestamptz;

-- Backfill: every historical write to the old single slot was a CUSTOMER's own
-- signature — either self-serve via the portal's own `/sign` route (#2949), or
-- entered by MSP staff on the customer's behalf via the old MSP-console
-- off-platform-collection route (`signed_by` is `ClientApprover`-shaped in both
-- cases; see security-plan-versioning.ts). Carry it forward into the new
-- customer slot so no historical signature is lost.
UPDATE msp_security_plan_versions
SET customer_signed_by = signed_by, customer_signed_at = signed_at
WHERE signed = true AND signed_by IS NOT NULL AND customer_signed_at IS NULL;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-12-security-plan-dual-signature-3793.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
