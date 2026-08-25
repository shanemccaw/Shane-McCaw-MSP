-- #1291 — Detector: billing.license_change
--
-- Builds the licence-assignment snapshot table + wires the diff detector
-- customer-tenant-alert-engine.ts's evalLicenseChange() reads. Mirrors
-- overshared_items's (#1275) run-to-run diff shape: one row per (user x
-- SKU), a run_id partition key (snapshots retained, never pruned), and a
-- natural_key (tenant+user+sku) independent of run_id so a rescan's same
-- assignment is the same row identity, not a remove+add.
--
-- Source: license:unused-assigned's full item list (already linked to the
-- detail:full-item-collection package, includeItems:true) --
-- item-detail-collector.ts now also normalizes that same collection into
-- this table via license-assignment-snapshots.ts, the same "best effort,
-- never blocks the tenant_check_item_details row" pattern #1275 established
-- for overshared_items. No new monitor_checks row or Graph scope needed --
-- license:unused-assigned already selects assignedLicenses.
--
-- Then flips the customer_tenant_alert_rules "billing.license_change"
-- catalog row (seeded pending_detector/disabled by #1278, lib/db/migrations/
-- manual/2026-08-25-customer-tenant-alert-rules-1278.sql) live/enabled,
-- mirroring finding.mfa_gap (#1288) / finding.global_admin_added (#1289)'s shape.

BEGIN;

CREATE TABLE IF NOT EXISTS license_assignment_snapshots (
  id               SERIAL PRIMARY KEY,
  snapshot_id      UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id        TEXT NOT NULL,
  customer_id      INTEGER,
  run_id           UUID NOT NULL,
  check_key        TEXT NOT NULL,
  user_id          TEXT NOT NULL,
  account_enabled  BOOLEAN,
  sku_id           TEXT NOT NULL,
  natural_key      TEXT NOT NULL,
  collected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT license_assignment_snapshots_run_natural_key_uidx UNIQUE (run_id, natural_key)
);

CREATE INDEX IF NOT EXISTS license_assignment_snapshots_tenant_collected_idx
  ON license_assignment_snapshots (tenant_id, collected_at);
CREATE INDEX IF NOT EXISTS license_assignment_snapshots_customer_run_idx
  ON license_assignment_snapshots (customer_id, run_id);
CREATE INDEX IF NOT EXISTS license_assignment_snapshots_natural_key_idx
  ON license_assignment_snapshots (natural_key);

UPDATE customer_tenant_alert_rules
SET detector_status = 'live',
    enabled = true,
    description = 'A licence assignment changed (added or removed), from a run-to-run diff of license_assignment_snapshots.',
    source = 'license_assignment_snapshots run-to-run diff, sourced from license:unused-assigned (#1291)',
    updated_at = now()
WHERE rule_key = 'billing.license_change';

-- ── Self-mark for Simulator Studio's Migrations tree (#497) ──────────────────
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-25-license-change-snapshot-diff-1291.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
