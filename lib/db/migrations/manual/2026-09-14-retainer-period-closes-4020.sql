-- ============================================================================
-- #4020 — retainer_period_closes: the MSP Console operator's period-close record
-- ============================================================================
-- Part of #2560 (Feature: My Architect, MSP Console).
--
-- Confirmed live before this file was written: the retainer ledger itself
-- already exists (`retainer_settings`, `retainer_work_log`, Git #1293), and it
-- backs logging and adjusting hours as-is. Nothing anywhere recorded that a
-- billing period had been CLOSED — no table, no column, no code. This table is
-- that record: one row per (customer, anniversary period), carrying a frozen
-- snapshot of the bucket `computeMonthBucket` (artifacts/api-server/src/lib/
-- retainer-hours.ts) produced at the moment of close, so the closed figures
-- stay readable even if the allotment is later changed in AdminV2.
--
-- While a row exists, routes/msp-retainer.ts refuses to log, adjust or delete
-- ledger entries in that period (409). Reopening deletes the row.
--
-- `customer_id` is a tenants.id with no FK, and `period_key` is the ISO
-- "YYYY-MM-DD" anniversary period key (Git #3473) — both matching
-- retainer_work_log's own convention exactly.
--
-- Additive only: a new table and its indexes.

CREATE TABLE IF NOT EXISTS retainer_period_closes (
  id                 serial PRIMARY KEY,
  customer_id        integer NOT NULL,
  msp_id             integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  period_key         text NOT NULL,
  anchor_day         integer NOT NULL,
  retained_minutes   integer NOT NULL,
  rolled_minutes     integer NOT NULL,
  used_minutes       integer NOT NULL,
  remaining_minutes  integer NOT NULL,
  over_minutes       integer NOT NULL,
  hourly_rate_cents  integer NOT NULL,
  entry_count        integer NOT NULL,
  note               text,
  closed_by_user_id  integer,
  closed_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS retainer_period_closes_customer_period_uidx
  ON retainer_period_closes (customer_id, period_key);

CREATE INDEX IF NOT EXISTS retainer_period_closes_msp_id_idx
  ON retainer_period_closes (msp_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-14-retainer-period-closes-4020.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
