-- Launch Control — Rollback (Reverse-Template Pairing)
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).
--
-- Adds reverse-template pairing to baseline_action_templates and a
-- requestVariables capture column to baseline_action_template_audit_log.
-- Rollback for Launch Control is explicit-pairing only (not a generic
-- snapshot/replay mechanism) — see workflow-executor.ts's rollbackExecution().

ALTER TABLE "baseline_action_templates"
  ADD COLUMN IF NOT EXISTS "reversible" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "reverse_template_id" text;

ALTER TABLE "baseline_action_template_audit_log"
  ADD COLUMN IF NOT EXISTS "request_variables" jsonb DEFAULT '{}'::jsonb;

-- Populate the 6 reversible templates (of the 10 built in Phase 3). The 4
-- left at reversible=false (the column default, no UPDATE needed) are:
--   sharepoint.restore_recycle_bin_item, users.force_password_reset,
--   auth.revoke_signin_sessions — no real single-step reverse exists.
-- template_id spellings confirmed against
-- 2026-07-20-launch-control-phase3-templates.sql (the actual seed data),
-- not assumed from task doc guesses.

-- Self-paired: the sign-in toggle reverses by inverting the captured
-- accountEnabled boolean, not by replaying the same call (see
-- rollbackExecution()'s self-pair special case).
UPDATE "baseline_action_templates"
SET "reversible" = true, "reverse_template_id" = 'users.disable_enable_signin'
WHERE "template_id" = 'users.disable_enable_signin';

UPDATE "baseline_action_templates"
SET "reversible" = true, "reverse_template_id" = 'licensing.remove_license'
WHERE "template_id" = 'licensing.assign_license';

UPDATE "baseline_action_templates"
SET "reversible" = true, "reverse_template_id" = 'licensing.assign_license'
WHERE "template_id" = 'licensing.remove_license';

UPDATE "baseline_action_templates"
SET "reversible" = true, "reverse_template_id" = 'groups.remove_member'
WHERE "template_id" = 'groups.add_member';

UPDATE "baseline_action_templates"
SET "reversible" = true, "reverse_template_id" = 'groups.add_member'
WHERE "template_id" = 'groups.remove_member';

-- teams.add_member's reverse requires a live membership-ID lookup at
-- rollback time (GET /teams/{teamId}/members, filtered by userId) — the
-- captured requestVariables (teamId, memberId) alone are not sufficient,
-- since teams.remove_member needs the CONVERSATION MEMBERSHIP id, not the
-- user id. Handled specially in rollbackExecution(); the pairing below only
-- marks the templates reversible and names the reverse template.
UPDATE "baseline_action_templates"
SET "reversible" = true, "reverse_template_id" = 'teams.remove_member'
WHERE "template_id" = 'teams.add_member';

UPDATE "baseline_action_templates"
SET "reversible" = true, "reverse_template_id" = 'teams.add_member'
WHERE "template_id" = 'teams.remove_member';
