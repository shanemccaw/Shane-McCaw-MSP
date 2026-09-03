-- Ownership / RACI — decline-escalation identity (#1519)
--
-- #1519 settles that a customer-side decline "escalates internally, to the
-- assigner" — but the only existing record of who assigned a cell is
-- `set_by`, free-text (display name, falling back to email) written by
-- `actingName`/`actingMspName`. That is fine for printing "who set this" to
-- a person, and useless for routing a notification: two holders can share a
-- display name, and nothing here resolves it back to a real recipient.
--
-- `set_by_person_id` is that missing stable identity — the assigner's own
-- wire person id ("u{id}", the same `personIdForUser` scheme `owner_person_id`
-- already uses), captured at assign time so a later decline can notify the
-- real person who made the assignment, not just print their name.
--
-- Additive/reversible per CLAUDE.md. Drizzle schema lives in
-- lib/db/src/schema/msp.ts (hand-written; no drizzle-kit push).

BEGIN;

ALTER TABLE portal_ownership_assignments
  ADD COLUMN IF NOT EXISTS set_by_person_id text NOT NULL DEFAULT '';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-03-ownership-raci-decline-escalation-1519.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
