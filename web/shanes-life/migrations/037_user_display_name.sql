-- Shane's Life -- real display name for the no-login Shared list view (Git #3184).
--
-- Numbered 037, not 035: `schema_migrations` on the real shared local `finances` database
-- already carries rows for `035_people_patterns.sql` and `036_push_subscriptions.sql` -- neither
-- file exists anywhere in this repo's checked-out migrations directory or git history at the
-- time this was written (checked `git log --all -- web/shanes-life/migrations`). That's the same
-- live-drift shape 034_catches.sql's own header documents: a concurrent session applied real SQL
-- against the shared database from a worktree whose commits never landed on origin/main. Filed
-- as a real finding (see this build's own bookend/issue comment) rather than reusing or
-- overwriting those numbers.
--
-- Real gap this closes: `users.name` is set at signup to the literal email address (confirmed
-- live -- both real rows in `finances.users` today have name == email) and nothing anywhere lets
-- it be anything else. The Shared list design ("Shanes Life 12 - Shared list.dc.html", 1t) says
-- "From Shane" on the no-login page; showing "From shanemccaw@gmail.com" instead would be a real
-- visual regression from the design, and hardcoding the literal string "Shane" in application
-- code would be exactly the fabricated-display-data the standing rule forbids. `display_name` is
-- the real, additive fix -- nullable, defaults to nothing, falls back to the existing `name`
-- value when unset so no caller breaks.
--
-- The one real row that needs it is backfilled below with Shane's own actual first name -- a
-- known, real fact about the account holder, not an invented placeholder.

ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name text;

UPDATE users SET display_name = 'Shane'
 WHERE email = 'shanemccaw@gmail.com' AND display_name IS NULL;
