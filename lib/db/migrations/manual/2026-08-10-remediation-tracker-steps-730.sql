-- Remediation Tracker — persistent per-step state (Git #730, Phase A of epic #647).
--
-- Adds remediation_tracker_steps, the real backend behind the Full Remediation
-- Guide's tick boxes. Before this the ticks were React state in
-- RemediationGuideBody.tsx and died with the tab.
--
-- One row per (customer, step). Step ids are the guide's own "s1".."s30" from
-- previewRemediationGuide.ts / remediationLiveGuide.ts. A step with NO row is
-- 'not_started' — nothing pre-seeds thirty rows per customer, and the API
-- resolves the absence.
--
-- customer_id is tenants.id (the JWT customerId claim), the same id space
-- msp_diagnostic_runs.customer_id uses. No FK, matching that table's own
-- deliberate choice.
--
-- status is a plain TEXT column with no CHECK, the same convention
-- content_posts.status follows: Phase B (#731) widens the vocabulary with the
-- design's real action set (self-resolve, defer, Shane-handles,
-- already-handled, not-applicable) and should not need a second migration to
-- do it.
--
-- Run via Shane's SQL console; do NOT run drizzle-kit push against this.

BEGIN;

CREATE TABLE IF NOT EXISTS remediation_tracker_steps (
  id                   SERIAL PRIMARY KEY,
  customer_id          INTEGER NOT NULL,                            -- tenants.id
  step_id              TEXT NOT NULL,                               -- "s1" .. "s30"
  status               TEXT NOT NULL DEFAULT 'not_started',         -- not_started | completed (Phase B widens)
  completed_at         TIMESTAMPTZ,                                 -- set when status becomes 'completed', cleared otherwise
  updated_by_user_id   INTEGER,                                     -- users.id of whoever last changed it
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The tracker's only real read ("this customer's whole tracker") and its only
-- real write (upsert one step) both go through this pair, and the uniqueness is
-- what makes the write an idempotent ON CONFLICT upsert.
CREATE UNIQUE INDEX IF NOT EXISTS remediation_tracker_steps_customer_step_idx
  ON remediation_tracker_steps (customer_id, step_id);

-- ── self-marking record ───────────────────────────────────────────────────────

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-10-remediation-tracker-steps-730.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
