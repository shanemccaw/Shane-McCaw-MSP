-- License-Gap Classification — track checks that couldn't run because the tenant
-- lacks the required Microsoft 365 SKU/add-on (Entra ID Premium, Defender for
-- Office 365, etc.) separately from genuine technical errors.
--
-- Run manually (Shane) — this repo does not use `drizzle-kit push`.
--
-- Notes:
--  * tenant_monitor_profiles.status is a plain text column (no CHECK constraint),
--    so the new "license_gap" status value needs no DDL — it is accepted as-is.
--  * Only the new msp_diagnostic_runs.checks_license_gap counter needs a column.

ALTER TABLE "msp_diagnostic_runs"
  ADD COLUMN IF NOT EXISTS "checks_license_gap" integer NOT NULL DEFAULT 0;
