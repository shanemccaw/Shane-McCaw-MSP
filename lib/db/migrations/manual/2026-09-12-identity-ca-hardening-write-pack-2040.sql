-- #2040 — Phase 2 (fan-out from #1925): author write packs for the uncovered
-- Identity / Conditional-Access checks — the largest uncovered domain and the
-- one with the most lockout risk.
--
-- WHY. After #1925 Phase 1 mapped every EXISTING execution-ready template to its
-- check, 5 identity:* checks had a mapped remediation (b2b-collaboration-settings,
-- break-glass-health, ca-report-only, mfa-registration, named-locations). The
-- Conditional-Access family that actually hardens sign-in — block legacy auth,
-- require MFA, sign-in/user risk, guest MFA — had NO automation: no template
-- creates the policy each of those checks reads, so none could reach we_can_run.
-- This authors those 5 CA-policy-creation writes as baseline_action_templates and
-- binds them to their checks in a new themed pack.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- SAFETY MODEL — READ THIS BEFORE ANYONE EVER APPLIES ONE OF THESE.
--
-- Every policy authored here is created in state
-- `enabledForReportingButNotEnforced` (report-only) and, for every policy that
-- targets internal users, EXCLUDES a break-glass group ({{breakGlassGroupId}}).
-- A report-only Conditional Access policy is evaluated and logged but NEVER
-- enforced — it cannot lock anyone out. This is the deliberate, safest possible
-- authored form for this lockout-critical domain: creating the policy is a real,
-- runnable remediation step the platform can execute, and PROMOTING it to
-- enforced (`state: enabled`) is a SEPARATE, human-reviewed step — the already-
-- existing `microrem.enforce-ca-policy` template (PATCH {state:enabled}). In THIS
-- platform's tenant (mccawsoft2.onmicrosoft.com is Shane's real M365 tenant, not a
-- sandbox) that enable step is a #1281 release-gate decision, never an agent apply.
-- Consequently these 5 checks reach we_can_run for the CREATE step only; the
-- ceiling is set honestly — the create is automatable, the enforce is gated.
--
-- HARD CONSTRAINT (carried from #1925 Phase 3, non-negotiable): this migration
-- only AUTHORS templates + pack mappings. It applies NOTHING to any tenant. All
-- testbed validation of these packs is planOnly dry-run — no CA policy was, or is
-- to be, created against the live tenant by this build.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- MICROSOFT GRAPH v1.0 DOCS FETCHED THIS SESSION (2026-09-12), not recalled —
-- every shape below is verbatim from these pages:
--   Create conditionalAccessPolicy ... https://learn.microsoft.com/en-us/graph/api/conditionalaccessroot-post-policies
--        POST /identity/conditionalAccess/policies  -> 201 Created  (Policy.ReadWrite.ConditionalAccess)
--   conditionalAccessPolicy (state) .. https://learn.microsoft.com/en-us/graph/api/resources/conditionalaccesspolicy
--        state enum: enabled | disabled | enabledForReportingButNotEnforced (report-only)
--   conditionalAccessConditionSet .... https://learn.microsoft.com/en-us/graph/api/resources/conditionalaccessconditionset
--        clientAppTypes: all|browser|mobileAppsAndDesktopClients|exchangeActiveSync|easSupported|other
--          (legacy auth = ["exchangeActiveSync","other"])
--        signInRiskLevels / userRiskLevels: low|medium|high|hidden|none|unknownFutureValue
--   conditionalAccessUsers ........... https://learn.microsoft.com/en-us/graph/api/resources/conditionalaccessusers
--        includeUsers accepts the literals "All", "None", "GuestsOrExternalUsers"
--   conditionalAccessGrantControls ... https://learn.microsoft.com/en-us/graph/api/resources/conditionalaccessgrantcontrols
--        operator: AND|OR ; builtInControls: block|mfa|compliantDevice|passwordChange|...
--        DOCUMENTED CONSTRAINT for passwordChange (used by the user-risk policy):
--          passwordChange MUST be combined with mfa via operator AND; the policy
--          MUST contain userRiskLevels; and it may contain ONLY users,
--          applications and userRiskLevels conditions (hence NO clientAppTypes on
--          the user-risk policy body below — intentional, per the doc).
--
-- TYPED-BODY NOTE (same as #1925). resolveBaselineTemplateRequest() JSON-stringifies
-- body_template, string-substitutes {{var}}, then JSON.parses — so a {{var}} only
-- ever binds a STRING. The only variable here is {{breakGlassGroupId}} (a group
-- GUID, genuinely a string, inside a string array) — no numeric substitution, so
-- no typing hazard. Every other value is a hardcoded literal.
--
-- reversible=false / reverse_template_id=NULL on all 5: the reverse of a create is
-- action.delete-ca-policy, but that needs the CREATED policy's id (unknown at author
-- time), so no explicit single-step reverse is authored here — the documented
-- 6-template reverse count is not inflated.
--
-- requires_verification_gate=false on all 5: the verification gate mechanism
-- (config-pack-graph.ts) splices in a BREAK-GLASS SECRET gate that expects a
-- generatedPassword in the run payload; these CA creates produce no such secret, so
-- flagging the gate would hard-fail the pack. Correct value is false.
--
-- identity:legacy-auth-usage is remediated by the SAME "block legacy auth" policy as
-- identity:ca-legacy-auth-block. It is intentionally NOT separately mapped here:
-- a duplicate template_id inside one pack collapses the pack graph (getStepId keys
-- on template_id — config-pack-graph.ts:176/182), and giving it a second identical
-- template would make the platform offer to create TWO identical block policies. Per
-- #1925's discipline (a wrong/duplicative map is worse than the gap), legacy-auth-usage
-- is left unmapped and its shared remediation is documented on the issue.
--
-- IDEMPOTENT. Templates upsert on their unique template_id (DO NOTHING); the pack
-- upserts on its unique pack_key; the 5 mapping rows insert only WHERE NOT EXISTS for
-- (pack_id, check_key). A re-run writes nothing. Additive; reversible by deleting
-- these rows. All 5 target check_keys exist in monitor_checks (FK satisfied).

BEGIN;

-- ── 1. The five Conditional-Access write templates (all report-only) ──────────
INSERT INTO baseline_action_templates
  (template_id, label, description, category, endpoint, method, body_template, required_variables, success_criteria, status, reversible, requires_verification_gate)
VALUES
  ('action.create-ca-legacy-auth-block-policy',
   'Create CA Policy: Block Legacy Authentication',
   'Creates a Conditional Access policy that blocks legacy (non-modern) authentication for all users via POST /identity/conditionalAccess/policies. Created in REPORT-ONLY state (enabledForReportingButNotEnforced) and excludes the break-glass group {{breakGlassGroupId}}, so it cannot lock anyone out; promoting it to enforced is the separate microrem.enforce-ca-policy step. Remediates identity:ca-legacy-auth-block (and, by the same policy, identity:legacy-auth-usage). Ref: https://learn.microsoft.com/en-us/graph/api/conditionalaccessroot-post-policies',
   'security', '/identity/conditionalAccess/policies', 'POST',
   '{"displayName": "Baseline: Block Legacy Authentication (report-only)", "state": "enabledForReportingButNotEnforced", "conditions": {"clientAppTypes": ["exchangeActiveSync", "other"], "applications": {"includeApplications": ["All"]}, "users": {"includeUsers": ["All"], "excludeGroups": ["{{breakGlassGroupId}}"]}}, "grantControls": {"operator": "OR", "builtInControls": ["block"]}}'::jsonb,
   '["breakGlassGroupId"]'::jsonb, '{"expectStatus": 201}'::jsonb, 'active', false, false),

  ('action.create-ca-mfa-all-users-policy',
   'Create CA Policy: Require MFA for All Users',
   'Creates a Conditional Access policy requiring multifactor authentication for all users on all cloud apps via POST /identity/conditionalAccess/policies. Created in REPORT-ONLY state and excludes the break-glass group {{breakGlassGroupId}}, so it cannot lock anyone out; promoting it to enforced is the separate microrem.enforce-ca-policy step. Remediates identity:ca-mfa-coverage. Ref: https://learn.microsoft.com/en-us/graph/api/conditionalaccessroot-post-policies',
   'security', '/identity/conditionalAccess/policies', 'POST',
   '{"displayName": "Baseline: Require MFA for All Users (report-only)", "state": "enabledForReportingButNotEnforced", "conditions": {"clientAppTypes": ["all"], "applications": {"includeApplications": ["All"]}, "users": {"includeUsers": ["All"], "excludeGroups": ["{{breakGlassGroupId}}"]}}, "grantControls": {"operator": "OR", "builtInControls": ["mfa"]}}'::jsonb,
   '["breakGlassGroupId"]'::jsonb, '{"expectStatus": 201}'::jsonb, 'active', false, false),

  ('action.create-ca-signin-risk-policy',
   'Create CA Policy: Require MFA on Sign-In Risk',
   'Creates a sign-in-risk-based Conditional Access policy requiring MFA when sign-in risk is medium or high, via POST /identity/conditionalAccess/policies. Created in REPORT-ONLY state and excludes the break-glass group {{breakGlassGroupId}}, so it cannot lock anyone out; promoting it to enforced is the separate microrem.enforce-ca-policy step. Requires Microsoft Entra ID P2 to evaluate risk. Remediates identity:signin-risk-policy. Ref: https://learn.microsoft.com/en-us/graph/api/conditionalaccessroot-post-policies',
   'security', '/identity/conditionalAccess/policies', 'POST',
   '{"displayName": "Baseline: Require MFA on Sign-In Risk (report-only)", "state": "enabledForReportingButNotEnforced", "conditions": {"signInRiskLevels": ["high", "medium"], "clientAppTypes": ["all"], "applications": {"includeApplications": ["All"]}, "users": {"includeUsers": ["All"], "excludeGroups": ["{{breakGlassGroupId}}"]}}, "grantControls": {"operator": "OR", "builtInControls": ["mfa"]}}'::jsonb,
   '["breakGlassGroupId"]'::jsonb, '{"expectStatus": 201}'::jsonb, 'active', false, false),

  ('action.create-ca-user-risk-policy',
   'Create CA Policy: Require Secure Password Change on User Risk',
   'Creates a user-risk-based Conditional Access policy requiring a secure password change (passwordChange AND mfa) when user risk is high, via POST /identity/conditionalAccess/policies. Created in REPORT-ONLY state and excludes the break-glass group {{breakGlassGroupId}}, so it cannot lock anyone out; promoting it to enforced is the separate microrem.enforce-ca-policy step. Body carries only users/applications/userRiskLevels conditions per the documented passwordChange constraint. Requires Microsoft Entra ID P2. Remediates identity:user-risk-policy. Ref: https://learn.microsoft.com/en-us/graph/api/resources/conditionalaccessgrantcontrols',
   'security', '/identity/conditionalAccess/policies', 'POST',
   '{"displayName": "Baseline: Secure Password Change on User Risk (report-only)", "state": "enabledForReportingButNotEnforced", "conditions": {"userRiskLevels": ["high"], "applications": {"includeApplications": ["All"]}, "users": {"includeUsers": ["All"], "excludeGroups": ["{{breakGlassGroupId}}"]}}, "grantControls": {"operator": "AND", "builtInControls": ["passwordChange", "mfa"]}}'::jsonb,
   '["breakGlassGroupId"]'::jsonb, '{"expectStatus": 201}'::jsonb, 'active', false, false),

  ('action.create-ca-guest-mfa-policy',
   'Create CA Policy: Require MFA for Guests',
   'Creates a Conditional Access policy requiring MFA for all guest and external users on all cloud apps via POST /identity/conditionalAccess/policies. Created in REPORT-ONLY state. Scoped to guests/external users only (includeUsers ["GuestsOrExternalUsers"]) — internal break-glass accounts are out of scope by construction, so no break-glass exclusion is needed. Remediates identity:guest-mfa-enforcement. Ref: https://learn.microsoft.com/en-us/graph/api/resources/conditionalaccessusers',
   'security', '/identity/conditionalAccess/policies', 'POST',
   '{"displayName": "Baseline: Require MFA for Guests (report-only)", "state": "enabledForReportingButNotEnforced", "conditions": {"clientAppTypes": ["all"], "applications": {"includeApplications": ["All"]}, "users": {"includeUsers": ["GuestsOrExternalUsers"]}}, "grantControls": {"operator": "OR", "builtInControls": ["mfa"]}}'::jsonb,
   '[]'::jsonb, '{"expectStatus": 201}'::jsonb, 'active', false, false)
ON CONFLICT (template_id) DO NOTHING;

-- ── 2. The themed pack ───────────────────────────────────────────────────────
INSERT INTO config_packs (pack_key, label, description, categories, status)
VALUES
  ('identity-ca-hardening-v1', 'Conditional Access Hardening Baseline',
   'Creates the core sign-in hardening Conditional Access policies — block legacy authentication, require MFA for all users, require MFA on sign-in risk, secure password change on user risk, and require MFA for guests. Every policy is created report-only with the break-glass group excluded; enabling enforcement is a separate reviewed step.',
   ARRAY['Identity','Security'], 'active')
ON CONFLICT (pack_key) DO NOTHING;

-- ── 3. Bind each template to the check it remediates ─────────────────────────
INSERT INTO config_pack_templates (pack_id, template_id, check_key, sort_order)
SELECT cp.id, v.template_id, v.check_key, v.sort_order
  FROM config_packs cp
  CROSS JOIN (VALUES
    ('action.create-ca-legacy-auth-block-policy', 'identity:ca-legacy-auth-block',  1),
    ('action.create-ca-mfa-all-users-policy',     'identity:ca-mfa-coverage',       2),
    ('action.create-ca-signin-risk-policy',       'identity:signin-risk-policy',    3),
    ('action.create-ca-user-risk-policy',         'identity:user-risk-policy',      4),
    ('action.create-ca-guest-mfa-policy',         'identity:guest-mfa-enforcement', 5)
  ) AS v(template_id, check_key, sort_order)
 WHERE cp.pack_key = 'identity-ca-hardening-v1'
   AND NOT EXISTS (
     SELECT 1 FROM config_pack_templates x
      WHERE x.pack_id = cp.id AND x.check_key = v.check_key
   );

-- Verification — the pack, its five templates, and the new we_can_run total.
SELECT cp.pack_key, cpt.sort_order, cpt.template_id, cpt.check_key
  FROM config_pack_templates cpt JOIN config_packs cp ON cp.id = cpt.pack_id
 WHERE cp.pack_key = 'identity-ca-hardening-v1' ORDER BY cpt.sort_order;

SELECT count(DISTINCT cpt.check_key) AS we_can_run_checks
  FROM config_pack_templates cpt JOIN config_packs cp ON cp.id = cpt.pack_id
 WHERE cpt.check_key IS NOT NULL AND cpt.template_id IS NOT NULL AND cp.status = 'active';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-12-identity-ca-hardening-write-pack-2040.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
