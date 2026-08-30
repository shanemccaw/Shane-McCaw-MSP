-- #1541 — Remediation: CR gate — diff before approval, executable after.
--
-- The diff (preChangeSnapshot / proposedPayload) already ships unconditionally
-- on the CR register (portal-change-control.ts) — nothing to change there.
-- What was missing was the structured link a CR needs to gate a customer-
-- executed fix's PowerShell behind its own approval: `msp_change_requests` had
-- no queryable pointer back to the remediation item ("check") it was raised to
-- fix, only the free-text `linked_finding` display column.
--
-- Additive only. `msp_change_requests` has 0 rows in local dev at the time this
-- was written (verified live), so every column below starts NULL for real data
-- as well as none.

ALTER TABLE msp_change_requests
  ADD COLUMN IF NOT EXISTS remediation_check_key text;

CREATE INDEX IF NOT EXISTS msp_change_requests_remediation_check_key_idx
  ON msp_change_requests (remediation_check_key);

-- cr_events.event_type gains "script_revealed" — the append-only record that a
-- customer-executed fix's script was shown to the customer, once its CR is
-- approved. NO DDL is needed for this half: event_type is plain `text` with no
-- CHECK constraint (verified live — `pg_constraint` on cr_events carries only
-- NOT NULL / PK / FK entries, the same widening-with-no-DDL precedent already
-- used for msp_change_requests.category). The enum widening lives entirely in
-- lib/db/src/schema/msp.ts's CR_EVENT_TYPES.

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-30-remediation-cr-gate-1541.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
