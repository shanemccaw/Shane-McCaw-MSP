-- tenant_signal_history.customer_id (#2983) — settles the two-id-space contradiction.
-- Manual migration - review and run by hand (do not run drizzle-kit push/push --force).
--
-- #2983 documented seven tables whose `customer_id` the codebase read as BOTH
-- `tenants.id` and `users.id`. A per-table trace of every real writer and reader
-- (recorded in build-journal/2983.md) found six of them unambiguous — they are
-- `users.id`, in the Drizzle definition, in the live FK, and in every code path —
-- and exactly ONE genuinely contradictory: this table.
--
-- tenant_signal_history is contradictory because:
--   * the Drizzle comment says "tenants.id ... no FK by design";
--   * the live DB carries `tenant_signal_history_customer_id_fkey -> users(id)`,
--     which appears in NO migration or schema file in this repo — undocumented
--     drift, not a designed constraint;
--   * the ONLY writer (tenant-signals.ts recordSignalTransitions) is HANDED a
--     tenants.id by computeTenantSignals and then calls resolveCustomerPortalUserId
--     purely to satisfy that FK, with a comment saying so;
--   * every correct reader (getStabilizedSignals, policy-engine evaluateAllPolicies)
--     immediately fans back OUT over users.tenant_id — i.e. the effective semantic
--     was already per-tenant, reached through a users.id detour;
--   * portal-privacy.ts's data export, admin-active-directory.ts's tenant hard
--     delete, and both testbed-reset migrations all already pass a tenants.id.
--
-- A signal fired by tenant-level monitoring is tenant data. Keying it on one
-- arbitrary login also made it collateral damage of that login's deletion: the
-- users FK is ON DELETE SET NULL, and the local DB already holds 103 rows whose
-- customer_id is NULL and therefore attributable to no tenant at all.
--
-- Shape follows the established precedent for exactly this correction —
-- 2026-09-06-status-reports-customer-id-1923.sql, and sales_offers.customer_id
-- (#2730): the users.id column keeps its value under an honest users.id-shaped
-- name, and `customer_id` becomes a real tenants.id with a real FK.
--
-- Wholly non-destructive and reversible: nothing is dropped, no value is
-- overwritten. RENAME and DROP CONSTRAINT are both explicitly non-destructive
-- per CLAUDE.md; the one UPDATE writes only the newly-added column.
--
-- Local state at authoring time: 6,591 rows; 6,488 with a non-NULL customer_id
-- holding users.id values 37, 39 and 56; 103 already NULL. The 103 cannot be
-- attributed to a tenant by any available evidence (msp_id = 1 spans more than
-- one tenant) and are deliberately left NULL — a real, reportable state.

BEGIN;

-- 1. The existing column holds users.id values. Give it the name this codebase
--    already uses for a users.id (projects.client_user_id,
--    client_services.client_user_id, script_download_tokens.client_user_id).
--    Its existing users FK is correct and is kept, now correctly named.
ALTER TABLE "tenant_signal_history"
  RENAME COLUMN "customer_id" TO "client_user_id";

ALTER TABLE "tenant_signal_history"
  RENAME CONSTRAINT "tenant_signal_history_customer_id_fkey"
  TO "tenant_signal_history_client_user_id_fkey";

ALTER INDEX IF EXISTS "tenant_signal_history_customer_signal_fired_idx"
  RENAME TO "tenant_signal_history_client_user_signal_fired_idx";

-- 2. The real scoping key: the owning tenant.
ALTER TABLE "tenant_signal_history"
  ADD COLUMN IF NOT EXISTS "customer_id" integer;

ALTER TABLE "tenant_signal_history"
  DROP CONSTRAINT IF EXISTS "tenant_signal_history_customer_id_tenants_id_fk";

ALTER TABLE "tenant_signal_history"
  ADD CONSTRAINT "tenant_signal_history_customer_id_tenants_id_fk"
  FOREIGN KEY ("customer_id") REFERENCES "tenants"("id") ON DELETE CASCADE;

-- 3. Backfill from the login the signal engine happened to write under.
--    Deterministic: every non-NULL client_user_id resolves through users.tenant_id.
UPDATE "tenant_signal_history" tsh
SET "customer_id" = u."tenant_id"
FROM "users" u
WHERE tsh."client_user_id" = u."id"
  AND tsh."customer_id" IS NULL
  AND u."tenant_id" IS NOT NULL;

-- 4. The read index the engine actually uses, in the real key space.
CREATE INDEX IF NOT EXISTS "tenant_signal_history_customer_signal_fired_idx"
  ON "tenant_signal_history" ("customer_id", "signal_key", "fired_at");

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-07-tenant-signal-history-customer-id-2983.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
