-- Git #2494 -- Launch Control Phase 3, second batch: promote the real remaining gap,
-- Users domain first, per #2494's own Phase 3 instruction.
--
-- Live reconcile at session start (2026-09-13): write_action_catalog is 123 total /
-- 84 linked / 84 execution_ready (#2702 on 2026-09-03 left it at 85/85 -- immaterial
-- 1-row drift, not chased). 39 rows are unlinked (7 legitimately blocked/blocked_no_
-- workaround, 32 genuinely uncovered). Of those 32, only 4 are in the Users domain
-- (93, 100, 108, 109) -- Users is nearly exhausted, not a 5-10-row domain right now.
--
-- Investigated all 4 Users-domain gaps individually rather than forcing links:
--   93  Permanently purge deleted user  -> BUILDABLE, real Graph DELETE. Promoted below.
--   100 Add/remove email alias         -> NOT buildable today. Exchange/Entra alias
--       management (proxyAddresses) is not PATCHable via Graph's /users endpoint --
--       it is Exchange-Online-PowerShell-only (Set-Mailbox -EmailAddresses), the same
--       "exchange-online://" pseudo-scheme already used by 13 other 'active' templates
--       (e.g. action.convert-user-to-shared-mailbox) -- and runBaselineTemplateAgainstTenant()
--       -> graphWriteForTenant() has NO handling for that scheme; it only ever calls
--       Microsoft Graph over HTTP. Confirmed by reading graph.ts:1041-1096 and grepping
--       workflow-executor.ts for "exchange-online" (zero hits). Filed as its own finding
--       (see bookend/issue list) rather than authoring a template that cannot execute.
--       Left unlinked, status unchanged.
--   108 Bulk CSV import                -> NOT buildable today. This is a multi-row
--       orchestration action (loop over CSV rows, each its own Graph call), and
--       baseline_action_templates models exactly one {endpoint, method, body} call per
--       template -- the same single-call limitation runForceMfaReregistrationAgainstTenant
--       and runRemoveAuthMethodAgainstTenant were special-cased in workflow-executor.ts
--       to work around (#1899, #2875). A CSV bulk import needs the same kind of
--       dedicated fan-out handler, not a `baseline_action_templates` row. Left unlinked.
--   109 Update user photo             -> NOT buildable today. The real Graph endpoint
--       (PUT /users/{id}/photo/$value) requires a binary image/* body, but
--       graphWriteForTenant() always sends `JSON.stringify(body)` with
--       "Content-Type: application/json" (graph.ts:~1096) -- there is no binary/
--       multipart body path. Left unlinked.
--
-- Given Users domain alone doesn't reach a meaningful batch, extended to the next
-- lowest-risk, highest-value real gaps, using the exact same two techniques #2702
-- already established:
--   (a) NEW templates for actions with a real, well-known, single-call Graph v1.0
--       endpoint (same standard as #2702/#2703 -- no guessed/unverifiable endpoints):
--         122 Licensing "Enable/disable service plan within a license"
--             -> new action.toggle-license-service-plan. Graph's assignLicense is an
--             upsert per skuId keyed by the SKU's complete disabledPlans array (not a
--             delta) -- but action.manage-ca-exclusions already established this
--             codebase's real precedent for that class of limitation: its own
--             body_template embeds a single quoted "{{excludeGroupId}}" inside a
--             one-element JSON array (interp() only substitutes a scalar/JSON value
--             into a fixed template shape stored as valid JSON at rest -- it does not
--             grow an array to an arbitrary caller-supplied length). This template
--             follows the identical, already-established convention: one
--             servicePlanId per call, honestly named singular rather than
--             "disabledPlans" plural, so a technician disabling >1 plan on the same
--             SKU knows to call it more than once and is not misled into thinking a
--             list is accepted in one call.
--         136 Conditional Access "Enable/disable (report-only vs on)"
--             -> new action.set-ca-policy-state. conditionalAccessPolicy.state is a
--             real, documented enum ("enabled"/"disabled"/
--             "enabledForReportingButNotEnforced") -- the exact same three values
--             already hardcoded into action.create-ca-signin-risk-policy /
--             action.create-ca-user-risk-policy's own body_template, confirmed live
--             below. PATCHes the same /identity/conditionalAccess/policies/{{policyId}}
--             resource action.manage-ca-exclusions already uses, just a different field.
--   (b) RELINKS -- real 'active' baseline_action_templates rows that already exist
--       (built by an earlier, unknown session, after #2702's 2026-09-03 audit) but were
--       never linked to their obvious matching catalog row. Found via a real anti-join
--       (`baseline_action_templates LEFT JOIN write_action_catalog ON template_id`
--       WHERE catalog.id IS NULL) that #2702 itself did not have the benefit of running
--       against these 3, since they postdate its audit:
--         139 Conditional Access "Sign-in risk policy" -> action.create-ca-signin-risk-policy
--         140 Conditional Access "User risk policy"    -> action.create-ca-user-risk-policy
--         204 Security (Defender) "Submit file/URL for detonation" -> action.submit-file-detonation
--       Matched by exact label/intent equivalence, same discipline as #2702 -- not
--       vouching for those templates' own internal correctness (not authored in this
--       session), only for the catalog-row <-> template-row correspondence.
--
--   93 Permanently purge deleted user -> new action.purge-deleted-user. Real Graph
--       endpoint, mirrors the already-existing action.restore-deleted-user
--       (POST /directory/deletedItems/{{userId}}/restore) but the destructive
--       counterpart: DELETE /directory/deletedItems/{{userId}} permanently removes a
--       soft-deleted directory object (no restore possible after this call --
--       correctly left "gated" in the catalog, unchanged).
--
-- 141 Conditional Access "Terms of Use policy assignment" was investigated and NOT
-- promoted: real ToU assignment isn't a standalone Graph call against a user/group --
-- it's expressed via a Conditional Access policy's grantControls.termsOfUse referencing
-- a pre-existing identityGovernance/termsOfUse agreement id, which needs real design
-- (does the technician pick an existing agreement? can Launch Control create one?)
-- rather than a one-line template. Left as endpoint_design_pending, matching #2702's own
-- restraint on "Update CA policy" (134, also still untouched here).
--
-- Idempotent: template INSERTs use ON CONFLICT ("template_id") DO NOTHING (matching
-- 2026-07-20-launch-control-phase3-templates.sql); catalog UPDATEs are guarded by
-- id + domain + action_name + "template_id IS NULL" (matching 2702's migration) --
-- safe to re-run.

INSERT INTO "baseline_action_templates"
  ("template_id", "label", "description", "category", "endpoint", "method", "body_template",
   "required_variables", "success_criteria", "depends_on", "requires_verification_gate", "status")
VALUES
  (
    'action.purge-deleted-user',
    'Permanently Purge Deleted User',
    'Permanently removes a soft-deleted user object from the tenant''s Deleted Items -- irreversible, unlike restoring it. The caller should have already exported the full user object (see snapshot_notes on the matching write_action_catalog row) before invoking this.',
    'identity',
    '/directory/deletedItems/{{userId}}',
    'DELETE',
    '{}'::jsonb,
    '["userId"]'::jsonb,
    '{"statusCode": 204}'::jsonb,
    '[]'::jsonb,
    true,
    'active'
  ),
  (
    'action.set-ca-policy-state',
    'Set Conditional Access Policy State',
    'Toggles an existing Conditional Access policy between enforced, report-only, and fully disabled via its real "state" field -- the same values ("enabled"/"disabled"/"enabledForReportingButNotEnforced") the baseline CA policy templates already write on creation.',
    'security',
    '/identity/conditionalAccess/policies/{{policyId}}',
    'PATCH',
    '{"state": "{{state}}"}'::jsonb,
    '["policyId", "state"]'::jsonb,
    '{"statusCode": 204}'::jsonb,
    '[]'::jsonb,
    false,
    'active'
  ),
  (
    'action.toggle-license-service-plan',
    'Enable/Disable Service Plan Within a License',
    'Re-assigns a user''s already-held license SKU with a single service plan disabled -- Microsoft Graph''s assignLicense call is an upsert keyed on skuId, so this overwrites the SKU''s disabledPlans with just this one id (matching action.manage-ca-exclusions'' own single-item convention); disabling more than one plan on the same SKU needs a second call, not one call with a list.',
    'identity',
    '/users/{{userId}}/assignLicense',
    'POST',
    '{"addLicenses": [{"skuId": "{{skuId}}", "disabledPlans": ["{{servicePlanId}}"]}], "removeLicenses": []}'::jsonb,
    '["userId", "skuId", "servicePlanId"]'::jsonb,
    '{"statusCode": 200}'::jsonb,
    '[]'::jsonb,
    false,
    'active'
  )
ON CONFLICT ("template_id") DO NOTHING;

-- Link the 3 newly-authored templates to their catalog rows.
UPDATE "write_action_catalog"
SET "template_id" = 'action.purge-deleted-user', "status" = 'execution_ready'
WHERE "id" = 93 AND "domain" = 'Users' AND "action_name" = 'Permanently purge deleted user'
  AND "template_id" IS NULL;

UPDATE "write_action_catalog"
SET "template_id" = 'action.set-ca-policy-state', "status" = 'execution_ready'
WHERE "id" = 136 AND "domain" = 'Conditional Access' AND "action_name" = 'Enable/disable (report-only vs on)'
  AND "template_id" IS NULL;

UPDATE "write_action_catalog"
SET "template_id" = 'action.toggle-license-service-plan', "status" = 'execution_ready'
WHERE "id" = 122 AND "domain" = 'Licensing' AND "action_name" = 'Enable/disable service plan within a license'
  AND "template_id" IS NULL;

-- Relink the 3 already-existing-but-orphaned templates found via the anti-join.
UPDATE "write_action_catalog"
SET "template_id" = 'action.create-ca-signin-risk-policy', "status" = 'execution_ready'
WHERE "id" = 139 AND "domain" = 'Conditional Access' AND "action_name" = 'Sign-in risk policy'
  AND "template_id" IS NULL;

UPDATE "write_action_catalog"
SET "template_id" = 'action.create-ca-user-risk-policy', "status" = 'execution_ready'
WHERE "id" = 140 AND "domain" = 'Conditional Access' AND "action_name" = 'User risk policy'
  AND "template_id" IS NULL;

UPDATE "write_action_catalog"
SET "template_id" = 'action.submit-file-detonation', "status" = 'execution_ready'
WHERE "id" = 204 AND "domain" = 'Security (Defender)' AND "action_name" = 'Submit file/URL for detonation'
  AND "template_id" IS NULL;

-- Git #497 self-marking row so Simulator Studio's Migrations tree checkbox reflects
-- DB reality regardless of which console ran this file.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-13-write-action-catalog-users-domain-batch-2494.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
