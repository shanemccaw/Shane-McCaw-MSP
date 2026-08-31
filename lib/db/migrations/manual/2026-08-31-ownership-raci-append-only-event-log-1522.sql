-- Ownership / RACI — append-only cell event log (#1522)
--
-- portal_ownership_assignments is CURRENT STATE: one row per
-- (customer_id, object_id, role_key, owner_person_id), overwritten in place by
-- ON CONFLICT on every re-assert (#1515/#1517). That answers "who holds this
-- cell today" but not "who held A when this RBD was signed" — the earlier
-- holder's provenance is gone the moment a later write overwrites the row.
--
-- Fix, per the settled architecture: portal_ownership_assignments STAYS as a
-- materialised current-state view (rewriting every route and the read payload
-- shape to replay a log on every request is a different, larger change with no
-- product need yet); this table is the append-only record underneath it. Every
-- assign / accept / clear / reassign is inserted here in the same transaction
-- as the current-state write, and a row is NEVER updated or deleted — so a
-- replay of this log as of any date can answer who held a cell then, which the
-- current-state table alone cannot (#1511 needs exactly this for risk
-- acceptance authority at signing time).
--
-- `declined` is part of the vocabulary (the architecture names five event
-- types) but has no writer yet — decline as a UX/state is #1519's scope, not
-- built here. Recording the enum value now means #1519 has a log to write into
-- rather than inventing its own.
--
-- Drizzle schema lives in lib/db/src/schema/msp.ts (hand-written; no
-- drizzle-kit push).

BEGIN;

CREATE TABLE IF NOT EXISTS portal_ownership_events (
  id               SERIAL PRIMARY KEY,
  customer_id      INTEGER NOT NULL,
  object_id        TEXT    NOT NULL,
  role_key         TEXT    NOT NULL,
  owner_person_id  TEXT    NOT NULL DEFAULT '',
  event_type       TEXT    NOT NULL,
  actor            TEXT    NOT NULL DEFAULT '',
  reason           TEXT    NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT portal_ownership_events_event_type_check
    CHECK (event_type IN ('assigned', 'accepted', 'declined', 'cleared', 'reassigned'))
);

CREATE INDEX IF NOT EXISTS portal_ownership_events_customer_id_idx
  ON portal_ownership_events (customer_id);

CREATE INDEX IF NOT EXISTS portal_ownership_events_cell_idx
  ON portal_ownership_events (customer_id, object_id, role_key, owner_person_id);

-- Self-marking run record so Simulator Studio's Migrations tree (Git #497)
-- reflects DB reality regardless of which console ran this file.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-31-ownership-raci-append-only-event-log-1522.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
