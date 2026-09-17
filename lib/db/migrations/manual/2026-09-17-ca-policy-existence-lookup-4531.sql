-- #4531 — the six Conditional Access policy create templates were a bare
-- POST /identity/conditionalAccess/policies with a fixed displayName and no
-- existence check, so every re-run of identity-ca-hardening-v1 or quickstart-v1
-- created another policy with the same name. Data-only: appends one
-- resolve-then-skip lookup (resolve-then-write.ts, #4514) to each template's
-- resolve_steps. No DDL.
--
-- The lookup lists the tenant's CA policies and matches the template's own
-- displayName (case-insensitive, "ieq:"):
--   none  → the POST fires as before
--   two+  → fail closed with every id, no POST (onMatch implies unique)
--   one   → skip the POST ONLY when that policy also meets `skipRequires` (#4531):
--           it is in the same state the template creates (report-only), targets
--           the same users, and — for the five that exclude a break-glass group —
--           its conditions.users.excludeGroups holds the breakGlassGroupId this run
--           resolved. Anything else fails closed (424, no POST): a same-named policy
--           that lacks the exclusion, targets other users, or is already enforced is
--           not the policy this pack creates, and neither skipping onto it nor
--           creating a second one beside it is safe. Grant controls and the
--           template's distinguishing condition (client app types / risk levels) are
--           checked for the same reason.
--
-- Ordering: the four identity-ca-hardening-v1 templates keep #4514's three
-- break-glass steps first, so {{breakGlassGroupId}} is resolved and verified before
-- the existence check reads it. quickstart-v1.create-ca-baseline-policy gets it from
-- parameter_mapping (create-ca-exclusion-group → breakGlassGroupId); unresolved,
-- "has:" matches nothing and the lookup fails closed. guest-mfa targets
-- GuestsOrExternalUsers and excludes no group, so it has no exclusion requirement.
--
-- Idempotent: any existing skip-write step is removed before the new one is appended.
-- Graph read live-verified against the testbed tenant this session (2026-09-17) with
-- the write app token: GET /identity/conditionalAccess/policies?$select=... → 200.

BEGIN;

CREATE TEMP TABLE ca_4531_lookup (template_id text PRIMARY KEY, step jsonb NOT NULL) ON COMMIT DROP;

INSERT INTO ca_4531_lookup (template_id, step) VALUES
('action.create-ca-legacy-auth-block-policy', $json${
  "subject": "an existing \"Baseline: Block Legacy Authentication (report-only)\" Conditional Access policy",
  "endpoint": "/identity/conditionalAccess/policies?$select=id,displayName,state,conditions,grantControls",
  "selectMatch": { "displayName": "ieq:Baseline: Block Legacy Authentication (report-only)" },
  "onMatch": "skip-write",
  "skipRequires": {
    "state": "enabledForReportingButNotEnforced",
    "conditions.users.includeUsers": "has:All",
    "conditions.users.excludeGroups": "has:{{breakGlassGroupId}}",
    "conditions.clientAppTypes": "has:exchangeActiveSync,other",
    "grantControls.builtInControls": "has:block"
  },
  "assign": {}
}$json$::jsonb),
('action.create-ca-mfa-all-users-policy', $json${
  "subject": "an existing \"Baseline: Require MFA for All Users (report-only)\" Conditional Access policy",
  "endpoint": "/identity/conditionalAccess/policies?$select=id,displayName,state,conditions,grantControls",
  "selectMatch": { "displayName": "ieq:Baseline: Require MFA for All Users (report-only)" },
  "onMatch": "skip-write",
  "skipRequires": {
    "state": "enabledForReportingButNotEnforced",
    "conditions.users.includeUsers": "has:All",
    "conditions.users.excludeGroups": "has:{{breakGlassGroupId}}",
    "grantControls.builtInControls": "has:mfa"
  },
  "assign": {}
}$json$::jsonb),
('action.create-ca-signin-risk-policy', $json${
  "subject": "an existing \"Baseline: Require MFA on Sign-In Risk (report-only)\" Conditional Access policy",
  "endpoint": "/identity/conditionalAccess/policies?$select=id,displayName,state,conditions,grantControls",
  "selectMatch": { "displayName": "ieq:Baseline: Require MFA on Sign-In Risk (report-only)" },
  "onMatch": "skip-write",
  "skipRequires": {
    "state": "enabledForReportingButNotEnforced",
    "conditions.users.includeUsers": "has:All",
    "conditions.users.excludeGroups": "has:{{breakGlassGroupId}}",
    "conditions.signInRiskLevels": "has:high,medium",
    "grantControls.builtInControls": "has:mfa"
  },
  "assign": {}
}$json$::jsonb),
('action.create-ca-user-risk-policy', $json${
  "subject": "an existing \"Baseline: Secure Password Change on User Risk (report-only)\" Conditional Access policy",
  "endpoint": "/identity/conditionalAccess/policies?$select=id,displayName,state,conditions,grantControls",
  "selectMatch": { "displayName": "ieq:Baseline: Secure Password Change on User Risk (report-only)" },
  "onMatch": "skip-write",
  "skipRequires": {
    "state": "enabledForReportingButNotEnforced",
    "conditions.users.includeUsers": "has:All",
    "conditions.users.excludeGroups": "has:{{breakGlassGroupId}}",
    "conditions.userRiskLevels": "has:high",
    "grantControls.builtInControls": "has:passwordChange,mfa"
  },
  "assign": {}
}$json$::jsonb),
('action.create-ca-guest-mfa-policy', $json${
  "subject": "an existing \"Baseline: Require MFA for Guests (report-only)\" Conditional Access policy",
  "endpoint": "/identity/conditionalAccess/policies?$select=id,displayName,state,conditions,grantControls",
  "selectMatch": { "displayName": "ieq:Baseline: Require MFA for Guests (report-only)" },
  "onMatch": "skip-write",
  "skipRequires": {
    "state": "enabledForReportingButNotEnforced",
    "conditions.users.includeUsers": "has:GuestsOrExternalUsers",
    "grantControls.builtInControls": "has:mfa"
  },
  "assign": {}
}$json$::jsonb),
('quickstart-v1.create-ca-baseline-policy', $json${
  "subject": "an existing \"Quick-Start Baseline: Require MFA for All Users\" Conditional Access policy",
  "endpoint": "/identity/conditionalAccess/policies?$select=id,displayName,state,conditions,grantControls",
  "selectMatch": { "displayName": "ieq:Quick-Start Baseline: Require MFA for All Users" },
  "onMatch": "skip-write",
  "skipRequires": {
    "state": "enabledForReportingButNotEnforced",
    "conditions.users.includeUsers": "has:All",
    "conditions.users.excludeGroups": "has:{{breakGlassGroupId}}",
    "grantControls.builtInControls": "has:mfa"
  },
  "assign": {}
}$json$::jsonb);

UPDATE baseline_action_templates t
   SET resolve_steps = COALESCE(
         (SELECT jsonb_agg(e ORDER BY ord)
            FROM jsonb_array_elements(t.resolve_steps) WITH ORDINALITY AS x(e, ord)
           WHERE e->>'onMatch' IS DISTINCT FROM 'skip-write'),
         '[]'::jsonb
       ) || jsonb_build_array(l.step),
       updated_at = now()
  FROM ca_4531_lookup l
 WHERE t.template_id = l.template_id;

-- Verification — the four break-glass CA templates carry 4 steps, the other two 1,
-- and each ends in the skip-write lookup.
SELECT template_id,
       jsonb_array_length(resolve_steps) AS steps,
       resolve_steps->-1->>'onMatch' AS last_step
  FROM baseline_action_templates
 WHERE template_id IN (SELECT template_id FROM ca_4531_lookup)
 ORDER BY template_id;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-17-ca-policy-existence-lookup-4531.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
