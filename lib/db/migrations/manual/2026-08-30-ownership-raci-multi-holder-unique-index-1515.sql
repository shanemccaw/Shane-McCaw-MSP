-- Ownership / RACI — a cell holds MANY holders, not one (#1515)
--
-- portal_ownership_assignments carried a UNIQUE index on
-- (customer_id, object_id, role_key) — one holder per RACI cell per object. That
-- is wrong for all four letters, not three: R, C and I are routinely many, and A
-- is too. The textbook singular-Accountable rule does not survive practice (NASA
-- runs three A's on M365). So the constraint forbade exactly the shape the module
-- is built to hold.
--
-- Fix: drop the three-column unique key and replace it with a four-column one that
-- adds owner_person_id. This still forbids the SAME holder appearing twice in one
-- cell (a person does not hold one role on one object twice), but permits DISTINCT
-- holders to co-exist in a cell. Ordering of the A holders (primary / second /
-- third — informational only, #1517) is preserved by insertion order via the id
-- serial, which the read layer already orders by. The '' gap value is itself a
-- valid distinct holder under this key.
--
-- The assign route's ON CONFLICT target is updated in the same change to match this
-- four-column index (artifacts/api-server/src/routes/portal-ownership.ts), because
-- Postgres rejects an ON CONFLICT clause whose columns do not match a unique index.
--
-- Additive/reversible per CLAUDE.md: the table is empty (0 rows) so no holder is
-- lost and no duplicate blocks the new index. Drizzle schema lives in
-- lib/db/src/schema/msp.ts (hand-written; no drizzle-kit push).

BEGIN;

DROP INDEX IF EXISTS portal_ownership_assignments_customer_object_role_idx;

CREATE UNIQUE INDEX IF NOT EXISTS portal_ownership_assignments_customer_object_role_owner_idx
  ON portal_ownership_assignments (customer_id, object_id, role_key, owner_person_id);

-- Self-marking run record so Simulator Studio's Migrations tree (Git #497)
-- reflects DB reality regardless of which console ran this file.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-30-ownership-raci-multi-holder-unique-index-1515.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
