-- 2026-08-24-monitoring-subscription-fulfillment-type-1164.sql
--
-- Git #1164 — Enhanced Monitoring: purchase provisions no client_services row.
--
-- WHAT THIS FIXES ------------------------------------------------------------
-- All 12 monitoring_tier `services` rows (Foundation/Growth/Premier x
-- Micro/SMB/Mid-Market/Enterprise) carry fulfillment_type_key=
-- 'monitoring_subscription'. Live-confirmed against this database: no
-- `fulfillment_types` row exists for that key at all (only 'config_pack' and
-- 'project_sow' do). resolve-fulfillment.ts's resolveFulfillment() looks up
-- fulfillment_types by key FIRST, before anything else — with no row present
-- it returns status:"unknown_type" and returns immediately (confirmed by
-- reading the function; it does not throw), so a real monitoring purchase's
-- call to resolveFulfillment() is a silent no-op: no event emitted, and none
-- of the code added by #1164 (which provisions the `client_services` row
-- inside resolveFulfillment, gated on fulfillmentTypeKey==='monitoring_subscription')
-- ever runs. This is the same missing-registry-row class of gap #585 already
-- fixed for 'project_sow' — same guarded pattern reused here.
--
-- Additive only, ON CONFLICT-guarded. Safe to run repeatedly.

BEGIN;

INSERT INTO fulfillment_types (key, label, description, fired_when, recurring, is_active)
SELECT 'monitoring_subscription',
       'Enhanced Monitoring Subscription',
       'Fires when a customer purchases a monitoring_tier service (Foundation/Growth/Premier). resolveFulfillment() provisions the active client_services row every downstream reader (msp-diagnostics.ts, support-chat.ts, etc.) keys on — see Git #1164.',
       jsonb_build_array('purchase'),
       true,
       true
WHERE NOT EXISTS (SELECT 1 FROM fulfillment_types WHERE key = 'monitoring_subscription');

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-24-monitoring-subscription-fulfillment-type-1164.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
