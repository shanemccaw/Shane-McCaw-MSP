-- monitor_checks.script_package_id — link a check to the script that satisfies it
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).
--
-- Context: checks with requires_customer_script = TRUE tell the customer that
-- a PowerShell runbook must be run in their own tenant, but nothing on
-- monitor_checks (or anywhere else) points at which script_packages row
-- actually satisfies that check. This adds a nullable FK so the platform can
-- resolve "this check needs a script" -> "here is the exact script to run."
-- Nullable because most checks don't require a script, and even
-- requires_customer_script checks may not have a package assigned yet.

ALTER TABLE "monitor_checks"
  ADD COLUMN IF NOT EXISTS "script_package_id" uuid;

ALTER TABLE "monitor_checks" DROP CONSTRAINT IF EXISTS "monitor_checks_script_package_id_fkey";
ALTER TABLE "monitor_checks"
  ADD CONSTRAINT "monitor_checks_script_package_id_fkey"
  FOREIGN KEY ("script_package_id") REFERENCES "script_packages"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "monitor_checks_script_package_id_idx"
  ON "monitor_checks" ("script_package_id");