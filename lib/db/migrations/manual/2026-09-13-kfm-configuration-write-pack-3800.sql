-- #3800 — Author the real devices:kfm-configuration write automation using the
-- new resolve-then-write step type (see companion migration
-- 2026-09-13-baseline-template-resolve-steps-3800.sql, which adds
-- baseline_action_templates.resolve_steps).
--
-- WHY THIS EXISTS. #2039 correctly REFUSED to ship a fake KFM automation: creating
-- an empty groupPolicyConfiguration container with a KFM-sounding displayName would
-- satisfy the devices:kfm-configuration check's name-match read (it counts profiles
-- whose displayName contains "Known Folder Move"/"KFM") while doing ZERO real device
-- configuration — the "a fix that does not fix the finding is worse than the gap"
-- failure #1925/#3800 warn against. Real KFM enforcement is an Administrative
-- Templates policy: create the container, then write a groupPolicyDefinitionValue
-- bound to the KFMOptInNoWizard ADMX definition — whose definitionId is NOT a fixed
-- constant, it must be resolved from a live filtered GET. resolve_steps is exactly
-- that resolve-then-write capability, so KFM can now be authored honestly.
--
-- MICROSOFT DOCS FETCHED THIS SESSION (2026-09-13), shapes taken verbatim:
--   Create groupPolicyConfiguration (beta) -> 201, {displayName, description,
--     roleScopeTagIds, policyConfigurationIngestionType}:
--     https://learn.microsoft.com/en-us/graph/api/intune-grouppolicy-grouppolicyconfiguration-create?view=graph-rest-beta
--   Create groupPolicyDefinitionValue (beta) -> 201 under
--     POST /deviceManagement/groupPolicyConfigurations/{id}/definitionValues,
--     {enabled, configurationType}; the definition is bound via definition@odata.bind
--     and presentation values via presentation@odata.bind:
--     https://learn.microsoft.com/en-us/graph/api/intune-grouppolicy-grouppolicydefinitionvalue-create?view=graph-rest-beta
--   groupPolicyDefinition (beta) — displayName, categoryPath, classType, policyType;
--     KFMOptInNoWizard's localized displayName is "Silently move Windows known
--     folders to OneDrive", categoryPath "\OneDrive":
--     https://learn.microsoft.com/en-us/graph/api/resources/intune-grouppolicy-grouppolicydefinition?view=graph-rest-beta
--   groupPolicyPresentationValueText (beta) — @odata.type
--     #microsoft.graph.groupPolicyPresentationValueText, string `value`; the KFM
--     text box (groupPolicyPresentationTextBox) takes the Entra tenant GUID
--     (KFMSilentOptIn). ADMX element ids/required-ness confirmed against the real
--     OneDrive ADMX (KFMOptInNoWizard_TextBox required="true"):
--     https://learn.microsoft.com/en-us/graph/api/resources/intune-grouppolicy-grouppolicypresentationvaluetext?view=graph-rest-beta
--
-- RESOLVE-THEN-WRITE (action.set-kfm-definition-values.resolve_steps), run in order
-- before the write, each seeing the prior step's assignments:
--   1. GET groupPolicyDefinitions?$filter=categoryPath eq '\OneDrive', then client-
--      match displayName contains "silently move windows known folders" (uniquely
--      KFMOptInNoWizard — "with wizard" / "prevent redirecting" siblings do not
--      contain that phrase) -> assign kfmDefinitionId = id.
--   2. GET that definition's /presentations, match @odata.type contains
--      "groupPolicyPresentationTextBox" -> assign kfmTenantPresentationId = id.
-- A required resolve that matches nothing FAILS CLOSED (424, no write) — it never
-- silently writes an empty {{kfmDefinitionId}}.
--
-- The tenant GUID for KFMSilentOptIn comes from {{organizationId}} — the config-pack
-- orchestrator sets organizationId = customer.tenantId (the Graph organization id IS
-- the tenant GUID; config-pack-orchestrator.ts payload construction). kfmContainerId
-- comes from step 1's parameter_mapping ({"kfmContainerId":"id"}), the SAME create-
-- output chaining #1316 uses. So the write binds a real resolved definitionId AND the
-- real container id — never the empty container #2039 refused to ship.
--
-- CONFIGURATION TYPE. "policy" (enforced/locked), not "preference".
--
-- NOT GATED (requires_verification_gate = false). requires_verification_gate is the
-- break-glass gate (config-pack-graph.ts): it is purpose-built to capture/verify a
-- minted break-glass account and hard-fails without one, so it does not fit KFM.
-- KFM writes are already governed by the config-pack Change Control authorization
-- gate every pack run enforces (ConfigPackError change_request_not_authorized) plus
-- the testbed/consent gates — the same protection the non-gated device templates in
-- #2039 (update-rings, compliance) rely on. KFM silent redirect is reversible
-- (KFMBlockOptOut / unassign), not a lockout/brick class.
--
-- BETA-API DEPRECATION (filed as a separate finding, see #3800 build): Microsoft
-- announced the beta groupPolicyConfigurations/groupPolicyDefinitions surface is
-- being superseded by deviceManagement/configurationPolicies (Settings Catalog).
-- This automation targets groupPolicyConfigurations DELIBERATELY, because the live
-- devices:kfm-configuration check reads exactly that surface (confirmed live #2185,
-- #2039) — a Settings Catalog write would not satisfy the check's read. The check and
-- this automation should migrate together; that migration is out of scope for #3800.
--
-- IDEMPOTENT. Templates upsert on template_id (DO NOTHING); pack upserts on pack_key;
-- mapping rows insert WHERE NOT EXISTS. Additive; reversible by deleting these rows.
-- devices:kfm-configuration exists in monitor_checks (FK satisfied, verified live).

BEGIN;

-- ── 1. Templates ─────────────────────────────────────────────────────────────
INSERT INTO baseline_action_templates
  (template_id, label, description, category, endpoint, method, body_template,
   required_variables, resolve_steps, success_criteria, depends_on, status,
   reversible, requires_verification_gate)
VALUES
  ('action.create-kfm-grouppolicy-configuration',
   'Create KFM Administrative Templates Container',
   'Creates the Administrative Templates (group policy) configuration container that will hold the Known Folder Move policy, via BETA POST /deviceManagement/groupPolicyConfigurations (DeviceManagementConfiguration.ReadWrite.All). Its displayName contains "Known Folder Move" so devices:kfm-configuration''s name-match read recognizes it; the real enforcement is written by action.set-kfm-definition-values into this container. Ref: https://learn.microsoft.com/en-us/graph/api/intune-grouppolicy-grouppolicyconfiguration-create?view=graph-rest-beta',
   'devices',
   'https://graph.microsoft.com/beta/deviceManagement/groupPolicyConfigurations',
   'POST',
   $j${"@odata.type": "#microsoft.graph.groupPolicyConfiguration", "displayName": "OneDrive Known Folder Move (KFM) - Silent Redirect", "description": "Silently redirects Windows known folders (Desktop, Documents, Pictures) to OneDrive. Managed by Shane McCaw Consulting.", "roleScopeTagIds": ["0"], "policyConfigurationIngestionType": "builtIn"}$j$::jsonb,
   '[]'::jsonb,
   '[]'::jsonb,
   '{"expectStatus": 201}'::jsonb, '[]'::jsonb, 'active', false, false),

  ('action.set-kfm-definition-values',
   'Enable Silent KFM (Known Folder Move) Definition Value',
   'Writes the "Silently move Windows known folders to OneDrive" (KFMOptInNoWizard) Administrative Templates policy into the KFM container via BETA POST /deviceManagement/groupPolicyConfigurations/{id}/definitionValues (DeviceManagementConfiguration.ReadWrite.All). Resolves the ADMX definitionId and the tenant-ID text-box presentation id from live filtered GETs (resolve_steps), binds them via definition@odata.bind / presentation@odata.bind, and sets the tenant GUID ({{organizationId}}) as the required KFMSilentOptIn value. Remediates devices:kfm-configuration with a REAL policy, not an empty container. Refs: https://learn.microsoft.com/en-us/graph/api/intune-grouppolicy-grouppolicydefinitionvalue-create?view=graph-rest-beta ; https://learn.microsoft.com/en-us/graph/api/resources/intune-grouppolicy-grouppolicypresentationvaluetext?view=graph-rest-beta',
   'devices',
   'https://graph.microsoft.com/beta/deviceManagement/groupPolicyConfigurations/{{kfmContainerId}}/definitionValues',
   'POST',
   $j${"@odata.type": "#microsoft.graph.groupPolicyDefinitionValue", "enabled": true, "configurationType": "policy", "definition@odata.bind": "https://graph.microsoft.com/beta/deviceManagement/groupPolicyDefinitions('{{kfmDefinitionId}}')", "presentationValues": [{"@odata.type": "#microsoft.graph.groupPolicyPresentationValueText", "value": "{{organizationId}}", "presentation@odata.bind": "https://graph.microsoft.com/beta/deviceManagement/groupPolicyDefinitions('{{kfmDefinitionId}}')/presentations('{{kfmTenantPresentationId}}')"}]}$j$::jsonb,
   '["kfmContainerId", "organizationId"]'::jsonb,
   $j$[{"endpoint": "https://graph.microsoft.com/beta/deviceManagement/groupPolicyDefinitions?$filter=categoryPath%20eq%20'%5COneDrive'", "selectMatch": {"displayName": "contains:silently move windows known folders"}, "assign": {"kfmDefinitionId": "id"}}, {"endpoint": "https://graph.microsoft.com/beta/deviceManagement/groupPolicyDefinitions('{{kfmDefinitionId}}')/presentations", "selectMatch": {"@odata.type": "contains:groupPolicyPresentationTextBox"}, "assign": {"kfmTenantPresentationId": "id"}}]$j$::jsonb,
   '{"expectStatus": 201}'::jsonb,
   '["action.create-kfm-grouppolicy-configuration"]'::jsonb, 'active', false, false)
ON CONFLICT (template_id) DO NOTHING;

-- ── 2. The pack ──────────────────────────────────────────────────────────────
INSERT INTO config_packs (pack_key, label, description, categories, status)
VALUES
  ('kfm-configuration-v1', 'OneDrive Known Folder Move (KFM)',
   'Silently redirects Windows known folders (Desktop, Documents, Pictures) to OneDrive: creates the Administrative Templates container and writes the KFMOptInNoWizard policy with the tenant''s ID.',
   ARRAY['Devices','Data Protection'], 'active')
ON CONFLICT (pack_key) DO NOTHING;

-- ── 3. Bind templates -> check (anchor carries NULL check_key) ───────────────
INSERT INTO config_pack_templates (pack_id, template_id, check_key, sort_order, depends_on_override, parameter_mapping)
SELECT cp.id, v.template_id, v.check_key, v.sort_order, v.depends_on_override, v.parameter_mapping
  FROM config_packs cp
  CROSS JOIN (VALUES
    ('action.create-kfm-grouppolicy-configuration', NULL::text,                    1, NULL::jsonb,                                                    '{"kfmContainerId": "id"}'::jsonb),
    ('action.set-kfm-definition-values',            'devices:kfm-configuration',    2, '["action.create-kfm-grouppolicy-configuration"]'::jsonb,        NULL::jsonb)
  ) AS v(template_id, check_key, sort_order, depends_on_override, parameter_mapping)
 WHERE cp.pack_key = 'kfm-configuration-v1'
   AND NOT EXISTS (
     SELECT 1 FROM config_pack_templates x
      WHERE x.pack_id = cp.id AND x.template_id = v.template_id
        AND (x.check_key IS NOT DISTINCT FROM v.check_key)
   );

-- ── Verification ─────────────────────────────────────────────────────────────
SELECT cp.pack_key, cpt.sort_order, cpt.template_id, cpt.check_key, cpt.depends_on_override, cpt.parameter_mapping
  FROM config_pack_templates cpt JOIN config_packs cp ON cp.id = cpt.pack_id
 WHERE cp.pack_key = 'kfm-configuration-v1' ORDER BY cpt.sort_order;

SELECT template_id, jsonb_array_length(resolve_steps) AS resolve_step_count
  FROM baseline_action_templates
 WHERE template_id IN ('action.create-kfm-grouppolicy-configuration', 'action.set-kfm-definition-values')
 ORDER BY template_id;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-13-kfm-configuration-write-pack-3800.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
