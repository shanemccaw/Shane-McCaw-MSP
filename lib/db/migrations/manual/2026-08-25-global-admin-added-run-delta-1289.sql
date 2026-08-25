-- #1289 — Detector: finding.global_admin_added
--
-- Chose option (a) from the issue (a run-to-run delta of
-- identity:global-admin-count), not (b) a new /auditLogs/directoryAudits
-- monitor check. Reason: tenant_monitor_profiles is already the production
-- monitoring record for identity:global-admin-count, populated on every
-- regular scoring scan (not the optional detail-collection package), so it
-- already historises the count per run -- no new schema, migration, Graph
-- endpoint or scope was needed. customer-tenant-alert-engine.ts's
-- evalGlobalAdminAdded() compares the latest tenant_monitor_profiles row's
-- extracted_properties->>'globalAdminCount' against the run before it for
-- that tenant; a tenant with no prior collection never fires, so an existing
-- admin baseline is never mistaken for a newly-added admin on the first scan.
--
-- No new monitor_checks row -- this reuses identity:global-admin-count as-is.
-- Just flips the customer_tenant_alert_rules "finding.global_admin_added"
-- catalog row (seeded pending_detector/disabled by #1278, lib/db/migrations/
-- manual/2026-08-25-customer-tenant-alert-rules-1278.sql) live/enabled,
-- mirroring finding.mfa_gap's shape (#1288).

BEGIN;

UPDATE customer_tenant_alert_rules
SET detector_status = 'live',
    enabled = true,
    description = 'A new Global Administrator appeared (run-to-run delta of identity:global-admin-count).',
    source = 'identity:global-admin-count run-to-run delta via tenant_monitor_profiles (#1289)',
    updated_at = now()
WHERE rule_key = 'finding.global_admin_added';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-25-global-admin-added-run-delta-1289.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
