-- ============================================================================
-- POA&Ms ⟷ Risk Acceptance (RBD): real bidirectional conversion (Git #3081,
-- Phase 1b of #1935).
-- ============================================================================
-- Manual migration — self-executed via direct local Postgres per current
-- CLAUDE.md. Additive only: new nullable columns on the two real tables
-- #3080 (Phase 1a) already shipped, plus their indexes. Nothing destructive.
-- Idempotent: every ADD COLUMN/INDEX is IF NOT EXISTS — safe to re-run.
--
-- Real decision, recorded on #1935: conversion between a risk acceptance
-- (msp_risk_decisions / RBD, #1487) and a POA&M (msp_poams, #3080) is
-- genuinely bidirectional — neither is a silent default, both require a real,
-- explicit MSP/customer action. Each direction:
--   1. Creates a NEW row on the other table, carrying forward the real
--      identity/finding-link/accountability fields rather than re-deriving
--      or inventing them.
--   2. Changes the SOURCE row's own status to a real terminal
--      "converted_..." value (never left dangling in its prior status) and
--      points it forward at the row it became, via the *_converted_to_*_id
--      columns below.
--   3. The new row carries a *_spawned_by_*_id column back to the source row
--      it came from — same forward/back pointer shape
--      `msp_risk_decisions.spawnedByChangeRequestId` /
--      `.dischargedByChangeRequestId` already established for the CR⟷Risk
--      relationship (#1514).
-- ============================================================================

BEGIN;

-- ── msp_poams: converted OUT to (this plan became too costly/infeasible and
--    was converted to an accepted risk) and spawned FROM (this plan was
--    created by converting a risk acceptance the customer decided to fix) ───
ALTER TABLE msp_poams ADD COLUMN IF NOT EXISTS converted_to_risk_decision_id INTEGER REFERENCES msp_risk_decisions(id) ON DELETE SET NULL;
ALTER TABLE msp_poams ADD COLUMN IF NOT EXISTS spawned_by_risk_decision_id INTEGER REFERENCES msp_risk_decisions(id) ON DELETE SET NULL;
ALTER TABLE msp_poams ADD COLUMN IF NOT EXISTS conversion_reason TEXT;

CREATE INDEX IF NOT EXISTS msp_poams_converted_to_risk_decision_idx ON msp_poams (converted_to_risk_decision_id);
CREATE INDEX IF NOT EXISTS msp_poams_spawned_by_risk_decision_idx ON msp_poams (spawned_by_risk_decision_id);

-- ── msp_risk_decisions: converted OUT to (customer decided to actually fix
--    this accepted risk, converted to a POA&M) and spawned FROM (this
--    acceptance was created by converting a POA&M whose cost/factors turned
--    out too high) ───────────────────────────────────────────────────────────
ALTER TABLE msp_risk_decisions ADD COLUMN IF NOT EXISTS converted_to_poam_id INTEGER REFERENCES msp_poams(id) ON DELETE SET NULL;
ALTER TABLE msp_risk_decisions ADD COLUMN IF NOT EXISTS spawned_by_poam_id INTEGER REFERENCES msp_poams(id) ON DELETE SET NULL;
ALTER TABLE msp_risk_decisions ADD COLUMN IF NOT EXISTS conversion_reason TEXT;

CREATE INDEX IF NOT EXISTS msp_risk_decisions_converted_to_poam_idx ON msp_risk_decisions (converted_to_poam_id);
CREATE INDEX IF NOT EXISTS msp_risk_decisions_spawned_by_poam_idx ON msp_risk_decisions (spawned_by_poam_id);

-- ── Self-mark for Simulator Studio's Migrations tree (#497) ──────────────────
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-10-poam-rbd-bidirectional-conversion-3081.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
