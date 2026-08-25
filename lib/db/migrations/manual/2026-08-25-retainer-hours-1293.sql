-- 2026-08-25-retainer-hours-1293.sql
--
-- Git #1293 — AdminV2 Retainer Hours module. The real ledger behind the
-- customer-facing "My Architect" retainer page (#1285), which until now shipped
-- as a fixture only.
--
-- Two greenfield tables:
--   retainer_settings   — one row per customer: monthly retained-hour allotment
--                         (minutes) + rate (cents) + named architect.
--   retainer_work_log   — the RET_WORK ledger. Every hour logged against a
--                         retainer, from either the tracker-byproduct path
--                         (source change_control / remediation_tracker, keyed to
--                         the closed item's id) or the ad-hoc unscoped path.
--
-- Scoping matches every other customer-scoped table: customer_id is a
-- tenants.id carried WITHOUT a foreign key; msp_id references msps for MSP-scoped
-- reads. Enum-ish columns are plain text with no CHECK, per the repo convention.
-- Hours are integer MINUTES (30 = 0.5h) — exact arithmetic, no numeric coercion.
--
-- Hand-written to be run by Shane (schema changes are never self-executed).
-- Idempotent: safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS retainer_settings (
  id                          SERIAL PRIMARY KEY,
  customer_id                 INTEGER NOT NULL,
  msp_id                      INTEGER NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  retained_minutes_per_month  INTEGER NOT NULL DEFAULT 480,
  hourly_rate_cents           INTEGER NOT NULL DEFAULT 30000,
  architect_name              TEXT,
  active                      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS retainer_settings_customer_uidx
  ON retainer_settings (customer_id);
CREATE INDEX IF NOT EXISTS retainer_settings_msp_id_idx
  ON retainer_settings (msp_id);

CREATE TABLE IF NOT EXISTS retainer_work_log (
  id                SERIAL PRIMARY KEY,
  customer_id       INTEGER NOT NULL,
  msp_id            INTEGER NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  period_month      TEXT NOT NULL,
  week_label        TEXT,
  item              TEXT NOT NULL,
  minutes           INTEGER NOT NULL DEFAULT 0,
  pillar            TEXT,
  finding           TEXT,
  outcome           TEXT,
  state             TEXT NOT NULL DEFAULT 'in_progress',
  source            TEXT NOT NULL,
  source_ref_id     INTEGER,
  logged_by_user_id INTEGER,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS retainer_work_log_customer_period_idx
  ON retainer_work_log (customer_id, period_month);
CREATE INDEX IF NOT EXISTS retainer_work_log_msp_id_idx
  ON retainer_work_log (msp_id);
-- Idempotency for the byproduct hooks: one row per closed tracked item. NULL
-- source_ref_id (unscoped) rows are distinct under a Postgres unique index, so
-- any number of ad-hoc entries coexist.
CREATE UNIQUE INDEX IF NOT EXISTS retainer_work_log_source_ref_uidx
  ON retainer_work_log (source, source_ref_id);

-- Self-marking run record so Simulator Studio's Migrations tree reflects reality
-- regardless of which console ran this file.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-25-retainer-hours-1293.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
