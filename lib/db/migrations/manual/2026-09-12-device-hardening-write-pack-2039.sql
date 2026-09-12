-- #2039 — Phase 2 (fan-out from #1925): author write packs for uncovered
-- Device/Intune checks.
--
-- WHY. Live DB baseline before this migration: 12 `devices:*` monitor_checks,
-- 4 already we_can_run-mapped via the existing `device-compliance-v1` pack
-- (devices:app-protection-coverage, devices:compliance-policy-coverage,
-- devices:compliant-vs-noncompliant, devices:unassigned-intune-profiles). The
-- other 8 had no automation at all. The issue body named 7 of them
-- (update-rings-config, bitlocker-key-escrow, os-patch-compliance,
-- encryption-status, enrollment-status, kfm-configuration, autopilot-coverage);
-- live DB confirms the 8th uncovered check the issue body did not name is
-- `devices:stale-duplicate-records`.
--
-- OF THE 8: six get real write automation below, authored against Microsoft
-- documentation FETCHED THIS SESSION (2026-09-12), not recalled. Two are
-- deliberately left with NO template authored, per #1925's own "leave NULL
-- rather than fake it" discipline — reasons recorded per-check below.
--
-- MICROSOFT DOCS FETCHED THIS SESSION, exact shapes taken verbatim from these
-- pages:
--   Create windowsUpdateForBusinessConfiguration (v1.0)
--     https://learn.microsoft.com/en-us/graph/api/intune-deviceconfig-windowsupdateforbusinessconfiguration-create
--     POST /deviceManagement/deviceConfigurations -> 201 (DeviceManagementConfiguration.ReadWrite.All)
--   Assign deviceConfiguration (v1.0) — reused for the ring's assignment (a
--   Windows Update ring IS a deviceConfiguration row; this is the SAME generic
--   assign template already used by devices:unassigned-intune-profiles in the
--   existing device-compliance-v1 pack — genuine reuse, not a new template):
--     https://learn.microsoft.com/en-us/graph/api/intune-deviceconfig-deviceconfiguration-assign
--     POST /deviceManagement/deviceConfigurations/{id}/assign -> 200, body
--     {"assignments":[{"target":{"groupId":..,"@odata.type":"#microsoft.graph.groupAssignmentTarget"}}]}
--   Create windows10EndpointProtectionConfiguration (v1.0) — bitLockerEncryptDevice
--     https://learn.microsoft.com/en-us/graph/api/intune-deviceconfig-windows10endpointprotectionconfiguration-create
--     POST /deviceManagement/deviceConfigurations -> 201. v1.0 schema for this
--     resource has NO recovery-key-escrow properties (only bitLockerEncryptDevice,
--     bitLockerDisableWarningForOtherDiskEncryption, bitLockerEnableStorageCardEncryptionOnMobile,
--     bitLockerRemovableDrivePolicy) — confirmed by reading the full v1.0 property table.
--   bitLockerSystemDrivePolicy.recoveryOptions (BETA-ONLY — not in v1.0's endpoint-
--   protection schema, confirmed above) — this is the actual escrow-to-store lever:
--     https://learn.microsoft.com/en-us/graph/api/resources/intune-deviceconfig-bitlockersystemdrivepolicy?view=graph-rest-beta
--     recoveryOptions.enableRecoveryInformationSaveToStore (bool) +
--     recoveryOptions.recoveryInformationToStore ("keyAndPassword"|"keyOnly"|"passwordOnly"|"notConfigured")
--     is what escrows the recovery key/password to the tenant's store (AD/AAD).
--     Same absolute-beta-URL technique devices:kfm-configuration's own check row
--     already uses (#2185) for a beta-only Graph resource.
--   Create windows10CompliancePolicy (v1.0) — osMinimumVersion
--     https://learn.microsoft.com/en-us/graph/api/intune-deviceconfig-windows10compliancepolicy-create
--     POST /deviceManagement/deviceCompliancePolicies -> 201
--   Create azureADWindowsAutopilotDeploymentProfile (BETA — this resource has no
--   v1.0 create operation; confirmed by the create page's own moniker being
--   graph-rest-beta only, with no "Other Supported Versions" v1.0 link)
--     https://learn.microsoft.com/en-us/graph/api/intune-enrollment-azureadwindowsautopilotdeploymentprofile-create?view=graph-rest-beta
--     POST /deviceManagement/windowsAutopilotDeploymentProfiles -> 201
--     (DeviceManagementServiceConfig.ReadWrite.All)
--   windowsAutopilotDeploymentProfile's own `assignments` relationship (group-based
--   assignment, distinct from the per-device-hash `assign` action) —
--     https://learn.microsoft.com/en-us/graph/api/resources/intune-enrollment-windowsautopilotdeploymentprofile?view=graph-rest-beta
--     POST /deviceManagement/windowsAutopilotDeploymentProfiles/{id}/assignments -> 201,
--     body {"target":{"@odata.type":"#microsoft.graph.groupAssignmentTarget","groupId":..}}.
--     NOTE: the doc page titled "Create windowsAutopilotDeploymentProfileAssignment"
--     (https://learn.microsoft.com/en-us/graph/api/intune-enrollment-windowsautopilotdeploymentprofileassignment-create?view=graph-rest-beta)
--     shows a templated example URL under windowsAutopilotDeviceIdentities/.../deploymentProfile/assignments
--     that does not match the resource being created — a known Graph-doc
--     generation mismatch. The endpoint used below instead matches the
--     `assignments` collection genuinely declared on the profile resource itself.
--   Delete device (v1.0)
--     https://learn.microsoft.com/en-us/graph/api/device-delete
--     DELETE /devices/{id} -> 204 (Device.ReadWrite.All)
--
-- TYPED-BODY NOTE (same as #1925's governance-groups migration): numeric values
-- bound through {{var}} come back as strings after resolveBaselineTemplateRequest's
-- stringify/substitute/parse round-trip, so every genuinely numeric setting below
-- (deferral days, etc.) is a hardcoded literal, not a {{var}}.
--
-- RISK CLASSIFICATION (per #2039's own caveat — "any policy that could brick
-- enrollment is plan-only, never a real apply" — the mechanism for that in this
-- schema is requires_verification_gate, which pauses a pack run for tenant-admin
-- confirmation before the write fires):
--   - action.create-windows-update-ring: NOT gated. Governs patch cadence only;
--     reversible by deleting/unassigning the ring. Same risk tier as the existing
--     non-gated devices:compliance-policy-coverage template.
--   - action.create-bitlocker-protection-profile: GATED. Forces BitLocker
--     encryption tenant-wide — a real device-lockout class (TPM/PIN failure
--     scenarios), which is exactly the caveat's "could lock a user or device out."
--   - action.create-os-patch-compliance-policy: NOT gated. A compliance FLAG only
--     (device reports non-compliant) — it does not itself enforce or block
--     access; any CA policy that acts on compliance is a separate, unauthored
--     policy. Same risk tier as compliance-policy-coverage's own template.
--   - action.create-autopilot-deployment-profile: GATED. Autopilot OOBE
--     configuration is enrollment itself — a misconfigured profile is precisely
--     "could brick enrollment" from #2039's own text.
--   - action.delete-stale-device-record: GATED. A destructive directory-object
--     delete; gated per this project's own "when in doubt, gate it" practice
--     (matches action.delete-group, action.delete-user, action.retire-device).
-- NOTE ON MULTIPLE GATES IN ONE PACK: config-pack-graph.ts's own documented
-- behavior is that only the FIRST gated template in topological order gets a
-- real pause node; later gated templates in the same pack coalesce onto that
-- same approval and run immediately after it (coalescedGateTemplateIds). This
-- pack has three gated anchors; in sort_order they are bitlocker (5th),
-- autopilot (9th) — actually see sort_order below — the create-stale-device
-- template is standalone with sort_order 10. Recorded here so this tradeoff is
-- visible rather than silently relied on: approving the first gate this pack
-- hits also releases every later gated step in the SAME pack run. A real
-- purchase/run of this pack should be scoped to only the checks a customer
-- actually wants remediated (existing config-pack purchase flow already scopes
-- by pack, not by individual check).
--
-- LEFT WITH NO TEMPLATE AUTHORED (2 of the 8), and why:
--   - devices:enrollment-status — REPORTING-ONLY. The check's own description is
--     "Total enrolled devices and enrollment method breakdown" — a raw count/
--     breakdown metric. There is no single Graph write that "fixes" an
--     enrollment total; real remediation (enrolling more devices) requires
--     end-user/device action, not an admin API call the platform can fire on
--     the tenant's behalf. Correctly has no automation, same bucket as #1925
--     Phase 1's "remediates nothing in the catalogue" templates.
--   - devices:kfm-configuration — GENUINE ARCHITECTURAL GAP, not left ambiguous
--     by choice. Real Known Folder Move configuration requires Administrative
--     Templates (groupPolicyConfigurations + definitionValues, both beta-only),
--     and the definitionValues step needs a definitionId resolved from a LIVE,
--     filtered GET against /deviceManagement/groupPolicyDefinitions — a
--     "look up an id from a read, then write with it" step the current
--     baseline_action_templates model has no way to express (a template is a
--     single fixed endpoint+body with {{var}} substitution only; it cannot
--     encode a dependent dynamic lookup). Creating an EMPTY groupPolicyConfiguration
--     container with a KFM-sounding displayName would satisfy the check's own
--     name-match read logic (per the check's description: it counts profiles by
--     displayName containing "Known Folder Move"/"KFM") WITHOUT doing any real
--     device configuration — exactly the "a wrong mapping offers a fix that does
--     not fix the finding, which is worse than the gap" failure #1925 warns
--     against. Filed as a real finding (see bookend / issue comment) rather than
--     authored around dishonestly.
--
-- IDEMPOTENT. Templates upsert on their unique template_id (DO NOTHING); the
-- pack upserts on its unique pack_key; the mapping rows insert only WHERE NOT
-- EXISTS for (pack_id, check_key). A re-run writes nothing. Additive; reversible
-- by deleting these rows. All target check_keys exist in monitor_checks (FK
-- satisfied) and were confirmed live in the local DB before authoring.

BEGIN;

-- ── 1. New write templates ───────────────────────────────────────────────────
INSERT INTO baseline_action_templates
  (template_id, label, description, category, endpoint, method, body_template, required_variables, success_criteria, depends_on, status, reversible, requires_verification_gate)
VALUES
  ('action.create-windows-update-ring',
   'Create Windows Update Ring',
   'Creates a Windows Update for Business deployment ring (moderate 7-day quality / 14-day feature deferral) via POST /deviceManagement/deviceConfigurations (DeviceManagementConfiguration.ReadWrite.All). Remediates devices:update-rings-config once assigned. Ref: https://learn.microsoft.com/en-us/graph/api/intune-deviceconfig-windowsupdateforbusinessconfiguration-create',
   'devices', '/deviceManagement/deviceConfigurations', 'POST',
   '{"@odata.type": "#microsoft.graph.windowsUpdateForBusinessConfiguration", "displayName": "{{ringName}}", "automaticUpdateMode": "autoInstallAndRebootAtMaintenanceTime", "qualityUpdatesDeferralPeriodInDays": 7, "featureUpdatesDeferralPeriodInDays": 14, "deliveryOptimizationMode": "httpOnly"}'::jsonb,
   '["ringName"]'::jsonb, '{"expectStatus": 201}'::jsonb, '[]'::jsonb, 'active', false, false),

  ('action.create-bitlocker-protection-profile',
   'Create BitLocker Protection Profile (Encryption + Recovery Key Escrow)',
   'Creates a Windows 10 Endpoint Protection configuration profile via BETA POST /deviceManagement/deviceConfigurations (DeviceManagementConfiguration.ReadWrite.All): bitLockerEncryptDevice forces system-drive encryption (v1.0 property), and bitLockerSystemDrivePolicy.recoveryOptions (beta-only) requires the recovery key+password to be escrowed to the tenant''s store. Remediates devices:encryption-status and devices:bitlocker-key-escrow once assigned. GATED: forcing encryption tenant-wide is a real device-lockout class. Ref: https://learn.microsoft.com/en-us/graph/api/intune-deviceconfig-windows10endpointprotectionconfiguration-create ; https://learn.microsoft.com/en-us/graph/api/resources/intune-deviceconfig-bitlockersystemdrivepolicy?view=graph-rest-beta',
   'devices', 'https://graph.microsoft.com/beta/deviceManagement/deviceConfigurations', 'POST',
   '{"@odata.type": "#microsoft.graph.windows10EndpointProtectionConfiguration", "displayName": "{{profileName}}", "bitLockerEncryptDevice": true, "bitLockerDisableWarningForOtherDiskEncryption": true, "bitLockerSystemDrivePolicy": {"@odata.type": "microsoft.graph.bitLockerSystemDrivePolicy", "recoveryOptions": {"@odata.type": "microsoft.graph.bitLockerRecoveryOptions", "enableRecoveryInformationSaveToStore": true, "recoveryInformationToStore": "keyAndPassword", "recoveryKeyUsage": "allowed", "recoveryPasswordUsage": "required"}}}'::jsonb,
   '["profileName"]'::jsonb, '{"expectStatus": 201}'::jsonb, '[]'::jsonb, 'active', false, true),

  ('action.assign-bitlocker-encryption-profile',
   'Assign BitLocker Protection Profile (Encryption Coverage)',
   'Assigns the BitLocker protection profile to a group via POST /deviceManagement/deviceConfigurations/{id}/assign (DeviceManagementConfiguration.ReadWrite.All). Remediates devices:encryption-status. Distinct template_id from the escrow-check''s assign row (same real action, two checks — the config-pack graph keys nodes on template_id, so a duplicate id inside one pack breaks the topo sort, same dup-row technique #1925''s governance-groups pack used). Ref: https://learn.microsoft.com/en-us/graph/api/intune-deviceconfig-deviceconfiguration-assign',
   'devices', '/deviceManagement/deviceConfigurations/{{profileId}}/assign', 'POST',
   '{"assignments": [{"target": {"groupId": "{{groupId}}", "@odata.type": "#microsoft.graph.groupAssignmentTarget"}}]}'::jsonb,
   '["profileId", "groupId"]'::jsonb, '{"expectStatus": 200}'::jsonb,
   '["action.create-bitlocker-protection-profile"]'::jsonb, 'active', false, false),

  ('action.assign-bitlocker-escrow-profile',
   'Assign BitLocker Protection Profile (Recovery Key Escrow Coverage)',
   'Assigns the BitLocker protection profile to a group via POST /deviceManagement/deviceConfigurations/{id}/assign (DeviceManagementConfiguration.ReadWrite.All). Remediates devices:bitlocker-key-escrow. Ref: https://learn.microsoft.com/en-us/graph/api/intune-deviceconfig-deviceconfiguration-assign',
   'devices', '/deviceManagement/deviceConfigurations/{{profileId}}/assign', 'POST',
   '{"assignments": [{"target": {"groupId": "{{groupId}}", "@odata.type": "#microsoft.graph.groupAssignmentTarget"}}]}'::jsonb,
   '["profileId", "groupId"]'::jsonb, '{"expectStatus": 200}'::jsonb,
   '["action.create-bitlocker-protection-profile"]'::jsonb, 'active', false, false),

  ('action.create-os-patch-compliance-policy',
   'Create OS Patch Compliance Policy',
   'Creates a Windows 10 compliance policy requiring a minimum supported OS build via POST /deviceManagement/deviceCompliancePolicies (DeviceManagementConfiguration.ReadWrite.All), osMinimumVersion set from operator input. Remediates devices:os-patch-compliance once assigned. Not gated: a compliance policy only flags non-compliant devices, it does not itself block access. Ref: https://learn.microsoft.com/en-us/graph/api/intune-deviceconfig-windows10compliancepolicy-create',
   'devices', '/deviceManagement/deviceCompliancePolicies', 'POST',
   '{"@odata.type": "#microsoft.graph.windows10CompliancePolicy", "displayName": "{{policyName}}", "osMinimumVersion": "{{minimumOsVersion}}"}'::jsonb,
   '["policyName", "minimumOsVersion"]'::jsonb, '{"expectStatus": 201}'::jsonb, '[]'::jsonb, 'active', false, false),

  ('action.create-autopilot-deployment-profile',
   'Create Autopilot Deployment Profile',
   'Creates an Azure AD-joined Windows Autopilot deployment profile via BETA POST /deviceManagement/windowsAutopilotDeploymentProfiles (DeviceManagementServiceConfig.ReadWrite.All; this resource has no v1.0 create operation). Remediates devices:autopilot-coverage once assigned. GATED: Autopilot OOBE configuration is enrollment itself — a misconfigured profile is exactly #2039''s "could brick enrollment" caveat. Ref: https://learn.microsoft.com/en-us/graph/api/intune-enrollment-azureadwindowsautopilotdeploymentprofile-create?view=graph-rest-beta',
   'devices', 'https://graph.microsoft.com/beta/deviceManagement/windowsAutopilotDeploymentProfiles', 'POST',
   '{"@odata.type": "#microsoft.graph.azureADWindowsAutopilotDeploymentProfile", "displayName": "{{profileName}}", "outOfBoxExperienceSetting": {"@odata.type": "microsoft.graph.outOfBoxExperienceSetting", "privacySettingsHidden": false, "eulaHidden": true, "userType": "standard", "deviceUsageType": "singleUser", "keyboardSelectionPageSkipped": false, "escapeLinkHidden": true}}'::jsonb,
   '["profileName"]'::jsonb, '{"expectStatus": 201}'::jsonb, '[]'::jsonb, 'active', false, true),

  ('action.assign-autopilot-deployment-profile',
   'Assign Autopilot Deployment Profile',
   'Assigns the Autopilot deployment profile to a group via BETA POST /deviceManagement/windowsAutopilotDeploymentProfiles/{id}/assignments — the profile''s own documented `assignments` relationship (group-based), distinct from the per-device-hash `assign` action. Remediates devices:autopilot-coverage. Ref: https://learn.microsoft.com/en-us/graph/api/resources/intune-enrollment-windowsautopilotdeploymentprofile?view=graph-rest-beta',
   'devices', 'https://graph.microsoft.com/beta/deviceManagement/windowsAutopilotDeploymentProfiles/{{profileId}}/assignments', 'POST',
   '{"@odata.type": "#microsoft.graph.windowsAutopilotDeploymentProfileAssignment", "target": {"@odata.type": "#microsoft.graph.groupAssignmentTarget", "groupId": "{{groupId}}"}}'::jsonb,
   '["profileId", "groupId"]'::jsonb, '{"expectStatus": 201}'::jsonb,
   '["action.create-autopilot-deployment-profile"]'::jsonb, 'active', false, false),

  ('action.delete-stale-device-record',
   'Delete Stale/Duplicate Device Record',
   'Deletes a stale or duplicate device object via DELETE /devices/{id} (Device.ReadWrite.All). Targets a device record already flagged by devices:stale-duplicate-records (no sign-in for 90+ days, or a duplicate deviceId from a re-enrolled device) — deleting the stale/duplicate record, not the actively-used one. Remediates devices:stale-duplicate-records. GATED: a destructive directory-object delete, gated per this project''s own practice for such actions (matches action.delete-group / action.delete-user / action.retire-device). Ref: https://learn.microsoft.com/en-us/graph/api/device-delete',
   'devices', '/devices/{{deviceObjectId}}', 'DELETE',
   '{}'::jsonb,
   '["deviceObjectId"]'::jsonb, '{"expectStatus": 204}'::jsonb, '[]'::jsonb, 'active', false, true)
ON CONFLICT (template_id) DO NOTHING;

-- ── 2. The themed pack ───────────────────────────────────────────────────────
INSERT INTO config_packs (pack_key, label, description, categories, status)
VALUES
  ('device-hardening-v1', 'Device & Intune Hardening',
   'Hardens Windows device management: creates and assigns a Windows Update ring, a BitLocker protection profile (encryption + recovery key escrow), an OS patch compliance policy, and an Autopilot deployment profile, plus stale/duplicate device record cleanup.',
   ARRAY['Devices','Security'], 'active')
ON CONFLICT (pack_key) DO NOTHING;

-- ── 3. Bind each template to the check it remediates (anchors carry NULL) ────
INSERT INTO config_pack_templates (pack_id, template_id, check_key, sort_order, depends_on_override)
SELECT cp.id, v.template_id, v.check_key, v.sort_order, v.depends_on_override
  FROM config_packs cp
  CROSS JOIN (VALUES
    ('action.create-windows-update-ring',          NULL::text,                            1, NULL::jsonb),
    ('action.update-config-profile-assignment',    'devices:update-rings-config',         2, '["action.create-windows-update-ring"]'::jsonb),
    ('action.create-bitlocker-protection-profile', NULL::text,                            3, NULL::jsonb),
    ('action.assign-bitlocker-encryption-profile', 'devices:encryption-status',            4, NULL::jsonb),
    ('action.assign-bitlocker-escrow-profile',     'devices:bitlocker-key-escrow',         5, NULL::jsonb),
    ('action.create-os-patch-compliance-policy',   NULL::text,                            6, NULL::jsonb),
    ('action.update-compliance-policy-assignment', 'devices:os-patch-compliance',          7, '["action.create-os-patch-compliance-policy"]'::jsonb),
    ('action.create-autopilot-deployment-profile', NULL::text,                            8, NULL::jsonb),
    ('action.assign-autopilot-deployment-profile', 'devices:autopilot-coverage',           9, NULL::jsonb),
    ('action.delete-stale-device-record',          'devices:stale-duplicate-records',     10, NULL::jsonb)
  ) AS v(template_id, check_key, sort_order, depends_on_override)
 WHERE cp.pack_key = 'device-hardening-v1'
   AND NOT EXISTS (
     SELECT 1 FROM config_pack_templates x
      WHERE x.pack_id = cp.id AND x.template_id = v.template_id
        AND (x.check_key IS NOT DISTINCT FROM v.check_key)
   );

-- Verification — the pack's rows, and the new we_can_run total (expect 16 + 5 = 21:
-- update-rings-config, encryption-status, bitlocker-key-escrow, os-patch-compliance,
-- autopilot-coverage, stale-duplicate-records = 6 new checks; anchors carry no
-- check_key so they don't count).
SELECT cp.pack_key, cpt.sort_order, cpt.template_id, cpt.check_key, cpt.depends_on_override
  FROM config_pack_templates cpt JOIN config_packs cp ON cp.id = cpt.pack_id
 WHERE cp.pack_key = 'device-hardening-v1' ORDER BY cpt.sort_order;

SELECT count(DISTINCT cpt.check_key) AS we_can_run_checks
  FROM config_pack_templates cpt JOIN config_packs cp ON cp.id = cpt.pack_id
 WHERE cpt.check_key IS NOT NULL AND cpt.template_id IS NOT NULL AND cp.status = 'active';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-12-device-hardening-write-pack-2039.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
