-- status_reports.customer_id (#1923) — corrects #1589's "stays user-scoped" decision.
-- Manual migration - review and run by hand (do not run drizzle-kit push/push --force).
--
-- A status report is a deliverable to the customer organisation, not a private
-- message to one named person. Add a real tenants.id reference so publish
-- visibility/notification fan-out can derive from the customer, not from the
-- single `client_user_id` addressee. Nullable + ON DELETE SET NULL, matching
-- the sales_offers.customer_id convention (#2730): additive, non-destructive,
-- existing rows are backfilled best-effort from client_user_id -> users.tenant_id
-- where resolvable, left NULL otherwise (a real, reportable state, not an error).
--
-- Confirmed local status_reports is empty (0 rows) at authoring time, so the
-- backfill below is a no-op locally but is included for correctness against any
-- environment that does carry rows.

BEGIN;

ALTER TABLE "status_reports"
  ADD COLUMN IF NOT EXISTS "customer_id" integer;

ALTER TABLE "status_reports"
  DROP CONSTRAINT IF EXISTS "status_reports_customer_id_fkey";

ALTER TABLE "status_reports"
  ADD CONSTRAINT "status_reports_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "tenants"("id") ON DELETE SET NULL;

-- Backfill: derive customer_id from the addressee's own tenant, where one exists.
UPDATE "status_reports" sr
SET "customer_id" = u."tenant_id"
FROM "users" u
WHERE sr."client_user_id" = u."id"
  AND sr."customer_id" IS NULL
  AND u."tenant_id" IS NOT NULL;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-06-status-reports-customer-id-1923.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
