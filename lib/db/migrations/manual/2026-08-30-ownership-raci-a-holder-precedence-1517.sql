-- Ownership / RACI — explicit precedence for multi-holder cells (#1517)
--
-- #1515 made a RACI cell hold MANY holders (unique key now carries
-- owner_person_id), and its migration noted that ordering was "preserved by
-- insertion order via the id serial, which the read layer already orders by."
-- That gives an initial order for free, but it cannot be CHANGED without
-- deleting and reinserting a row — which would lose that row's acceptance and
-- setBy/setAt/setWhy provenance. #1517 settles that the A cell (and, by the
-- same shape, any cell) is an ORDERED list — primary, second, third — with
-- every holder carrying identical authority; the order is informational only,
-- no succession/activation/timeout logic reads it.
--
-- Fix: add an explicit order_rank column. New rows get the next rank for their
-- (customer, object, role) cell; existing rows are backfilled in their current
-- insertion order so today's implicit order becomes explicit rather than
-- resetting to all-zero. A reorder endpoint (POST /portal/ownership/reorder)
-- can then rewrite ranks for a cell without touching any other column.
--
-- Additive/reversible per CLAUDE.md. Drizzle schema lives in
-- lib/db/src/schema/msp.ts (hand-written; no drizzle-kit push).

BEGIN;

ALTER TABLE portal_ownership_assignments
  ADD COLUMN IF NOT EXISTS order_rank integer NOT NULL DEFAULT 0;

-- Backfill: turn today's implicit insertion order (id asc) into an explicit
-- 0-based rank per (customer_id, object_id, role_key) cell. A no-op on this
-- database today (the table is empty), but correct if ever run against a
-- database that already holds rows.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY customer_id, object_id, role_key
      ORDER BY id ASC
    ) - 1 AS rank
  FROM portal_ownership_assignments
)
UPDATE portal_ownership_assignments a
SET order_rank = ranked.rank
FROM ranked
WHERE a.id = ranked.id;

-- Self-marking run record so Simulator Studio's Migrations tree (Git #497)
-- reflects DB reality regardless of which console ran this file.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-30-ownership-raci-a-holder-precedence-1517.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
