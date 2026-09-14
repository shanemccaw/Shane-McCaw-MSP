-- 4040-break-glass-override-claim.sql
--
-- Git #4040. Additive, reversible.
--
-- Mutual exclusion for break-glass admin-override. The override used to check
-- `status = 'pending_delivery'` on a row read before the call, so two concurrent
-- overrides on the same pending secret both reset the tenant password and both
-- inserted a deliverable replacement — only one of which was the live password.
--
-- The override now claims the row first:
--   UPDATE ... SET status = 'reset_in_progress', reset_claim_token = <random>, reset_claimed_at = now()
--    WHERE id = <id> AND status = 'pending_delivery' RETURNING id
-- and a second override gets 409 before it touches the store or the tenant.
--
-- `status` is plain text with no CHECK constraint (the enum lives in the Drizzle
-- schema only), so the new 'reset_in_progress' value needs no DDL. The two columns
-- below identify the claim holder and let a claim abandoned by a crashed process be
-- taken over once stale.

ALTER TABLE break_glass_pending_secrets
  ADD COLUMN IF NOT EXISTS reset_claim_token text;

ALTER TABLE break_glass_pending_secrets
  ADD COLUMN IF NOT EXISTS reset_claimed_at timestamptz;

COMMENT ON COLUMN break_glass_pending_secrets.reset_claim_token IS
  'Git #4040 — random token of the admin-override currently holding this row in reset_in_progress; only that call may release or supersede it. Not a credential.';

COMMENT ON COLUMN break_glass_pending_secrets.reset_claimed_at IS
  'Git #4040 — when the admin-override claimed this row. A reset_in_progress claim older than the override''s stale window may be taken over.';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('4040-break-glass-override-claim.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
