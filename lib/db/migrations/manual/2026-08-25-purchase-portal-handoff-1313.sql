-- Git #1313 (Epic #1309 Phase 4): purchase-session → portal auto-login handoff.
--
-- checkout_sessions.account_user_id records WHICH users row had its password
-- attached through this session's own inline account-creation flow (set only
-- by attachPasswordToAccount's `ok` outcome in
-- artifacts/api-server/src/lib/purchase-account-flow.ts — never for an
-- `already_set` pre-existing account). It is the durable authorization fact
-- behind POST /api/public/purchase/portal-handoff: /auth/signup-exchange
-- trades a signup token for a FULL portal session with no MFA challenge, so a
-- handoff token may only ever be minted for the account this very session
-- created. A pre-existing account (password/MFA predating this purchase) must
-- sign in through the portal's own door — a checkout session is not a
-- credential-recovery or MFA-bypass door.
--
-- Null means this session never completed account creation (or the row
-- predates the column). Purely additive; safe to run on a live database.

BEGIN;

ALTER TABLE checkout_sessions
  ADD COLUMN IF NOT EXISTS account_user_id integer REFERENCES users(id);

-- (at the very end of the file, inside the same transaction)
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-25-purchase-portal-handoff-1313.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
