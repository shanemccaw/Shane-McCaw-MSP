-- Delete the 103 unattributable tenant_signal_history rows (#3077).
-- Manual migration - review and run by hand (do not run drizzle-kit push/push --force).
--
-- #2983 fixed tenant_signal_history.customer_id going forward: it is now a real
-- tenants.id with a real FK to tenants(id) ON DELETE CASCADE. Before that fix,
-- customer_id was a users.id with `... ON DELETE SET NULL`, so deleting a portal
-- login NULLed the only column attributing a signal row to anybody, without
-- deleting the row itself. 103 rows are the accumulated result of that bug, and
-- #2983's backfill deliberately left them NULL rather than guessing an owner.
--
-- #3077 investigated whether these 103 rows can be attributed after the fact:
--   * msp_id = 1 on all 103, but msp 1 owns TWO tenants (id 1 and id 3), both of
--     which already have their own correctly-attributed rows in this same table
--     (6,396 rows for tenant 1, 92 for tenant 3) - msp_id alone can't disambiguate.
--   * The only surviving identifying column, client_user_id, is also NULL on all
--     103 (users.id ON DELETE SET NULL fired on the same deleted login) - the row
--     that would resolve to a tenant via users.tenant_id is gone.
--   * No msp_diagnostic_runs row and no tenant_engine_snapshots row exists for
--     msp_id = 1 anywhere near these rows' fired_at window (2026-08-04 to
--     2026-08-07 local time) to correlate against - confirmed against the live
--     local DB at authoring time, zero rows either query.
--   * No other table holds a foreign key into tenant_signal_history.id - deleting
--     these rows orphans nothing else.
--
-- Real customer/tenant impact of leaving them: invisible to
-- GET /api/portal/data-export (a silently incomplete privacy export), invisible
-- to the 7-year post-termination purge (retention/purgers/modules.ts keys on
-- customer_id/client_user_id, both NULL here - permanent survivors of any purge),
-- and skipped by policy-engine.ts's evaluateAllPolicies (`WHERE customer_id IS
-- NOT NULL`) - two of these 103 rows have resolved_at IS NULL and are therefore
-- permanently-open signals nothing will ever close.
--
-- Decision (per #3077's own body and Shane's dispatch comment on the issue,
-- explicit real-time authorization for this specific one-time cleanup): these
-- rows are genuinely unattributable to any tenant or customer by any evidence
-- available in this database, and carry no purpose un-attributable to anyone.
-- Delete them. This is irreversible; the counts below are the record of what
-- was removed.
--
-- Local state at authoring time: 6,591 total rows in tenant_signal_history;
-- 103 with customer_id IS NULL AND client_user_id IS NULL (the orphaned set);
-- 6,488 correctly attributed and untouched by this migration.

BEGIN;

-- Row count immediately before deletion, for the record (also captured by the
-- session running this migration via a separate SELECT before/after).
DO $$
DECLARE
  orphaned_count integer;
BEGIN
  SELECT count(*) INTO orphaned_count
  FROM tenant_signal_history
  WHERE customer_id IS NULL AND client_user_id IS NULL;

  RAISE NOTICE 'tenant_signal_history orphaned rows before delete: %', orphaned_count;
END $$;

DELETE FROM tenant_signal_history
WHERE customer_id IS NULL
  AND client_user_id IS NULL;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-07-delete-orphaned-tenant-signal-history-3077.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
