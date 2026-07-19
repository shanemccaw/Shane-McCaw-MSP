-- Portal Foundation Redesign — account-level theme preference
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).
--
-- Adds:
--   msp_users.theme_preference — nullable 'light'/'dark' preference, so the
--   customer never has to re-toggle dark mode after logging in on a new
--   device or a cache clear. NULL means "no preference set yet"; the client
--   falls back to OS prefers-color-scheme and does not write anything until
--   the user actually toggles it. No default value by design.

ALTER TABLE "msp_users" ADD COLUMN IF NOT EXISTS "theme_preference" text;

ALTER TABLE "msp_users" ADD CONSTRAINT "msp_users_theme_preference_check"
  CHECK ("theme_preference" IS NULL OR "theme_preference" IN ('light', 'dark'));
