-- #1509 — Risk Register: Risk instances as line items.
--
-- Additive only. New table, no existing column touched.
--
-- Settled architecture (#1487, #1509): the RBD is a container (one MFA risk
-- with twenty-two accounts, not twenty-two risk records), not a single risk
-- record. `msp_risk_decisions` is the container row (one per rbd_id, unchanged
-- by this migration); risk_instances is the many-rows-per-container line items
-- it was always missing a home for.
--
-- `risk_decision_id` is a real FK to the container row (unlike msp_rbd_versions,
-- #1508, which deliberately keys on the durable rbd_id text because it is a
-- document-version chain). A line item belongs to exactly one container row for
-- its whole life, so a normal FK is the right, simpler tool here. rbd_id/msp_id
-- are denormalized alongside it anyway, matching every other cross-table
-- pointer on msp_risk_decisions, so a caller holding only the container
-- identifier can query instances without a join.
--
-- found_at / accepted_at are per-instance because each object was found and
-- accepted at a different moment — the whole point of #1509. accepted_at
-- follows msp_risk_decisions.accepted_at's existing "never editable after the
-- fact" contract, enforced at the route.
--
-- status is ONE flat enum (active / remediated / object_removed) rather than a
-- boolean-plus-reason pair, matching remediation_tracker_steps.status's
-- existing precedent for exactly the same reason: "still open" and "left, and
-- why" are the same shape of fact. Neither exit reason requires a signature
-- (#1509's own text) — resolved_at is a plain operational timestamp.
--
-- This migration does NOT touch msp_risk_decisions.accepted_at or any existing
-- column/route behavior — see the Drizzle schema header in lib/db/src/schema/msp.ts.

BEGIN;

CREATE TABLE IF NOT EXISTS risk_instances (
  id                serial PRIMARY KEY,
  msp_id            integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  risk_decision_id  integer NOT NULL REFERENCES msp_risk_decisions(id) ON DELETE CASCADE,
  rbd_id            text NOT NULL,
  label             text NOT NULL,
  object_id         text,
  found_at          timestamptz NOT NULL,
  accepted_at       timestamptz,
  status            text NOT NULL DEFAULT 'active',
  resolved_at       timestamptz,
  resolution_note   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT risk_instances_status_check CHECK (status IN ('active', 'remediated', 'object_removed'))
);

CREATE INDEX IF NOT EXISTS risk_instances_msp_id_risk_decision_id_idx ON risk_instances (msp_id, risk_decision_id);
CREATE INDEX IF NOT EXISTS risk_instances_rbd_id_status_idx ON risk_instances (rbd_id, status);
CREATE INDEX IF NOT EXISTS risk_instances_risk_decision_id_idx ON risk_instances (risk_decision_id);

COMMENT ON TABLE risk_instances IS
  'RBD line items (#1509). Many rows per msp_risk_decisions container row — '
  'one MFA risk with twenty-two accounts, not twenty-two risk records. Each '
  'line owns its own found_at/accepted_at clock.';
COMMENT ON COLUMN risk_instances.status IS
  'active / remediated / object_removed. Why a line left the risk (remediated '
  'vs. the object ceasing to exist) is a different history, per #1509. Neither '
  'exit reason requires a signature.';
COMMENT ON COLUMN risk_instances.accepted_at IS
  'NULL until accepted. Never editable after the fact once set — enforced at '
  'the route, same contract as msp_risk_decisions.accepted_at.';

SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'risk_instances'
 ORDER BY ordinal_position;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-31-risk-instances-line-items-1509.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
