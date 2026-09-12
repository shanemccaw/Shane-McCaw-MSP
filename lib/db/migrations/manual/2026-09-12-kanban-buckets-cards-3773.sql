-- Git #3773 — Simple Kanban board, Phase 1 only (Feature roadmap #3768).
--
-- Real data model for plain buckets (columns) + plain cards (tasks).
-- Deliberately narrow: no `type` column on kanban_cards, no per-type shape,
-- no FK to #3433/#3769/#3770/#3771 — those stay independent standalone
-- entities until Phase 2 wires them in as card types. customer_id is
-- tenants.id with no FK, matching the existing "successor id-space, no FK
-- by design" convention already used by msp_status_reports.customer_id and
-- break_glass_pending_secrets.

BEGIN;

CREATE TABLE IF NOT EXISTS kanban_buckets (
  id serial PRIMARY KEY,
  msp_id integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  customer_id integer NOT NULL,
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kanban_buckets_msp_id_idx ON kanban_buckets (msp_id);
CREATE INDEX IF NOT EXISTS kanban_buckets_customer_id_idx ON kanban_buckets (customer_id);

CREATE TABLE IF NOT EXISTS kanban_cards (
  id serial PRIMARY KEY,
  bucket_id integer NOT NULL REFERENCES kanban_buckets(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kanban_cards_bucket_id_idx ON kanban_cards (bucket_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-12-kanban-buckets-cards-3773.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
