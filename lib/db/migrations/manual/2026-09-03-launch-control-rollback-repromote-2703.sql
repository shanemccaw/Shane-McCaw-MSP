-- Launch Control - Rollback re-promotion against REAL live template_ids (#2703)
-- Manual migration - review and run by hand (do not run drizzle-kit push/push --force).
--
-- 2026-07-21-launch-control-rollback.sql set reversible=true + reverse_template_id on 6
-- template_id values (users.disable_enable_signin, licensing.assign_license/remove_license,
-- groups.add_member/remove_member, teams.add_member/remove_member) that do not exist anywhere
-- in the live baseline_action_templates table (102 rows, all using the action.*/microrem.*/
-- quickstart-v1.*/groups.*/roleManagement.* naming actually seeded live). That migration's own
-- simulator_migration_runs row says it ran; its actual effect never landed. Confirmed against
-- local DATABASE_URL this session: 0/102 live rows have reversible=true.
--
-- This migration re-promotes reversibility against the REAL, currently-live template_id values,
-- matched by real name/intent/endpoint/required_variables (confirmed via direct query, not
-- guessed):
--
--   action.disable-user-signin      <-> action.enable-user-signin
--     Same endpoint (/users/{{userId}}, PATCH), same required_variables (["userId"]), fixed
--     accountEnabled true/false in each template's own body_template. NOT self-paired like the
--     old single-toggle template - these are two separate live templates, so this hits
--     rollbackExecution()'s generic replay-with-captured-variables path directly (no special
--     case needed; the self-pair boolean-invert branch correctly does not apply here since
--     template_id !== reverse_template_id).
--
--   action.assign-single-license    <-> microrem.remove-unused-license
--     Same endpoint (/users/{{userId}}/assignLicense, POST), same required_variables
--     (["userId","skuId"]), addLicenses vs removeLicenses. Generic replay path.
--
--   action.group-based-license-assign <-> action.group-based-license-remove
--     Same endpoint (/groups/{{groupId}}/assignLicense, POST), same required_variables
--     (["groupId","skuId"]), addLicenses vs removeLicenses. Generic replay path.
--
--   action.add-group-member         <-> microrem.remove-stale-group-member
--     Real reciprocal Graph operations on the same relationship (POST .../members/$ref to add,
--     DELETE .../members/{id}/$ref to remove) but the captured variable is named "memberId" on
--     the add template and "userId" on the remove template for the same directoryObject id -
--     replaying captured requestVariables verbatim would leave {{userId}} unresolved on the
--     reverse call. workflow-executor.ts gets a new explicit alias special case for this pair
--     (same pattern as the existing self-pair/Teams special cases) so the id is carried across
--     under both names before replay.
--
-- teams.add_member / teams.remove_member are NOT re-promoted here: no live
-- baseline_action_templates row exists for Teams conversation-member add/remove under any name
-- (confirmed - no match on template_id/endpoint/label ilike '%member%'/'%teams%' beyond the
-- unrelated group/service-principal member templates already covered above). Forcing a pairing
-- there would mean inventing new tenant-write templates, not matching real ones - filed as
-- #2772 instead, sibling under #2494. workflow-executor.ts:879-905's Teams special case is left
-- as-is, still unreachable (still naming the old dead ids) pending that issue's resolution.

BEGIN;

-- Sign-in toggle (reciprocal pair, not self-paired)
UPDATE "baseline_action_templates"
SET "reversible" = true, "reverse_template_id" = 'action.enable-user-signin'
WHERE "template_id" = 'action.disable-user-signin';

UPDATE "baseline_action_templates"
SET "reversible" = true, "reverse_template_id" = 'action.disable-user-signin'
WHERE "template_id" = 'action.enable-user-signin';

-- Direct single-user license assign/remove
UPDATE "baseline_action_templates"
SET "reversible" = true, "reverse_template_id" = 'microrem.remove-unused-license'
WHERE "template_id" = 'action.assign-single-license';

UPDATE "baseline_action_templates"
SET "reversible" = true, "reverse_template_id" = 'action.assign-single-license'
WHERE "template_id" = 'microrem.remove-unused-license';

-- Group-based license assign/remove
UPDATE "baseline_action_templates"
SET "reversible" = true, "reverse_template_id" = 'action.group-based-license-remove'
WHERE "template_id" = 'action.group-based-license-assign';

UPDATE "baseline_action_templates"
SET "reversible" = true, "reverse_template_id" = 'action.group-based-license-assign'
WHERE "template_id" = 'action.group-based-license-remove';

-- Group member add/remove (needs the memberId/userId alias special case in
-- workflow-executor.ts - see comment above)
UPDATE "baseline_action_templates"
SET "reversible" = true, "reverse_template_id" = 'microrem.remove-stale-group-member'
WHERE "template_id" = 'action.add-group-member';

UPDATE "baseline_action_templates"
SET "reversible" = true, "reverse_template_id" = 'action.add-group-member'
WHERE "template_id" = 'microrem.remove-stale-group-member';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-03-launch-control-rollback-repromote-2703.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
