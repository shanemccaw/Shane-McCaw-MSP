-- #1558 — SOPs/Runbooks: per-tenant custom steps as an overlay on a versioned
-- MSP definition, plus the run's own half of the version-ambiguity requirement.
--
-- Two additive changes:
--   1. msp_sop_runs.sop_version — the msp_sops.version a run actually followed,
--      captured at insert so it stays true even after the base definition is
--      republished forward.
--   2. portal_sop_custom_steps — the new table. A tenant's own steps grafted
--      onto an MSP-authored SOP, kept structurally separate from msp_sops.steps
--      so a version bump on the base definition can never discard them.
--
-- See lib/db/src/schema/msp.ts (mspSopRunsTable.sopVersion,
-- portalSopCustomStepsTable) for the full rationale.

ALTER TABLE msp_sop_runs
  ADD COLUMN IF NOT EXISTS sop_version text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS portal_sop_custom_steps (
  id SERIAL PRIMARY KEY,
  customer_id integer NOT NULL,
  sop_id text NOT NULL,
  position integer NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  based_on_version text NOT NULL,
  added_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_sop_custom_steps_customer_sop_idx
  ON portal_sop_custom_steps (customer_id, sop_id);

CREATE UNIQUE INDEX IF NOT EXISTS portal_sop_custom_steps_customer_sop_position_idx
  ON portal_sop_custom_steps (customer_id, sop_id, position);

-- Self-marking run, so Simulator Studio's Migrations tree reflects reality
-- regardless of which console ran this file.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-30-sop-custom-steps-overlay-1558.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
