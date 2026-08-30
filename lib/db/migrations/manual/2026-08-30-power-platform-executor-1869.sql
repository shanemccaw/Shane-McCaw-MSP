-- #1869 — Power Platform back in scope: the power-platform executor transport.
--
-- Additive and reversible. Adds the one column the fifth executor type needs.
--
-- Context: MONITOR_CHECK_EXECUTOR_TYPES gains 'power-platform' as its fifth
-- transport (lib/db/src/schema/msp.ts). `executor_type` is a plain TEXT column
-- with the enum enforced in Drizzle rather than by a DB CHECK constraint, so
-- widening the vocabulary needs no DDL — but the new transport's operation
-- identifier does.
--
-- `pp_operation` mirrors `sp_operation` exactly: an identifier resolved
-- server-side against a code-owned registry (POWER_PLATFORM_OPERATIONS in
-- monitor-executor.ts), never a URL and never a script. NULL for every check
-- that is not executor_type = 'power-platform', which today is all of them —
-- #1869 deliberately writes no customer-facing checks.

BEGIN;

ALTER TABLE monitor_checks
  ADD COLUMN IF NOT EXISTS pp_operation text;

COMMENT ON COLUMN monitor_checks.pp_operation IS
  'Key into the code-owned POWER_PLATFORM_OPERATIONS registry (monitor-executor.ts). '
  'Identifier only - never a URL, never a script. NULL unless executor_type = ''power-platform''. (#1869)';

-- Verify the column landed, and confirm no existing row was disturbed.
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'monitor_checks'
   AND column_name IN ('sp_operation', 'pp_operation', 'executor_type')
 ORDER BY column_name;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-30-power-platform-executor-1869.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
