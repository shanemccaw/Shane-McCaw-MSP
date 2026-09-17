-- #4522 — CA enforcement mode (monitor-first default, explicit "immediate" override)
-- and the report-only → enabled promotion audit trail. Shane's decision on #4518:
-- CA policies are created report-only unless explicitly overridden; promotion to
-- enforced only after real sign-in impact has been verified.
--
-- 1. The six Conditional Access create templates hard-coded
--    "state": "enabledForReportingButNotEnforced". They now resolve
--    "{{caPolicyState}}", which the Config Pack orchestrator stamps from the run's
--    caEnforcementMode (monitor-first → report-only, immediate → enabled) and every
--    other caller defaults to report-only (resolveBaselineTemplateRequest).
--
-- 2. #4531's existence lookup skipped onto a same-named policy only when it was
--    still report-only. After a policy is PROMOTED through the #4522 workflow, that
--    rule failed every later re-run of the pack closed (424) on the very policy the
--    pack created. A same-named policy that is report-only OR enabled — with every
--    other skipRequires condition still met — is the pack's own policy; skip onto it.
--    A disabled one still fails closed. Nothing is ever flipped by a re-run: an
--    "immediate" run that finds its policy still report-only skips it (it does not
--    silently enforce it); promotion stays the workflow's job.
--
-- 3. ca_policy_promotions — who promoted which policy, when, on what reviewed impact.
--
-- Additive / data-only for the templates. Idempotent.

BEGIN;

UPDATE baseline_action_templates
SET body_template = jsonb_set(body_template, '{state}', '"{{caPolicyState}}"'::jsonb),
    updated_at = now()
WHERE template_id IN (
  'action.create-ca-legacy-auth-block-policy',
  'action.create-ca-mfa-all-users-policy',
  'action.create-ca-signin-risk-policy',
  'action.create-ca-user-risk-policy',
  'action.create-ca-guest-mfa-policy',
  'quickstart-v1.create-ca-baseline-policy'
)
  AND body_template->>'state' = 'enabledForReportingButNotEnforced';

UPDATE baseline_action_templates t
SET resolve_steps = (
      SELECT jsonb_agg(
               CASE
                 WHEN s.step->>'onMatch' = 'skip-write'
                      AND s.step->'skipRequires'->>'state' = 'enabledForReportingButNotEnforced'
                 THEN jsonb_set(s.step, '{skipRequires,state}', '"in:enabledForReportingButNotEnforced,enabled"'::jsonb)
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
  'action.create-ca-guest-mfa-policy',
  'quickstart-v1.create-ca-baseline-policy'
)
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(t.resolve_steps) e
    WHERE e->>'onMatch' = 'skip-write' AND e->'skipRequires'->>'state' = 'enabledForReportingButNotEnforced'
  );

CREATE TABLE IF NOT EXISTS ca_policy_promotions (
  id                     serial PRIMARY KEY,
  msp_id                 integer NOT NULL,
  customer_id            integer NOT NULL,
  tenant_id              text NOT NULL,
  policy_id              text NOT NULL,
  policy_display_name    text,
  previous_state         text,
  new_state              text NOT NULL,
  outcome                text NOT NULL,
  outcome_reason         text,
  impact_fingerprint     text,
  impact_snapshot        jsonb,
  impact_acknowledged    boolean NOT NULL DEFAULT false,
  operator_note          text,
  actor_user_id          integer,
  actor_name             text,
  actor_role             text,
  change_request_id      integer,
  template_audit_log_id  integer,
  created_at             timestamptz NOT NULL DEFAULT now(),
  completed_at           timestamptz
);

CREATE INDEX IF NOT EXISTS ca_policy_promotions_customer_idx ON ca_policy_promotions (customer_id, created_at);
CREATE INDEX IF NOT EXISTS ca_policy_promotions_policy_idx ON ca_policy_promotions (tenant_id, policy_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-17-ca-enforcement-mode-and-promotions-4522.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
