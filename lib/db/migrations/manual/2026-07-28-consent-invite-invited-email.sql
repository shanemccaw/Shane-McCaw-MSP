-- Tenant/User Refactor Phase 2b (#103, parent #95/#92): the admin "add client"
-- flow becomes a consent invite instead of direct account creation. The invite
-- token must therefore carry the admin-specified email/name for a client who
-- has NO users row yet — consent-first means the account only comes into
-- existence when the tenant admin approves (provisionProspectAccount in the
-- consent callback reads these two columns off the burned token).
--
-- Additive only; safe to run at any time.

ALTER TABLE consent_invite_tokens ADD COLUMN IF NOT EXISTS invited_email text;
ALTER TABLE consent_invite_tokens ADD COLUMN IF NOT EXISTS invited_name text;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-07-28-consent-invite-invited-email.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
