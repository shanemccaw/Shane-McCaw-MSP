-- #4549 — the "(report-only)" suffix baked into five of the six CA baseline
-- create templates' displayName never got updated when a policy's real state
-- changed: an "immediate" mode run creates the policy already `enabled` but its
-- name still says report-only; the #4522 promotion workflow (action.set-ca-policy-state,
-- PATCH {state} only) flips report-only -> enabled and leaves the name unchanged.
--
-- Fix, data-only, no DDL:
--
-- 1. Strip " (report-only)" from the five templates' body_template.displayName.
--    State (already the real source of truth everywhere else — see `reportOnly`
--    in ca-policy-promotion.ts) is what tells an admin whether a policy is
--    enforcing; the name no longer needs to say so, and so never needs to lie
--    again after an immediate create or a promotion.
--      action.create-ca-legacy-auth-block-policy
--      action.create-ca-mfa-all-users-policy
--      action.create-ca-signin-risk-policy
--      action.create-ca-user-risk-policy
--      action.create-ca-guest-mfa-policy
--    (quickstart-v1.create-ca-baseline-policy never had the suffix.)
--
-- 2. action.set-ca-policy-state's body_template gains a `displayName` field, PATCHed
--    alongside `state`, so promoteCaPolicy (ca-policy-promotion.ts, #4549) can rename
--    an already-existing policy that still carries the stale suffix. required_params
--    gains "displayName" to match.
--
-- 3. Each of the five templates' #4531/#4522 skip-write existence lookup matched an
--    EXACT displayName (`ieq:<name>`). Now that the template body's own name changed,
--    a bare rename would make the next pack run fail to recognize its own
--    already-created (pre-#4549, still-suffixed) policy and create a duplicate.
--    Widen the match to resolve-then-write.ts's `in:a,b` convention (case-insensitive
--    membership) so a re-run recognizes its policy under EITHER the legacy suffixed
--    name (not yet promoted/renamed) or the new clean name (freshly created by this
--    template post-#4549, or renamed by step 2's promotion PATCH).
--
-- Idempotent: every UPDATE is qualified on the pre-#4549 shape, so a second run is a
-- no-op.

BEGIN;

-- 1. Strip the suffix from each affected template's own create body.
UPDATE baseline_action_templates
SET body_template = jsonb_set(
      body_template,
      '{displayName}',
      to_jsonb(regexp_replace(body_template->>'displayName', '\s*\(report-only\)\s*$', '', 'i')),
      false
    ),
    updated_at = now()
WHERE template_id IN (
  'action.create-ca-legacy-auth-block-policy',
  'action.create-ca-mfa-all-users-policy',
  'action.create-ca-signin-risk-policy',
  'action.create-ca-user-risk-policy',
  'action.create-ca-guest-mfa-policy'
)
  AND body_template->>'displayName' ~* '\(report-only\)\s*$';

-- 2. action.set-ca-policy-state PATCHes displayName alongside state.
UPDATE baseline_action_templates
SET body_template = body_template || '{"displayName": "{{displayName}}"}'::jsonb,
    required_variables = CASE
      WHEN required_variables @> '["displayName"]'::jsonb THEN required_variables
      ELSE required_variables || '["displayName"]'::jsonb
    END,
    updated_at = now()
WHERE template_id = 'action.set-ca-policy-state'
  AND NOT (body_template ? 'displayName');

-- 3. Widen the five templates' skip-write lookup to match either name.
UPDATE baseline_action_templates t
SET resolve_steps = (
      SELECT jsonb_agg(
               CASE
                 WHEN s.step->>'onMatch' = 'skip-write'
                      AND s.step->'selectMatch'->>'displayName' LIKE 'ieq:%(report-only)'
                 THEN jsonb_set(
                        s.step,
                        '{selectMatch,displayName}',
                        to_jsonb(
                          'in:' ||
                          regexp_replace(substring(s.step->'selectMatch'->>'displayName' from 5), '\s*\(report-only\)\s*$', '', 'i') ||
                          ',' ||
                          substring(s.step->'selectMatch'->>'displayName' from 5)
                        )
                      )
                 ELSE s.step
               END
               ORDER BY s.ord)
      FROM jsonb_array_elements(t.resolve_steps) WITH ORDINALITY AS s(step, ord)
    ),
    updated_at = now()
WHERE t.template_id IN (
  'action.create-ca-legacy-auth-block-policy',
  'action.create-ca-mfa-all-users-policy',
  'action.create-ca-signin-risk-policy',
  'action.create-ca-user-risk-policy',
  'action.create-ca-guest-mfa-policy'
)
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(t.resolve_steps) e
    WHERE e->>'onMatch' = 'skip-write' AND e->'selectMatch'->>'displayName' LIKE 'ieq:%(report-only)'
  );

-- Verification
SELECT template_id, body_template->>'displayName' AS create_display_name
  FROM baseline_action_templates
 WHERE template_id IN (
   'action.create-ca-legacy-auth-block-policy',
   'action.create-ca-mfa-all-users-policy',
   'action.create-ca-signin-risk-policy',
   'action.create-ca-user-risk-policy',
   'action.create-ca-guest-mfa-policy'
 )
 ORDER BY template_id;

SELECT template_id, resolve_steps->-1->'selectMatch'->>'displayName' AS lookup_display_match
  FROM baseline_action_templates
 WHERE template_id IN (
   'action.create-ca-legacy-auth-block-policy',
   'action.create-ca-mfa-all-users-policy',
   'action.create-ca-signin-risk-policy',
   'action.create-ca-user-risk-policy',
   'action.create-ca-guest-mfa-policy'
 )
 ORDER BY template_id;

SELECT template_id, body_template, required_variables
  FROM baseline_action_templates
 WHERE template_id = 'action.set-ca-policy-state';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-17-ca-report-only-suffix-rename-4549.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
