-- Ownership / RACI — reports-to chain for decline escalation (#2527)
--
-- #1519 shipped the assigner-notification half of "escalates internally, to
-- the assigner or up their chain" and correctly stopped there: there was no
-- manager/reports-to relationship anywhere in this schema, and inventing one
-- (job-title guessing, a fabricated org chart) would be exactly the kind of
-- invented vocabulary CLAUDE.md's "never invent data" rule forbids.
--
-- This is that real column: a nullable, self-referencing pointer on `users`.
-- It starts empty for every row — nothing backfills it. It is populated only
-- by a real person (a `canManageTeam` teammate, or MSP staff/PlatformAdmin)
-- calling PATCH /portal/team/:userId/manager. There is deliberately no
-- Microsoft-Graph-sourced auto-sync here; wiring that is a separate,
-- larger integration decision (a new Graph `manager` read scope + consent)
-- and out of this issue's scope.
--
-- Additive/reversible per CLAUDE.md. Drizzle schema lives in
-- lib/db/src/schema/index.ts (hand-written; no drizzle-kit push).

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS manager_user_id integer REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS users_manager_user_id_idx ON users(manager_user_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-users-manager-reports-to-2527.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
