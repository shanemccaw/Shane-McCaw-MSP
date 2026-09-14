-- ============================================================================
-- #4112 — operator-proposed retainer interval switch, pending customer approval
-- ============================================================================
-- Part of #1692 (Feature: Billing, MSP Console).
--
-- Shane's decision (2026-09-14): an MSP operator can propose a retainer
-- interval switch (month<->year) for a direct customer, but it does not take
-- effect until the customer approves it in their portal. This is a NEW state,
-- distinct from the existing self-service switch on client_services
-- (stripe_schedule_id / pending_billing_interval, portal-retainer-billing.ts)
-- which takes effect immediately via a Stripe Subscription Schedule.
--
-- Presence of proposed_billing_interval means a proposal is pending customer
-- action. On approval the existing switch-interval mechanics run (folding the
-- proposal into stripe_schedule_id/pending_billing_interval), then the
-- proposed_* columns are cleared. On rejection they are simply cleared. No
-- auto-expiry column — mirrors the existing switch's own pattern where only
-- an explicit action (never a timeout) clears pending state.
--
-- Additive only: three new nullable columns on client_services.

ALTER TABLE client_services
  ADD COLUMN IF NOT EXISTS proposed_billing_interval text,
  ADD COLUMN IF NOT EXISTS proposed_by_user_id integer REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS proposed_at timestamptz;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-14-retainer-interval-switch-proposal-4112.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
