-- #2762 — Close the real coverage gap on the compliance surface (Feature #1128).
--
-- Real completion: 10 of the 36 `surface = 'compliance' AND availability =
-- 'available_now' AND check_coverage_count = 0` resources (live-queried
-- 2026-09-04; #1848's cached 34 has drifted slightly — using the live set per
-- the issue's own instruction). All 10 back onto a NEW, unfiltered PowerShell
-- read entry in `services/ps-execution/cmdlet-catalog.ps1` (companion commit),
-- each confirmed genuinely working app-only against the real testbed tenant
-- (mccawsoft2.onmicrosoft.com, tenants.id=1) by #1793's own live capability
-- survey — not a fresh probe this session ran (the local dev-server the
-- shaneapp://executeCmdlet courier needs is genuinely down, see
-- build-journal/2762.md and the filed finding), but real, repeated
-- (3-4 independent runs per cmdlet, consistent item counts), already-live
-- evidence against the SAME testbed tenant:
--
--   SELECT cmdlet_name, session_type, status, item_count
--   FROM ps_capability_survey_results
--   WHERE cmdlet_name IN (...) ORDER BY cmdlet_name, session_type, status;
--
-- Every mapping/severity_rules field below is a REAL field name: either
-- LIVE-observed on a real returned object this tenant has instances of
-- (Get-ComplianceRetentionEventType 3 items, Get-DlpSensitiveInformationType
-- 225 items, Get-ProtectionAlert 47 items, Get-RoleGroup 5 items,
-- Get-PolicyConfig 1 item, Get-FilePlanProperty* several items each -- see
-- `ps_capability_survey_results.property_names`), or, where this tenant
-- currently has ZERO live instances of the resource (RetentionCompliancePolicy,
-- RetentionComplianceRule, DlpComplianceRule, DeviceConditionalAccessPolicy,
-- DeviceConfigurationPolicy, ComplianceTag), DECLARED on the real M365DSC
-- module schema for that resource type (`derived_property_names`,
-- shape_derivation='derived_from_dsc') -- a real declared property name, not a
-- fabricated one, but never yet observed on a live object on this tenant. That
-- distinction is called out per-check below (mirrors docs/pillarmapping.md's
-- own REAL/declared-but-unobserved honesty convention, #1481).
--
-- Real matching-algorithm confirmation (map-monitor-checks.mjs
-- matchEndpointToResource, run directly against the real parsed catalog file
-- + full config_resources table, not hand-computed): 9 of 10 resolve at
-- `high` confidence (the DSC resource name, minus workload prefix, exactly
-- equals the cmdlet's noun); `compliance:retention-event-type-unlinked`
-- resolves at `low` confidence only because SCRetentionEventType's own name
-- lacks the cmdlet noun's "Compliance" segment (Get-ComplianceRetentionEventType
-- vs "RetentionEventType") -- a pre-existing scoring-algorithm quirk, not a
-- wrong match: it is still the correct, sole, unique config_resources row for
-- that cmdlet (verified no competing candidate exists). Recorded honestly as
-- `low` below rather than overstated.
--
-- The remaining 26 of the 36 are left for a real follow-up pass (issue body's
-- own "not all in one pass" allowance). Notable ones NOT covered this pass and
-- why, so a follow-up doesn't re-discover the same blockers:
--   - Get-CaseHoldPolicy/Rule, Get-ComplianceCase, Get-ComplianceSearch(Action),
--     Get-ComplianceSecurityFilter, Get-InsiderRiskPolicy,
--     Get-RecordReviewNotificationTemplateConfig, Get-AuditConfigurationPolicy,
--     Get-AutoSensitivityLabelPolicy/Rule: never attempted by #1793's survey
--     (no live-or-declared evidence either way) -- need a fresh probe once the
--     local dev-server / shaneapp://executeCmdlet path is restored.
--   - Get-InsiderRiskEntityList: surveyed, real error
--     (ErrorIrmEntityListInvalidGetParamet...) -- needs a specific entity-list
--     identity, not a blanket get-all; not a simple unfiltered read.
--   - Get-RoleGroupMember (backs SCRoleGroupMember, a separate, not-in-this-36
--     resource): surveyed `not_attempted`, "requires mandatory parameter(s)
--     [Identity]" -- would need a fan-out over the role groups this same
--     migration adds coverage for, left for a follow-up.
--   - Get-SCDLPSensitiveInformation(Groups), Get-SCFilePlanProperty(Object):
--     never surveyed; unclear these are even real top-level PowerShell cmdlet
--     names (no Microsoft Learn page found under these exact names) rather
--     than M365DSC-internal helper names -- needs verification, not a blind
--     catalog entry.
--   - Get-FilePlanPropertyAuthority/Category/Citation/Department/ReferenceId/
--     SubCategory, Get-SupervisoryReviewPolicyV2/Rule,
--     Get-DeviceConditionalAccessRule, Get-DeviceConfigurationRule: real,
--     live-confirmed working cmdlets (see the survey query above) but left
--     for a follow-up pass on real severity-signal design grounds -- the
--     FilePlanProperty* family is records-management taxonomy with no field
--     this session found a genuine risk signal in (would be a bare
--     existence/count check, which #2184's own discipline forbids), and the
--     *Rule resources are the nested child of a *Policy resource already
--     covered this pass by its parent (SCDeviceConditionalAccessPolicy /
--     SCDeviceConfigurationPolicy) -- covering both would double-count the
--     same real-world object under two resource rows.
--   - graph:beta:/informationProtection/policy/labels (the one Graph-executor
--     row in the original 36): out of scope for this PowerShell-focused pass,
--     left for a follow-up alongside the Graph label endpoints already
--     covered by compliance:missing-labels/label-errors.

BEGIN;

INSERT INTO monitor_checks (
  key, label, description, endpoint, method,
  properties, mapping, severity_rules,
  engines, frequency, requires_customer_script, status, executor_type,
  ps_cmdlet_key
) VALUES
(
  'compliance:retention-policy-coverage',
  'Retention Compliance Policy Coverage',
  'Microsoft Purview retention compliance policies (Exchange/SharePoint/OneDrive/Teams/Groups retention & disposition), checked for whether any exist at all and whether any that do exist are disabled. Field names (Enabled) are the real M365DSC SCRetentionCompliancePolicy resource schema; this tenant currently has zero live policies so the field has not been observed on a real object yet, only declared.',
  '(unused — executorType=powershell drives dispatch, not endpoint)',
  'GET',
  '["Name"]'::jsonb,
  '[{"sourceField":"Name","targetField":"retentionPolicyCount","transform":"count"},{"sourceField":"Name","targetField":"disabledRetentionPolicies","transform":"countWhere(''{{Enabled}} == false'')"}]'::jsonb,
  '[{"severity":"critical","expression":"{{retentionPolicyCount}} == 0","label":"No retention compliance policy is configured in Purview — Exchange, SharePoint, OneDrive, Teams and Groups content has no retention or disposition governance at all"},{"severity":"warning","expression":"{{disabledRetentionPolicies}} > 0","label":"One or more retention compliance polic(ies) exist but are disabled (Enabled=false) — configured but not currently enforcing retention"}]'::jsonb,
  '["compliance"]'::jsonb,
  'daily',
  false,
  'active',
  'powershell',
  'get-retention-compliance-policies'
),
(
  'compliance:retention-rule-no-action',
  'Retention Compliance Rules Without a Disposition Action',
  'Microsoft Purview retention compliance rules, checked for rules with no RetentionComplianceAction configured — a rule that matches content but performs no retain/delete/disposition action on it. Field name (RetentionComplianceAction) is the real M365DSC SCRetentionComplianceRule resource schema; this tenant currently has zero live rules so the field has not been observed on a real object yet, only declared.',
  '(unused — executorType=powershell drives dispatch, not endpoint)',
  'GET',
  '["Name"]'::jsonb,
  '[{"sourceField":"Name","targetField":"retentionRuleCount","transform":"count"},{"sourceField":"Name","targetField":"rulesWithoutAction","transform":"countWhere(''{{RetentionComplianceAction}} == null || {{RetentionComplianceAction}} == \"\"'')"}]'::jsonb,
  '[{"severity":"warning","expression":"{{rulesWithoutAction}} > 0","label":"One or more retention compliance rule(s) has no RetentionComplianceAction configured — the rule matches content but takes no retain/delete/disposition action on it"}]'::jsonb,
  '["compliance"]'::jsonb,
  'daily',
  false,
  'active',
  'powershell',
  'get-retention-compliance-rules'
),
(
  'compliance:dlp-rules-not-enforcing',
  'DLP Compliance Rules Without an Enforcement Action',
  'Microsoft Purview DLP compliance rules (the rule level, distinct from the DLP policy level compliance:zero-dlp-policies/weak-dlp-policies already cover), checked for rules that are disabled, and rules that neither block access, quarantine content, nor remove RMS protection on a match — detection/reporting only, no real enforcement. Field names (Disabled, BlockAccess, Quarantine, RemoveRMSTemplate) are the real M365DSC SCDLPComplianceRule resource schema; this tenant currently has zero live rules so the fields have not been observed on a real object yet, only declared.',
  '(unused — executorType=powershell drives dispatch, not endpoint)',
  'GET',
  '["Name"]'::jsonb,
  '[{"sourceField":"Name","targetField":"dlpRuleCount","transform":"count"},{"sourceField":"Name","targetField":"disabledDlpRules","transform":"countWhere(''{{Disabled}} == true'')"},{"sourceField":"Name","targetField":"detectionOnlyDlpRules","transform":"countWhere(''{{BlockAccess}} != true && {{Quarantine}} != true && {{RemoveRMSTemplate}} != true'')"}]'::jsonb,
  '[{"severity":"warning","expression":"{{disabledDlpRules}} > 0","label":"One or more DLP compliance rule(s) is disabled — configured but not currently enforcing"},{"severity":"info","expression":"{{detectionOnlyDlpRules}} > 0","label":"One or more DLP compliance rule(s) neither blocks access, quarantines, nor removes RMS protection on a match — detection/reporting only, no real enforcement action taken"}]'::jsonb,
  '["compliance"]'::jsonb,
  'daily',
  false,
  'active',
  'powershell',
  'get-dlp-compliance-rules'
),
(
  'compliance:app-conditional-access-policy-disabled',
  'Device Conditional Access Policies Disabled',
  'Security & Compliance Center device conditional access (mobile device mailbox) policies, checked for whether any exist and whether any are disabled. Field name (Enabled) is the real M365DSC SCDeviceConditionalAccessPolicy resource schema; this tenant currently has zero live policies so the field has not been observed on a real object yet, only declared.',
  '(unused — executorType=powershell drives dispatch, not endpoint)',
  'GET',
  '["Name"]'::jsonb,
  '[{"sourceField":"Name","targetField":"deviceConditionalAccessPolicyCount","transform":"count"},{"sourceField":"Name","targetField":"disabledPolicies","transform":"countWhere(''{{Enabled}} == false'')"}]'::jsonb,
  '[{"severity":"info","expression":"{{deviceConditionalAccessPolicyCount}} == 0","label":"No Security & Compliance device conditional access (mobile device mailbox) policy is configured"},{"severity":"warning","expression":"{{disabledPolicies}} > 0","label":"One or more device conditional access polic(ies) exist but are disabled"}]'::jsonb,
  '["compliance"]'::jsonb,
  'daily',
  false,
  'active',
  'powershell',
  'get-device-conditional-access-policies'
),
(
  'compliance:device-config-policy-weak-password',
  'Device Configuration Policies Not Requiring a Passcode',
  'Security & Compliance Center device configuration (mobile device mailbox) policies, checked for enabled policies that do not require a passcode on the device. Field names (Enabled, PasswordRequired) are the real M365DSC SCDeviceConfigurationPolicy resource schema; this tenant currently has zero live policies so the fields have not been observed on a real object yet, only declared.',
  '(unused — executorType=powershell drives dispatch, not endpoint)',
  'GET',
  '["Name"]'::jsonb,
  '[{"sourceField":"Name","targetField":"deviceConfigPolicyCount","transform":"count"},{"sourceField":"Name","targetField":"policiesNotRequiringPassword","transform":"countWhere(''{{Enabled}} == true && {{PasswordRequired}} == false'')"}]'::jsonb,
  '[{"severity":"warning","expression":"{{policiesNotRequiringPassword}} > 0","label":"One or more enabled device configuration polic(ies) does not require a passcode on the mobile device (PasswordRequired=false)"}]'::jsonb,
  '["compliance"]'::jsonb,
  'daily',
  false,
  'active',
  'powershell',
  'get-device-configuration-policies'
),
(
  'compliance:sensitive-info-type-custom',
  'Custom Sensitive Information Types',
  'Microsoft Purview sensitive information type taxonomy (225 real entries on the testbed tenant, live-observed), checked for how many are custom (tenant-authored, not Microsoft-provided out-of-the-box) definitions — custom classifiers are a real, tenant-specific config surface worth tracking for staleness/accuracy review, unlike the built-in catalog. Field name (IsOutOfBox) is live-observed on real returned objects (Get-DlpSensitiveInformationType, #1793 survey).',
  '(unused — executorType=powershell drives dispatch, not endpoint)',
  'GET',
  '["Id"]'::jsonb,
  '[{"sourceField":"Id","targetField":"sensitiveInfoTypeCount","transform":"count"},{"sourceField":"Id","targetField":"customSensitiveInfoTypes","transform":"countWhere(''{{IsOutOfBox}} == false'')"}]'::jsonb,
  '[{"severity":"info","expression":"{{customSensitiveInfoTypes}} > 0","label":"One or more custom (non-Microsoft-provided) sensitive information type(s) are defined in this tenant''s Purview taxonomy — review custom classifier definitions for accuracy and staleness"}]'::jsonb,
  '["compliance"]'::jsonb,
  'daily',
  false,
  'active',
  'powershell',
  'get-dlp-sensitive-info-types'
),
(
  'compliance:protection-alert-policy-disabled',
  'Protection Alert Policies Disabled',
  'Microsoft Purview protection alert policies (47 real entries on the testbed tenant, live-observed), checked for how many are disabled overall and, specifically, how many Microsoft-provided DEFAULT alert policies (IsSystemRule=true — e.g. malware campaign, mass-download, phishing detections) are disabled. Field names (Disabled, IsSystemRule) are live-observed on real returned objects (Get-ProtectionAlert, #1793 survey).',
  '(unused — executorType=powershell drives dispatch, not endpoint)',
  'GET',
  '["Name"]'::jsonb,
  '[{"sourceField":"Name","targetField":"protectionAlertCount","transform":"count"},{"sourceField":"Name","targetField":"disabledAlerts","transform":"countWhere(''{{Disabled}} == true'')"},{"sourceField":"Name","targetField":"disabledSystemAlerts","transform":"countWhere(''{{Disabled}} == true && {{IsSystemRule}} == true'')"}]'::jsonb,
  '[{"severity":"warning","expression":"{{disabledSystemAlerts}} > 0","label":"One or more Microsoft-provided DEFAULT alert polic(ies) is disabled — a built-in Purview protection alert is not currently monitoring this tenant"},{"severity":"info","expression":"{{disabledAlerts}} > 0","label":"One or more Purview protection alert polic(ies) is disabled"}]'::jsonb,
  '["compliance"]'::jsonb,
  'daily',
  false,
  'active',
  'powershell',
  'get-protection-alerts'
),
(
  'compliance:role-group-empty-membership',
  'Security & Compliance Role Groups With No Members',
  'Security & Compliance Center role groups (5 real entries on the testbed tenant, live-observed), checked for how many have zero members assigned — the role''s permissions are provisioned but nobody currently holds them. Field name (Members) is live-observed on real returned objects (Get-RoleGroup, #1793 survey).',
  '(unused — executorType=powershell drives dispatch, not endpoint)',
  'GET',
  '["Name"]'::jsonb,
  '[{"sourceField":"Name","targetField":"roleGroupCount","transform":"count"},{"sourceField":"Name","targetField":"emptyRoleGroups","transform":"countWhere(''{{Members}} length==0'')"}]'::jsonb,
  '[{"severity":"info","expression":"{{emptyRoleGroups}} > 0","label":"One or more Security & Compliance role group(s) has zero members assigned — the role''s permissions are provisioned but nobody currently holds them"}]'::jsonb,
  '["compliance"]'::jsonb,
  'daily',
  false,
  'active',
  'powershell',
  'get-compliance-role-groups'
),
(
  'compliance:record-tag-missing-reviewer',
  'Regulatory Retention Labels Without a Disposition Reviewer',
  'Microsoft Purview retention labels (compliance tags), checked for regulatory labels (Regulatory=true) with no ReviewerEmail configured — records subject to regulatory retention have no disposition reviewer assigned before final deletion. Field names (Regulatory, ReviewerEmail) are the real M365DSC SCComplianceTag resource schema; this tenant currently has zero live tags so the fields have not been observed on a real object yet, only declared.',
  '(unused — executorType=powershell drives dispatch, not endpoint)',
  'GET',
  '["Name"]'::jsonb,
  '[{"sourceField":"Name","targetField":"complianceTagCount","transform":"count"},{"sourceField":"Name","targetField":"regulatoryTagsWithoutReviewer","transform":"countWhere(''{{Regulatory}} == true && {{ReviewerEmail}} length==0'')"}]'::jsonb,
  '[{"severity":"warning","expression":"{{regulatoryTagsWithoutReviewer}} > 0","label":"One or more regulatory retention label(s) (Regulatory=true) has no ReviewerEmail configured — records subject to regulatory retention have no disposition reviewer assigned before final deletion"}]'::jsonb,
  '["compliance"]'::jsonb,
  'daily',
  false,
  'active',
  'powershell',
  'get-compliance-tags'
),
(
  'compliance:retention-event-type-unlinked',
  'Retention Event Types With No Linked Compliance Tags',
  'Microsoft Purview event-based retention event types (3 real entries on the testbed tenant, live-observed), checked for enabled event types with no Compliance Tags linked — an event-based retention trigger with nothing configured to act on the event when it fires. Field names (Disabled, ComplianceTags) are live-observed on real returned objects (Get-ComplianceRetentionEventType, #1793 survey).',
  '(unused — executorType=powershell drives dispatch, not endpoint)',
  'GET',
  '["Name"]'::jsonb,
  '[{"sourceField":"Name","targetField":"retentionEventTypeCount","transform":"count"},{"sourceField":"Name","targetField":"eventTypesWithoutTags","transform":"countWhere(''{{Disabled}} == false && {{ComplianceTags}} length==0'')"}]'::jsonb,
  '[{"severity":"info","expression":"{{eventTypesWithoutTags}} > 0","label":"One or more enabled retention event type(s) has no Compliance Tags linked to it — an event-based retention trigger with nothing configured to act on the event"}]'::jsonb,
  '["compliance"]'::jsonb,
  'daily',
  false,
  'active',
  'powershell',
  'get-retention-event-types'
);

INSERT INTO monitoring_package_checks (package_key, check_key, sort_order)
SELECT v.package_key, v.check_key,
  COALESCE((SELECT MAX(mpc2.sort_order) FROM monitoring_package_checks mpc2 WHERE mpc2.package_key = v.package_key), 0)
    + row_number() OVER (PARTITION BY v.package_key ORDER BY v.check_key)
FROM (VALUES
  ('core:premier', 'compliance:retention-policy-coverage'),
  ('core:growth', 'compliance:retention-policy-coverage'),
  ('detail:full-item-collection', 'compliance:retention-policy-coverage'),
  ('assess:copilot-readiness', 'compliance:retention-policy-coverage'),
  ('core:premier', 'compliance:retention-rule-no-action'),
  ('core:growth', 'compliance:retention-rule-no-action'),
  ('detail:full-item-collection', 'compliance:retention-rule-no-action'),
  ('assess:copilot-readiness', 'compliance:retention-rule-no-action'),
  ('core:premier', 'compliance:dlp-rules-not-enforcing'),
  ('core:growth', 'compliance:dlp-rules-not-enforcing'),
  ('detail:full-item-collection', 'compliance:dlp-rules-not-enforcing'),
  ('assess:copilot-readiness', 'compliance:dlp-rules-not-enforcing'),
  ('core:premier', 'compliance:app-conditional-access-policy-disabled'),
  ('core:growth', 'compliance:app-conditional-access-policy-disabled'),
  ('detail:full-item-collection', 'compliance:app-conditional-access-policy-disabled'),
  ('assess:copilot-readiness', 'compliance:app-conditional-access-policy-disabled'),
  ('core:premier', 'compliance:device-config-policy-weak-password'),
  ('core:growth', 'compliance:device-config-policy-weak-password'),
  ('detail:full-item-collection', 'compliance:device-config-policy-weak-password'),
  ('assess:copilot-readiness', 'compliance:device-config-policy-weak-password'),
  ('core:premier', 'compliance:sensitive-info-type-custom'),
  ('core:growth', 'compliance:sensitive-info-type-custom'),
  ('detail:full-item-collection', 'compliance:sensitive-info-type-custom'),
  ('assess:copilot-readiness', 'compliance:sensitive-info-type-custom'),
  ('core:premier', 'compliance:protection-alert-policy-disabled'),
  ('core:growth', 'compliance:protection-alert-policy-disabled'),
  ('detail:full-item-collection', 'compliance:protection-alert-policy-disabled'),
  ('assess:copilot-readiness', 'compliance:protection-alert-policy-disabled'),
  ('core:premier', 'compliance:role-group-empty-membership'),
  ('core:growth', 'compliance:role-group-empty-membership'),
  ('detail:full-item-collection', 'compliance:role-group-empty-membership'),
  ('assess:copilot-readiness', 'compliance:role-group-empty-membership'),
  ('core:premier', 'compliance:record-tag-missing-reviewer'),
  ('core:growth', 'compliance:record-tag-missing-reviewer'),
  ('detail:full-item-collection', 'compliance:record-tag-missing-reviewer'),
  ('assess:copilot-readiness', 'compliance:record-tag-missing-reviewer'),
  ('core:premier', 'compliance:retention-event-type-unlinked'),
  ('core:growth', 'compliance:retention-event-type-unlinked'),
  ('detail:full-item-collection', 'compliance:retention-event-type-unlinked'),
  ('assess:copilot-readiness', 'compliance:retention-event-type-unlinked')
) AS v(package_key, check_key)
ON CONFLICT DO NOTHING;

-- config_resource_check_coverage is normally recomputed by
-- scripts/config-state/build-resource-model.mjs's full pipeline (which also
-- re-fetches Graph/m365dsc metadata over the network — not run here, per
-- #2761's own precedent). The real matchEndpointToResource() result for each
-- of these 10 checks was confirmed by running that function directly against
-- the real parsed cmdlet-catalog.ps1 (companion commit) and the full
-- config_resources table before writing this migration (see build-journal/
-- 2762.md for the exact run and output) — inserted directly here, scoped to
-- just these ten checks, matching what the full pipeline would produce.
INSERT INTO config_resource_check_coverage (config_resource_id, monitor_check_id, check_key, executor_type, match_basis, confidence, matched_on)
SELECT r.id, c.id, c.key, c.executor_type, 'ps-cmdlet', v.confidence, v.cmdlet
FROM (VALUES
  ('compliance:retention-policy-coverage', 'm365dsc:SCRetentionCompliancePolicy', 'high', 'Get-RetentionCompliancePolicy'),
  ('compliance:retention-rule-no-action', 'm365dsc:SCRetentionComplianceRule', 'high', 'Get-RetentionComplianceRule'),
  ('compliance:dlp-rules-not-enforcing', 'm365dsc:SCDLPComplianceRule', 'high', 'Get-DlpComplianceRule'),
  ('compliance:app-conditional-access-policy-disabled', 'm365dsc:SCDeviceConditionalAccessPolicy', 'high', 'Get-DeviceConditionalAccessPolicy'),
  ('compliance:device-config-policy-weak-password', 'm365dsc:SCDeviceConfigurationPolicy', 'high', 'Get-DeviceConfigurationPolicy'),
  ('compliance:sensitive-info-type-custom', 'm365dsc:SCDLPSensitiveInformationType', 'high', 'Get-DlpSensitiveInformationType'),
  ('compliance:protection-alert-policy-disabled', 'm365dsc:SCProtectionAlert', 'high', 'Get-ProtectionAlert'),
  ('compliance:role-group-empty-membership', 'm365dsc:SCRoleGroup', 'high', 'Get-RoleGroup'),
  ('compliance:record-tag-missing-reviewer', 'm365dsc:SCComplianceTag', 'high', 'Get-ComplianceTag'),
  ('compliance:retention-event-type-unlinked', 'm365dsc:SCRetentionEventType', 'low', 'Get-ComplianceRetentionEventType')
) AS v(check_key, resource_key, confidence, cmdlet)
JOIN monitor_checks c ON c.key = v.check_key
JOIN config_resources r ON r.resource_key = v.resource_key
ON CONFLICT DO NOTHING;

UPDATE config_resources r SET check_coverage_count = COALESCE(c.n, 0)
  FROM (SELECT config_resource_id, count(*) n FROM config_resource_check_coverage
        WHERE config_resource_id IS NOT NULL GROUP BY 1) c
 WHERE c.config_resource_id = r.id;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-compliance-surface-coverage-2762.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
