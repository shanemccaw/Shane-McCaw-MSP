-- 4041-break-glass-pending-secret-credential-uncertain.sql
--
-- Git #4041. Additive, reversible.
--
-- Adds `credential_uncertain_at` to `break_glass_pending_secrets`. An admin-override
-- that ends `502 outcome_unknown` (Graph 5xx / transport error, so the reset may have
-- landed) or `500 replacement_unrecorded` (the reset landed, recording failed twice)
-- deliberately leaves the old row `pending_delivery` so the override can be re-run.
-- Before this column the uncertainty lived only in the HTTP response and a log line,
-- so invites could still be issued for, and a recipient could be shown, a credential
-- the tenant may no longer accept.
--
-- The override writes this before sending the tenant reset, restores it on a
-- definite refusal, and clears it in the transaction that records a replacement.
-- While it is set, invite and reveal refuse and point at admin-override.
--
-- No backfill: no row can be known to be uncertain from existing data.

ALTER TABLE break_glass_pending_secrets
  ADD COLUMN IF NOT EXISTS credential_uncertain_at timestamptz;

COMMENT ON COLUMN break_glass_pending_secrets.credential_uncertain_at IS
  'Git #4041 — set while an admin-override may have changed the tenant credential without recording a replacement; invite and reveal refuse until an override succeeds.';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('4041-break-glass-pending-secret-credential-uncertain.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
