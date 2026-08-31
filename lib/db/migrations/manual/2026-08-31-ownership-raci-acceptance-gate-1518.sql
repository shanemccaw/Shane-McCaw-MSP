-- Ownership / RACI — universal, symmetric, cross-boundary acceptance gate (#1518)
--
-- #1518 settles that whoever is NAMED in an R or A cell must themselves agree
-- to it — MSP included — and that this works identically in both directions
-- across the tenant boundary (a customer assigning the MSP, or the MSP
-- proposing itself, land on the same gate). Two things were missing for that:
--
--   1. `acceptance` only ever moved "" -> "pending" -> "accepted". There was
--      no DECLINE outcome, and no record of WHO actually responded or WHEN —
--      `set_by`/`set_at` record who ASSIGNED the cell, not who accepted it,
--      so a real audit question ("did the accountable person agree, and
--      when?") had no column to answer it from.
--
--   2. Nothing recorded a REASON for a decline. Accepting needs no reason;
--      declining a role someone was just named to is exactly the case a
--      reader later wants an explanation for.
--
-- `acceptance` itself needs no migration: it is a free TEXT column with no DB
-- CHECK constraint (matching the rest of this table and the wider
-- msp_alert-enums-are-text convention), so "declined" is a new value the
-- application-layer guard (`isOwnDecision`) admits without a schema change.
--
-- Additive/reversible per CLAUDE.md. Drizzle schema lives in
-- lib/db/src/schema/msp.ts (hand-written; no drizzle-kit push).
--
-- Already run against local DATABASE_URL in a prior session of this build
-- (worktree lost before the commit landed — see build-journal/1518.md); this
-- file re-adds it to source control so the applied state is documented.
-- IF NOT EXISTS makes re-running it here a safe no-op.

BEGIN;

ALTER TABLE portal_ownership_assignments
  ADD COLUMN IF NOT EXISTS responded_by text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS responded_at text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS decline_reason text NOT NULL DEFAULT '';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-31-ownership-raci-acceptance-gate-1518.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
