-- ============================================================================
-- #4026 — retainer_adjustment_notes: the MSP Console "adjust after close" trail
-- ============================================================================
-- Part of #2560 (Feature: My Architect, MSP Console).
--
-- #4020 gave the MSP Console a per-customer period-close lock
-- (retainer_period_closes, routes/msp-retainer.ts): once closed, the normal
-- log/adjust/delete endpoints answer 409. #4026 found AdminV2's three writers
-- (routes/admin-retainer.ts) didn't honor that lock at all. Shane's decision
-- (2026-09-14): AdminV2 now honors the lock with NO override — the only way to
-- change a closed period's hours is a new, deliberate MSP Console path that
-- requires a real reason on every call.
--
-- This table is that reason's persisted, customer-visible record: one row per
-- adjustment made to a closed period, so a customer looking at a figure that
-- changed after close sees WHY, not just a number that silently moved.
--
-- `customer_id` (tenants.id) and `period_key` (ISO "YYYY-MM-DD" anniversary
-- key) match retainer_work_log's own convention. `work_log_entry_id` carries
-- no FK on purpose — a "delete" adjustment's row outlives the entry it
-- describes.
--
-- Additive only: a new table and its indexes.

CREATE TABLE IF NOT EXISTS retainer_adjustment_notes (
  id                   serial PRIMARY KEY,
  customer_id          integer NOT NULL,
  msp_id               integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  period_key           text NOT NULL,
  work_log_entry_id    integer,
  action               text NOT NULL,
  reason               text NOT NULL,
  item                 text NOT NULL,
  before_minutes       integer,
  after_minutes        integer,
  created_by_user_id   integer,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS retainer_adjustment_notes_customer_period_idx
  ON retainer_adjustment_notes (customer_id, period_key);

CREATE INDEX IF NOT EXISTS retainer_adjustment_notes_msp_id_idx
  ON retainer_adjustment_notes (msp_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-14-retainer-adjustment-notes-4026.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
