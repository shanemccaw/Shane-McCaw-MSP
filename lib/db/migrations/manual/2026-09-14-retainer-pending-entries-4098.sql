-- ============================================================================
-- #4098 — retainer_pending_entries: approval queue for the tracker byproduct
-- hook writing into a CLOSED period (follow-up to #4026)
-- ============================================================================
-- Part of #2560 (Feature: My Architect, MSP Console).
--
-- #4026 gave every ROUTE writer into retainer_work_log the same period-close
-- lock (lib/retainer-ledger-lock.ts) — AdminV2 and MSP Console both answer 409
-- once a period is closed. logRetainerWorkFromTracker
-- (artifacts/api-server/src/lib/retainer-work-logger.ts) is not a route — it's
-- the automatic byproduct hook fired when Shane closes/resolves a tracked
-- change request or remediation step — and it was never wired into that lock
-- at all: it inserted straight into retainer_work_log regardless of whether
-- the target period was closed.
--
-- Shane's decision (2026-09-14): the hook doesn't silently write past the
-- lock, and it doesn't silently skip either — a closed-period byproduct is
-- queued here for a human (MSP Console operator/admin) to approve or reject,
-- with a required reason captured at review time. Approval inserts the real
-- row into retainer_work_log; rejection never touches the ledger.
--
-- `customer_id`/`period_key`/`msp_id` match retainer_work_log's own
-- convention. The (source, source_ref_id) unique index mirrors
-- retainer_work_log's own idempotency guard — a re-close of the same tracked
-- item never double-queues.
--
-- Additive only: a new table and its indexes.

CREATE TABLE IF NOT EXISTS retainer_pending_entries (
  id                    serial PRIMARY KEY,
  customer_id           integer NOT NULL,
  msp_id                integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  period_key            text NOT NULL,
  week_label            text,
  item                  text NOT NULL,
  minutes               integer NOT NULL DEFAULT 0,
  pillar                text,
  finding               text,
  outcome               text,
  source                text NOT NULL,
  source_ref_id         integer,
  logged_by_user_id     integer,
  occurred_at           timestamptz NOT NULL,
  status                text NOT NULL DEFAULT 'pending',
  reviewed_by_user_id   integer,
  reviewed_at           timestamptz,
  review_reason         text,
  work_log_entry_id     integer,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS retainer_pending_entries_customer_period_idx
  ON retainer_pending_entries (customer_id, period_key);

CREATE INDEX IF NOT EXISTS retainer_pending_entries_msp_id_idx
  ON retainer_pending_entries (msp_id);

CREATE INDEX IF NOT EXISTS retainer_pending_entries_status_idx
  ON retainer_pending_entries (status);

CREATE UNIQUE INDEX IF NOT EXISTS retainer_pending_entries_source_ref_uidx
  ON retainer_pending_entries (source, source_ref_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-14-retainer-pending-entries-4098.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
