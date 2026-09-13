-- 2026-09-13-per-user-mfa-disable-template-and-catalog-relink-3939.sql
-- Git #3939 (Feature #2494) -- write_action_catalog row 115 ("Enable/disable
-- per-user MFA (legacy)") was left blocked_no_workaround by #2702 even though
-- a real, active, unlinked baseline_action_templates row
-- (action.enforce-per-user-mfa) already implements the modern Graph
-- replacement -- it just only covered the "enable" direction.
--
-- Step 1 dependency check (confirmed against local DATABASE_URL this session):
--   action.enforce-per-user-mfa IS in live use --
--     config_pack_templates id=156, pack_id=54 ('mfa-enforcement-v1', the real
--     $299 "MFA Enforcement Pack" sellable product, seeded by
--     2026-08-26-mfa-enforcement-pack-1182.sql).
--   Per the issue's own instruction, its body_template is therefore left
--   completely untouched here -- a SECOND template covers the "disable"
--   direction instead of parameterizing/editing the existing one.
--
-- Step 2 -- the "disable" direction: a new, independent template,
-- action.disable-per-user-mfa, hitting the SAME real Graph endpoint
-- (PATCH /users/{{userId}}/authentication/requirements) with
-- perUserMfaState: "disabled" instead of "enforced". Both templates require
-- only ["userId"], so they pair through the EXISTING, already-built
-- rollback/reverse-template mechanism (workflow-executor.ts
-- rollbackExecution(), generic "replay the paired reverse template with the
-- same captured requestVariables" branch -- no special-casing needed, since
-- neither the self-paired-toggle nor the memberId/userId-alias special cases
-- apply here) rather than needing a second write_action_catalog column that
-- doesn't exist. This is metadata only (reversible/reverse_template_id) on
-- the existing row -- its body_template, endpoint, method, and everything
-- config_pack_templates id=156 actually executes stay byte-for-byte
-- unchanged, so the live MFA Enforcement Pack is unaffected.
--
-- Step 3 (REVISED after live-test, same session) -- row 115 was NOT promoted
-- to execution_ready. Live-testing both directions against the real testbed
-- tenant (this issue's own required step, before calling it done) via
-- POST /api/admin/write-actions/action.enforce-per-user-mfa/execute and
-- .../action.disable-per-user-mfa/execute (the real runBaselineTemplateAgainstTenant()
-- engine, target: the sanctioned Git #2840 synthetic identity
-- zz-test-graphwrite-01@mccawsoft2.onmicrosoft.com,
-- objectId bdb21dc3-146a-4d97-a128-a2b8ff618d35) revealed that
-- PATCH /users/{{userId}}/authentication/requirements is NOT a real
-- Microsoft Graph resource: both calls came back
-- {"error":{"code":"BadRequest","message":"Resource not found for the
-- segment 'requirements'."}}, durably recorded as real failures in
-- baseline_action_template_audit_log ids 49 (enforce) and 50 (disable). Both
-- templates fail identically and symmetrically, proving the pairing itself
-- is correct and the failure is the endpoint, not either template's own
-- substitution. This is a PRE-EXISTING defect in action.enforce-per-user-mfa
-- (already status='active', already linked into the live, sold $299 "MFA
-- Enforcement Pack" since #1182) -- not something this migration introduces.
--
-- Telling an MSP technician in Launch Control that this action is
-- execution_ready when it demonstrably 400s against a real tenant every time
-- would be worse than leaving it blocked, so row 115 stays
-- blocked_no_workaround, with blocked_reason now naming the real cause and
-- the filed finding (#3951, sibling sub-issue of this build's own Feature
-- #2494) instead of the previous empty reason. Fixing the underlying
-- endpoint (or re-scoping the pack onto Conditional Access, which appears to
-- be Microsoft's only real current mechanism for this) is real, undone
-- research/product work tracked there -- out of scope for this relink.
--
-- The two new baseline_action_templates rows themselves are left status='active'
-- (matching the pre-existing convention of that table -- 'active' there means
-- "a real definition exists, not archived," not "verified working over Graph";
-- unilaterally archiving the already-sold action.enforce-per-user-mfa is a
-- product/money decision for #3951 to carry, not this migration's to make).
--
-- Idempotent: the new template upserts on template_id; the catalog UPDATE is
-- guarded by id + domain + action_name.

BEGIN;

-- 1. New write-action template: the "disable" direction, same real Graph
--    endpoint, independent of action.enforce-per-user-mfa's body.
INSERT INTO baseline_action_templates
  (template_id, label, description, category, endpoint, method,
   body_template, required_variables, success_criteria, depends_on,
   requires_verification_gate, reversible, reverse_template_id, status)
VALUES
  ('action.disable-per-user-mfa',
   'Disable Per-User MFA',
   'Clears the account''s per-user MFA enforcement via the real Graph authentication/requirements API (perUserMfaState: "disabled") -- the real reverse of action.enforce-per-user-mfa, for undoing an enforcement that was applied in error or is no longer wanted.',
   'identity',
   '/users/{{userId}}/authentication/requirements',
   'PATCH',
   '{"perUserMfaState": "disabled"}'::jsonb,
   '["userId"]'::jsonb,
   '{"expectStatus": 204}'::jsonb,
   '[]'::jsonb,
   true,   -- requires_verification_gate: same posture as its paired enforce template
   true,   -- reversible: pairs back to action.enforce-per-user-mfa
   'action.enforce-per-user-mfa',
   'active')
ON CONFLICT (template_id) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  endpoint = EXCLUDED.endpoint,
  method = EXCLUDED.method,
  body_template = EXCLUDED.body_template,
  required_variables = EXCLUDED.required_variables,
  success_criteria = EXCLUDED.success_criteria,
  requires_verification_gate = EXCLUDED.requires_verification_gate,
  reversible = EXCLUDED.reversible,
  reverse_template_id = EXCLUDED.reverse_template_id,
  updated_at = now();

-- 2. Pair the existing, in-use template back to its new reverse. Metadata
--    only (reversible + reverse_template_id) -- body_template, endpoint,
--    method, required_variables, success_criteria are NOT touched, so
--    config_pack_templates id=156 (the live MFA Enforcement Pack) executes
--    exactly the same request it always has.
UPDATE baseline_action_templates
SET reversible = true,
    reverse_template_id = 'action.disable-per-user-mfa',
    updated_at = now()
WHERE template_id = 'action.enforce-per-user-mfa';

-- 3. Row 115 stays blocked_no_workaround (see the header note above) -- the
--    template_id is recorded (documents which real template was evaluated
--    and found broken) but status is deliberately NOT promoted, and
--    blocked_reason now names the real, live-verified cause instead of
--    being empty.
UPDATE write_action_catalog
SET template_id = 'action.enforce-per-user-mfa',
    status = 'blocked_no_workaround',
    blocked_reason = 'action.enforce-per-user-mfa (the modern Graph replacement candidate) live-fails: PATCH /users/{userId}/authentication/requirements is not a real Graph resource (confirmed 400 "Resource not found for the segment ''requirements''" against the real testbed tenant, audit log ids 49/50). See Git #3951.'
WHERE id = 115
  AND domain = 'Auth/MFA'
  AND action_name = 'Enable/disable per-user MFA (legacy)';

-- Self-mark this migration as run (Simulator Studio Migrations tree, #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-13-per-user-mfa-disable-template-and-catalog-relink-3939.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
