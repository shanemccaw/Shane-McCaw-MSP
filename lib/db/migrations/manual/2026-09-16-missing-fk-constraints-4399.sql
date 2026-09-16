-- Git #4399: 7 missing FK constraints that are column-shaped like real foreign keys but
-- have no enforced FOREIGN KEY in the live schema — confirmed live via pg_constraint,
-- 2026-09-16:
--   msp_refresh_tokens.user_id       -> users(id)
--   sla_breaches.msp_id              -> msps(id)
--   sla_breaches.customer_id         -> tenants(id)
--   sla_compliance_records.msp_id    -> msps(id)
--   sla_compliance_records.customer_id -> tenants(id)
--   sla_timers.msp_id                -> msps(id)
--   sla_timers.customer_id           -> tenants(id)
--
-- Same shape as #4372/#3971: ADD CONSTRAINT ... NOT VALID -> verify no orphans ->
-- VALIDATE CONSTRAINT. Idempotent: safe to re-run (DROP IF EXISTS first).
--
-- ON DELETE CASCADE on msp_refresh_tokens.user_id matches user_sessions.user_id's
-- existing real delete rule for the same "revoke this user's auth material when the
-- user is deleted" relationship (see lib/db/src/schema/msp.ts userSessionsTable).
-- sla_breaches/sla_compliance_records/sla_timers msp_id/customer_id use no delete
-- rule (RESTRICT), matching this repo's default for FKs the issue didn't specify a
-- rule for.
--
-- Orphan-row check, live-verified pre-migration against local shanemccawmsp:
--   sla_breaches msp_id / customer_id             -> 0 orphans
--   sla_compliance_records msp_id / customer_id   -> 0 orphans
--   sla_timers msp_id / customer_id               -> 0 orphans
--   msp_refresh_tokens user_id                    -> 5 REAL orphans. Reported honestly
--     here rather than silently deleted or force-added, per this repo's convention.
--     All 5 are unexpired, unrevoked tokens whose user_id (3708, 3731, 3774, 3833, 3930)
--     has no matching row in users (current users max id at time of writing: 3821 — some
--     of these ids never existed as live users at all, others reference ids below the
--     current max that are simply gone). This is exactly the failure mode #4399
--     describes: nothing today cleans up msp_refresh_tokens when its owning user is
--     deleted.
--
--     Because 5 real orphans exist, this migration does NOT run
--     `VALIDATE CONSTRAINT msp_refresh_tokens_user_id_fkey` — validating would either
--     fail outright or require deleting live rows this migration has no authority to
--     remove unilaterally. Instead the constraint is added `NOT VALID`: it still
--     enforces on every future INSERT/UPDATE (closing the gap #4399 is actually about),
--     it is still discoverable via pg_constraint / information_schema for #4313's
--     find-tenant-scoped-tables.mjs (NOT VALID constraints are real, listed constraints —
--     only *existing* rows are unchecked), and the 5 pre-existing orphaned rows are left
--     exactly as-is for Shane to decide whether to purge. Filed as its own finding
--     alongside this migration (see the #4399 issue comments for the number) for the
--     real orphan data and the follow-up VALIDATE once those rows are cleared.

BEGIN;

-- ----------------------------------------------------------------------------
-- msp_refresh_tokens.user_id -> users(id)
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  n_orphans integer;
BEGIN
  SELECT count(*) INTO n_orphans
  FROM msp_refresh_tokens r LEFT JOIN users u ON u.id = r.user_id
  WHERE u.id IS NULL;

  IF n_orphans > 0 THEN
    RAISE NOTICE 'msp_refresh_tokens: % pre-existing orphaned row(s) with no matching users.id — NOT deleted, NOT validated. Constraint added NOT VALID so it still enforces on all future writes; see the migration header comment.', n_orphans;
  END IF;
END $$;

ALTER TABLE msp_refresh_tokens DROP CONSTRAINT IF EXISTS msp_refresh_tokens_user_id_fkey;

ALTER TABLE msp_refresh_tokens
  ADD CONSTRAINT msp_refresh_tokens_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  NOT VALID;

-- Deliberately NOT run: ALTER TABLE msp_refresh_tokens VALIDATE CONSTRAINT
-- msp_refresh_tokens_user_id_fkey; — 5 real pre-existing orphaned rows would fail it.
-- The constraint above still enforces on every future INSERT/UPDATE. Run VALIDATE
-- separately once the orphaned rows are resolved (see the filed finding).

-- ----------------------------------------------------------------------------
-- sla_breaches.msp_id -> msps(id), sla_breaches.customer_id -> tenants(id)
-- ----------------------------------------------------------------------------

ALTER TABLE sla_breaches DROP CONSTRAINT IF EXISTS sla_breaches_msp_id_fkey;
ALTER TABLE sla_breaches DROP CONSTRAINT IF EXISTS sla_breaches_customer_id_fkey;

ALTER TABLE sla_breaches
  ADD CONSTRAINT sla_breaches_msp_id_fkey FOREIGN KEY (msp_id) REFERENCES msps(id) NOT VALID,
  ADD CONSTRAINT sla_breaches_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES tenants(id) NOT VALID;

ALTER TABLE sla_breaches VALIDATE CONSTRAINT sla_breaches_msp_id_fkey;
ALTER TABLE sla_breaches VALIDATE CONSTRAINT sla_breaches_customer_id_fkey;

-- ----------------------------------------------------------------------------
-- sla_compliance_records.msp_id -> msps(id), sla_compliance_records.customer_id -> tenants(id)
-- ----------------------------------------------------------------------------

ALTER TABLE sla_compliance_records DROP CONSTRAINT IF EXISTS sla_compliance_records_msp_id_fkey;
ALTER TABLE sla_compliance_records DROP CONSTRAINT IF EXISTS sla_compliance_records_customer_id_fkey;

ALTER TABLE sla_compliance_records
  ADD CONSTRAINT sla_compliance_records_msp_id_fkey FOREIGN KEY (msp_id) REFERENCES msps(id) NOT VALID,
  ADD CONSTRAINT sla_compliance_records_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES tenants(id) NOT VALID;

ALTER TABLE sla_compliance_records VALIDATE CONSTRAINT sla_compliance_records_msp_id_fkey;
ALTER TABLE sla_compliance_records VALIDATE CONSTRAINT sla_compliance_records_customer_id_fkey;

-- ----------------------------------------------------------------------------
-- sla_timers.msp_id -> msps(id), sla_timers.customer_id -> tenants(id)
-- ----------------------------------------------------------------------------

ALTER TABLE sla_timers DROP CONSTRAINT IF EXISTS sla_timers_msp_id_fkey;
ALTER TABLE sla_timers DROP CONSTRAINT IF EXISTS sla_timers_customer_id_fkey;

ALTER TABLE sla_timers
  ADD CONSTRAINT sla_timers_msp_id_fkey FOREIGN KEY (msp_id) REFERENCES msps(id) NOT VALID,
  ADD CONSTRAINT sla_timers_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES tenants(id) NOT VALID;

ALTER TABLE sla_timers VALIDATE CONSTRAINT sla_timers_msp_id_fkey;
ALTER TABLE sla_timers VALIDATE CONSTRAINT sla_timers_customer_id_fkey;

-- ----------------------------------------------------------------------------
-- Run tracking (Git #497) — Simulator Studio's Migrations tree reads this.
-- ----------------------------------------------------------------------------
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-16-missing-fk-constraints-4399.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
