-- 2026-08-28-testbed-reset-patch-live-audit-1471.sql
--
-- Git #1471 — extend the testbed reset to a genuinely empty testbed, driven
-- by a live schema audit rather than another file-search pass. Live-queried
-- (SELECT table_name, column_name, data_type FROM information_schema.columns
-- WHERE table_schema = 'public' AND column_name IN ('customer_id',
-- 'tenant_id')) against the real database, then diffed the result against
-- every table #1329 + #1396 already cover. Found 14 genuinely tenant/
-- customer-scoped tables with zero coverage in either prior file:
--
--   customer_id (integer, tenants.id) shape:
--     msp_report_definitions    -- per-customer scheduled report definition;
--                                   customer_id is nullable (NULL means
--                                   "across all customers" per the column's
--                                   own comment) so this DELETE only ever
--                                   touches this tenant's own rows
--     scope_creep_assignments, scope_creep_compliance, scope_creep_detections,
--     scope_creep_escalations, scope_creep_scores, scope_creep_violations
--                                -- Scope Creep Engine. Raw-SQL tables with no
--                                   Drizzle schema entry — confirmed real and
--                                   customer_id-scoped via
--                                   artifacts/api-server/src/lib/scope-creep-engine.ts
--     sla_breaches, sla_compliance_records, sla_escalations, sla_timers
--                                -- SLA Engine, same raw-SQL shape, confirmed
--                                   via artifacts/api-server/src/lib/sla-engine.ts
--     war_room_interaction_events
--                                -- customer_id NOT NULL. No application code
--                                   references this table anywhere in the repo
--                                   today, but the column shape is genuinely
--                                   customer-scoped, so it's covered here —
--                                   a harmless always-zero-row DELETE until/
--                                   unless it's wired up
--
--   tenant_id (text, the real M365 tenant GUID) shape:
--     drift_collection_status   -- same keying as drift_events /
--                                   tenant_monitor_profiles, both already
--                                   covered by #1329
--
--   tenant_id (integer, tenants.id — note this is the SAME FK shape as
--   customer_id above, just named tenant_id on this one table) shape:
--     tenant_compliance_scope   -- per-tenant compliance-framework scope
--                                   decision (onboarding/manual/advisor),
--                                   FK ON DELETE CASCADE to tenants.id —
--                                   confirmed tenant-instance data, not the
--                                   shared framework/obligation catalog
--
-- DELIBERATELY NOT WIPED — same guardrail #1396 applied to client_services:
--   tenant_add_on_entitlements  -- real PURCHASED/ACTIVE add-on entitlement
--     state (status active/canceled, purchased_at), not test scaffolding.
--     Wiping it could silently remove a paid feature entitlement the test
--     account needs in order to test that very feature. Flagged for Shane's
--     explicit decision, not wiped by default.
--
-- GUARDED, NOT ASSUMED PRESENT: drift_collection_status and
-- tenant_compliance_scope exist on local dev (where this audit ran) but a
-- live check against the Replit staging DB found neither table created
-- there yet -- staging's schema genuinely lags local dev for these two newer
-- features. An unconditional DELETE against a missing relation would abort
-- the whole transaction (including every valid delete above it), so both are
-- wrapped in `to_regclass(...) IS NOT NULL` guards below -- a no-op wherever
-- the table doesn't exist yet, and the real delete once it does.
--
-- KEPT untouched, re-confirmed accurate by this session's live audit:
-- tenants, azure_tenant_credentials, client_app_registrations,
-- consent_invite_tokens (identity/consent — #1329's original list).
-- msp_sharepoint_connectors / msp_mailbox_connectors are STILL correctly
-- excluded: re-read live via \d — both are keyed by msp_id NOT NULL (Shane's
-- own MSP infra), and their tenant_id column is the CONNECTOR'S OWN target
-- M365 tenant for auth, not the testbed customer being reset. users is
-- identity (tenant_id integer, confirmed live) — deleting rows there would
-- break the test account's own login, so it stays untouched like #1329's
-- other identity tables.

BEGIN;

DO $$
DECLARE
  v_tenant_id INT;
  v_tenant_guid TEXT := 'c4c814d4-3afe-441e-9145-62461d0a4fd3';
BEGIN
  SELECT id INTO v_tenant_id FROM tenants WHERE tenant_id = v_tenant_guid;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Testbed tenant (mccawsoft2.onmicrosoft.com) not found -- aborting, nothing changed.';
  END IF;

  -- ── customer_id (integer) scoped tables, newly found ───────────────────
  DELETE FROM msp_report_definitions WHERE customer_id = v_tenant_id;
  DELETE FROM scope_creep_assignments WHERE customer_id = v_tenant_id;
  DELETE FROM scope_creep_compliance WHERE customer_id = v_tenant_id;
  DELETE FROM scope_creep_detections WHERE customer_id = v_tenant_id;
  DELETE FROM scope_creep_escalations WHERE customer_id = v_tenant_id;
  DELETE FROM scope_creep_scores WHERE customer_id = v_tenant_id;
  DELETE FROM scope_creep_violations WHERE customer_id = v_tenant_id;
  DELETE FROM sla_breaches WHERE customer_id = v_tenant_id;
  DELETE FROM sla_compliance_records WHERE customer_id = v_tenant_id;
  DELETE FROM sla_escalations WHERE customer_id = v_tenant_id;
  DELETE FROM sla_timers WHERE customer_id = v_tenant_id;
  DELETE FROM war_room_interaction_events WHERE customer_id = v_tenant_id;

  -- ── tenant_id (text, real M365 tenant GUID) scoped tables, newly found ──
  -- Guarded: not yet created on every environment (see header note).
  IF to_regclass('public.drift_collection_status') IS NOT NULL THEN
    DELETE FROM drift_collection_status WHERE tenant_id = v_tenant_guid;
  END IF;

  -- ── tenant_id (integer, tenants.id) scoped tables, newly found ─────────
  -- Guarded: not yet created on every environment (see header note).
  IF to_regclass('public.tenant_compliance_scope') IS NOT NULL THEN
    DELETE FROM tenant_compliance_scope WHERE tenant_id = v_tenant_id;
  END IF;

  RAISE NOTICE 'Live-audit reset patch complete for tenant id=%, guid=%', v_tenant_id, v_tenant_guid;
END $$;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-28-testbed-reset-patch-live-audit-1471.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
