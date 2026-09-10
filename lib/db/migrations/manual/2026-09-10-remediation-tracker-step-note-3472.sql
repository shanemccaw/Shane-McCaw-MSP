-- #3472 — Session Notes (MyArchitect): MSP-operator free-text note per
-- remediation_tracker_steps row.
--
-- Change-control-linked notes already have a real home: attestationNote on
-- POST .../change-control/executions/human-action and .../attest (no schema
-- change needed there). Plain remediation_tracker_steps checklist items had
-- no notes field at all — this adds one nullable column, written through its
-- own PUT .../steps/:stepId/note route (msp-remediation-tracker.ts), kept
-- separate from the status write so setting a note never resets
-- verification_state/verified_at the way a status change deliberately does.
--
-- MSP-side only: the customer-facing portal-remediation-tracker.ts route does
-- not read or write this column. Additive, nullable, reversible.

BEGIN;

ALTER TABLE remediation_tracker_steps ADD COLUMN IF NOT EXISTS note TEXT;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-10-remediation-tracker-step-note-3472.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
