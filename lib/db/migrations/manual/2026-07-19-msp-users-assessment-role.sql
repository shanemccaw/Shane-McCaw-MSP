-- Add "Assessment" MSP role
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).
--
-- Context / correction to the task brief:
--   msp_users.msp_role is NOT a Postgres ENUM type, so `ALTER TYPE ... ADD VALUE`
--   does not apply here. It is a plain `text` column. Depending on which of the
--   colliding 0157 creation migrations actually created the table on a given
--   environment, it is EITHER:
--     (a) bare text with no constraint            (0157_msp_offboarding.sql:45), or
--     (b) text + an inline CHECK constraint        (0157_add_msp_platform_tables.sql:41)
--         auto-named "msp_users_msp_role_check" listing the 6 legacy roles.
--   The Drizzle-level `text("msp_role", { enum: MSP_ROLES })` is a TypeScript-only
--   constraint and needs no DB migration; the ONLY thing that can reject the new
--   'Assessment' value at the DB layer is the CHECK constraint from case (b).
--
-- This migration is written to be safe for BOTH cases: it drops the CHECK
-- constraint if present, then (re)adds one that includes 'Assessment' (and 'Free').
-- On a case-(a) database this simply establishes the CHECK for the first time,
-- matching the convention used by the other status/enum text columns in the schema.
--
-- All values currently in use are among the 6 legacy roles, every one of which is
-- included below, so the ADD CONSTRAINT cannot fail on existing data.

BEGIN;

ALTER TABLE "msp_users" DROP CONSTRAINT IF EXISTS "msp_users_msp_role_check";

ALTER TABLE "msp_users"
  ADD CONSTRAINT "msp_users_msp_role_check"
  CHECK ("msp_role" IN (
    'PlatformAdmin',
    'MSPAdmin',
    'MSPOperator',
    'CustomerUser',
    'ServiceAccount',
    'Free',
    'Assessment'
  ));

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Deliverable 2 investigation — run these READ-ONLY queries by hand to inform the
-- Free→Assessment decision. (Claude has no DB access in this environment and did
-- NOT run them; the codebase-side decision below is path (a): treat Free and
-- Assessment identically, leave existing Free rows untouched, new signups use
-- Assessment.)
--
--   -- How many real users currently sit on the Free role?
--   SELECT count(*) AS free_users FROM msp_users WHERE msp_role = 'Free';
--
--   -- Break down Free rows by whether they even have a customer association,
--   -- which tells us if any Free row is actually exercising the self-scope paths.
--   SELECT (customer_id IS NOT NULL) AS has_customer, count(*)
--   FROM msp_users WHERE msp_role = 'Free'
--   GROUP BY (customer_id IS NOT NULL);
--
-- Path (a) does NOT migrate rows. If, after reviewing the counts, Shane instead
-- prefers the cleaner end-state of path (b) (migrate Free → Assessment and retire
-- Free), the row migration would be — DO NOT run without deciding to retire Free
-- and removing the remaining Free handling from the codebase first:
--
--   -- UPDATE msp_users SET msp_role = 'Assessment', updated_at = now()
--   -- WHERE msp_role = 'Free';
