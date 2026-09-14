-- 4015-break-glass-pending-secret-account-id.sql
--
-- Git #4015. Additive, reversible.
--
-- Adds the break-glass ACCOUNT IDENTITY (Entra object id or UPN) to
-- `break_glass_pending_secrets`. The break_glass_verification_gate writes it at
-- insert, and admin-override reads it to know which tenant account to reset, then
-- copies it onto the replacement row it issues.
--
-- Before this, the override read `wf_runs.payload.breakGlassAccountId`, which #1911's
-- deep redaction had turned into the literal "[redacted]" on every gated run, so the
-- override PATCHed /users/%5Bredacted%5D and always failed with 502.
--
-- Backfill: a still-pending row whose run payload carries a real (unredacted) value
-- gets it copied across. Rows whose payload holds only "[redacted]" stay NULL — that
-- identity is not recoverable (the value scrub removed every copy of it), and the
-- override answers 409 for them rather than resetting the wrong account.

ALTER TABLE break_glass_pending_secrets
  ADD COLUMN IF NOT EXISTS break_glass_account_id text;

COMMENT ON COLUMN break_glass_pending_secrets.break_glass_account_id IS
  'Git #4015 — the break-glass account (Entra object id or UPN) this credential belongs to; the account admin-override resets. An identifier, never a credential.';

UPDATE break_glass_pending_secrets s
   SET break_glass_account_id = r.payload->>'breakGlassAccountId'
  FROM wf_runs r
 WHERE r.id = s.run_id
   AND s.break_glass_account_id IS NULL
   AND s.status = 'pending_delivery'
   AND coalesce(r.payload->>'breakGlassAccountId', '') NOT IN ('', '[redacted]');

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('4015-break-glass-pending-secret-account-id.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
