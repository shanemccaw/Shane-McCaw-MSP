-- Real Account Lockout
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).
--
-- Adds:
--   msp_users.failed_login_attempts — integer, NOT NULL, default 0. Counts
--   consecutive bad-password attempts within the lockout window, checked
--   live at /auth/login. Reset to 0 on any successful login or admin unlock.
--   msp_users.last_failed_login_at — timestamptz, nullable. Timestamp of the
--   most recent failed attempt, used to decide whether a new failure falls
--   inside the existing lockout window or starts a fresh count.
--   msp_users.locked_until — timestamptz, nullable. Set once
--   failed_login_attempts crosses the threshold; login is blocked (no
--   tokens issued) until this passes or an admin unlocks the account via
--   POST /portal/team/:userId/unlock.

ALTER TABLE "msp_users" ADD COLUMN IF NOT EXISTS "failed_login_attempts" integer NOT NULL DEFAULT 0;
ALTER TABLE "msp_users" ADD COLUMN IF NOT EXISTS "last_failed_login_at" timestamptz;
ALTER TABLE "msp_users" ADD COLUMN IF NOT EXISTS "locked_until" timestamptz;
