-- #1556 — SOPs/Runbooks unification: one procedure definition, one run record.
--
-- `msp_sop_runs` is the surviving run record for a procedure regardless of what
-- invoked it. Provenance becomes a property of the run rather than a different
-- table: a policy-invoked enactment (#1548), a lifecycle operation (#1552), a
-- remediation fix (#1539) and a hand-started run are the same object with a
-- different `origin`.
--
-- Additive, reversible: one NOT NULL column with a DEFAULT so every existing row
-- (there are none today — the execution hook is not yet connected, #1559) and any
-- writer that does not set it reads as `manual`. Vocabulary is enforced in code
-- (MSP_SOP_RUN_ORIGIN), not by a DB CHECK, matching the widen-in-code convention
-- `msp_sop_runs.status` already follows.

ALTER TABLE msp_sop_runs
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'manual';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-30-sop-run-origin-1556.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
