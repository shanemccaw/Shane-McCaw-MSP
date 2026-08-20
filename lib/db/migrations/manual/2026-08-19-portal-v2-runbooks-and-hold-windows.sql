-- 2026-08-19-portal-v2-runbooks-and-hold-windows.sql
--
-- Customer Portal v2, Layer 2 page 2 (Active Runbooks) — the schema for the
-- Operate section's two greenfield systems, plus one column the Change Control
-- page needed and did not have.
--
-- WHY THIS IS NEW SCHEMA RATHER THAN NEW ROUTES OVER OLD TABLES
-- -------------------------------------------------------------
-- BUILD_PLAN §3.3 records hold windows as the ONE design system with zero
-- existing implementation — a repo-wide grep for "hold window" / HOLD_DEFS /
-- "hold_window" hits only the design files. Runbook progress turned out to be
-- equally unmodelled: the prototype holds step ticks and customer-added steps in
-- component state, so they die with the browser tab. That is precisely the
-- defect Git #730 fixed for the Remediation Tracker, and these tables are shaped
-- after that fix.
--
-- CONVENTIONS FOLLOWED, all matching remediation_tracker_steps:
--   • customer_id is a tenants.id (the JWT's customerId claim) carried WITHOUT a
--     foreign key, matching the deliberate choice msp_diagnostic_runs documents.
--   • Enum-ish columns are plain text with NO CHECK constraint, the same
--     convention remediation_tracker_steps.status and msp_change_requests.status
--     follow, so a vocabulary can be widened in code without another migration.
--   • Timestamps are timestamptz (UTC), per the schema file's header rule.
--
-- SAFE TO RE-RUN. Every statement is IF NOT EXISTS. Nothing here drops, renames
-- or rewrites an existing column, and the one ALTER is purely additive.

BEGIN;

-- ── msp_change_requests.linked_finding ───────────────────────────────────────
-- "Raised from" — the finding a change request came out of, e.g.
-- "Governance · External Sharing Drift". The customer portal's Change Control
-- page has a cell for this and the table had no column, so the cell could only
-- ever render blank. It is the only thing that makes the portal's central rule
-- ("every fix routes through a change request") traceable in the direction a
-- customer reads it: from the change back to the problem it was raised to solve.
--
-- Free text, not a foreign key, on purpose: a finding may be a monitor check, a
-- pillar drill-down area, or a hold window, and pinning it to any one of those
-- would make the other two unrepresentable. NULL means "raised directly", which
-- is a real state — the CR wizard raises exactly those.
ALTER TABLE public.msp_change_requests
  ADD COLUMN IF NOT EXISTS linked_finding text;

-- ── portal_runbooks ──────────────────────────────────────────────────────────
-- One row per runbook in progress for a customer.
CREATE TABLE IF NOT EXISTS public.portal_runbooks (
  id            serial PRIMARY KEY,
  customer_id   integer NOT NULL,
  runbook_key   text NOT NULL,
  title         text NOT NULL,
  context       text NOT NULL,
  pillar        text NOT NULL,
  -- A DATE, not a timestamp: the page renders "Day 7 of 14", a whole-day count.
  -- Storing a time would invite an off-by-one at the boundary depending on the
  -- reader's zone.
  started_on    date NOT NULL,
  cycle_days    integer NOT NULL,
  status        text NOT NULL DEFAULT 'active',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_runbooks_customer_id_idx
  ON public.portal_runbooks (customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS portal_runbooks_customer_key_idx
  ON public.portal_runbooks (customer_id, runbook_key);

-- ── portal_runbook_steps ─────────────────────────────────────────────────────
-- The tick boxes. `is_custom` separates a step that came with the runbook from
-- one the customer added themselves through the page's "Add a step or sub-step…"
-- field: a catalogue step is part of an agreed procedure, a custom one is the
-- customer's own note, and the design already renders them differently.
CREATE TABLE IF NOT EXISTS public.portal_runbook_steps (
  id                 serial PRIMARY KEY,
  runbook_id         integer NOT NULL REFERENCES public.portal_runbooks(id) ON DELETE CASCADE,
  position           integer NOT NULL,
  text               text NOT NULL,
  checked            boolean NOT NULL DEFAULT false,
  is_custom          boolean NOT NULL DEFAULT false,
  -- When `checked` last became true. NULL whenever it is false — un-ticking
  -- clears it rather than leaving a stale timestamp claiming a completion that
  -- was withdrawn (the rule portal-remediation-tracker.ts established).
  checked_at         timestamptz,
  checked_by_user_id integer,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_runbook_steps_runbook_id_idx
  ON public.portal_runbook_steps (runbook_id);
CREATE UNIQUE INDEX IF NOT EXISTS portal_runbook_steps_runbook_position_idx
  ON public.portal_runbook_steps (runbook_id, position);

-- ── portal_hold_windows ──────────────────────────────────────────────────────
-- A runbook step that gates the steps after it and waits on ELAPSED TIME rather
-- than on work — "enable CA01 in report-only, wait 7 days, then decide". The
-- tenant is scanned while the window runs, so a window can close early when the
-- evidence says waiting adds nothing.
--
-- scan_verdict is the interesting part and the thing the customer asked for:
--   clear   — nothing would break; offer to close early.
--   signals — enforcing today breaks something NAMED; do not release.
--   watch   — something worth a look before close.
CREATE TABLE IF NOT EXISTS public.portal_hold_windows (
  id                      serial PRIMARY KEY,
  customer_id             integer NOT NULL,
  runbook_id              integer REFERENCES public.portal_runbooks(id) ON DELETE CASCADE,
  hold_key                text NOT NULL,
  title                   text NOT NULL,
  gates                   text NOT NULL,
  -- The step this window actually gates, as a real reference into
  -- portal_runbook_steps.position rather than only the prose in `gates`. The
  -- prototype has only the sentence, so "which step is blocked" was not
  -- machine-readable and releasing a window could not unblock anything.
  gates_step_position     integer,
  pillar                  text NOT NULL,
  started_at              timestamptz NOT NULL,
  -- The originally agreed wait. Extensions do NOT mutate this.
  wait_days               integer NOT NULL,
  -- Days added by extensions, kept SEPARATE from wait_days so that "agreed at 7
  -- days, since extended twice" stays visible. The design is explicit about why:
  -- "Extending is recorded with a reason, so a window that keeps moving is
  -- visible rather than quietly permanent."
  extended_days           integer NOT NULL DEFAULT 0,
  scan_verdict            text NOT NULL DEFAULT 'watch',
  scan_line               text NOT NULL,
  -- The three parts of the design's provenance line, stored separately and
  -- composed for display ("{source}, scanned {cadence}, last {HH:MM}") rather
  -- than stored as finished prose, which would mean a timestamp that never
  -- updates itself.
  scan_source             text NOT NULL,
  scan_cadence            text NOT NULL DEFAULT 'hourly',
  scan_at                 timestamptz,
  why                     text NOT NULL,
  closed_at               timestamptz,
  closed_reason           text,
  -- The README's alerting contract: notify at T-24, at T-0, and again the moment
  -- a scan turns the verdict to `clear` before the window ends — the third being
  -- a FINDING ("you don't need to wait the remaining 9 days"), not a reminder.
  -- These stamps are what makes that contract implementable without re-firing.
  -- The transport itself is out of round one (BUILD_PLAN §7); these columns
  -- exist so wiring it later is not another schema change.
  notified_t24_at         timestamptz,
  notified_t0_at          timestamptz,
  notified_early_clear_at timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_hold_windows_customer_id_idx
  ON public.portal_hold_windows (customer_id);
CREATE INDEX IF NOT EXISTS portal_hold_windows_runbook_id_idx
  ON public.portal_hold_windows (runbook_id);
CREATE UNIQUE INDEX IF NOT EXISTS portal_hold_windows_customer_key_idx
  ON public.portal_hold_windows (customer_id, hold_key);

-- ── portal_hold_window_events ────────────────────────────────────────────────
-- Every decision taken on a hold window: the audit trail the design's copy
-- promises, and the join between a hold-window action and the change request it
-- raised. `change_request_id` is what makes "every early close routes through a
-- CR" checkable rather than merely asserted.
CREATE TABLE IF NOT EXISTS public.portal_hold_window_events (
  id                serial PRIMARY KEY,
  hold_window_id    integer NOT NULL REFERENCES public.portal_hold_windows(id) ON DELETE CASCADE,
  kind              text NOT NULL,
  days_delta        integer,
  reason            text,
  actor_user_id     integer,
  change_request_id integer,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_hold_window_events_hold_window_id_idx
  ON public.portal_hold_window_events (hold_window_id);

-- Self-marking run record, so Simulator Studio's Migrations tree reflects DB
-- reality regardless of which console ran this file.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-19-portal-v2-runbooks-and-hold-windows.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
