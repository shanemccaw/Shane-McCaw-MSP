-- #3959 — migrate devices:kfm-configuration's read AND the kfm-configuration-v1
-- write pack off the beta Administrative Templates group-policy surface
-- (groupPolicyConfigurations / groupPolicyDefinitions) onto
-- deviceManagement/configurationPolicies (Settings Catalog), per Microsoft's own
-- deprecation notice (MC955748; techcommunity.microsoft.com/blog/intunecustomersuccess/
-- updates-to-beta-apis-for-windows-endpoint-security-and-administrative-templates/4357002).
-- Filed and specced by #3800's own build (discovered while authoring the KFM write
-- automation against groupPolicyConfigurations, deliberately deferred as out of scope
-- for that build). Migrating the check and the write together, per #3959's own
-- instruction: a Settings Catalog write would not satisfy the OLD check's
-- groupPolicyConfigurations read, and vice versa.
--
-- MICROSOFT DOCS FETCHED THIS SESSION (2026-09-13/14), shapes taken verbatim:
--   deviceManagementConfigurationPolicy (beta) resource — `settings` is a real
--   navigation-property collection of deviceManagementConfigurationSetting, deep-
--   insertable directly in the create POST body (not just via the separate
--   POST .../configurationPolicies/{id}/settings sub-resource the generic doc
--   example shows):
--     https://learn.microsoft.com/en-us/graph/api/resources/intune-deviceconfigv2-devicemanagementconfigurationpolicy?view=graph-rest-beta
--     https://learn.microsoft.com/en-us/graph/api/intune-deviceconfigv2-devicemanagementconfigurationpolicy-create?view=graph-rest-beta
--   deviceManagementConfigurationSettingInstance / ChoiceSettingInstance /
--   SimpleSettingInstance shapes (settingDefinitionId, choiceSettingValue.value,
--   simpleSettingValue.value, children[] for a choice's dependent settings):
--     https://learn.microsoft.com/en-us/graph/api/intune-deviceconfigv2-devicemanagementconfigurationsetting-create?view=graph-rest-beta
--     https://learn.microsoft.com/en-us/graph/api/resources/intune-deviceconfigv2-devicemanagementconfigurationsettinginstance?view=graph-rest-beta
--   deviceManagementConfigurationSettingDefinition.rootDefinitionId — "Root setting
--   definition id if the setting is a child setting" (i.e. EMPTY on a root/top-level
--   setting, populated on a child) — the live disambiguator this migration's resolve
--   step uses to pick the KFM PARENT choice setting out of a filtered list that also
--   contains its dropdown/textbox children:
--     https://learn.microsoft.com/en-us/graph/api/resources/intune-deviceconfigv2-devicemanagementconfigurationsettingdefinition?view=graph-rest-beta
--   List deviceManagementConfigurationSettingDefinitions — GET
--   /deviceManagement/configurationSettings (independent of any policy), $filter-able:
--     https://learn.microsoft.com/en-us/graph/api/intune-deviceconfigv2-devicemanagementconfigurationsettingdefinition-list?view=graph-rest-beta
--
-- REAL-WORLD CONFIRMED SHAPE (not just doc placeholders — two independent working
-- examples, both using the identical settingDefinitionId family and the identical
-- deep-insert `settings` array pattern this migration's body_template copies):
--   https://raw.githubusercontent.com/PacktPublishing/Microsoft-Intune-Cookbook/main/Chapter2/onedrive-settings-catalog.ps1
--   https://rozemuller.com/distribute-onedrive-with-winget-and-onedrive-best-practices-automated/
--
-- WHY THE SETTINGDEFINITIONID IS RESOLVED LIVE, NOT HARDCODED. #3959's own issue body
-- states the id as `device_vendor_msft_policy_config_onedrivengsc~policy~onedrivengsc_kfmoptinnowizard`.
-- Both real-world sources above instead show
-- `device_vendor_msft_policy_config_onedrivengscv2~policy~onedrivengsc_kfmoptinnowizard`
-- (note "onedrivengscv2", not "onedrivengsc", in the category segment before
-- `~policy~`) — and independent community confirmation (HTMD/cloudinfra coverage of
-- this exact policy) states plainly: "You will find two versions of the same setting
-- in the Settings catalog." Hardcoding either literal risks silently missing the OTHER
-- version on a given tenant/Windows-release combination — exactly the kind of
-- unverifiable assumption the resolve-then-write mechanism (#3800) exists to avoid.
-- So the write resolves `kfmDefinitionId` live via a filtered GET against
-- /deviceManagement/configurationSettings (server-narrowed to candidates whose `id`
-- contains "onedrivengsc_kfmoptinnowizard" — true of both versions and their
-- dropdown/textbox children), then client-selects the one candidate whose
-- rootDefinitionId is EMPTY (the parent choice setting, not a child) — no displayName
-- string to get subtly wrong. The dropdown/textbox child ids are then derived from
-- the resolved parent id by the SAME literal suffix both real-world sources show
-- (`_kfmoptinnowizard_dropdown[_0]` / `_kfmoptinnowizard_textbox`), since Microsoft
-- generates them deterministically from the parent id and this is confirmed identical
-- across both the "v2" and non-"v2" naming the two real sources happen to use for the
-- parent itself (the segment AFTER `~policy~` stays "onedrivengsc_kfmoptinnowizard" in
-- both #3959's stated id and the confirmed real "v2" one — only the prefix differs).
--
-- LIVE-VERIFIED AGAINST THE REAL TESTBED TENANT (mccawsoft2.onmicrosoft.com),
-- 2026-09-14: Intune is not provisioned there (same root cause #2185 already
-- documented for the old surface, which 503s) — BOTH
-- `beta/deviceManagement/configurationPolicies` and
-- `beta/deviceManagement/configurationSettings` return
-- `400 {"code":"BadRequest","message":"Request not applicable to target tenant."}`.
-- This is a DIFFERENT wire shape than the old surface's 503 and was NOT one of
-- monitor-executor's five recognised "Intune never configured" signatures — without a
-- fix this migration would have silently regressed a graceful
-- `service_not_configured` resolution into a raw check-execution error. Fixed in the
-- SAME commit as this migration: `intune-not-applicable-400` added to
-- `INTUNE_WIRE_SIGNATURES` in artifacts/api-server/src/lib/service-availability.ts.
-- Because Intune isn't provisioned on this tenant, the actual write (and the actual
-- resolved settingDefinitionId) could not be live-fired here — same posture #3800 and
-- #2185 already documented for this same tenant/surface family.
--
-- THE PACK IS SIMPLIFIED FROM TWO TEMPLATES TO ONE. The old design needed a separate
-- "create the empty groupPolicyConfigurations container" step because Administrative
-- Templates definitionValues are written into an already-created container. Settings
-- Catalog has no equivalent two-phase shape: `settings` is deep-insertable directly on
-- the policy-create POST (confirmed by both real-world sources above), so container
-- creation and the KFM definition value collapse into one POST. The two old templates
-- are archived (status='archived'), not deleted — MONITOR_CHECK_STATUS semantics
-- already grandfather an archived template into any config pack still referencing it,
-- and archiving preserves the #3800 authorship history/comments on why they were
-- built the way they were. Their config_pack_templates bindings ARE removed (the pack
-- must stop invoking them), which is safe: nothing else FKs config_pack_templates.id.
--
-- CONFIGURATION TYPE stays "policy" (enforced/locked) — unchanged from #3800's choice.
-- NOT GATED (requires_verification_gate = false) — unchanged from #3800's reasoning:
-- KFM silent redirect is reversible (KFMBlockOptOut / unassign), not a lockout/brick
-- class, and is already governed by the config-pack Change Control authorization gate
-- plus the testbed/consent gates every pack run enforces.
--
-- IDEMPOTENT. Template upserts on template_id (DO UPDATE, since this migration may
-- re-run while the resolve/body shape is iterated on before a live tenant can confirm
-- it). Old-template archival and old-binding removal are simple UPDATE/DELETE, safe to
-- re-run. Reversible by re-activating the two archived templates and re-inserting
-- their config_pack_templates rows (their bodies are untouched, only status flips).

BEGIN;

-- ── 1. Archive the two groupPolicyConfigurations-era templates ────────────────
UPDATE baseline_action_templates
SET status = 'archived', updated_at = now()
WHERE template_id IN ('action.create-kfm-grouppolicy-configuration', 'action.set-kfm-definition-values')
  AND status = 'active';

-- ── 2. Drop their bindings from the kfm-configuration-v1 pack ─────────────────
DELETE FROM config_pack_templates cpt
USING config_packs cp
WHERE cpt.pack_id = cp.id
  AND cp.pack_key = 'kfm-configuration-v1'
  AND cpt.template_id IN ('action.create-kfm-grouppolicy-configuration', 'action.set-kfm-definition-values');

-- ── 3. The new Settings Catalog template (single POST, settings deep-inserted) ─
INSERT INTO baseline_action_templates
  (template_id, label, description, category, endpoint, method, body_template,
   required_variables, resolve_steps, success_criteria, depends_on, status,
   reversible, requires_verification_gate)
VALUES
  ('action.create-kfm-settings-catalog-policy',
   'Create KFM Settings Catalog Policy (Known Folder Move)',
   'Creates a Windows Settings Catalog policy that silently enables OneDrive Known Folder Move via BETA POST /deviceManagement/configurationPolicies (DeviceManagementConfiguration.ReadWrite.All), with the KFMOptInNoWizard setting (parent choice = Enabled, dropdown child = Enabled, tenant-ID textbox child = {{organizationId}}) deep-inserted directly in the create body — the Settings Catalog replacement for the deprecated groupPolicyConfigurations + definitionValues two-step (#3800, archived by #3959). The real settingDefinitionId is resolved live via resolve_steps rather than hardcoded, because Microsoft currently serves two live variants of this setting (an "onedrivengsc" and an "onedrivengscv2" category prefix) and which one a given tenant/Windows-release combination returns is not fixed. Remediates devices:kfm-configuration, whose read this migration re-points at the same configurationPolicies surface. Refs: https://learn.microsoft.com/en-us/graph/api/intune-deviceconfigv2-devicemanagementconfigurationpolicy-create?view=graph-rest-beta ; https://learn.microsoft.com/en-us/graph/api/intune-deviceconfigv2-devicemanagementconfigurationsetting-create?view=graph-rest-beta',
   'devices',
   'https://graph.microsoft.com/beta/deviceManagement/configurationPolicies',
   'POST',
   $j${
     "@odata.type": "#microsoft.graph.deviceManagementConfigurationPolicy",
     "name": "OneDrive Known Folder Move (KFM) - Silent Redirect",
     "description": "Silently redirects Windows known folders (Desktop, Documents, Pictures) to OneDrive. Managed by Shane McCaw Consulting.",
     "platforms": "windows10",
     "technologies": "mdm",
     "roleScopeTagIds": ["0"],
     "settings": [
       {
         "@odata.type": "#microsoft.graph.deviceManagementConfigurationSetting",
         "settingInstance": {
           "@odata.type": "#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance",
           "settingDefinitionId": "{{kfmDefinitionId}}",
           "choiceSettingValue": {
             "@odata.type": "#microsoft.graph.deviceManagementConfigurationChoiceSettingValue",
             "value": "{{kfmDefinitionId}}_1",
             "children": [
               {
                 "@odata.type": "#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance",
                 "settingDefinitionId": "{{kfmDefinitionId}}_kfmoptinnowizard_dropdown",
                 "choiceSettingValue": {
                   "@odata.type": "#microsoft.graph.deviceManagementConfigurationChoiceSettingValue",
                   "value": "{{kfmDefinitionId}}_kfmoptinnowizard_dropdown_0",
                   "children": []
                 }
               },
               {
                 "@odata.type": "#microsoft.graph.deviceManagementConfigurationSimpleSettingInstance",
                 "settingDefinitionId": "{{kfmDefinitionId}}_kfmoptinnowizard_textbox",
                 "simpleSettingValue": {
                   "@odata.type": "#microsoft.graph.deviceManagementConfigurationStringSettingValue",
                   "value": "{{organizationId}}"
                 }
               }
             ]
           }
         }
       }
     ]
   }$j$::jsonb,
   '["organizationId"]'::jsonb,
   $j$[{"endpoint": "https://graph.microsoft.com/beta/deviceManagement/configurationSettings?$filter=contains(id,'onedrivengsc_kfmoptinnowizard')", "selectMatch": {"rootDefinitionId": ""}, "assign": {"kfmDefinitionId": "id"}}]$j$::jsonb,
   '{"expectStatus": 201}'::jsonb,
   '[]'::jsonb, 'active', false, false)
ON CONFLICT (template_id) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  endpoint = EXCLUDED.endpoint,
  method = EXCLUDED.method,
  body_template = EXCLUDED.body_template,
  required_variables = EXCLUDED.required_variables,
  resolve_steps = EXCLUDED.resolve_steps,
  success_criteria = EXCLUDED.success_criteria,
  depends_on = EXCLUDED.depends_on,
  status = 'active',
  updated_at = now();

-- ── 4. Update the pack's description, bind the new template to the check ──────
UPDATE config_packs
SET description = 'Silently redirects Windows known folders (Desktop, Documents, Pictures) to OneDrive: creates a Settings Catalog policy with the KFMOptInNoWizard setting (Enabled + the tenant''s ID). Migrated off the deprecated groupPolicyConfigurations surface by #3959.',
    updated_at = now()
WHERE pack_key = 'kfm-configuration-v1';

INSERT INTO config_pack_templates (pack_id, template_id, check_key, sort_order, depends_on_override, parameter_mapping)
SELECT cp.id, 'action.create-kfm-settings-catalog-policy', 'devices:kfm-configuration', 1, NULL::jsonb, NULL::jsonb
  FROM config_packs cp
 WHERE cp.pack_key = 'kfm-configuration-v1'
   AND NOT EXISTS (
     SELECT 1 FROM config_pack_templates x
      WHERE x.pack_id = cp.id AND x.template_id = 'action.create-kfm-settings-catalog-policy'
        AND (x.check_key IS NOT DISTINCT FROM 'devices:kfm-configuration')
   );

-- ── 5. Re-point devices:kfm-configuration's read at Settings Catalog ───────────
UPDATE monitor_checks
SET endpoint = 'https://graph.microsoft.com/beta/deviceManagement/configurationPolicies?$expand=settings',
    mapping = $j$[{"transform": "countWhere('{{settingInstance.settingDefinitionId}} contains \"onedrivengsc_kfmoptinnowizard\"')", "sourceField": "settings", "targetField": "kfmConfiguredProfileCount"}, {"transform": "count", "sourceField": "id", "targetField": "deviceConfigProfileCount"}]$j$::jsonb,
    description = '#3959 -- GET beta /deviceManagement/configurationPolicies?$expand=settings (Settings Catalog policies with their settings inline; DeviceManagementConfiguration.Read.All -- already in REQUIRED_MT_SCOPES). Migrated off groupPolicyConfigurations (#2185), which Microsoft has publicly announced is being superseded by configurationPolicies for Administrative Templates (MC955748). kfmConfiguredProfileCount counts POLICIES whose settings[] array contains an entry whose settingInstance.settingDefinitionId contains "onedrivengsc_kfmoptinnowizard" -- matches either live Settings Catalog variant of the KFM setting ("onedrivengsc" or "onedrivengscv2" category prefix; Microsoft currently serves both) without needing to know which one a given tenant returns. Each policy''s settings[] array holds only its TOP-LEVEL setting instances (KFM''s dropdown/textbox children live nested inside settingInstance.choiceSettingValue.children, not as separate settings[] entries), so this cannot double-count or accidentally match a child. deviceConfigProfileCount is the raw scanned-profile count for context, unchanged in shape from the prior groupPolicyConfigurations read.',
    updated_at = now()
WHERE key = 'devices:kfm-configuration';

-- ── Verification ─────────────────────────────────────────────────────────────
SELECT key, status, method, endpoint, mapping FROM monitor_checks WHERE key = 'devices:kfm-configuration';

SELECT template_id, status FROM baseline_action_templates
WHERE template_id IN ('action.create-kfm-grouppolicy-configuration', 'action.set-kfm-definition-values', 'action.create-kfm-settings-catalog-policy')
ORDER BY template_id;

SELECT cp.pack_key, cpt.sort_order, cpt.template_id, cpt.check_key
  FROM config_pack_templates cpt JOIN config_packs cp ON cp.id = cpt.pack_id
 WHERE cp.pack_key = 'kfm-configuration-v1' ORDER BY cpt.sort_order;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-14-kfm-settings-catalog-migration-3959.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
