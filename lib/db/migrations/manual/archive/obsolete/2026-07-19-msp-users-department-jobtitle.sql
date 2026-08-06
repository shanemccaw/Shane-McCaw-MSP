-- Fix Broken Team Invite Endpoint
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).
--
-- Adds:
--   msp_users.department, msp_users.job_title — nullable free-text org metadata
--   captured at customer-team invite time (POST /portal/team/invite). Nullable
--   because MSP-side roles (MSPAdmin, MSPOperator, etc.) never set these.

ALTER TABLE "msp_users" ADD COLUMN IF NOT EXISTS "department" text;
ALTER TABLE "msp_users" ADD COLUMN IF NOT EXISTS "job_title" text;
