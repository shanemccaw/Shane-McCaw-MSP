-- Git #3769 — Communications push tracker, backend/data-model only
-- (Feature roadmap #3768).
--
-- Real project-management tracking tool, not a delivery/send system: Shane
-- initiates a "communications push" (e.g. an upcoming change/release),
-- assigns it to a customer, and this tracks a cascade of checkpoint
-- reminders (e.g. 60/45/30 days before the effective date) so he doesn't
-- forget to send each one. No recipient list, no email/Teams integration,
-- no send mechanism of any kind. customer_id is tenants.id with no FK,
-- matching the existing "successor id-space, no FK by design" convention
-- already used by msp_status_reports, kanban_buckets/kanban_cards and
-- break_glass_pending_secrets.
--
-- Reminder offsets are not hardcoded to exactly 3 (60/45/30 is a default
-- suggestion, editable per push) — each offset is its own row in
-- communications_push_checkpoints, carrying its own real resolved
-- checkpoint date and pending/done state.

BEGIN;

CREATE TABLE IF NOT EXISTS communications_pushes (
  id serial PRIMARY KEY,
  msp_id integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  customer_id integer NOT NULL,
  title text NOT NULL,
  description text,
  effective_date timestamptz NOT NULL,
  created_by_user_id integer NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS communications_pushes_msp_id_idx ON communications_pushes (msp_id);
CREATE INDEX IF NOT EXISTS communications_pushes_customer_id_idx ON communications_pushes (customer_id);

CREATE TABLE IF NOT EXISTS communications_push_checkpoints (
  id serial PRIMARY KEY,
  push_id integer NOT NULL REFERENCES communications_pushes(id) ON DELETE CASCADE,
  offset_days integer NOT NULL,
  checkpoint_date timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'done')),
  done_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS communications_push_checkpoints_push_id_idx ON communications_push_checkpoints (push_id);
CREATE INDEX IF NOT EXISTS communications_push_checkpoints_checkpoint_date_idx ON communications_push_checkpoints (checkpoint_date);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-12-communications-push-3769.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
