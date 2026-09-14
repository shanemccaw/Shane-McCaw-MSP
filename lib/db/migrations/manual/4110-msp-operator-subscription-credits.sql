-- 4110-msp-operator-subscription-credits.sql
--
-- Git #4110 (Feature #1692 — MSP Console Billing). Additive, reversible.
--
-- Real audit for #4110 found the per-customer subscription row is
-- `tenant_subscriptions` (Git #2847, tenant-scoped) — not `msp_subscriptions` (the
-- MSP's own platform-tier subscription, msp_id-unique) and not `invoices` /
-- `client_services` (the legacy client-portal axis, keyed on users.id).
-- `tenant_subscriptions` already carries every column a cancel route needs
-- (status, canceled_at, ended_at, cancel_at_period_end), so no schema change is
-- needed there.
--
-- "Apply a discount" and "apply free month(s)" both reuse the real mechanism
-- #4032 already built for testimonial-approval credits (`customer_billing_credits`
-- + `issueCreditToNextInvoice()`: a Stripe coupon attached to the tenant's active
-- subscription) rather than inventing a parallel one. That table only supported a
-- single-invoice ("duration: once") credit and only the one `testimonial_approval`
-- source. This migration:
--
--   1. Adds `duration_months` (nullable) so a credit can span more than one
--      invoice — null/1 stays "once" (unchanged behavior for existing rows and
--      the testimonial flow), 2+ becomes a Stripe "repeating" coupon for that
--      many invoice cycles. This is what makes "free month(s)" (plural) real.
--   2. Widens the `source` check to add the two new MSP-operator-issued flows,
--      distinct from `testimonial_approval` for audit/provenance clarity:
--      `msp_operator_discount` (a custom-amount discount) and
--      `msp_operator_free_month` (a 100%-off credit for N invoices).

BEGIN;

ALTER TABLE customer_billing_credits
  ADD COLUMN IF NOT EXISTS duration_months integer;

ALTER TABLE customer_billing_credits
  DROP CONSTRAINT IF EXISTS customer_billing_credits_source_check;

ALTER TABLE customer_billing_credits
  ADD CONSTRAINT customer_billing_credits_source_check
    CHECK (source IN ('testimonial_approval', 'msp_operator_discount', 'msp_operator_free_month'));

COMMENT ON COLUMN customer_billing_credits.duration_months IS
  'Git #4110 — null/1 = a single-invoice ("once") Stripe coupon, matching the original #4032 testimonial-credit behavior. 2+ = a "repeating" Stripe coupon applied to that many consecutive invoices (an MSP-operator-granted multi-month free period).';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('4110-msp-operator-subscription-credits.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
