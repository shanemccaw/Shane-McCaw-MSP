-- Automated Customer Emails Setting
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).
--
-- Adds:
--   msps.automated_customer_emails_enabled — boolean, NOT NULL, default true.
--   Gates any platform-initiated email to a customer_user. Defaults true, but
--   is functionally inert (no send occurs) unless the MSP also has an active
--   mspMailboxConnectorsTable row — see canSendAutomatedCustomerEmail() in
--   artifacts/api-server/src/lib/mailer.ts.

ALTER TABLE "msps" ADD COLUMN IF NOT EXISTS "automated_customer_emails_enabled" boolean NOT NULL DEFAULT true;
