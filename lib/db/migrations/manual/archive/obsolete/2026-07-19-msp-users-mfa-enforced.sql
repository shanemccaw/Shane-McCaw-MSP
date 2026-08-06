-- Team MFA Enforcement Toggle
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).
--
-- Adds:
--   msp_users.mfa_enforced — boolean, NOT NULL, default false. When true,
--   the user must have an active MFA enrollment to log in (checked live at
--   /auth/login). Defaults false so no existing team member is silently
--   affected by this migration; enforcement is opted in per-user via
--   PATCH /portal/team/:userId/mfa-enforcement.

ALTER TABLE "msp_users" ADD COLUMN IF NOT EXISTS "mfa_enforced" boolean NOT NULL DEFAULT false;
