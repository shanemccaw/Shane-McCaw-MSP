-- Portal v2 — Ownership matrix WRITE persistence
--
-- GET /api/portal/ownership already reads real rows + real people, but every
-- mutation the matrix offers (assign a name to a cell, mark it accepted, hand a
-- person's work over, add a row) lived only in React state and was lost on
-- reload — there was nowhere to write it. These three per-customer tables are
-- that write side: an OVERLAY on top of the objects the read assembles, keyed by
-- the same opaque wire identifiers the page already uses.
--
-- All three key on customer_id (= tenants.id, the JWT's customerId) with NO
-- foreign keys, matching every other portal_* table: the object ids ("svc-12",
-- "CR-2026-0148", a Graph message id, a hold key, a hand-added "own-…") and
-- person ids ("u39") are UI identifiers assembled by the read layer, not rows in
-- a table this could reference.
--
-- Drizzle schema lives in lib/db/src/schema/msp.ts. Per CLAUDE.md this is
-- hand-written (no drizzle-kit push).

BEGIN;

-- One assigned (or explicitly cleared) matrix cell. owner_person_id of '' is a
-- REAL value meaning "cleared to a gap", the same way the client's ownerOf
-- treats an override of ''.
CREATE TABLE IF NOT EXISTS portal_ownership_assignments (
  id               SERIAL PRIMARY KEY,
  customer_id      INTEGER NOT NULL,
  object_id        TEXT    NOT NULL,
  role_key         TEXT    NOT NULL,
  owner_person_id  TEXT    NOT NULL DEFAULT '',
  acceptance       TEXT    NOT NULL DEFAULT '',
  set_by           TEXT    NOT NULL DEFAULT '',
  set_at           TEXT    NOT NULL DEFAULT '',
  set_why          TEXT    NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS portal_ownership_assignments_customer_id_idx
  ON portal_ownership_assignments (customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS portal_ownership_assignments_customer_object_role_idx
  ON portal_ownership_assignments (customer_id, object_id, role_key);

-- A dated handover of one person's work to another. It annotates, it does not
-- reassign — ending a handover flips done rather than deleting the row.
CREATE TABLE IF NOT EXISTS portal_ownership_delegations (
  id              SERIAL PRIMARY KEY,
  customer_id     INTEGER NOT NULL,
  from_person_id  TEXT    NOT NULL,
  to_person_id    TEXT    NOT NULL,
  until           TEXT    NOT NULL,
  scope           TEXT    NOT NULL DEFAULT 'all',
  done            BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS portal_ownership_delegations_customer_id_idx
  ON portal_ownership_delegations (customer_id);

-- A row the customer added by hand. source is 'custom' (add-a-row) or 'coverage'
-- (give-it-a-row). Either way it arrives with four gaps.
CREATE TABLE IF NOT EXISTS portal_ownership_rows (
  id           SERIAL PRIMARY KEY,
  customer_id  INTEGER NOT NULL,
  row_id       TEXT    NOT NULL,
  source       TEXT    NOT NULL,
  obj_type     TEXT,
  name         TEXT,
  sub          TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS portal_ownership_rows_customer_id_idx
  ON portal_ownership_rows (customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS portal_ownership_rows_customer_row_idx
  ON portal_ownership_rows (customer_id, row_id);

-- Self-marking run record so Simulator Studio's Migrations tree (Git #497)
-- reflects DB reality regardless of which console ran this file.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-21-portal-v2-ownership-write-persistence.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
