-- #1290 — Detector: drift.regression — drift resolved→reopened lifecycle
--
-- Sub-issue of #1278, follow-up to #1270 (drift engine) and #1283 (collector
-- wiring). drift_events (#1270) was append-only: no resolved_at/status/reopen
-- column, and its idempotency key (tenant|domain|baseline|op|setting) blocks a
-- second event for the same reverted-then-redrifted setting against the same
-- baseline — so "a previously-resolved finding reappeared" was not representable.
--
-- This adds the lifecycle on drift_events and points the catalog's
-- `drift.regression` detector at reopened events:
--   * status       — 'open' | 'resolved' | 'reopened' (DEFAULT 'open').
--                    Every existing append-only row is 'open', which is exactly
--                    its real state (drifted, never resolved), so the backfill is
--                    just the column default.
--   * resolved_at  — set when drift-collector.ts observes the setting back at
--                    baseline; NULL while open/reopened.
--   * reopened_at  — set when a previously-resolved setting drifts from baseline
--                    again; this is what the drift.regression evaluator filters
--                    on (customer-tenant-alert-engine.ts).
--   * reopen_count — how many times the event has been reopened after resolution.
--
-- The collector's resolve/reopen detection lives in
-- artifacts/api-server/src/lib/drift-collector.ts (planDriftLifecycle +
-- collectDrift). No new table.

BEGIN;

-- ── drift_events lifecycle columns (additive, idempotent) ────────────────────
ALTER TABLE drift_events ADD COLUMN IF NOT EXISTS status       TEXT NOT NULL DEFAULT 'open';
ALTER TABLE drift_events ADD COLUMN IF NOT EXISTS resolved_at  TIMESTAMPTZ;
ALTER TABLE drift_events ADD COLUMN IF NOT EXISTS reopened_at  TIMESTAMPTZ;
ALTER TABLE drift_events ADD COLUMN IF NOT EXISTS reopen_count INTEGER NOT NULL DEFAULT 0;

-- Index backing the drift.regression evaluator: reopened events per tenant by time.
CREATE INDEX IF NOT EXISTS drift_events_tenant_status_reopened_idx
  ON drift_events (tenant_id, status, reopened_at);

-- ── flip the #1278 catalog row live ──────────────────────────────────────────
-- Seeded pending_detector/disabled by #1278
-- (lib/db/migrations/manual/2026-08-25-customer-tenant-alert-rules-1278.sql),
-- mirroring the finding.global_admin_added (#1289) / billing.license_change
-- (#1291) flips.
UPDATE customer_tenant_alert_rules
SET detector_status = 'live',
    enabled = true,
    description = 'A previously-resolved configuration finding reappeared (a drift_events row reopened after returning to baseline).',
    source = 'drift_events resolved→reopened lifecycle via drift-collector.ts (#1290)',
    updated_at = now()
WHERE rule_key = 'drift.regression';

-- ── self-mark for Simulator Studio migration tracking (#497) ─────────────────
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-25-drift-resolved-reopened-lifecycle-1290.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

-- ── VERIFY ───────────────────────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'drift_events'
--     AND column_name IN ('status','resolved_at','reopened_at','reopen_count');
-- SELECT rule_key, detector_status, enabled FROM customer_tenant_alert_rules
--   WHERE rule_key = 'drift.regression';
